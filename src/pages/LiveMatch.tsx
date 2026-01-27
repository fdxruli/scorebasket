// src/pages/LiveMatch.tsx
import { useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Player } from '../db/models';
import { History, X, PauseCircle, PlayCircle } from 'lucide-react'; // Íconos nuevos
import { MatchesRepository } from '../db/matches.repository';

import './LiveMatch.css';
import { useMatchTimer } from '../hooks/useMatchTImer';
import { useErrorHandler } from '../hooks/useErrorHandler';

import { Scoreboard } from '../components/live/Scoreboard';
import { MatchControls } from '../components/live/MatchControls';
import { PlayerSelectModal, type GameAction } from '../components/live/PlayerSelectModal';
import { ErrorToast } from '../components/ErrorToast';

export function LiveMatch() {
    const { id } = useParams();
    const matchId = Number(id);
    const navigate = useNavigate();
    const { error, handleError, clearError } = useErrorHandler();

    // --- DATA ---
    const data = useLiveQuery(async () => {
        const match = await db.matches.get(matchId);
        if (!match) return null;

        const [localTeam, visitorTeam, localPlayers, visitorPlayers, scores, fouls] = await Promise.all([
            db.teams.get(match.localTeamId),
            db.teams.get(match.visitorTeamId),
            db.players.where({ teamId: match.localTeamId }).toArray(),
            db.players.where({ teamId: match.visitorTeamId }).toArray(),
            db.scores.where({ matchId }).toArray(),
            db.fouls.where({ matchId }).toArray()
        ]);

        return { match, localTeam, visitorTeam, localPlayers, visitorPlayers, scores, fouls };
    }, [matchId]);

    // --- HOOK DEL TIMER ---
    const { timeLeft, isRunning, toggleTimer, keepTimerRunningOnUnmount } = useMatchTimer(data?.match);

    // Estado para acciones de juego (puntos/faltas)
    const [currentAction, setCurrentAction] = useState<{
        teamId: number;
        action: GameAction;
        teamName: string;
        players: Player[];
    } | null>(null);

    // Estado para el MODAL DE SALIDA
    const [showExitConfirm, setShowExitConfirm] = useState(false);

    // --- STATS ---
    const stats = useMemo(() => {
        if (!data) return { localScore: 0, visitorScore: 0, localFoulsQ: 0, visitorFoulsQ: 0 };
        const { scores, fouls, match } = data;
        return {
            localScore: scores.filter(s => s.teamId === data.localTeam!.id).reduce((a, b) => a + b.points, 0),
            visitorScore: scores.filter(s => s.teamId === data.visitorTeam!.id).reduce((a, b) => a + b.points, 0),
            localFoulsQ: fouls.filter(f => f.teamId === data.localTeam!.id && f.quarter === match.currentQuarter).length,
            visitorFoulsQ: fouls.filter(f => f.teamId === data.visitorTeam!.id && f.quarter === match.currentQuarter).length
        };
    }, [data]);

    // --- HANDLERS ---

    const handleBackClick = () => {
        // Si el reloj está corriendo, preguntamos qué hacer
        if (isRunning) {
            setShowExitConfirm(true);
        } else {
            // Si ya está pausado, salimos directo
            navigate('/matches');
        }
    };

    const handleExitAndPause = async () => {
        try {
            await toggleTimer(); // Pausar
            navigate('/matches');
        } catch (err) {
            handleError(err);
        }
    };

    const handleExitRunning = () => {
        keepTimerRunningOnUnmount();
        // Simplemente salimos, el timer sigue basado en la fecha de inicio en la BD
        navigate('/matches');
    };

    const handleNextQuarter = async () => {
        if (!data) return;
        try {
            if (isRunning) await toggleTimer();
            const nextQ = data.match.currentQuarter + 1;
            if (confirm(`¿Iniciar Cuarto ${nextQ}?`)) {
                await db.matches.update(matchId, {
                    currentQuarter: nextQ,
                    timerSecondsRemaining: data.match.quarterDuration * 60,
                    timerLastStart: undefined
                });
            }
        } catch (err) {
            handleError(err, "Error al cambiar de cuarto");
        }
    };

    const handleEndMatch = async () => {
        try {
            if (confirm("¿Finalizar partido?")) {
                await MatchesRepository.finish(matchId);
                navigate('/matches');
            }
        } catch (err) {
            handleError(err, "Error al finalizar");
        }
    };

    const handleActionRequest = (teamId: number, teamName: string, players: Player[], action: GameAction) => {
        setCurrentAction({ teamId, teamName, players, action });
    };

    const handleUndo = async () => {
        try {
            if (navigator.vibrate) navigator.vibrate(50);
            await MatchesRepository.undoLastAction(matchId);
        } catch (err) {
            handleError(err);
        }
    };

    const confirmAction = async (playerId: number | null) => {
        if (!currentAction || !data) return;
        try {
            const commonData = {
                matchId,
                teamId: currentAction.teamId,
                playerId: playerId ?? undefined,
                quarter: data.match.currentQuarter,
                createdAt: new Date()
            };

            if (currentAction.action.type === 'score') {
                await db.scores.add({ ...commonData, points: currentAction.action.points });
            } else {
                await db.fouls.add(commonData);
            }
            setCurrentAction(null);
        } catch (err) {
            handleError(err, "Error al guardar acción");
        }
    };

    if (!data) return <div className="bg-black h-screen flex items-center justify-center text-white">Cargando...</div>;
    const { match, localTeam, visitorTeam, localPlayers, visitorPlayers } = data;

    return (
        <div className="live-overlay">
            {error && <ErrorToast message={error} onClose={clearError} />}

            <header className="live-header">
                <button onClick={handleBackClick} className="live-back-btn">
                    <X size={24} />
                </button>

                <div className="live-status-badge">
                    Q{match.currentQuarter} • {match.status === 'finished' ? 'FINAL' : 'EN VIVO'}
                </div>

                <button onClick={handleUndo} className="live-back-btn" title="Deshacer última acción">
                    <History size={20} />
                </button>
            </header>

            <Scoreboard
                localName={localTeam?.name || 'Local'}
                visitorName={visitorTeam?.name || 'Visita'}
                localScore={stats.localScore}
                visitorScore={stats.visitorScore}
                localFouls={stats.localFoulsQ}
                visitorFouls={stats.visitorFoulsQ}
                timeLeft={timeLeft}
                isTimerRunning={isRunning}
            />

            <MatchControls
                localTeam={localTeam!}
                visitorTeam={visitorTeam!}
                localPlayers={localPlayers}
                visitorPlayers={visitorPlayers}
                isTimerRunning={isRunning}
                onActionRequest={handleActionRequest}
                onToggleTimer={toggleTimer}
                onNextQuarter={handleNextQuarter}
                onEndMatch={handleEndMatch}
            />

            {/* MODAL DE SELECCIÓN DE JUGADOR */}
            {currentAction && (
                <PlayerSelectModal
                    teamName={currentAction.teamName}
                    players={currentAction.players}
                    action={currentAction.action}
                    onSelect={confirmAction}
                    onCancel={() => setCurrentAction(null)}
                />
            )}

            {/* MODAL DE CONFIRMACIÓN DE SALIDA */}
            {showExitConfirm && (
                <div className="fixed inset-0 bg-black/90 z-[10000] flex items-center justify-center p-4">
                    <div className="bg-[#18181b] w-full max-w-sm rounded-2xl p-6 border border-[#27272a] text-center">
                        <h3 className="text-xl font-bold text-white mb-2">¿Cómo deseas salir?</h3>
                        <p className="text-gray-400 mb-6 text-sm">
                            El reloj está corriendo. Puedes pausarlo ahora o dejar que siga contando en segundo plano.
                        </p>
                        
                        <div className="flex flex-col gap-3">
                            <button 
                                onClick={handleExitAndPause}
                                className="w-full py-3 bg-yellow-500/10 text-yellow-500 font-bold rounded-lg border border-yellow-500/20 flex items-center justify-center gap-2"
                            >
                                <PauseCircle size={20} />
                                Pausar y Salir
                            </button>
                            
                            <button 
                                onClick={handleExitRunning}
                                className="w-full py-3 bg-green-500/10 text-green-500 font-bold rounded-lg border border-green-500/20 flex items-center justify-center gap-2"
                            >
                                <PlayCircle size={20} />
                                Dejar Corriendo y Salir
                            </button>
                            
                            <button 
                                onClick={() => setShowExitConfirm(false)}
                                className="w-full py-3 text-gray-400 font-medium mt-2"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}