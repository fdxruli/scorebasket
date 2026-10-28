import React, { useState, useEffect } from 'react'; // Importar useEffect
import { useNavigate } from 'react-router-dom';     // Importar useNavigate
import { useLiveMatch } from '../context/LiveMatchContext';
import { useGameActions } from '../../hooks/useGameActions';
import { useRaceLogic } from '../../hooks/useRaceLogic';
import { LiveHeader } from '../shared/LiveHeader';
import { GameActionControls } from '../shared/GameActionControls';
import { Scoreboard } from '../../../../components/live/Scoreboard';
import { PlayerSelectModal, type GameAction } from '../../../../components/live/PlayerSelectModal';
import { Target, Trophy, RotateCcw, Flag } from 'lucide-react';

export const RaceEngine: React.FC = () => {
    const navigate = useNavigate(); // Hook de navegación
    const { match, localTeam, visitorTeam } = useLiveMatch();
    const { addScore, addFoul } = useGameActions();

    if (!match || !localTeam || !visitorTeam) return null;

    const {
        targetScore,
        hasRematches,
        showMatchEndModal,
        endMatch,
        handleRematch,
        winnerTeamId
    } = useRaceLogic({ match });

    // 🟢 NUEVO: Redirección automática al terminar el partido
    useEffect(() => {
        if (match.status === 'finished') {
            navigate('/matches'); // O redirigir al historial si prefieres
        }
    }, [match.status, navigate]);

    const [currentAction, setCurrentAction] = useState<{
        teamId: number;
        teamName: string;
        players: any[];
        action: GameAction;
    } | null>(null);

    const requestAction = (teamId: number, teamName: string, players: any[], action: GameAction) => {
        // Evitar acciones si el modal de fin ya está visible
        if (showMatchEndModal) return;
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

            <div className="absolute top-[85px] left-1/2 -translate-x-1/2 z-20">
                <div className="race-info-pill">
                    <span className="race-info-label">
                        <Target size={16} className="text-primary" />
                        Meta
                    </span>
                    <span className="race-info-value">{targetScore}</span>
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
            />

            <section className="controls-panel">
                <div className="action-grid">
                    {/* COLUMNA LOCAL */}
                    <div className="team-column">
                        <GameActionControls
                            simpleScoring={true}
                            variant="local"
                            onScore={(pts) => requestAction(localTeam.id!, localTeam.name, localTeam.players, { type: 'score', points: pts as 1 | 2 | 3 })}
                            onFoul={() => requestAction(localTeam.id!, localTeam.name, localTeam.players, { type: 'foul' })}
                            disabled={showMatchEndModal} // Deshabilitar botones si el modal está abierto
                        />
                    </div>

                    {/* COLUMNA VISITANTE */}
                    <div className="team-column">
                        <GameActionControls
                            simpleScoring={true}
                            variant="visitor"
                            onScore={(pts) => requestAction(visitorTeam.id!, visitorTeam.name, visitorTeam.players, { type: 'score', points: pts as 1 | 2 | 3 })}
                            onFoul={() => requestAction(visitorTeam.id!, visitorTeam.name, visitorTeam.players, { type: 'foul' })}
                            disabled={showMatchEndModal} // Deshabilitar botones si el modal está abierto
                        />
                    </div>
                </div>

                <div className="bottom-bar">
                    <button
                        onClick={handleEarlyFinish}
                        className="btn btn-secondary btn-full"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                    >
                        <Flag size={16} />
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
                            <Trophy size={40} className="text-yellow-500" />
                        </div>
                        <h3>¡Tenemos un Ganador!</h3>
                        <p className="text-lg text-white font-bold my-4">
                            {winnerTeamId === localTeam.id ? localTeam.name : visitorTeam.name}
                        </p>
                        <p className="text-sm text-muted mb-6">
                            Ha alcanzado la meta de {targetScore} puntos.
                        </p>

                        <div className="modal-actions">
                            {/* BOTÓN DAR VUELTA / REVANCHA (Solo si está activado) */}
                            {hasRematches && (
                                <button
                                    onClick={handleRematch}
                                    className="btn-modal-primary"
                                    style={{ background: 'var(--secondary)', marginBottom: '0.5rem' }}
                                >
                                    <RotateCcw size={18} />
                                    Dar la Vuelta (Revancha)
                                </button>
                            )}

                            {/* BOTÓN FINALIZAR */}
                            <button onClick={endMatch} className="btn-modal-primary btn-finish">
                                Finalizar Partido
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};