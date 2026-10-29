// src/features/match-creations/components/engines/RaceEngine.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveMatch } from '../context/LiveMatchContext';
import { useGameActions } from '../../hooks/useGameActions';
import { useRaceLogic } from '../../hooks/useRaceLogic';
import { LiveHeader } from '../shared/LiveHeader';
import { GameActionControls } from '../shared/GameActionControls';
import { LiveToolsBar } from '../shared/LiveToolsBar';
import { Scoreboard } from '../../../../components/live/Scoreboard';
import { PlayerSelectModal, type GameAction } from '../../../../components/live/PlayerSelectModal';
import { ModalLiveStatusPill } from '../../../../components/live/ModalLiveStatusPill';
import { buildShareMatchCardInputFromDb, shareOrDownloadMatchCard } from '../../../../utils/shareCardGenerator';
import { Target, Trophy, RotateCcw, Flag, Share2 } from 'lucide-react';
import type { Player } from '../../../../db/models';

export const RaceEngine: React.FC = () => {
    const navigate = useNavigate();
    const { match, localTeam, visitorTeam } = useLiveMatch();
    const { addScore, addFoul, undoLastAction } = useGameActions();

    const hasAnyPlayers = Boolean(
        (localTeam?.players && localTeam.players.length > 0) ||
        (visitorTeam?.players && visitorTeam.players.length > 0)
    );
    const [trackPlayers, setTrackPlayers] = useState<boolean>(hasAnyPlayers);
    const [showEarlyFinishConfirm, setShowEarlyFinishConfirm] = useState(false);
    const [isSharingCard, setIsSharingCard] = useState(false);

    // Solo activa el rastreo al pasar de 0 jugadores a >= 1 (o en la carga inicial);
    // si el usuario lo apaga manualmente, no se vuelve a forzar a ON.
    const prevHasAnyPlayersRef = useRef(false);
    useEffect(() => {
        if (hasAnyPlayers && !prevHasAnyPlayersRef.current) {
            setTrackPlayers(true);
        }
        prevHasAnyPlayersRef.current = hasAnyPlayers;
    }, [hasAnyPlayers]);

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
        teamSide: 'local' | 'visitor';
        teamName: string;
        players: Player[];
        action: GameAction;
    } | null>(null);

    const requestAction = (
        teamId: number,
        teamSide: 'local' | 'visitor',
        teamName: string,
        players: Player[],
        action: GameAction
    ) => {
        if (showMatchEndModal) return;

        if (!trackPlayers) {
            if (action.type === 'score') {
                addScore(teamId, action.points, undefined);
            } else {
                addFoul(teamId, undefined);
            }
            return;
        }

        setCurrentAction({ teamId, teamSide, teamName, players, action });
    };

    const confirmAction = async (playerId: number | null, overrideAction?: GameAction) => {
        if (!currentAction) return;
        const finalAction = overrideAction || currentAction.action;
        const targetTeamId = currentAction.teamId;
        if (finalAction.type === 'score') {
            await addScore(targetTeamId, finalAction.points, playerId ?? undefined);
        } else {
            await addFoul(targetTeamId, playerId ?? undefined);
        }
        setCurrentAction(null);
    };

    const handleShareLiveResult = async () => {
        if (!match.id || isSharingCard) return;
        setIsSharingCard(true);
        try {
            const payload = await buildShareMatchCardInputFromDb(match.id);
            if (payload) {
                await shareOrDownloadMatchCard(payload);
            }
        } catch (err) {
            console.error('Error al compartir resultado en vivo:', err);
            window.alert('No se pudo generar la imagen del partido.');
        } finally {
            setIsSharingCard(false);
        }
    };

    const gameHistory = match.gameHistory || [];
    const localGamesWon = gameHistory.filter(g => g.winner === 'local').length;
    const visitorGamesWon = gameHistory.filter(g => g.winner === 'visitor').length;
    const currentGameNum = match.config?.race?.currentGame || 1;

    return (
        <div className="live-layout">
            <LiveHeader />

            <div className="race-stage-banner">
                <div className="race-info-pill">
                    <span className="race-info-label">
                        <Target size={16} color="var(--primary)" />
                        Meta Reta #{currentGameNum}
                    </span>
                    <span className="race-info-value">
                        {targetScore} PTS {winByTwo ? '• DIF +2' : ''}
                    </span>
                    {gameHistory.length > 0 && (
                        <span className="race-games-record">
                            Juegos: {localGamesWon} - {visitorGamesWon}
                        </span>
                    )}
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
                            teamName={localTeam.name}
                            scoringOptions={scoringOptions}
                            variant="local"
                            onScore={(pts) =>
                                requestAction(localTeam.id!, 'local', localTeam.name, localTeam.players, {
                                    type: 'score',
                                    points: pts
                                })
                            }
                            onFoul={() =>
                                requestAction(localTeam.id!, 'local', localTeam.name, localTeam.players, {
                                    type: 'foul'
                                })
                            }
                            disabled={showMatchEndModal}
                        />
                    </div>

                    {/* COLUMNA VISITANTE */}
                    <div className="team-column">
                        <GameActionControls
                            teamName={visitorTeam.name}
                            scoringOptions={scoringOptions}
                            variant="visitor"
                            onScore={(pts) =>
                                requestAction(visitorTeam.id!, 'visitor', visitorTeam.name, visitorTeam.players, {
                                    type: 'score',
                                    points: pts
                                })
                            }
                            onFoul={() =>
                                requestAction(visitorTeam.id!, 'visitor', visitorTeam.name, visitorTeam.players, {
                                    type: 'foul'
                                })
                            }
                            disabled={showMatchEndModal}
                        />
                    </div>
                </div>

                <LiveToolsBar
                    trackPlayers={trackPlayers}
                    onToggleTrackPlayers={() => setTrackPlayers(prev => !prev)}
                    onEndMatch={() => setShowEarlyFinishConfirm(true)}
                />
            </section>

            {currentAction && (
                <PlayerSelectModal
                    matchId={match.id}
                    teamId={currentAction.teamId}
                    teamSide={currentAction.teamSide}
                    teamName={currentAction.teamName}
                    players={currentAction.teamSide === 'local' ? localTeam.players : visitorTeam.players}
                    action={currentAction.action}
                    scoringOptions={scoringOptions}
                    onSelect={confirmAction}
                    onCancel={() => setCurrentAction(null)}
                />
            )}

            {showEarlyFinishConfirm && (
                <div className="game-modal-overlay" onClick={() => setShowEarlyFinishConfirm(false)}>
                    <div className="game-modal-card is-exit" onClick={e => e.stopPropagation()}>
                        <div className="game-modal-status-header">
                            <ModalLiveStatusPill />
                        </div>
                        <div className="modal-icon-wrapper">
                            <Flag size={34} color="var(--danger)" />
                        </div>
                        <h3>¿Finalizar la Reta?</h3>
                        <p>
                            Aún no se alcanza la meta de {targetScore} puntos ({match.localScore} - {match.visitorScore}).
                        </p>
                        <div className="modal-actions">
                            <button
                                type="button"
                                onClick={async () => {
                                    setShowEarlyFinishConfirm(false);
                                    await endMatch();
                                }}
                                className="btn-modal-primary btn-finish"
                            >
                                Sí, Guardar y Cerrar Partido
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowEarlyFinishConfirm(false)}
                                className="btn-modal-secondary"
                            >
                                Seguir Jugando
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showMatchEndModal && (
                <div className="game-modal-overlay">
                    <div className="game-modal-card is-end">
                        <div className="game-modal-status-header">
                            <ModalLiveStatusPill />
                        </div>
                        <div className="modal-icon-wrapper">
                            <Trophy size={40} color="var(--warning)" />
                        </div>
                        <h3>¡Tenemos un Ganador!</h3>
                        <p style={{ fontSize: '1.45rem', fontFamily: 'var(--font-display)', color: '#fff', fontWeight: 900, margin: '0.5rem 0', textTransform: 'uppercase' }}>
                            {winnerTeamId === localTeam.id ? localTeam.name : visitorTeam.name}
                        </p>
                        <p className="text-muted" style={{ fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                            Ha alcanzado la meta de {targetScore} puntos ({match.localScore} - {match.visitorScore}).
                        </p>

                        <div className="modal-actions">
                            {hasRematches && (
                                <button
                                    type="button"
                                    onClick={handleRematch}
                                    className="btn-modal-primary"
                                    style={{ background: 'var(--secondary)', marginBottom: '0.35rem' }}
                                >
                                    <RotateCcw size={18} />
                                    Dar la Vuelta (Revancha)
                                </button>
                            )}

                            <button type="button" onClick={endMatch} className="btn-modal-primary btn-finish">
                                Finalizar Partido
                            </button>

                            <button
                                type="button"
                                onClick={handleShareLiveResult}
                                disabled={isSharingCard}
                                className="btn-modal-primary"
                                style={{
                                    background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.5rem'
                                }}
                            >
                                <Share2 size={18} />
                                {isSharingCard ? 'Generando imagen...' : 'Compartir Resultado (Imagen)'}
                            </button>

                            <button type="button" onClick={undoLastAction} className="btn-modal-secondary">
                                Deshacer último punto (Corregir)
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
