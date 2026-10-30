// src/features/match-creations/components/engines/SeriesEngine.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useLiveMatch } from '../context/LiveMatchContext';
import { useGameActions } from '../../hooks/useGameActions';
import { useSeriesLogic } from '../../hooks/useSeriesLogic';
import { SeriesEarlyFinishModal } from './SeriesEarlyFinishModal';
import { LiveHeader } from '../shared/LiveHeader';
import { GameActionControls } from '../shared/GameActionControls';
import { LiveToolsBar } from '../shared/LiveToolsBar';
import { Scoreboard } from '../../../../components/live/Scoreboard';
import { PlayerSelectModal, type GameAction } from '../../../../components/live/PlayerSelectModal';
import { ModalLiveStatusPill } from '../../../../components/live/ModalLiveStatusPill';
import { buildShareMatchCardInputFromDb, shareOrDownloadMatchCard } from '../../../../utils/shareCardGenerator';
import { Trophy, Layers, Share2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Player } from '../../../../db/models';

export const SeriesEngine: React.FC = () => {
    const { match, localTeam, visitorTeam } = useLiveMatch();
    const { addScore, addFoul, undoLastAction } = useGameActions();
    const navigate = useNavigate();

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

    const {
        currentSet,
        localSetsWon,
        visitorSetsWon,
        setsToWin,
        pointsPerSet,
        winByTwo,
        scoringSystem,
        showSetEndModal,
        showSeriesEndModal,
        confirmSetEnd,
        endSeries,
        setWinnerId,
        isProcessing,
        errorMessage,
        clearError
    } = useSeriesLogic({ match });

    const [currentAction, setCurrentAction] = useState<{
        teamId: number;
        teamSide: 'local' | 'visitor';
        teamName: string;
        players: Player[];
        action: GameAction;
    } | null>(null);

    const handleEarlyFinish = async (countCurrentSet: boolean) => {
        const result = await endSeries({ countCurrentSet });
        if (result && (result.status === 'finished' || result.status === 'already_finished')) {
            setShowEarlyFinishConfirm(false);
        }
    };

    if (!match || !localTeam || !visitorTeam) return null;

    const scoringOptions: (1 | 2 | 3)[] = scoringSystem === 'street' ? [1, 2] : [1, 2, 3];

    // Se preserva la pantalla final de la serie para visualización del resultado,
    // compartir la tarjeta y salida explícita hacia el historial.

    const requestAction = (
        teamId: number,
        teamSide: 'local' | 'visitor',
        teamName: string,
        players: Player[],
        action: GameAction
    ) => {
        if (showSetEndModal || showSeriesEndModal) return;

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

    return (
        <div className="live-layout">
            <LiveHeader />

            {/* Herramientas secundarias (en vertical: arriba de los marcadores; en horizontal: columna central superior) */}
            <LiveToolsBar
                trackPlayers={trackPlayers}
                onToggleTrackPlayers={() => setTrackPlayers(prev => !prev)}
                onEndMatch={() => { clearError(); setShowEarlyFinishConfirm(true); }}
            />

            {/* 1. BANNER SUPERIOR COMPACTO DE SETS GANADOS (PLAYOFFS BAR) */}
            <div className="race-stage-banner" style={{ paddingBottom: '0.2rem' }}>
                <div
                    className="series-info-pill"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.85rem',
                        width: '100%',
                        maxWidth: '640px',
                        padding: '0.5rem 1.15rem'
                    }}
                >
                    {/* Sets Local */}
                    <div className="flex-gap" style={{ gap: '0.45rem' }}>
                        <span
                            style={{
                                fontSize: '0.75rem',
                                fontWeight: 800,
                                textTransform: 'uppercase',
                                color: 'var(--secondary-light)',
                                maxWidth: '96px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {localTeam.name}
                        </span>
                        <span
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '1.15rem',
                                fontWeight: 900,
                                color: '#fff',
                                background: 'rgba(14, 165, 233, 0.22)',
                                border: '1px solid rgba(14, 165, 233, 0.45)',
                                borderRadius: '6px',
                                padding: '0.1rem 0.5rem'
                            }}
                        >
                            {localSetsWon}
                        </span>
                        <div className="flex-gap" style={{ gap: '4px' }}>
                            {[...Array(setsToWin)].map((_, i) => (
                                <span
                                    key={`l-set-${i}`}
                                    style={{
                                        width: '8px',
                                        height: '8px',
                                        borderRadius: '50%',
                                        backgroundColor: i < localSetsWon ? 'var(--secondary-light)' : 'rgba(255,255,255,0.15)',
                                        boxShadow: i < localSetsWon ? '0 0 8px var(--secondary)' : 'none'
                                    }}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Info Set Actual */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                        <div className="series-info-main" style={{ fontSize: '0.92rem' }}>
                            <Layers size={14} color="var(--secondary-light)" />
                            SET {currentSet} (A {pointsPerSet} PTS{winByTwo ? ' +2' : ''})
                        </div>
                        <span style={{ fontSize: '0.64rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Sets Ganados (Meta: {setsToWin})
                        </span>
                    </div>

                    {/* Sets Visita */}
                    <div className="flex-gap" style={{ gap: '0.45rem' }}>
                        <div className="flex-gap" style={{ gap: '4px' }}>
                            {[...Array(setsToWin)].map((_, i) => (
                                <span
                                    key={`v-set-${i}`}
                                    style={{
                                        width: '8px',
                                        height: '8px',
                                        borderRadius: '50%',
                                        backgroundColor: i < visitorSetsWon ? 'var(--primary-light)' : 'rgba(255,255,255,0.15)',
                                        boxShadow: i < visitorSetsWon ? '0 0 8px var(--primary)' : 'none'
                                    }}
                                />
                            ))}
                        </div>
                        <span
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '1.15rem',
                                fontWeight: 900,
                                color: '#fff',
                                background: 'rgba(255, 95, 31, 0.22)',
                                border: '1px solid rgba(255, 95, 31, 0.45)',
                                borderRadius: '6px',
                                padding: '0.1rem 0.5rem'
                            }}
                        >
                            {visitorSetsWon}
                        </span>
                        <span
                            style={{
                                fontSize: '0.75rem',
                                fontWeight: 800,
                                textTransform: 'uppercase',
                                color: 'var(--primary-light)',
                                maxWidth: '96px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {visitorTeam.name}
                        </span>
                    </div>
                </div>
            </div>

            {/* 2. SCOREBOARD PRINCIPAL: PUNTOS DEL SET ACTUAL EN GRANDE */}
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
                showFouls={true}
            />

            {/* Controles */}
            <section className="controls-panel">
                <div className="action-grid">
                    <div className="team-column">
                        <GameActionControls
                            teamName={localTeam.name}
                            variant="local"
                            scoringOptions={scoringOptions}
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
                            disabled={showSetEndModal || showSeriesEndModal}
                        />
                    </div>

                    <div className="team-column">
                        <GameActionControls
                            teamName={visitorTeam.name}
                            variant="visitor"
                            scoringOptions={scoringOptions}
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
                            disabled={showSetEndModal || showSeriesEndModal}
                        />
                    </div>
                </div>
            </section>

            {/* --- MODALES --- */}
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

            <SeriesEarlyFinishModal
                isOpen={showEarlyFinishConfirm}
                isProcessing={isProcessing}
                errorMessage={errorMessage}
                match={match}
                localTeam={localTeam}
                visitorTeam={visitorTeam}
                localSetsWon={localSetsWon}
                visitorSetsWon={visitorSetsWon}
                onConfirmFinish={handleEarlyFinish}
                onDismiss={() => {
                    if (isProcessing) return;
                    clearError();
                    setShowEarlyFinishConfirm(false);
                }}
            />

            {showSetEndModal && (
                <div className="game-modal-overlay">
                    <div className="game-modal-card is-exit">
                        <div className="game-modal-status-header">
                            <ModalLiveStatusPill />
                        </div>
                        <div className="modal-icon-wrapper">
                            <Trophy size={40} color="var(--secondary-light)" />
                        </div>
                        <h3>Fin del Set {currentSet}</h3>
                        {errorMessage && (
                            <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid var(--danger, #ef4444)', color: '#fca5a5', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.85rem', marginBottom: '1rem', textAlign: 'left' }}>
                                {errorMessage}
                            </div>
                        )}
                        <p style={{ color: '#fff', marginBottom: '0.5rem' }}>
                            Ganador del set: <strong>{setWinnerId === localTeam.id ? localTeam.name : visitorTeam.name}</strong> ({match.localScore} - {match.visitorScore})
                        </p>
                        <p className="text-muted" style={{ fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                            El marcador de puntos se reiniciará para el siguiente set.
                        </p>
                        <div className="modal-actions">
                            <button type="button" onClick={confirmSetEnd} disabled={isProcessing} className="btn-modal-primary btn-next-q">
                                {isProcessing ? 'Confirmando...' : 'Confirmar y Siguiente Set'}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    clearError();
                                    undoLastAction();
                                }}
                                className="btn-modal-secondary"
                            >
                                Deshacer último punto (Corregir)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showSeriesEndModal && (
                <div className="game-modal-overlay">
                    <div className="game-modal-card is-end">
                        <div className="game-modal-status-header">
                            <ModalLiveStatusPill />
                        </div>
                        <div className="modal-icon-wrapper">
                            <Trophy size={40} color="var(--warning)" />
                        </div>
                        <h3>¡Serie Finalizada!</h3>
                        <p style={{ fontSize: '1.25rem', fontFamily: 'var(--font-display)', color: '#fff', fontWeight: 900, margin: '0.5rem 0', textTransform: 'uppercase' }}>
                            {localSetsWon === visitorSetsWon
                                ? 'Serie Empatada'
                                : `Ganador: ${localSetsWon > visitorSetsWon ? localTeam.name : visitorTeam.name}`}
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
                            <button type="button" onClick={() => navigate('/matches')} className="btn-modal-primary btn-finish">
                                Ir al Historial de Partidos
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
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
