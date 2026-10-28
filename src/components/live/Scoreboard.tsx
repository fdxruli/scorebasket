// src/components/live/Scoreboard.tsx
import { useState } from 'react';
import { Pencil, Clock, Check, X } from 'lucide-react';
import { renameTeamSafely } from '../../utils/matchHelpers';
import { useLiveMatch } from '../../features/match-creations/components/context/LiveMatchContext';
import { db } from '../../db/db';
import { unlockAudioContext, playWhistle } from '../../utils/soundEffects';

interface ScoreboardProps {
    localName: string;
    visitorName: string;
    localScore: number;
    visitorScore: number;
    localFouls: number;
    visitorFouls: number;
    timeLeft: number;
    isTimerRunning: boolean;
    showTimer?: boolean;
    showFouls?: boolean;
    onTimerClick?: () => void;
    onToggleTimer?: () => Promise<void> | void;
    localTeamId?: number;
    visitorTeamId?: number;
}

const MAX_TIMEOUTS = 3;

const formatTime = (seconds: number) => {
    const s = Math.ceil(seconds);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
};

export function Scoreboard({
    localName, visitorName,
    localScore, visitorScore,
    localFouls, visitorFouls,
    timeLeft, isTimerRunning,
    showTimer = true,
    showFouls = true,
    onTimerClick,
    onToggleTimer,
    localTeamId,
    visitorTeamId
}: ScoreboardProps) {
    const { match } = useLiveMatch();
    const resolvedLocalId = localTeamId ?? match?.localTeamId;
    const resolvedVisitorId = visitorTeamId ?? match?.visitorTeamId;

    const [editingSide, setEditingSide] = useState<'local' | 'visitor' | null>(null);
    const [draftName, setDraftName] = useState('');
    const [renameError, setRenameError] = useState<string | null>(null);

    const startEditing = (side: 'local' | 'visitor', currentName: string) => {
        const teamId = side === 'local' ? resolvedLocalId : resolvedVisitorId;
        if (!teamId) return;
        setEditingSide(side);
        setDraftName(currentName);
        setRenameError(null);
    };

    const saveRename = async (side: 'local' | 'visitor') => {
        const teamId = side === 'local' ? resolvedLocalId : resolvedVisitorId;
        const currentName = side === 'local' ? localName : visitorName;
        const rivalTeamId = side === 'local' ? resolvedVisitorId : resolvedLocalId;

        if (!teamId) {
            setEditingSide(null);
            return;
        }

        const trimmed = draftName.trim();
        if (!trimmed || trimmed === currentName) {
            setEditingSide(null);
            setRenameError(null);
            return;
        }

        try {
            const result = await renameTeamSafely(teamId, trimmed, rivalTeamId);
            if (!result.ok) {
                setRenameError(result.error ?? 'No se pudo renombrar el equipo.');
                return;
            }
            setEditingSide(null);
            setRenameError(null);
        } catch (err) {
            console.error('Error renombrando equipo:', err);
            setRenameError('No se pudo renombrar el equipo.');
        }
    };

    const handleTogglePossession = async () => {
        if (!match?.id) return;
        const current = match.possession ?? null;
        const nextPossession: 'local' | 'visitor' = current === 'local' ? 'visitor' : 'local';
        await db.matches.update(match.id, { possession: nextPossession });
    };

    const handleTimeoutClick = async (side: 'local' | 'visitor') => {
        if (!match?.id) return;
        unlockAudioContext();

        const currentCount = (side === 'local' ? match.localTimeouts : match.visitorTimeouts) ?? 0;

        // Si ya llegó al máximo (3), un toque adicional permite reiniciarlo a 0
        if (currentCount >= MAX_TIMEOUTS) {
            await db.matches.update(
                match.id,
                side === 'local' ? { localTimeouts: 0 } : { visitorTimeouts: 0 }
            );
            return;
        }

        // 1. Si el reloj está corriendo, pausarlo automáticamente
        if (isTimerRunning) {
            if (onToggleTimer) {
                await onToggleTimer();
            } else if (match.timerLastStart) {
                const elapsed = (Date.now() - match.timerLastStart.getTime()) / 1000;
                await db.matches.update(match.id, {
                    timerLastStart: undefined,
                    timerSecondsRemaining: Math.max(0, (match.timerSecondsRemaining || 0) - elapsed)
                });
            }
        }

        // 2. Sonar silbato de árbitro
        playWhistle();

        // 3. Incrementar contador de tiempos fuera del equipo
        const nextCount = currentCount + 1;
        await db.matches.update(
            match.id,
            side === 'local' ? { localTimeouts: nextCount } : { visitorTimeouts: nextCount }
        );
    };

    const canEditTimer = Boolean(onTimerClick) && !isTimerRunning;
    const isTraditional = (match?.config?.mode || 'traditional') === 'traditional';
    const possession = match?.possession ?? null;
    const localTimeouts = match?.localTimeouts ?? 0;
    const visitorTimeouts = match?.visitorTimeouts ?? 0;

    return (
        <section className={`scoreboard-container ${!showTimer ? 'no-timer' : ''}`}>
            {/* Reloj Central + Flecha de Posesión Alterna */}
            {showTimer && (
                <div className="timer-center-hub">
                    <button
                        type="button"
                        className={`timer-pill ${isTimerRunning ? 'running' : 'paused'} ${canEditTimer ? 'editable' : ''}`}
                        onClick={canEditTimer ? onTimerClick : undefined}
                        disabled={!canEditTimer}
                        title={canEditTimer ? 'Toca para ajustar el reloj' : 'Pausa el reloj para editarlo'}
                    >
                        <span className="timer-digits">{formatTime(timeLeft)}</span>
                        {canEditTimer && (
                            <span className="timer-edit-hint">
                                <Clock size={11} />
                                EDITAR
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={handleTogglePossession}
                        className={`possession-pill ${possession ? `is-${possession}` : 'is-neutral'}`}
                        title="Alternar flecha de posesión (Local / Visitante)"
                        aria-label="Alternar posesión"
                    >
                        {possession === 'local' && <span>◀ POS</span>}
                        {possession === 'visitor' && <span>POS ▶</span>}
                        {!possession && <span>POS •</span>}
                    </button>
                </div>
            )}

            {/* Card Local */}
            <div className={`score-card local ${localScore > visitorScore ? 'is-leading' : ''}`}>
                <span className="score-card-role">LOCAL</span>

                {editingSide === 'local' ? (
                    <div className="team-rename-inline">
                        <input
                            type="text"
                            value={draftName}
                            onChange={e => {
                                setDraftName(e.target.value);
                                setRenameError(null);
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Enter') saveRename('local');
                                if (e.key === 'Escape') setEditingSide(null);
                            }}
                            className="team-rename-input"
                            autoFocus
                        />
                        <button type="button" onClick={() => saveRename('local')} className="team-rename-btn ok" aria-label="Guardar">
                            <Check size={14} />
                        </button>
                        <button type="button" onClick={() => setEditingSide(null)} className="team-rename-btn cancel" aria-label="Cancelar">
                            <X size={14} />
                        </button>
                    </div>
                ) : (
                    <h2
                        className="team-name"
                        onClick={() => startEditing('local', localName)}
                        style={{
                            cursor: resolvedLocalId ? 'pointer' : undefined,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.35rem'
                        }}
                        title="Toca para editar el nombre del equipo"
                    >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {localName}
                        </span>
                        {resolvedLocalId && (
                            <Pencil size={13} style={{ opacity: 0.45, flexShrink: 0 }} />
                        )}
                    </h2>
                )}
                {editingSide === 'local' && renameError && (
                    <span className="team-rename-error">{renameError}</span>
                )}

                <div className="score-big">{localScore}</div>

                {(showFouls || showTimer) && (
                    <div className="team-meta-row">
                        {showFouls && (
                            <div className="fouls-bar" title={`${localFouls} faltas de equipo`}>
                                <div className="fouls-dots">
                                    {[...Array(5)].map((_, i) => (
                                        <div
                                            key={i}
                                            className={`dot ${i < localFouls ? 'active' : ''}`}
                                        />
                                    ))}
                                </div>
                                <span className="fouls-count-label">{localFouls} FAL</span>
                                {isTraditional && localFouls >= 5 && (
                                    <span className="bonus-pill">BONUS</span>
                                )}
                            </div>
                        )}

                        {showTimer && (
                            <button
                                type="button"
                                onClick={() => handleTimeoutClick('local')}
                                className={`timeout-chip local ${localTimeouts >= MAX_TIMEOUTS ? 'maxed' : ''}`}
                                title={
                                    localTimeouts >= MAX_TIMEOUTS
                                        ? 'Tiempos fuera agotados (toca para reiniciar a 0)'
                                        : 'Pedir Tiempo Fuera (pausa el reloj y suena silbato)'
                                }
                            >
                                <span>T. FUERA ({localTimeouts}/{MAX_TIMEOUTS})</span>
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Card Visitante */}
            <div className={`score-card visitor ${visitorScore > localScore ? 'is-leading' : ''}`}>
                <span className="score-card-role">VISITA</span>

                {editingSide === 'visitor' ? (
                    <div className="team-rename-inline">
                        <input
                            type="text"
                            value={draftName}
                            onChange={e => {
                                setDraftName(e.target.value);
                                setRenameError(null);
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Enter') saveRename('visitor');
                                if (e.key === 'Escape') setEditingSide(null);
                            }}
                            className="team-rename-input"
                            autoFocus
                        />
                        <button type="button" onClick={() => saveRename('visitor')} className="team-rename-btn ok" aria-label="Guardar">
                            <Check size={14} />
                        </button>
                        <button type="button" onClick={() => setEditingSide(null)} className="team-rename-btn cancel" aria-label="Cancelar">
                            <X size={14} />
                        </button>
                    </div>
                ) : (
                    <h2
                        className="team-name"
                        onClick={() => startEditing('visitor', visitorName)}
                        style={{
                            cursor: resolvedVisitorId ? 'pointer' : undefined,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.35rem'
                        }}
                        title="Toca para editar el nombre del equipo"
                    >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {visitorName}
                        </span>
                        {resolvedVisitorId && (
                            <Pencil size={13} style={{ opacity: 0.45, flexShrink: 0 }} />
                        )}
                    </h2>
                )}
                {editingSide === 'visitor' && renameError && (
                    <span className="team-rename-error">{renameError}</span>
                )}

                <div className="score-big">{visitorScore}</div>

                {(showFouls || showTimer) && (
                    <div className="team-meta-row">
                        {showFouls && (
                            <div className="fouls-bar" title={`${visitorFouls} faltas de equipo`}>
                                <div className="fouls-dots">
                                    {[...Array(5)].map((_, i) => (
                                        <div
                                            key={i}
                                            className={`dot ${i < visitorFouls ? 'active' : ''}`}
                                        />
                                    ))}
                                </div>
                                <span className="fouls-count-label">{visitorFouls} FAL</span>
                                {isTraditional && visitorFouls >= 5 && (
                                    <span className="bonus-pill">BONUS</span>
                                )}
                            </div>
                        )}

                        {showTimer && (
                            <button
                                type="button"
                                onClick={() => handleTimeoutClick('visitor')}
                                className={`timeout-chip visitor ${visitorTimeouts >= MAX_TIMEOUTS ? 'maxed' : ''}`}
                                title={
                                    visitorTimeouts >= MAX_TIMEOUTS
                                        ? 'Tiempos fuera agotados (toca para reiniciar a 0)'
                                        : 'Pedir Tiempo Fuera (pausa el reloj y suena silbato)'
                                }
                            >
                                <span>T. FUERA ({visitorTimeouts}/{MAX_TIMEOUTS})</span>
                            </button>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}
