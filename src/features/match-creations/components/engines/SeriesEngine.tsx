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
    const { addScore, addFoul, undoLastAction } = useGameActions();
    const navigate = useNavigate();
    const [trackPlayers, setTrackPlayers] = useState(false);

    if (!match || !localTeam || !visitorTeam) return null;

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
        setWinnerId
    } = useSeriesLogic({ match });

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

            {/* 1. BANNER SUPERIOR COMPACTO DE SETS GANADOS (PLAYOFFS BAR) */}
            <div className="race-stage-banner" style={{ paddingBottom: '0.25rem' }}>
                <div
                    className="series-info-pill"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.85rem',
                        width: '100%',
                        maxWidth: '580px',
                        padding: '0.5rem 1.15rem'
                    }}
                >
                    {/* Sets Local */}
                    <div className="flex-gap" style={{ gap: '0.45rem' }}>
                        <span
                            style={{
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                textTransform: 'uppercase',
                                color: 'var(--secondary-light)',
                                maxWidth: '88px',
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
                        <div className="flex-gap" style={{ gap: '3px' }}>
                            {[...Array(setsToWin)].map((_, i) => (
                                <span
                                    key={`l-set-${i}`}
                                    style={{
                                        width: '7px',
                                        height: '7px',
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
                        <div className="series-info-main" style={{ fontSize: '0.88rem' }}>
                            <Layers size={14} color="var(--secondary-light)" />
                            SET {currentSet} (A {pointsPerSet} PTS{winByTwo ? ' +2' : ''})
                        </div>
                        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Sets Ganados (Meta: {setsToWin})
                        </span>
                    </div>

                    {/* Sets Visita */}
                    <div className="flex-gap" style={{ gap: '0.45rem' }}>
                        <div className="flex-gap" style={{ gap: '3px' }}>
                            {[...Array(setsToWin)].map((_, i) => (
                                <span
                                    key={`v-set-${i}`}
                                    style={{
                                        width: '7px',
                                        height: '7px',
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
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                textTransform: 'uppercase',
                                color: 'var(--primary-light)',
                                maxWidth: '88px',
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
                            variant="local"
                            simpleScoring={true}
                            scoringOptions={scoringOptions}
                            onScore={(pts) => requestAction(localTeam.id!, localTeam.name, localTeam.players, { type: 'score', points: pts as 1 | 2 | 3 })}
                            onFoul={() => requestAction(localTeam.id!, localTeam.name, localTeam.players, { type: 'foul' })}
                            disabled={showSetEndModal || showSeriesEndModal}
                        />
                    </div>

                    <div className="team-column">
                        <GameActionControls
                            variant="visitor"
                            simpleScoring={true}
                            scoringOptions={scoringOptions}
                            onScore={(pts) => requestAction(visitorTeam.id!, visitorTeam.name, visitorTeam.players, { type: 'score', points: pts as 1 | 2 | 3 })}
                            onFoul={() => requestAction(visitorTeam.id!, visitorTeam.name, visitorTeam.players, { type: 'foul' })}
                            disabled={showSetEndModal || showSeriesEndModal}
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
                        <p style={{ color: '#fff', marginBottom: '0.5rem' }}>
                            Ganador del set: <strong>{setWinnerId === localTeam.id ? localTeam.name : visitorTeam.name}</strong> ({match.localScore} - {match.visitorScore})
                        </p>
                        <p className="text-muted" style={{ fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                            El marcador de puntos se reiniciará para el siguiente set.
                        </p>
                        <div className="modal-actions">
                            <button onClick={confirmSetEnd} className="btn-modal-primary btn-next-q">
                                Confirmar y Siguiente Set
                            </button>
                            <button onClick={undoLastAction} className="btn-modal-secondary">
                                Deshacer último punto (Corregir)
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
