// src/features/match-creations/components/engines/SeriesEngine.tsx
import React, { useState, useEffect } from 'react';
import { useLiveMatch } from '../context/LiveMatchContext';
import { useGameActions } from '../../hooks/useGameActions';
import { useSeriesLogic } from '../../hooks/useSeriesLogic';
import { LiveHeader } from '../shared/LiveHeader';
import { GameActionControls } from '../shared/GameActionControls';
import { Scoreboard } from '../../../../components/live/Scoreboard';
import { PlayerSelectModal, type GameAction } from '../../../../components/live/PlayerSelectModal';
import { Trophy, Layers, Flag, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const SeriesEngine: React.FC = () => {
    const { match, localTeam, visitorTeam } = useLiveMatch();
    const { addScore, addFoul } = useGameActions();
    const navigate = useNavigate();
    const [trackPlayers, setTrackPlayers] = useState(false);

    if (!match || !localTeam || !visitorTeam) return null;

    const {
        currentSet,
        localSetsWon,
        visitorSetsWon,
        setsToWin,
        pointsPerSet,
        showSetEndModal,
        showSeriesEndModal,
        confirmSetEnd,
        endSeries,
        setWinnerId
    } = useSeriesLogic({ match });

    useEffect(() => {
        if (match.status === 'finished') {
            navigate('/matches');
        }
    }, [match.status, navigate]);

    const [currentAction, setCurrentAction] = useState<{
        teamId: number;
        teamName: string;
        players: any[];
        action: GameAction;
    } | null>(null);

    const requestAction = (teamId: number, teamName: string, players: any[], action: GameAction) => {
        if (showSetEndModal || showSeriesEndModal) return;

        if (!trackPlayers || !players || players.length === 0) {
            if (action.type === 'score') {
                addScore(teamId, action.points, undefined);
            } else {
                addFoul(teamId, undefined);
            }
            return;
        }

        setCurrentAction({ teamId, teamName, players, action });
    };

    const confirmAction = (playerId: number | null) => {
        if (!currentAction) return;
        if (currentAction.action.type === 'score') {
            addScore(currentAction.teamId, currentAction.action.points, playerId || undefined);
        } else {
            addFoul(currentAction.teamId, playerId || undefined);
        }
        setCurrentAction(null);
    };

    const handleEarlyFinish = async () => {
        const confirmed = window.confirm(
            'La serie aún no termina. ¿Deseas finalizar y cerrar el partido de todos modos?'
        );
        if (!confirmed) return;
        await endSeries();
    };

    return (
        <div className="live-layout">
            <LiveHeader />

            <div className="series-stage-container">
                {/* 1. INFORMACIÓN DE LA SERIE (Sets) */}
                <div className="series-info-pill">
                    <div className="series-info-main">
                        <Layers size={16} color="var(--secondary-light)" />
                        SET {currentSet}
                    </div>
                    <div className="series-info-sub">
                        A {pointsPerSet} Pts • Gana {setsToWin} de {((setsToWin * 2) - 1)}
                    </div>
                </div>

                {/* 2. SCOREBOARD DE SETS */}
                <div className="w-full">
                    <Scoreboard
                        localName={localTeam.name}
                        visitorName={visitorTeam.name}
                        localScore={localSetsWon}
                        visitorScore={visitorSetsWon}
                        localFouls={0}
                        visitorFouls={0}
                        timeLeft={0}
                        isTimerRunning={false}
                        showTimer={false}
                        showFouls={false}
                    />
                    <div className="series-sets-caption">
                        Sets Ganados en la Serie
                    </div>
                </div>

                {/* 3. PUNTOS DEL SET ACTUAL */}
                <div className="series-points-container">
                    <div className="series-point-box local">
                        <div className="series-point-label">Puntos Set Actual</div>
                        <div className="series-point-value">{match.localScore}</div>
                    </div>

                    <div className="series-vs-badge">VS</div>

                    <div className="series-point-box visitor">
                        <div className="series-point-label">Puntos Set Actual</div>
                        <div className="series-point-value">{match.visitorScore}</div>
                    </div>
                </div>
            </div>

            {/* Controles */}
            <section className="controls-panel">
                <div className="action-grid">
                    <div className="team-column">
                        <GameActionControls
                            variant="local"
                            simpleScoring={true}
                            onScore={(pts) => requestAction(localTeam.id!, localTeam.name, localTeam.players, { type: 'score', points: pts as 1 | 2 | 3 })}
                            onFoul={() => requestAction(localTeam.id!, localTeam.name, localTeam.players, { type: 'foul' })}
                        />
                    </div>

                    <div className="team-column">
                        <GameActionControls
                            variant="visitor"
                            simpleScoring={true}
                            onScore={(pts) => requestAction(visitorTeam.id!, visitorTeam.name, visitorTeam.players, { type: 'score', points: pts as 1 | 2 | 3 })}
                            onFoul={() => requestAction(visitorTeam.id!, visitorTeam.name, visitorTeam.players, { type: 'foul' })}
                        />
                    </div>
                </div>

                <div className="bottom-bar" style={{ gap: '0.65rem' }}>
                    <button
                        type="button"
                        onClick={() => setTrackPlayers(prev => !prev)}
                        className="btn btn-secondary"
                        style={{
                            flex: 1,
                            fontSize: '0.8rem',
                            padding: '0.7rem 0.75rem',
                            borderColor: trackPlayers ? 'var(--primary)' : 'var(--border-color)',
                            color: trackPlayers ? 'var(--primary-light)' : 'var(--text-muted)',
                            backgroundColor: trackPlayers ? 'rgba(255, 95, 31, 0.14)' : undefined
                        }}
                    >
                        <Users size={15} />
                        Jugadores: {trackPlayers ? 'ON' : 'OFF'}
                    </button>

                    <button
                        type="button"
                        onClick={handleEarlyFinish}
                        className="btn btn-secondary"
                        style={{
                            flex: 1,
                            fontSize: '0.8rem',
                            padding: '0.7rem 0.75rem'
                        }}
                    >
                        <Flag size={15} />
                        Finalizar / Cerrar Partido
                    </button>
                </div>
            </section>

            {/* --- MODALES --- */}
            {currentAction && (
                <PlayerSelectModal
                    matchId={match.id}
                    teamName={currentAction.teamName}
                    players={currentAction.players}
                    action={currentAction.action}
                    onSelect={confirmAction}
                    onCancel={() => setCurrentAction(null)}
                />
            )}

            {showSetEndModal && (
                <div className="game-modal-overlay">
                    <div className="game-modal-card is-exit">
                        <div className="modal-icon-wrapper">
                            <Trophy size={40} color="var(--secondary-light)" />
                        </div>
                        <h3>Fin del Set {currentSet}</h3>
                        <p style={{ color: '#fff', marginBottom: '0.75rem' }}>
                            Ganador del set: <strong>{setWinnerId === localTeam.id ? localTeam.name : visitorTeam.name}</strong>
                        </p>
                        <p className="text-muted" style={{ fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                            El marcador de puntos se reiniciará para el siguiente set.
                        </p>
                        <div className="modal-actions">
                            <button onClick={confirmSetEnd} className="btn-modal-primary btn-next-q">
                                Confirmar y Siguiente Set
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showSeriesEndModal && (
                <div className="game-modal-overlay">
                    <div className="game-modal-card is-end">
                        <div className="modal-icon-wrapper">
                            <Trophy size={40} color="var(--warning)" />
                        </div>
                        <h3>¡Serie Finalizada!</h3>
                        <p style={{ fontSize: '1.25rem', fontFamily: 'var(--font-display)', color: '#fff', fontWeight: 900, margin: '0.5rem 0', textTransform: 'uppercase' }}>
                            Ganador: {localSetsWon > visitorSetsWon ? localTeam.name : visitorTeam.name}
                        </p>
                        <div
                            style={{
                                fontSize: '1.65rem',
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 800,
                                marginBottom: '1.5rem',
                                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                                padding: '0.5rem 1.5rem',
                                borderRadius: '0.5rem'
                            }}
                        >
                            {localSetsWon} - {visitorSetsWon}
                        </div>
                        <div className="modal-actions">
                            <button onClick={endSeries} className="btn-modal-primary btn-finish">
                                Finalizar Partido
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
