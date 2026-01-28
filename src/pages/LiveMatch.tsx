// src/pages/LiveMatch.tsx
import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Player } from '../db/models';
import { History, X, PauseCircle, PlayCircle, AlertTriangle, Trophy, Flag } from 'lucide-react';
import { LiveMatchHistoryModal } from '../components/live/LiveMatchHistoryModal';
import { MatchesRepository } from '../db/matches.repository';
import { ScoresRepository } from '../db/scores.repository';
import { FoulsRepository } from '../db/fouls.repository';

import './LiveMatch.css';
import { useMatchTimer } from '../hooks/useMatchTimer';
import { useErrorHandler } from '../hooks/useErrorHandler';

import { Scoreboard } from '../components/live/Scoreboard';
import { MatchControls } from '../components/live/MatchControls';
import { PlayerSelectModal, type GameAction } from '../components/live/PlayerSelectModal';
import { ErrorToast } from '../components/ErrorToast';

// 🔧 Tipo para el modal de fin de cuarto
type QuarterEndModalType = 'end' | 'overtime' | null;

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

    const [showHistory, setShowHistory] = useState(false);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    
    // 🆕 Estado para el modal de fin de cuarto
    const [quarterEndModal, setQuarterEndModal] = useState<QuarterEndModalType>(null);

    // 🆕 Configuración del partido (para validaciones)
    const matchConfig = useMemo(() => {
        if (!data?.match) return null;
        return {
            totalQuarters: 4, // Por defecto 4 cuartos (esto podría venir de la BD si lo guardaste)
            quarterDuration: data.match.quarterDuration,
            currentQuarter: data.match.currentQuarter
        };
    }, [data?.match]);

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

    // 🆕 EFECTO: Detectar fin de cuarto automáticamente
    useEffect(() => {
        if (!data?.match || !matchConfig) return;
        
        // Si el tiempo llegó a 0 y el reloj se pausó automáticamente
        if (timeLeft <= 0 && !isRunning) {
            const { currentQuarter } = data.match;
            const { totalQuarters } = matchConfig;
            
            // Verificar si es el último cuarto
            if (currentQuarter >= totalQuarters) {
                // Es el último cuarto, verificar si hay empate
                if (stats.localScore === stats.visitorScore) {
                    // Empate - ofrecer tiempo extra
                    setQuarterEndModal('overtime');
                } else {
                    // Hay ganador - ofrecer finalizar
                    setQuarterEndModal('end');
                }
            } else {
                // No es el último cuarto - ofrecer siguiente cuarto
                setQuarterEndModal('end');
            }
        }
    }, [timeLeft, isRunning, data?.match, matchConfig, stats.localScore, stats.visitorScore]);

    // --- HANDLERS ---

    const handleBackClick = () => {
        if (isRunning) {
            setShowExitConfirm(true);
        } else {
            navigate('/matches');
        }
    };

    const handleExitAndPause = async () => {
        try {
            await toggleTimer();
            navigate('/matches');
        } catch (err) {
            handleError(err);
        }
    };

    const handleExitRunning = () => {
        keepTimerRunningOnUnmount();
        navigate('/matches');
    };

    // 🆕 HANDLER: Avanzar al siguiente cuarto (validado)
    const handleNextQuarter = async () => {
        if (!data?.match || !matchConfig) return;
        
        try {
            // 1. Pausar el reloj si está corriendo
            if (isRunning) await toggleTimer();
            
            const { currentQuarter } = data.match;
            const { totalQuarters } = matchConfig;
            
            // 2. Validar que no hayamos excedido el número de cuartos
            if (currentQuarter >= totalQuarters) {
                handleError(new Error(`Ya se jugaron los ${totalQuarters} cuartos reglamentarios`));
                return;
            }
            
            // 3. Mostrar modal de confirmación
            setQuarterEndModal('end');
            
        } catch (err) {
            handleError(err, "Error al cambiar de cuarto");
        }
    };

    // 🆕 HANDLER: Confirmar siguiente cuarto
    const confirmNextQuarter = async () => {
        if (!data?.match || !matchConfig) return;
        
        try {
            const nextQ = data.match.currentQuarter + 1;
            
            await db.matches.update(matchId, {
                currentQuarter: nextQ,
                timerSecondsRemaining: data.match.quarterDuration * 60,
                timerLastStart: undefined
            });
            
            setQuarterEndModal(null);
        } catch (err) {
            handleError(err, "Error al iniciar siguiente cuarto");
        }
    };

    // 🆕 HANDLER: Iniciar tiempo extra
    const handleStartOvertime = async () => {
        if (!data?.match) return;
        
        try {
            const overtimeQuarter = data.match.currentQuarter + 1;
            const overtimeDuration = 5; // 5 minutos de overtime
            
            await db.matches.update(matchId, {
                currentQuarter: overtimeQuarter,
                timerSecondsRemaining: overtimeDuration * 60,
                timerLastStart: undefined,
                quarterDuration: overtimeDuration // Actualizar duración para este cuarto
            });
            
            setQuarterEndModal(null);
        } catch (err) {
            handleError(err, "Error al iniciar tiempo extra");
        }
    };

    // 🆕 HANDLER: Finalizar partido (validado)
    const handleEndMatch = async () => {
        if (!data?.match) return;
        
        try {
            // 1. Pausar reloj si está corriendo
            if (isRunning) await toggleTimer();
            
            // 2. Verificar si hay empate
            if (stats.localScore === stats.visitorScore) {
                const shouldEnd = confirm(
                    "⚠️ El partido está EMPATADO\n\n" +
                    `${data.localTeam?.name}: ${stats.localScore}\n` +
                    `${data.visitorTeam?.name}: ${stats.visitorScore}\n\n` +
                    "¿Deseas finalizar de todas formas?"
                );
                
                if (!shouldEnd) return;
            } else {
                // Hay ganador, confirmación normal
                const winner = stats.localScore > stats.visitorScore 
                    ? data.localTeam?.name 
                    : data.visitorTeam?.name;
                
                const shouldEnd = confirm(
                    `🏆 Finalizar Partido\n\n` +
                    `Ganador: ${winner}\n` +
                    `Marcador: ${stats.localScore} - ${stats.visitorScore}\n\n` +
                    "¿Confirmar?"
                );
                
                if (!shouldEnd) return;
            }
            
            // 3. Finalizar
            await MatchesRepository.finish(matchId);
            navigate('/matches');
            
        } catch (err) {
            handleError(err, "Error al finalizar partido");
        }
    };

    const handleActionRequest = (teamId: number, teamName: string, players: Player[], action: GameAction) => {
        setCurrentAction({ teamId, teamName, players, action });
    };

    const confirmAction = async (playerId: number | null) => {
        if (!currentAction || !data) return;
        try {
            const commonInput = {
                matchId,
                teamId: currentAction.teamId,
                playerId: playerId ?? undefined,
                quarter: data.match.currentQuarter,
            };

            if (currentAction.action.type === 'score') {
                await ScoresRepository.add({
                    ...commonInput,
                    points: currentAction.action.points
                });
            } else {
                await FoulsRepository.add(commonInput);
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

                <button
                    onClick={() => setShowHistory(true)}
                    className="live-back-btn"
                    title="Ver Historial y Corregir"
                >
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

            {/* 🆕 MODAL DE FIN DE CUARTO */}
            {quarterEndModal && matchConfig && (
                <div className="fixed inset-0 bg-black/95 z-[10000] flex items-center justify-center p-4">
                    <div className="bg-[#18181b] w-full max-w-md rounded-2xl p-6 border border-[#27272a]">
                        
                        {/* Título dinámico */}
                        <div className="text-center mb-4">
                            {quarterEndModal === 'overtime' ? (
                                <>
                                    <AlertTriangle size={48} className="mx-auto mb-3 text-yellow-500" />
                                    <h3 className="text-2xl font-bold text-white mb-2">¡Empate!</h3>
                                    <p className="text-gray-400 text-sm">
                                        El partido está {stats.localScore} - {stats.visitorScore}
                                    </p>
                                </>
                            ) : (
                                <>
                                    <Flag size={48} className="mx-auto mb-3 text-primary" />
                                    <h3 className="text-2xl font-bold text-white mb-2">
                                        Fin del Cuarto {match.currentQuarter}
                                    </h3>
                                    <div className="flex justify-center items-center gap-4 text-lg font-mono my-3">
                                        <span className="text-blue-400">{stats.localScore}</span>
                                        <span className="text-gray-500">-</span>
                                        <span className="text-orange-400">{stats.visitorScore}</span>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Opciones */}
                        <div className="flex flex-col gap-3">
                            {quarterEndModal === 'overtime' ? (
                                <>
                                    {/* Tiempo Extra */}
                                    <button
                                        onClick={handleStartOvertime}
                                        className="w-full py-3 bg-primary/10 text-primary font-bold rounded-lg border border-primary/20 flex items-center justify-center gap-2"
                                    >
                                        <PlayCircle size={20} />
                                        Jugar Tiempo Extra (5 min)
                                    </button>

                                    {/* Finalizar en empate */}
                                    <button
                                        onClick={handleEndMatch}
                                        className="w-full py-3 bg-gray-800 text-gray-300 font-medium rounded-lg border border-gray-700"
                                    >
                                        Finalizar en Empate
                                    </button>
                                </>
                            ) : (
                                <>
                                    {/* Siguiente Cuarto o Finalizar */}
                                    {match.currentQuarter < matchConfig.totalQuarters ? (
                                        <button
                                            onClick={confirmNextQuarter}
                                            className="w-full py-3 bg-green-500/10 text-green-500 font-bold rounded-lg border border-green-500/20 flex items-center justify-center gap-2"
                                        >
                                            <PlayCircle size={20} />
                                            Iniciar Cuarto {match.currentQuarter + 1}
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleEndMatch}
                                            className="w-full py-3 bg-primary/10 text-primary font-bold rounded-lg border border-primary/20 flex items-center justify-center gap-2"
                                        >
                                            <Trophy size={20} />
                                            Finalizar Partido
                                        </button>
                                    )}

                                    {/* Cancelar */}
                                    <button
                                        onClick={() => setQuarterEndModal(null)}
                                        className="w-full py-3 text-gray-400 font-medium"
                                    >
                                        Continuar Jugando
                                    </button>
                                </>
                            )}
                        </div>

                        {/* Info adicional */}
                        <div className="mt-4 pt-4 border-t border-gray-800 text-center text-xs text-gray-500">
                            Cuartos: {match.currentQuarter} de {matchConfig.totalQuarters} • 
                            Duración: {matchConfig.quarterDuration} min
                        </div>
                    </div>
                </div>
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

            {showHistory && (
                <LiveMatchHistoryModal 
                    matchId={matchId} 
                    onClose={() => setShowHistory(false)} 
                />
            )}
        </div>
    );
}