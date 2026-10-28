// src/components/live/Scoreboard.tsx
import { useState } from 'react';
import { Pencil, Clock, Check, X } from 'lucide-react';
import { db } from '../../db/db';
import { useLiveMatch } from '../../features/match-creations/components/context/LiveMatchContext';

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
    localTeamId?: number;
    visitorTeamId?: number;
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
        const rivalName = side === 'local' ? visitorName : localName;

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

        if (trimmed.toLowerCase() === rivalName.trim().toLowerCase()) {
            setRenameError('Ya existe otro equipo con ese nombre.');
            return;
        }

        try {
            const duplicate = await db.teams
                .where('name')
                .equalsIgnoreCase(trimmed)
                .and(t => !t.isArchived && t.id !== teamId)
                .first();

            if (duplicate) {
                setRenameError('Ya existe otro equipo activo con ese nombre.');
                return;
            }

            await db.teams.update(teamId, { name: trimmed });
            setEditingSide(null);
            setRenameError(null);
        } catch (err) {
            console.error('Error renombrando equipo:', err);
            setEditingSide(null);
        }
    };

    const canEditTimer = Boolean(onTimerClick) && !isTimerRunning;
    const isTraditional = (match?.config?.mode || 'traditional') === 'traditional';

    return (
        <section className={`scoreboard-container ${!showTimer ? 'no-timer' : ''}`}>
            {/* Reloj Central (Píldora Digital) */}
            {showTimer && (
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
            </div>
        </section>
    );
}
