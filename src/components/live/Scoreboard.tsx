// src/components/live/Scoreboard.tsx
import { Pencil } from 'lucide-react';
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

    const handleRenameTeam = async (teamId: number | undefined, currentName: string) => {
        if (!teamId) return;
        const newName = window.prompt('Nuevo nombre del equipo:', currentName);
        if (newName === null) return;
        const trimmed = newName.trim();
        if (!trimmed || trimmed === currentName) return;

        const rivalName = teamId === resolvedLocalId ? visitorName : localName;
        if (trimmed.toLowerCase() === rivalName.trim().toLowerCase()) {
            window.alert('Ya existe otro equipo activo con ese nombre.');
            return;
        }

        try {
            const duplicate = await db.teams
                .where('name')
                .equalsIgnoreCase(trimmed)
                .and(t => !t.isArchived && t.id !== teamId)
                .first();

            if (duplicate) {
                window.alert('Ya existe otro equipo activo con ese nombre.');
                return;
            }

            await db.teams.update(teamId, { name: trimmed });
        } catch (err) {
            console.error('Error renombrando equipo:', err);
        }
    };

    const canEditTimer = Boolean(onTimerClick) && !isTimerRunning;

    return (
        <section className="scoreboard-container">
            {/* Reloj Central (Píldora Digital) */}
            {showTimer && (
                <div
                    className={`timer-pill ${isTimerRunning ? 'running' : ''}`}
                    onClick={canEditTimer ? onTimerClick : undefined}
                    style={canEditTimer ? { cursor: 'pointer' } : undefined}
                    title={canEditTimer ? 'Toca para ajustar el reloj (en pausa)' : undefined}
                >
                    {formatTime(timeLeft)}
                </div>
            )}

            {/* Card Local */}
            <div className="score-card local">
                <span className="score-card-role">HOME // LOCAL</span>
                <h2
                    className="team-name"
                    onClick={() => handleRenameTeam(resolvedLocalId, localName)}
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
                <div className="score-big">{localScore}</div>
                
                {showFouls && (
                    <div className="fouls-dots" title={`${localFouls} faltas de equipo`}>
                        {[...Array(5)].map((_, i) => (
                            <div 
                                key={i} 
                                className={`dot ${i < localFouls ? 'active' : ''}`} 
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Card Visitante */}
            <div className="score-card visitor">
                <span className="score-card-role">AWAY // VISITA</span>
                <h2
                    className="team-name"
                    onClick={() => handleRenameTeam(resolvedVisitorId, visitorName)}
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
                <div className="score-big">{visitorScore}</div>
                
                {showFouls && (
                    <div className="fouls-dots" title={`${visitorFouls} faltas de equipo`}>
                        {[...Array(5)].map((_, i) => (
                            <div 
                                key={i} 
                                className={`dot ${i < visitorFouls ? 'active' : ''}`} 
                            />
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
