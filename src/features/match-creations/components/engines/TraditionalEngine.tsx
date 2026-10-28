// src/features/match-creations/components/engines/TraditionalEngine.tsx
import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLiveMatch } from '../context/LiveMatchContext';
import { useGameActions } from '../../hooks/useGameActions';
import { useTraditionalLogic } from '../../hooks/useTraditionalLogic';
import { db } from '../../../../db/db';
import { formatPeriodLabel } from '../../../../utils/matchHelpers';
import { Trophy, Clock } from 'lucide-react';

// UI Components
import { Scoreboard } from '../../../../components/live/Scoreboard'; 
import { MatchControls } from '../../../../components/live/MatchControls';
import { PlayerSelectModal } from '../../../../components/live/PlayerSelectModal';

// Components compartidos
import { LiveHeader } from '../shared/LiveHeader';

export const TraditionalEngine: React.FC = () => {
  const { match, localTeam, visitorTeam } = useLiveMatch();
  const { addScore, addFoul } = useGameActions();

  if (!match || !localTeam || !visitorTeam) return null;

  const {
    timeLeft,
    isTimerRunning,
    toggleTimer,
    currentQuarter,
    totalQuarters,
    nextQuarter,
    showQuarterEndModal,
    showMatchEndModal,
    endMatch,
    startOvertime,
    isTied
  } = useTraditionalLogic({ match });

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

  const [playerModal, setPlayerModal] = React.useState<{
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
    if (!teamPlayers || teamPlayers.length === 0) {
      addScore(teamId, points, undefined);
      return;
    }
    setPlayerModal({ isOpen: true, teamId, actionType: 'score', points });
  };

  const handleFoulClick = (teamId: number) => {
    const teamPlayers = getTeamPlayers(teamId);
    if (!teamPlayers || teamPlayers.length === 0) {
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

  const handleNextQuarter = async () => {
    const isLastQuarter = currentQuarter >= totalQuarters;

    if (timeLeft > 0) {
      const actionLabel = isLastQuarter ? 'finalizar el partido' : 'avanzar al siguiente periodo';
      const shouldContinue = window.confirm(
        `Aún quedan ${formatTime(timeLeft)} en el ${periodLabel}. ¿Deseas ${actionLabel} de todos modos?`
      );

      if (!shouldContinue) return;
    }

    if (isLastQuarter) {
      await endMatch();
      return;
    }

    await nextQuarter();
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
      />

      <MatchControls 
        localTeam={localTeam}
        visitorTeam={visitorTeam}
        localPlayers={localTeam.players}
        visitorPlayers={visitorTeam.players}
        isTimerRunning={isTimerRunning}
        onToggleTimer={toggleTimer}
        onNextQuarter={handleNextQuarter}
        onEndMatch={() => endMatch()}
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
                <button onClick={() => startOvertime(5)} className="btn-modal-primary btn-overtime">
                  Iniciar OT (+5 min)
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
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
