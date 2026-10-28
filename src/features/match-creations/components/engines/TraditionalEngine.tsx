// src/features/match-creations/components/engines/TraditionalEngine.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLiveMatch } from '../context/LiveMatchContext';
import { useGameActions } from '../../hooks/useGameActions';
import { useTraditionalLogic } from '../../hooks/useTraditionalLogic';
import { db } from '../../../../db/db';
import { formatPeriodLabel } from '../../../../utils/matchHelpers';
import { Trophy, Clock, RotateCcw, X } from 'lucide-react';

// UI Components
import { Scoreboard } from '../../../../components/live/Scoreboard'; 
import { MatchControls } from '../../../../components/live/MatchControls';
import { PlayerSelectModal } from '../../../../components/live/PlayerSelectModal';

// Components compartidos
import { LiveHeader } from '../shared/LiveHeader';

export const TraditionalEngine: React.FC = () => {
  const navigate = useNavigate();
  const { match, localTeam, visitorTeam } = useLiveMatch();
  const { addScore, addFoul, undoLastAction } = useGameActions();

  const hasAnyPlayers = Boolean(
    (localTeam?.players && localTeam.players.length > 0) ||
    (visitorTeam?.players && visitorTeam.players.length > 0)
  );
  const [trackPlayers, setTrackPlayers] = useState<boolean>(hasAnyPlayers);
  const [showTimerModal, setShowTimerModal] = useState(false);
  const [customMinutes, setCustomMinutes] = useState('10');
  const [customSeconds, setCustomSeconds] = useState('00');

  useEffect(() => {
    setTrackPlayers(hasAnyPlayers);
  }, [hasAnyPlayers]);

  useEffect(() => {
    if (match?.status === 'finished') {
      navigate('/matches');
    }
  }, [match?.status, navigate]);

  if (!match || !localTeam || !visitorTeam) return null;

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
  } = useTraditionalLogic({ match });

  useEffect(() => {
    if (!showTimerModal) return;
    const totalSecs = Math.ceil(timeLeft);
    setCustomMinutes(String(Math.floor(totalSecs / 60)));
    setCustomSeconds(String(totalSecs % 60).padStart(2, '0'));
  }, [timeLeft, showTimerModal]);

  const periodLabel = formatPeriodLabel(currentQuarter, totalQuarters);

  const currentQuarterFouls = useLiveQuery(async () => {
    if (!match.id) {
      return {
        local: match.localFouls || 0,
        visitor: match.visitorFouls || 0
      };
    }

    const fouls = await db.fouls.where('matchId').equals(match.id).toArray();
    const quarterFouls = fouls.filter(foul => foul.quarter === currentQuarter);

    return {
      local: quarterFouls.filter(foul => foul.teamId === match.localTeamId).length,
      visitor: quarterFouls.filter(foul => foul.teamId === match.visitorTeamId).length
    };
  }, [match.id, match.localFouls, match.visitorFouls, currentQuarter]);

  const [playerModal, setPlayerModal] = useState<{
    isOpen: boolean;
    teamId: number;
    actionType: 'score' | 'foul';
    points?: 1 | 2 | 3;
  }>({ isOpen: false, teamId: 0, actionType: 'score' });
  
  const formatTime = (seconds: number) => {
    const s = Math.ceil(seconds);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const getTeamPlayers = (teamId: number) =>
    teamId === localTeam.id ? localTeam.players : visitorTeam.players;

  const handleScoreClick = (teamId: number, points: 1 | 2 | 3) => {
    const teamPlayers = getTeamPlayers(teamId);
    if (!trackPlayers || !teamPlayers || teamPlayers.length === 0) {
      addScore(teamId, points, undefined);
      return;
    }
    setPlayerModal({ isOpen: true, teamId, actionType: 'score', points });
  };

  const handleFoulClick = (teamId: number) => {
    const teamPlayers = getTeamPlayers(teamId);
    if (!trackPlayers || !teamPlayers || teamPlayers.length === 0) {
      addFoul(teamId, undefined);
      return;
    }
    setPlayerModal({ isOpen: true, teamId, actionType: 'foul' });
  };

  const handlePlayerSelect = (playerId: number | null) => {
    if (playerModal.actionType === 'score') {
      addScore(playerModal.teamId, playerModal.points || 1, playerId ?? undefined);
    } else {
      addFoul(playerModal.teamId, playerId ?? undefined);
    }

    setPlayerModal({ ...playerModal, isOpen: false });
  };

  const handleManualEndMatch = async () => {
    if (!window.confirm('¿Deseas finalizar y cerrar el partido actual?')) return;
    await endMatch();
  };

  const handleNextQuarter = async () => {
    const isLastQuarter = currentQuarter >= totalQuarters;

    if (timeLeft > 0) {
      const actionLabel = isLastQuarter ? 'cerrar el periodo actual' : 'avanzar al siguiente periodo';
      const shouldContinue = window.confirm(
        `Aún quedan ${formatTime(timeLeft)} en el ${periodLabel}. ¿Deseas ${actionLabel} de todos modos?`
      );

      if (!shouldContinue) return;
    }

    if (isLastQuarter) {
      if (isTied) {
        setShowMatchEndModal(true);
        return;
      }
      await endMatch();
      return;
    }

    await nextQuarter();
  };

  const handleUndoFromModal = async () => {
    await undoLastAction();
    setShowQuarterEndModal(false);
    setShowMatchEndModal(false);
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

  return (
    <div className="live-layout">
      <LiveHeader />

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
      />

      <MatchControls 
        localTeam={localTeam}
        visitorTeam={visitorTeam}
        localPlayers={localTeam.players}
        visitorPlayers={visitorTeam.players}
        isTimerRunning={isTimerRunning}
        trackPlayers={trackPlayers}
        onToggleTrackPlayers={() => setTrackPlayers(prev => !prev)}
        onToggleTimer={toggleTimer}
        onNextQuarter={handleNextQuarter}
        onEndMatch={handleManualEndMatch}
        onActionRequest={(teamId, _, __, action) => {
          if (action.type === 'score') handleScoreClick(teamId, action.points);
          else handleFoulClick(teamId);
        }}
      />

      {playerModal.isOpen && (
        <PlayerSelectModal 
          matchId={match.id}
          foulLimit={5}
          teamName={playerModal.teamId === localTeam.id ? localTeam.name : visitorTeam.name}
          players={playerModal.teamId === localTeam.id ? localTeam.players : visitorTeam.players}
          action={playerModal.actionType === 'score' ? { type: 'score', points: playerModal.points! } : { type: 'foul' }}
          onSelect={handlePlayerSelect}
          onCancel={() => setPlayerModal({ ...playerModal, isOpen: false })}
        />
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

            <div className="modal-icon-wrapper">
              <Clock size={32} color="var(--secondary-light)" />
            </div>
            <h3>Ajustar Reloj ({periodLabel})</h3>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '2.25rem',
                fontWeight: 800,
                color: '#fff',
                margin: '0.25rem 0 1rem'
              }}
            >
              {formatTime(timeLeft)}
            </div>

            {/* Botones rápidos de ajuste */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', width: '100%', marginBottom: '1rem' }}>
              <button type="button" onClick={() => adjustTime(-10)} className="btn btn-secondary" style={{ padding: '0.6rem 0.25rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                -10s
              </button>
              <button type="button" onClick={() => adjustTime(-1)} className="btn btn-secondary" style={{ padding: '0.6rem 0.25rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                -1s
              </button>
              <button type="button" onClick={() => adjustTime(1)} className="btn btn-secondary" style={{ padding: '0.6rem 0.25rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                +1s
              </button>
              <button type="button" onClick={() => adjustTime(10)} className="btn btn-secondary" style={{ padding: '0.6rem 0.25rem', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                +10s
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
                Reiniciar Periodo
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

      {showQuarterEndModal && (
        <div className="game-modal-overlay">
          <div className="game-modal-card is-exit">
            <div className="modal-icon-wrapper">
              <Clock size={36} color="var(--secondary-light)" />
            </div>
            <h3>Fin del {periodLabel}</h3>
            <p>
              El tiempo del periodo terminó. El siguiente periodo iniciará pausado.
            </p>
            <div className="modal-actions">
              <button onClick={nextQuarter} className="btn-modal-primary btn-next-q">
                Iniciar {formatPeriodLabel(currentQuarter + 1, totalQuarters)}
              </button>
              <button onClick={handleUndoFromModal} className="btn-modal-secondary">
                Deshacer última acción / Corregir
              </button>
            </div>
          </div>
        </div>
      )}
      
      {showMatchEndModal && (
        <div className="game-modal-overlay">
          <div className={`game-modal-card ${isTied ? 'is-overtime' : 'is-end'}`}>
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
                <button onClick={() => startOvertime(3)} className="btn-modal-primary btn-overtime">
                  Iniciar OT (+3 min)
                </button>
                <button onClick={() => startOvertime(5)} className="btn-modal-primary btn-overtime">
                  Iniciar OT (+5 min)
                </button>
                <button onClick={handleUndoFromModal} className="btn-modal-secondary">
                  Deshacer última acción / Corregir
                </button>
                <button onClick={endMatch} className="btn-modal-secondary">
                  Terminar en Empate
                </button>
              </div>
            ) : (
              <div className="modal-actions">
                <button onClick={endMatch} className="btn-modal-primary btn-finish">
                  Guardar y Cerrar Partido
                </button>
                <button onClick={handleUndoFromModal} className="btn-modal-secondary">
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
