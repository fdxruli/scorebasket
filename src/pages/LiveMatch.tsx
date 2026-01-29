import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Player } from '../db/models';
import { History, ChevronLeft, AlertTriangle, Trophy, Flag, Play, Pause, LogOut } from 'lucide-react';
import { LiveMatchHistoryModal } from '../components/live/LiveMatchHistoryModal';
import { MatchesRepository } from '../db/matches.repository';
import { ScoresRepository } from '../db/scores.repository';
import { FoulsRepository } from '../db/fouls.repository';
import { useMatchTimer } from '../hooks/useMatchTimer';
import { useErrorHandler } from '../hooks/useErrorHandler';

import { Scoreboard } from '../components/live/Scoreboard';
import { MatchControls } from '../components/live/MatchControls';
import { PlayerSelectModal, type GameAction } from '../components/live/PlayerSelectModal';
import { ErrorToast } from '../components/ErrorToast';

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

    // --- TIMER HOOK ---
    const { timeLeft, isRunning, toggleTimer, keepTimerRunningOnUnmount } = useMatchTimer(data?.match);

    const [currentAction, setCurrentAction] = useState<{
        teamId: number;
        action: GameAction;
        teamName: string;
        players: Player[];
    } | null>(null);

    const [showHistory, setShowHistory] = useState(false);
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [quarterEndModal, setQuarterEndModal] = useState<QuarterEndModalType>(null);

    const matchConfig = useMemo(() => {
        if (!data?.match) return null;
        return {
            totalQuarters: data.match.totalQuarters || 4, 
            quarterDuration: data.match.quarterDuration,
            currentQuarter: data.match.currentQuarter
        };
    }, [data?.match]);

    // --- STATS ---
    const stats = useMemo(() => {
        if (!data || !data.localTeam || !data.visitorTeam) {
            return { localScore: 0, visitorScore: 0, localFoulsQ: 0, visitorFoulsQ: 0 };
        }
        const { scores, fouls, match, localTeam, visitorTeam } = data;
        return {
            localScore: scores.filter(s => s.teamId === localTeam.id).reduce((a, b) => a + b.points, 0),
            visitorScore: scores.filter(s => s.teamId === visitorTeam.id).reduce((a, b) => a + b.points, 0),
            localFoulsQ: fouls.filter(f => f.teamId === localTeam.id && f.quarter === match.currentQuarter).length,
            visitorFoulsQ: fouls.filter(f => f.teamId === visitorTeam.id && f.quarter === match.currentQuarter).length
        };
    }, [data]);

    // --- AUTO DETECT QUARTER END ---
    useEffect(() => {
        if (!data?.match || !matchConfig) return;
        if (timeLeft <= 0 && !isRunning) {
            const { currentQuarter } = data.match;
            const { totalQuarters } = matchConfig;
            
            if (currentQuarter >= totalQuarters) {
                if (stats.localScore === stats.visitorScore) {
                    setQuarterEndModal('overtime');
                } else {
                    setQuarterEndModal('end');
                }
            } else {
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

    const handleNextQuarter = async () => {
        if (!data?.match || !matchConfig) return;
        try {
            if (isRunning) await toggleTimer();
            if (data.match.currentQuarter >= matchConfig.totalQuarters) {
                handleError(new Error(`Ya se jugaron los ${matchConfig.totalQuarters} cuartos reglamentarios`));
                return;
            }
            setQuarterEndModal('end');
        } catch (err) {
            handleError(err, "Error al cambiar de cuarto");
        }
    };

    const confirmNextQuarter = async () => {
        if (!data?.match) return;
        try {
            await MatchesRepository.nextQuarter(matchId);
            setQuarterEndModal(null);
        } catch (err) {
            handleError(err, "Error al iniciar siguiente cuarto");
        }
    };

    const handleStartOvertime = async () => {
        if (!data?.match) return;
        try {
            await MatchesRepository.startOvertime(matchId);
            setQuarterEndModal(null);
        } catch (err) {
            handleError(err, "Error al iniciar tiempo extra");
        }
    };

    const handleEndMatch = async () => {
        if (!data?.match) return;
        try {
            if (isRunning) await toggleTimer();
            
            if (stats.localScore === stats.visitorScore) {
                const shouldEnd = confirm("El partido está EMPATADO. ¿Finalizar de todas formas?");
                if (!shouldEnd) return;
            } else {
                const winner = stats.localScore > stats.visitorScore ? data.localTeam?.name : data.visitorTeam?.name;
                const shouldEnd = confirm(`🏆 Finalizar Partido\nGanador: ${winner}\n¿Confirmar?`);
                if (!shouldEnd) return;
            }
            
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
                await ScoresRepository.add({ ...commonInput, points: currentAction.action.points });
            } else {
                await FoulsRepository.add(commonInput);
            }
            setCurrentAction(null);
        } catch (err) {
            handleError(err, "Error al guardar acción");
        }
    };

    if (!data) return <div className="live-layout flex-center">Cargando...</div>;
    const { match, localTeam, visitorTeam, localPlayers, visitorPlayers } = data;

    if (!localTeam || !visitorTeam) {
        return (
            <div className="live-layout flex-center flex-col gap-md p-4 text-center">
                <AlertTriangle size={48} className="text-danger" />
                <h2 className="text-xl font-bold">Datos Incompletos</h2>
                <button onClick={() => navigate('/matches')} className="btn btn-primary">Volver</button>
            </div>
        );
    }

    const isLastQuarter = matchConfig && match.currentQuarter >= matchConfig.totalQuarters;

    return (
        <div className="live-layout">
            {error && <ErrorToast message={error} onClose={clearError} />}

            <header className="live-header">
                <button onClick={handleBackClick} className="live-btn-icon">
                    <ChevronLeft size={28} />
                </button>

                <div className={`live-badge ${match.status === 'playing' ? 'active' : ''}`}>
                    {match.status === 'finished' ? (
                        <>FINALIZADO</>
                    ) : (
                        <>
                            <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></span>
                            Q{match.currentQuarter}
                        </>
                    )}
                </div>

                <button onClick={() => setShowHistory(true)} className="live-btn-icon">
                    <History size={22} />
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

            {currentAction && (
                <PlayerSelectModal
                    teamName={currentAction.teamName}
                    players={currentAction.players}
                    action={currentAction.action}
                    onSelect={confirmAction}
                    onCancel={() => setCurrentAction(null)}
                />
            )}

            {/* MODAL DE FIN DE CUARTO / PARTIDO (Ahora usa clases CSS puras) */}
            {quarterEndModal && matchConfig && (
                <div className="game-modal-overlay">
                    <div className={`game-modal-card ${quarterEndModal === 'overtime' ? 'is-overtime' : 'is-end'}`}>
                        
                        <div className="modal-icon-wrapper">
                            {quarterEndModal === 'overtime' ? (
                                <AlertTriangle size={40} className="text-warning" />
                            ) : isLastQuarter ? (
                                <Trophy size={40} className="text-warning" />
                            ) : (
                                <Flag size={40} />
                            )}
                        </div>

                        <h3>
                            {quarterEndModal === 'overtime' 
                                ? '¡Tiempo Terminado!' 
                                : isLastQuarter ? 'Partido Finalizado' : `Fin del Cuarto ${match.currentQuarter}`
                            }
                        </h3>
                        
                        <p>
                            {quarterEndModal === 'overtime' 
                                ? 'El marcador está empatado. ¿Tiempo extra?'
                                : 'Confirma la siguiente acción.'
                            }
                        </p>

                        <div className="modal-score-strip">
                            <div className="text-center">
                                <div className="text-xs text-muted uppercase font-bold mb-1 tracking-wider">
                                    {data.localTeam?.name.substring(0, 3)}
                                </div>
                                <span className="modal-score-num text-blue-400">{stats.localScore}</span>
                            </div>
                            
                            <div className="text-muted font-mono text-xl">vs</div>
                            
                            <div className="text-center">
                                <div className="text-xs text-muted uppercase font-bold mb-1 tracking-wider">
                                    {data.visitorTeam?.name.substring(0, 3)}
                                </div>
                                <span className="modal-score-num text-orange-400">{stats.visitorScore}</span>
                            </div>
                        </div>

                        <div className="modal-actions">
                            {quarterEndModal === 'overtime' ? (
                                <>
                                    <button onClick={handleStartOvertime} className="btn-modal-primary btn-overtime">
                                        <Play size={20} />
                                        Tiempo Extra (5:00)
                                    </button>
                                    <button onClick={handleEndMatch} className="btn-modal-secondary">
                                        Terminar en Empate
                                    </button>
                                </>
                            ) : (
                                <>
                                    {!isLastQuarter ? (
                                        <button onClick={confirmNextQuarter} className="btn-modal-primary btn-next-q">
                                            <Play size={20} />
                                            Comenzar Cuarto {match.currentQuarter + 1}
                                        </button>
                                    ) : (
                                        <button onClick={handleEndMatch} className="btn-modal-primary btn-finish">
                                            <Trophy size={20} />
                                            Oficializar Victoria
                                        </button>
                                    )}
                                    
                                    <button onClick={() => setQuarterEndModal(null)} className="btn-modal-secondary">
                                        Volver al mapa
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL SALIDA (MEJORADO) */}
            {showExitConfirm && (
                <div className="game-modal-overlay">
                    <div className="game-modal-card is-exit">
                        <div className="modal-icon-wrapper">
                            <LogOut size={40} className="text-blue-400" />
                        </div>

                        <h3>¿Deseas salir?</h3>
                        <p>
                            El reloj sigue corriendo. Puedes pausarlo ahora o dejarlo activo en segundo plano.
                        </p>

                        <div className="modal-actions">
                            <button
                                onClick={handleExitAndPause}
                                className="btn-modal-primary btn-exit-pause"
                            >
                                <Pause size={20} />
                                Pausar y Salir
                            </button>

                            <button
                                onClick={handleExitRunning}
                                className="btn-modal-primary btn-exit-run"
                            >
                                <Play size={20} />
                                Salir sin Pausar
                            </button>

                            <button onClick={() => setShowExitConfirm(false)} className="btn-modal-secondary">
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