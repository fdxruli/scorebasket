// src/components/live/Scoreboard.tsx
import { useState, useRef } from 'react';
import { Pencil, Clock, Check, X } from 'lucide-react';
import { renameTeamSafely } from '../../utils/matchHelpers';
import { useLiveMatch } from '../../features/match-creations/components/context/LiveMatchContext';
import { db } from '../../db/db';
import { TimeoutService } from '../../db/timeout.service';
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
    showCenterTimer?: boolean;
}

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
    showCenterTimer = false,
    onTimerClick,
    localTeamId,
    visitorTeamId
}: ScoreboardProps) {
    const { match } = useLiveMatch();
    const resolvedLocalId = localTeamId ?? match?.localTeamId;
    const resolvedVisitorId = visitorTeamId ?? match?.visitorTeamId;

    const [editingSide, setEditingSide] = useState<'local' | 'visitor' | null>(null);
    const [draftName, setDraftName] = useState('');
    const [renameError, setRenameError] = useState<string | null>(null);
    const timeoutInFlightRef = useRef(false);

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

    const maxTimeouts = match?.config?.traditional?.timeoutsPerTeam ?? 3;

    const handleTimeoutClick = async (side: 'local' | 'visitor') => {
        if (!match?.id || timeoutInFlightRef.current) return;

        const currentCount = (side === 'local' ? match.localTimeouts : match.visitorTimeouts) ?? 0;

        // Si ya llegó al máximo o el partido finalizó, NO permitir incrementos ni reiniciar a 0
        if (currentCount >= maxTimeouts || match.status === 'finished') {
            return;
        }

        // R1.3-A: Desbloquear AudioContext síncronamente en el evento directo del usuario
        // antes de la primera espera asíncrona (IndexedDB transaction), para preservar el token
        // de user activation en navegadores móviles (iOS Safari, Chrome Android).
        unlockAudioContext();

        timeoutInFlightRef.current = true;
        try {
            // La validación de estado/límites, el incremento del contador y la pausa idempotente
            // del cronómetro ocurren de forma transaccional dentro de TimeoutService.requestTimeout().
            // Nunca se invoca toggleTimer() y el silbato solo se emite si la solicitud fue concedida (R1.2-B / R1.3-A).
            await TimeoutService.requestTimeout(match.id, side, {
                onGranted: () => {
                    playWhistle();
                }
            });
        } finally {
            timeoutInFlightRef.current = false;
        }
    };

    const canEditTimer = Boolean(onTimerClick) && !isTimerRunning;
    const isTraditional = (match?.config?.mode || 'traditional') === 'traditional';
    const possession = match?.possession ?? null;
    const localTimeouts = match?.localTimeouts ?? 0;
    const visitorTimeouts = match?.visitorTimeouts ?? 0;

    return (
        <section className={`scoreboard-container ${!showTimer ? 'no-timer' : ''}`}>
            {/* Reloj Central (opcional para visualización clásica) */}
            {showCenterTimer && showTimer && (
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

                        {showTimer && maxTimeouts > 0 && (
                            <button
                                type="button"
                                onClick={() => handleTimeoutClick('local')}
                                disabled={localTimeouts >= maxTimeouts || match?.status === 'finished'}
                                className={`btn-timeout-card local ${localTimeouts >= maxTimeouts ? 'is-maxed' : ''}`}
                                title={
                                    localTimeouts >= maxTimeouts
                                        ? 'Tiempos fuera agotados'
                                        : 'Pedir Tiempo Fuera (pausa el reloj y suena silbato)'
                                }
                            >
                                <div className="timeout-header-row">
                                    <span className="timeout-title">
                                        <Clock size={12} />
                                        T. FUERA
                                    </span>
                                    <span className="timeout-count-badge">
                                        {localTimeouts >= maxTimeouts ? 'AGOTADOS' : `${maxTimeouts - localTimeouts} disp.`}
                                    </span>
                                </div>
                                <div className="timeout-dots-row">
                                    {Array.from({ length: maxTimeouts }).map((_, idx) => (
                                        <span
                                            key={idx}
                                            className={`timeout-dot ${idx < localTimeouts ? 'used' : 'available'}`}
                                        />
                                    ))}
                                </div>
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

                        {showTimer && maxTimeouts > 0 && (
                            <button
                                type="button"
                                onClick={() => handleTimeoutClick('visitor')}
                                disabled={visitorTimeouts >= maxTimeouts || match?.status === 'finished'}
                                className={`btn-timeout-card visitor ${visitorTimeouts >= maxTimeouts ? 'is-maxed' : ''}`}
                                title={
                                    visitorTimeouts >= maxTimeouts
                                        ? 'Tiempos fuera agotados'
                                        : 'Pedir Tiempo Fuera (pausa el reloj y suena silbato)'
                                }
                            >
                                <div className="timeout-header-row">
                                    <span className="timeout-title">
                                        <Clock size={12} />
                                        T. FUERA
                                    </span>
                                    <span className="timeout-count-badge">
                                        {visitorTimeouts >= maxTimeouts ? 'AGOTADOS' : `${maxTimeouts - visitorTimeouts} disp.`}
                                    </span>
                                </div>
                                <div className="timeout-dots-row">
                                    {Array.from({ length: maxTimeouts }).map((_, idx) => (
                                        <span
                                            key={idx}
                                            className={`timeout-dot ${idx < visitorTimeouts ? 'used' : 'available'}`}
                                        />
                                    ))}
                                </div>
                            </button>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}
