// src/features/match-creations/componets/engines/SeriesEngine.tsx
import React, { useState, useEffect } from 'react';
import { useLiveMatch } from '../context/LiveMatchContext';
import { useGameActions } from '../../hooks/useGameActions';
import { useSeriesLogic } from '../../hooks/useSeriesLogic';
import { LiveHeader } from '../shared/LiveHeader';
import { GameActionControls } from '../shared/GameActionControls';
import { Scoreboard } from '../../../../components/live/Scoreboard';
import { PlayerSelectModal, type GameAction } from '../../../../components/live/PlayerSelectModal';
import { Trophy, Layers } from 'lucide-react';
import { useNavigate } from 'react-router-dom'; // Importar useNavigate

export const SeriesEngine: React.FC = () => {
    const { match, localTeam, visitorTeam } = useLiveMatch();
    const { addScore, addFoul } = useGameActions();
    const navigate = useNavigate(); // Hook de navegación

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
            navigate('/matches'); // O redirigir al historial si prefieres
        }
    }, [match.status, navigate]);

    // Estado para selección de jugador
    const [currentAction, setCurrentAction] = useState<{
        teamId: number;
        teamName: string;
        players: any[];
        action: GameAction;
    } | null>(null);

    const requestAction = (teamId: number, teamName: string, players: any[], action: GameAction) => {
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

    return (
        <div className="live-layout">
            <LiveHeader />

            {/* --- CONTENEDOR PRINCIPAL FLEXIBLE --- 
                CORRECCIÓN: Se cambió pb-32 a pb-4. 
                Al usar flex-col con la controls-panel al final, no necesitamos un padding gigante
                que generaba un espacio negro vacío innecesario.
            */}
            <div className="flex-1 flex flex-col items-center justify-start pt-4 pb-4 overflow-y-auto w-full max-w-lg mx-auto gap-6">

                {/* 1. INFORMACIÓN DE LA SERIE (Sets) */}
                <div className="series-info-pill">
                    <div className="series-info-main">
                        <Layers size={16} className="text-secondary" />
                        SET {currentSet}
                    </div>
                    <div className="series-info-sub">
                        A {pointsPerSet} Puntos • Gana {setsToWin} de {((setsToWin * 2) - 1)}
                    </div>
                </div>

                {/* 2. SCOREBOARD DE SETS */}
                <div className="w-full px-4">
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
                    <div className="text-center text-xs text-muted font-bold uppercase tracking-widest mt-2 opacity-60">
                        Sets Ganados
                    </div>
                </div>

                {/* 3. PUNTOS DEL SET ACTUAL */}
                <div className="series-points-container">
                    {/* Puntos Local */}
                    <div className="series-point-box local">
                        <div className="series-point-label">Puntos Set</div>
                        <div className="series-point-value">{match.localScore}</div>
                    </div>

                    {/* VS central decorativo */}
                    <div className="text-xs font-black text-zinc-700 bg-zinc-900 p-2 rounded-full border border-zinc-800">
                        VS
                    </div>

                    {/* Puntos Visitante */}
                    <div className="series-point-box visitor">
                        <div className="series-point-label">Puntos Set</div>
                        <div className="series-point-value">{match.visitorScore}</div>
                    </div>
                </div>

            </div>

            {/* Controles (Fixed Bottom) */}
            <section className="controls-panel">
                <div className="action-grid">
                    <div className="team-column">
                        <GameActionControls
                            variant="local"
                            balancedLayout={true}
                            onScore={(pts) => requestAction(localTeam.id!, localTeam.name, localTeam.players, { type: 'score', points: pts as 1 | 2 | 3 })}
                            onFoul={() => requestAction(localTeam.id!, localTeam.name, localTeam.players, { type: 'foul' })}
                        />
                    </div>

                    <div className="team-column">
                        <GameActionControls
                            variant="visitor"
                            balancedLayout={true}
                            onScore={(pts) => requestAction(visitorTeam.id!, visitorTeam.name, visitorTeam.players, { type: 'score', points: pts as 1 | 2 | 3 })}
                            onFoul={() => requestAction(visitorTeam.id!, visitorTeam.name, visitorTeam.players, { type: 'foul' })}
                        />
                    </div>
                </div>
            </section>

            {/* --- MODALES --- */}
            {currentAction && (
                <PlayerSelectModal
                    teamName={currentAction.teamName}
                    players={currentAction.players}
                    action={currentAction.action}
                    onSelect={confirmAction}
                    onCancel={() => setCurrentAction(null)}
                />
            )}

            {showSetEndModal && (
                <div className="game-modal-overlay">
                    <div className="game-modal-card">
                        <div className="modal-icon-wrapper">
                            <Trophy size={40} className="text-blue-400" />
                        </div>
                        <h3>Fin del Set {currentSet}</h3>
                        <p className="text-white mb-4">
                            Ganador del set: <strong>{setWinnerId === localTeam.id ? localTeam.name : visitorTeam.name}</strong>
                        </p>
                        <p className="text-sm text-muted mb-6">
                            El marcador de puntos se reiniciará para el siguiente set.
                        </p>
                        <button onClick={confirmSetEnd} className="btn-modal-primary btn-next-q">
                            Confirmar y Siguiente Set
                        </button>
                    </div>
                </div>
            )}

            {showSeriesEndModal && (
                <div className="game-modal-overlay">
                    <div className="game-modal-card is-end">
                        <div className="modal-icon-wrapper">
                            <Trophy size={40} className="text-yellow-500" />
                        </div>
                        <h3>¡Serie Finalizada!</h3>
                        <p className="text-lg text-white font-bold my-4">
                            Ganador: {localSetsWon > visitorSetsWon ? localTeam.name : visitorTeam.name}
                        </p>
                        <div className="text-2xl font-mono mb-6 bg-white/5 py-2 px-6 rounded-lg">
                            {localSetsWon} - {visitorSetsWon}
                        </div>
                        <button onClick={endSeries} className="btn-modal-primary btn-finish">
                            Finalizar Partido
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};