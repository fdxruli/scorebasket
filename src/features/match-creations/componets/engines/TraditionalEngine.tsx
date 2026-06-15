import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLiveMatch } from '../context/LiveMatchContext';
import { useGameActions } from '../../hooks/useGameActions';
import { useTraditionalLogic } from '../../hooks/useTraditionalLogic';
import { db } from '../../../../db/db';

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
    endMatch
  } = useTraditionalLogic({ match });

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

  const handleScoreClick = (teamId: number, points: 1 | 2 | 3) => {
    setPlayerModal({ isOpen: true, teamId, actionType: 'score', points });
  };

  const handleFoulClick = (teamId: number) => {
    setPlayerModal({ isOpen: true, teamId, actionType: 'foul' });
  };

  const handlePlayerSelect = (playerId: number | null) => {
    if (playerModal.actionType === 'score') {
      // Permite registrar puntos aunque se elija "Jugador Desconocido".
      addScore(playerModal.teamId, playerModal.points || 1, playerId ?? undefined);
    } else {
      // Permite falta técnica/banca cuando playerId es null.
      addFoul(playerModal.teamId, playerId ?? undefined);
    }

    setPlayerModal({ ...playerModal, isOpen: false });
  };

  const handleNextQuarter = async () => {
    const isLastQuarter = currentQuarter >= totalQuarters;

    if (timeLeft > 0) {
      const actionLabel = isLastQuarter ? 'finalizar el partido' : 'avanzar al siguiente periodo';
      const shouldContinue = window.confirm(
        `Aún quedan ${formatTime(timeLeft)} en el Q${currentQuarter}. ¿Deseas ${actionLabel} de todos modos?`
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
          teamName={playerModal.teamId === localTeam.id ? localTeam.name : visitorTeam.name}
          players={playerModal.teamId === localTeam.id ? localTeam.players : visitorTeam.players}
          action={playerModal.actionType === 'score' ? { type: 'score', points: playerModal.points! } : { type: 'foul' }}
          onSelect={handlePlayerSelect}
          onCancel={() => setPlayerModal({ ...playerModal, isOpen: false })}
        />
      )}

      {showQuarterEndModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Fin del Q{currentQuarter}</h3>
            <p className="text-muted" style={{ margin: '0.75rem 0 1.25rem' }}>
              El tiempo del periodo terminó. El siguiente periodo iniciará pausado.
            </p>
            <button onClick={nextQuarter} className="btn btn-primary">
              Iniciar Q{currentQuarter + 1}
            </button>
          </div>
        </div>
      )}
      
      {showMatchEndModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>¡Fin del Partido!</h3>
            <h2>{localTeam.name} {match.localScore} - {match.visitorScore} {visitorTeam.name}</h2>
            <button onClick={endMatch} className="btn btn-danger">Terminar Partido</button>
          </div>
        </div>
      )}
    </div>
  );
};