// src/features/match-creations/components/engines/TraditionalEngine.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLiveMatch } from '../context/LiveMatchContext';
import { useGameActions } from '../../hooks/useGameActions';
import { useTraditionalLogic } from '../../hooks/useTraditionalLogic';
import { db } from '../../../../db/db';
import { formatPeriodLabel } from '../../../../utils/matchHelpers';
import { buildShareMatchCardInputFromDb, shareOrDownloadMatchCard } from '../../../../utils/shareCardGenerator';
import { Trophy, Clock, RotateCcw, X, Flag, FastForward, Share2 } from 'lucide-react';

// UI Components
import { Scoreboard } from '../../../../components/live/Scoreboard';
import { MatchControls } from '../../../../components/live/MatchControls';
import { PlayerSelectModal, type GameAction } from '../../../../components/live/PlayerSelectModal';
import { ModalLiveStatusPill } from '../../../../components/live/ModalLiveStatusPill';

// Components compartidos
import { LiveHeader } from '../shared/LiveHeader';
import { LiveToolsBar } from '../shared/LiveToolsBar';

export const TraditionalEngine: React.FC = () => {
  const navigate = useNavigate();
  const { match, localTeam, visitorTeam, isActionModalOpen, setActionModalOpen } = useLiveMatch();
  const { addScore, addFoul, undoLastAction } = useGameActions();

  const hasAnyPlayers = Boolean(
    (localTeam?.players && localTeam.players.length > 0) ||
    (visitorTeam?.players && visitorTeam.players.length > 0)
  );
  const [trackPlayers, setTrackPlayers] = useState<boolean>(hasAnyPlayers);
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('10');
  const [customSeconds, setCustomSeconds] = useState('00');
  const [confirmDialog, setConfirmDialog] = useState<'end-match' | 'next-quarter' | null>(null);
  const [isSharingCard, setIsSharingCard] = useState(false);

  const [playerModal, setPlayerModal] = useState<{
    isOpen: boolean;
    teamId: number;
    action: GameAction;
  }>({ isOpen: false, teamId: 0, action: { type: 'score', points: 2 } });

  // Sincronizar estado de modales locales con el contexto de prioridad
  useEffect(() => {
    setActionModalOpen('engine-player-modal', playerModal.isOpen);
    return () => setActionModalOpen('engine-player-modal', false);
  }, [playerModal.isOpen, setActionModalOpen]);

  useEffect(() => {
    const hasDialog = showTimerModal || confirmDialog !== null;
    setActionModalOpen('engine-dialog-modal', hasDialog);
    return () => setActionModalOpen('engine-dialog-modal', false);
  }, [showTimerModal, confirmDialog, setActionModalOpen]);

  // Solo activa el rastreo al pasar de 0 jugadores a >= 1 (o en la carga inicial);
  // si el usuario lo apaga manualmente, no se vuelve a forzar a ON.
  const prevHasAnyPlayersRef = useRef(false);
  useEffect(() => {
    if (hasAnyPlayers && !prevHasAnyPlayersRef.current) {
      setTrackPlayers(true);
    }
    prevHasAnyPlayersRef.current = hasAnyPlayers;
  }, [hasAnyPlayers]);

  useEffect(() => {
    if (match?.status === 'finished') {
      navigate('/matches');
    }
  }, [match?.status, navigate]);

  // Hooks incondicionales al nivel superior del componente (Rules of Hooks)
  const isOverlayBlocking =
    isActionModalOpen || playerModal.isOpen || showTimerModal || confirmDialog !== null;

  const {
    timeLeft,
    isTimerRunning,
    toggleTimer,
    resetCurrentQuarter,
    adjustTime,
    currentQuarter,
    totalQuarters,
    nextQuarter,
    showQuarterEndModal,
    setShowQuarterEndModal,
    showMatchEndModal,
    setShowMatchEndModal,
    endMatch,
    startOvertime,
    isTied
  } = useTraditionalLogic({ match, isActionModalOpen: isOverlayBlocking });

  useEffect(() => {
    if (!showTimerModal) return;
    const totalSecs = Math.ceil(timeLeft);
    setCustomMinutes(String(Math.floor(totalSecs / 60)));
    setCustomSeconds(String(totalSecs % 60).padStart(2, '0'));
  }, [timeLeft, showTimerModal]);

  const currentQuarterFouls = useLiveQuery(async () => {
    if (!match?.id) {
      return {
        local: match?.localFouls || 0,
        visitor: match?.visitorFouls || 0
      };
    }

    const fouls = await db.fouls.where('matchId').equals(match.id).toArray();
    const quarterFouls = fouls.filter(foul => foul.quarter === currentQuarter);

    return {
      local: quarterFouls.filter(foul => foul.teamId === match.localTeamId).length,
      visitor: quarterFouls.filter(foul => foul.teamId === match.visitorTeamId).length
    };
  }, [match?.id, match?.localTeamId, match?.visitorTeamId, match?.localFouls, match?.visitorFouls, currentQuarter]);

  // Limpieza de estado local al cambiar el partido
  const currentMatchIdRef = useRef<number | undefined>(match?.id);
  useEffect(() => {
    if (currentMatchIdRef.current !== match?.id) {
      currentMatchIdRef.current = match?.id;
      setPlayerModal(prev => ({ ...prev, isOpen: false }));
      setShowTimerModal(false);
      setConfirmDialog(null);
    }
  }, [match?.id]);

  if (!match || !localTeam || !visitorTeam) return null;

  const periodLabel = formatPeriodLabel(currentQuarter, totalQuarters);
  const isLastQuarter = currentQuarter >= totalQuarters;
  const nextPeriodBtnLabel = isLastQuarter ? 'Cerrar Q' : `Ir a ${formatPeriodLabel(currentQuarter + 1, totalQuarters)}`;

  const formatTime = (seconds: number) => {
    const s = Math.ceil(seconds);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const handleActionRequest = (teamId: number, action: GameAction) => {
    if (!trackPlayers) {
      if (action.type === 'score') {
        addScore(teamId, action.points, undefined);
      } else {
        addFoul(teamId, undefined);
      }
      return;
    }
    setPlayerModal({ isOpen: true, teamId, action });
  };

  const handlePlayerSelect = async (playerId: number | null, overrideAction?: GameAction) => {
    const finalAction = overrideAction || playerModal.action;
    const targetTeamId = playerModal.teamId;

    if (finalAction.type === 'score') {
      await addScore(targetTeamId, finalAction.points, playerId ?? undefined);
    } else {
      await addFoul(targetTeamId, playerId ?? undefined);
    }

    setPlayerModal(prev => ({ ...prev, isOpen: false }));
  };

  const executeNextQuarter = async () => {
    setConfirmDialog(null);
    if (isLastQuarter) {
      if (isTied || timeLeft <= 0) {
        setShowMatchEndModal(true);
        return;
      }
      await endMatch();
      return;
    }
    await nextQuarter();
  };

  const handleNextQuarterClick = async () => {
    if (timeLeft > 0) {
      setConfirmDialog('next-quarter');
      return;
    }
    await executeNextQuarter();
  };

  const handleUndoFromModal = async () => {
    await undoLastAction();
    setShowQuarterEndModal(false);
    setShowMatchEndModal(false);
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

  const openTimerEditor = () => {
    if (isTimerRunning) return;
    const totalSecs = Math.ceil(timeLeft);
    setCustomMinutes(String(Math.floor(totalSecs / 60)));
    setCustomSeconds(String(totalSecs % 60).padStart(2, '0'));
    setShowTimerModal(true);
  };

  const handleApplyCustomTime = async () => {
    const mins = Math.max(0, parseInt(customMinutes, 10) || 0);
    const secs = Math.max(0, Math.min(59, parseInt(customSeconds, 10) || 0));
    const targetTotal = mins * 60 + secs;
    const currentTotal = Math.ceil(timeLeft);
    await adjustTime(targetTotal - currentTotal);
    setShowTimerModal(false);
  };

  const handleTogglePossession = async () => {
    if (!match?.id) return;
    const current = match.possession ?? null;
    const nextPossession: 'local' | 'visitor' = current === 'local' ? 'visitor' : 'local';
    await db.matches.update(match.id, { possession: nextPossession });
  };

  const isLocalModal = playerModal.teamId === localTeam.id;

  return (
    <div className="live-layout">
      <LiveHeader />

      {/* Herramientas secundarias (en vertical: arriba de los marcadores; en horizontal: columna central superior) */}
      <LiveToolsBar
        trackPlayers={trackPlayers}
        onToggleTrackPlayers={() => setTrackPlayers(prev => !prev)}
        onEndMatch={() => setConfirmDialog('end-match')}
        showBuzzer
      />

      <Scoreboard
        localName={localTeam.name}
        visitorName={visitorTeam.name}
        localScore={match.localScore}
        visitorScore={match.visitorScore}
        localFouls={currentQuarterFouls?.local ?? 0}
        visitorFouls={currentQuarterFouls?.visitor ?? 0}
        timeLeft={timeLeft}
        isTimerRunning={isTimerRunning}
        onTimerClick={openTimerEditor}
        onToggleTimer={toggleTimer}
      />

      <MatchControls
        localTeam={localTeam}
        visitorTeam={visitorTeam}
        localPlayers={localTeam.players}
        visitorPlayers={visitorTeam.players}
        isTimerRunning={isTimerRunning}
        timeLeft={timeLeft}
        canEditTimer={!isTimerRunning}
        onTimerClick={openTimerEditor}
        possession={match.possession ?? null}
        onTogglePossession={handleTogglePossession}
        onToggleTimer={toggleTimer}
        onNextQuarter={handleNextQuarterClick}
        nextPeriodLabel={nextPeriodBtnLabel}
        onActionRequest={(teamId, _, __, action) => handleActionRequest(teamId, action)}
      />

      {playerModal.isOpen && (
        <PlayerSelectModal
          matchId={match.id}
          foulLimit={5}
          teamId={playerModal.teamId}
          teamSide={isLocalModal ? 'local' : 'visitor'}
          teamName={isLocalModal ? localTeam.name : visitorTeam.name}
          players={isLocalModal ? localTeam.players : visitorTeam.players}
          action={playerModal.action}
          scoringOptions={[1, 2, 3]}
          onSelect={handlePlayerSelect}
          onCancel={() => setPlayerModal({ ...playerModal, isOpen: false })}
        />
      )}

      {/* Modal Confirmación de Avance de Periodo o Fin de Partido */}
      {confirmDialog && (
        <div className="game-modal-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="game-modal-card is-exit" onClick={e => e.stopPropagation()}>
            <div className="game-modal-status-header">
              <ModalLiveStatusPill />
            </div>
            <div className="modal-icon-wrapper">
              {confirmDialog === 'end-match' ? (
                <Flag size={34} color="var(--danger)" />
              ) : (
                <FastForward size={34} color="var(--secondary-light)" />
              )}
            </div>
            <h3>
              {confirmDialog === 'end-match'
                ? '¿Finalizar Partido?'
                : isLastQuarter
                  ? `¿Cerrar ${periodLabel}?`
                  : `¿Avanzar a ${formatPeriodLabel(currentQuarter + 1, totalQuarters)}?`}
            </h3>
            <p>
              {confirmDialog === 'end-match'
                ? `El partido se guardará con marcador final ${localTeam.name} ${match.localScore} - ${match.visitorScore} ${visitorTeam.name}.`
                : `Aún quedan ${formatTime(timeLeft)} en el reloj del ${periodLabel}.`}
            </p>
            <div className="modal-actions">
              {confirmDialog === 'end-match' ? (
                <button
                  type="button"
                  onClick={async () => {
                    setConfirmDialog(null);
                    await endMatch();
                  }}
                  className="btn-modal-primary btn-finish"
                >
                  Sí, Guardar y Finalizar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={executeNextQuarter}
                  className="btn-modal-primary btn-next-q"
                >
                  Sí, {isLastQuarter ? 'Cerrar Periodo' : 'Avanzar Periodo'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="btn-modal-secondary"
              >
                Seguir Jugando
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editor Rápido de Reloj (En Pausa) */}
      {showTimerModal && !isTimerRunning && (
        <div className="game-modal-overlay" onClick={() => setShowTimerModal(false)}>
          <div className="game-modal-card is-exit" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setShowTimerModal(false)}
              className="btn-icon"
              style={{ position: 'absolute', top: '0.85rem', right: '0.85rem' }}
            >
              <X size={20} />
            </button>

            <div className="game-modal-status-header" style={{ paddingRight: '2rem' }}>
              <ModalLiveStatusPill />
            </div>

            <div className="modal-icon-wrapper">
              <Clock size={32} color="var(--secondary-light)" />
            </div>
            <h3>Ajustar Reloj ({periodLabel})</h3>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '2.5rem',
                fontWeight: 800,
                color: '#fff',
                margin: '0.25rem 0 1rem'
              }}
            >
              {formatTime(timeLeft)}
            </div>

            {/* Botones rápidos de ajuste */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', width: '100%', marginBottom: '1rem' }}>
              <button type="button" onClick={() => adjustTime(-60)} className="btn btn-secondary" style={{ padding: '0.65rem 0.25rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                -1m
              </button>
              <button type="button" onClick={() => adjustTime(-10)} className="btn btn-secondary" style={{ padding: '0.65rem 0.25rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                -10s
              </button>
              <button type="button" onClick={() => adjustTime(-1)} className="btn btn-secondary" style={{ padding: '0.65rem 0.25rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                -1s
              </button>
              <button type="button" onClick={() => adjustTime(1)} className="btn btn-secondary" style={{ padding: '0.65rem 0.25rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                +1s
              </button>
              <button type="button" onClick={() => adjustTime(10)} className="btn btn-secondary" style={{ padding: '0.65rem 0.25rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                +10s
              </button>
              <button type="button" onClick={() => adjustTime(60)} className="btn btn-secondary" style={{ padding: '0.65rem 0.25rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                +1m
              </button>
            </div>

            {/* Input directo de minutos y segundos */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', marginBottom: '1rem' }}>
              <input
                type="number"
                min="0"
                max="99"
                value={customMinutes}
                onChange={e => setCustomMinutes(e.target.value)}
                className="input"
                style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 800 }}
                placeholder="Min"
              />
              <span style={{ fontWeight: 800, fontSize: '1.2rem' }}>:</span>
              <input
                type="number"
                min="0"
                max="59"
                value={customSeconds}
                onChange={e => setCustomSeconds(e.target.value)}
                className="input"
                style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 800 }}
                placeholder="Seg"
              />
              <button type="button" onClick={handleApplyCustomTime} className="btn btn-primary" style={{ padding: '0.65rem 1rem' }}>
                Fijar
              </button>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                onClick={async () => {
                  await resetCurrentQuarter();
                  setShowTimerModal(false);
                }}
                className="btn btn-secondary btn-full"
              >
                <RotateCcw size={16} />
                Reiniciar Reloj del Periodo
              </button>
              <button
                type="button"
                onClick={() => setShowTimerModal(false)}
                className="btn btn-secondary btn-full"
              >
                Listo / Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {showQuarterEndModal && !isOverlayBlocking && (
        <div className="game-modal-overlay">
          <div className="game-modal-card is-exit">
            <div className="game-modal-status-header">
              <ModalLiveStatusPill />
            </div>
            <div className="modal-icon-wrapper">
              <Clock size={36} color="var(--secondary-light)" />
            </div>
            <h3>Fin del {periodLabel}</h3>
            <p>
              El tiempo del periodo terminó. El siguiente periodo iniciará pausado.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={nextQuarter} className="btn-modal-primary btn-next-q">
                Iniciar {formatPeriodLabel(currentQuarter + 1, totalQuarters)}
              </button>
              <button
                type="button"
                onClick={() => setShowQuarterEndModal(false)}
                className="btn-modal-secondary"
              >
                Seguir en {periodLabel} (Anotar jugada en 00:00)
              </button>
              <button type="button" onClick={handleUndoFromModal} className="btn-modal-secondary">
                Deshacer última acción / Corregir
              </button>
            </div>
          </div>
        </div>
      )}

      {showMatchEndModal && !isOverlayBlocking && (
        <div className="game-modal-overlay">
          <div className={`game-modal-card ${isTied ? 'is-overtime' : 'is-end'}`}>
            <div className="game-modal-status-header">
              <ModalLiveStatusPill />
            </div>
            <div className="modal-icon-wrapper">
              <Trophy size={38} color="var(--warning)" />
            </div>
            <h3>{isTied ? '¡Empate! Tiempo Extra' : '¡Fin del Partido!'}</h3>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '1.5rem',
                fontWeight: 800,
                margin: '0.5rem 0 1.25rem',
                padding: '0.75rem 1.25rem',
                background: 'rgba(0,0,0,0.35)',
                borderRadius: 'var(--radius-sm)',
                width: '100%'
              }}
            >
              {localTeam.name} {match.localScore} - {match.visitorScore} {visitorTeam.name}
            </div>
            {isTied ? (
              <div className="modal-actions">
                <button type="button" onClick={() => startOvertime(3)} className="btn-modal-primary btn-overtime">
                  Iniciar OT (+3 min)
                </button>
                <button type="button" onClick={() => startOvertime(5)} className="btn-modal-primary btn-overtime">
                  Iniciar OT (+5 min)
                </button>
                <button
                  type="button"
                  onClick={() => setShowMatchEndModal(false)}
                  className="btn-modal-secondary"
                >
                  Seguir en {periodLabel} (Anotar jugada en 00:00)
                </button>
                <button
                  type="button"
                  onClick={handleShareLiveResult}
                  disabled={isSharingCard}
                  className="btn-modal-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  <Share2 size={17} />
                  {isSharingCard ? 'Generando imagen...' : 'Compartir Resultado (Imagen)'}
                </button>
                <button type="button" onClick={handleUndoFromModal} className="btn-modal-secondary">
                  Deshacer última acción / Corregir
                </button>
                <button type="button" onClick={endMatch} className="btn-modal-secondary">
                  Terminar en Empate
                </button>
              </div>
            ) : (
              <div className="modal-actions">
                <button type="button" onClick={endMatch} className="btn-modal-primary btn-finish">
                  Guardar y Cerrar Partido
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
                <button
                  type="button"
                  onClick={() => setShowMatchEndModal(false)}
                  className="btn-modal-secondary"
                >
                  Seguir en {periodLabel} (Anotar jugada en 00:00)
                </button>
                <button type="button" onClick={handleUndoFromModal} className="btn-modal-secondary">
                  Deshacer última acción / Corregir
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
