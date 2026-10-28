// src/features/match-creations/components/engines/RaceEngine.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveMatch } from '../context/LiveMatchContext';
import { useGameActions } from '../../hooks/useGameActions';
import { useRaceLogic } from '../../hooks/useRaceLogic';
import { LiveHeader } from '../shared/LiveHeader';
import { GameActionControls } from '../shared/GameActionControls';
import { Scoreboard } from '../../../../components/live/Scoreboard';
import { PlayerSelectModal, type GameAction } from '../../../../components/live/PlayerSelectModal';
import { Target, Trophy, RotateCcw, Flag, Users } from 'lucide-react';

export const RaceEngine: React.FC = () => {
    const navigate = useNavigate();
    const { match, localTeam, visitorTeam } = useLiveMatch();
    const { addScore, addFoul, undoLastAction } = useGameActions();
    const [trackPlayers, setTrackPlayers] = useState(false);

    if (!match || !localTeam || !visitorTeam) return null;

    const {
        targetScore,
        hasRematches,
        winByTwo,
        scoringSystem,
        showMatchEndModal,
        endMatch,
        handleRematch,
        winnerTeamId
    } = useRaceLogic({ match });

    const scoringOptions: (1 | 2 | 3)[] = scoringSystem === 'street' ? [1, 2] : [1, 2, 3];

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
        if (showMatchEndModal) return;

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
            'La reta aún no llega a la meta. ¿Deseas finalizar y cerrar el partido de todos modos?'
        );
        if (!confirmed) return;
        await endMatch();
    };

    return (
        <div className="live-layout">
            <LiveHeader />

            <div className="race-stage-banner">
                <div className="race-info-pill">
                    <span className="race-info-label">
                        <Target size={16} color="var(--primary)" />
                        Meta del Juego
                    </span>
                    <span className="race-info-value">
                        {targetScore} PTS {winByTwo ? '• DIF +2' : ''}
                    </span>
                </div>
            </div>

            <Scoreboard
                localName={localTeam.name}
                visitorName={visitorTeam.name}
                localScore={match.localScore}
                visitorScore={match.visitorScore}
                localFouls={match.localFouls}
                visitorFouls={match.visitorFouls}
                timeLeft={0}
                isTimerRunning={false}
                showTimer={false}
            />

            <section className="controls-panel">
                <div className="action-grid">
                    {/* COLUMNA LOCAL */}
                    <div className="team-column">
                        <GameActionControls
                            simpleScoring={true}
                            scoringOptions={scoringOptions}
                            variant="local"
                            onScore={(pts) => requestAction(localTeam.id!, localTeam.name, localTeam.players, { type: 'score', points: pts as 1 | 2 | 3 })}
                            onFoul={() => requestAction(localTeam.id!, localTeam.name, localTeam.players, { type: 'foul' })}
                            disabled={showMatchEndModal}
                        />
                    </div>

                    {/* COLUMNA VISITANTE */}
                    <div className="team-column">
                        <GameActionControls
                            simpleScoring={true}
                            scoringOptions={scoringOptions}
                            variant="visitor"
                            onScore={(pts) => requestAction(visitorTeam.id!, visitorTeam.name, visitorTeam.players, { type: 'score', points: pts as 1 | 2 | 3 })}
                            onFoul={() => requestAction(visitorTeam.id!, visitorTeam.name, visitorTeam.players, { type: 'foul' })}
                            disabled={showMatchEndModal}
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

            {showMatchEndModal && (
                <div className="game-modal-overlay">
                    <div className="game-modal-card is-end">
                        <div className="modal-icon-wrapper">
                            <Trophy size={40} color="var(--warning)" />
                        </div>
                        <h3>¡Tenemos un Ganador!</h3>
                        <p style={{ fontSize: '1.35rem', fontFamily: 'var(--font-display)', color: '#fff', fontWeight: 900, margin: '0.5rem 0', textTransform: 'uppercase' }}>
                            {winnerTeamId === localTeam.id ? localTeam.name : visitorTeam.name}
                        </p>
                        <p className="text-muted" style={{ fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                            Ha alcanzado la meta de {targetScore} puntos ({match.localScore} - {match.visitorScore}).
                        </p>

                        <div className="modal-actions">
                            {hasRematches && (
                                <button
                                    onClick={handleRematch}
                                    className="btn-modal-primary"
                                    style={{ background: 'var(--secondary)', marginBottom: '0.35rem' }}
                                >
                                    <RotateCcw size={18} />
                                    Dar la Vuelta (Revancha)
                                </button>
                            )}

                            <button onClick={endMatch} className="btn-modal-primary btn-finish">
                                Finalizar Partido
                            </button>

                            <button onClick={undoLastAction} className="btn-modal-secondary">
                                Deshacer último punto (Corregir)
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
