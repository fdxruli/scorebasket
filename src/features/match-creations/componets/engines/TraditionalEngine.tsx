import React from 'react';
// CORRECCIÓN: Usar '../context' en lugar de '../../context'
import { useLiveMatch } from '../context/LiveMatchContext';
import { useGameActions } from '../../hooks/useGameActions';
import { useTraditionalLogic } from '../../hooks/useTraditionalLogic';

// UI Components existentes
import { Scoreboard } from '../../../../components/live/Scoreboard'; 
import { MatchControls } from '../../../../components/live/MatchControls';
import { PlayerSelectModal } from '../../../../components/live/PlayerSelectModal';

// Components compartidos
import { LiveHeader } from '../shared/LiveHeader';

export const TraditionalEngine: React.FC = () => {
  const { match, localTeam, visitorTeam } = useLiveMatch();
  const { addScore, addFoul, undoLastAction } = useGameActions();

  if (!match || !localTeam || !visitorTeam) return null;

  const {
    timerDisplay,
    isTimerRunning,
    toggleTimer,
    currentQuarter,
    showQuarterEndModal,
    nextQuarter,
    showMatchEndModal,
    endMatch
  } = useTraditionalLogic({ match });

  const [playerModal, setPlayerModal] = React.useState<{
    isOpen: boolean;
    teamId: number;
    actionType: 'score' | 'foul';
    points?: 1 | 2 | 3;
  }>({ isOpen: false, teamId: 0, actionType: 'score' });

  const handleScoreClick = (teamId: number, points: 1 | 2 | 3) => {
    setPlayerModal({ isOpen: true, teamId, actionType: 'score', points });
  };

  const handleFoulClick = (teamId: number) => {
    setPlayerModal({ isOpen: true, teamId, actionType: 'foul' });
  };

  const handlePlayerSelect = (playerId: number | null) => {
    if (playerId === null && playerModal.actionType === 'foul') {
       // Lógica para falta técnica o jugador desconocido si lo permites
       addFoul(playerModal.teamId, undefined);
    } else if (playerId !== null) {
        if (playerModal.actionType === 'score') {
          addScore(playerModal.teamId, playerModal.points || 1, playerId); // Fallback a 1 si undefined
        } else {
          addFoul(playerModal.teamId, playerId);
        }
    }
    setPlayerModal({ ...playerModal, isOpen: false });
  };

  return (
    <div className="live-layout">
      <LiveHeader />

      <Scoreboard 
        localName={localTeam.name}
        visitorName={visitorTeam.name}
        localScore={match.localScore}
        visitorScore={match.visitorScore}
        localFouls={match.localFouls}
        visitorFouls={match.visitorFouls}
        timeLeft={0} // El timerDisplay ya viene formateado, pero Scoreboard espera segundos
        // Nota: Si Scoreboard espera string en timer, ajusta la prop. Si espera segundos:
        // timeLeft={timeLeft} (pasándolo desde el hook)
        isTimerRunning={isTimerRunning}
      />
      {/* Visualización manual del tiempo si Scoreboard no soporta string directo */}
      <div className="absolute top-[80px] left-1/2 -translate-x-1/2 z-20">
         <div className="timer-pill">{timerDisplay}</div>
      </div>

      <MatchControls 
        localTeam={localTeam}
        visitorTeam={visitorTeam}
        localPlayers={localTeam.players}
        visitorPlayers={visitorTeam.players}
        isTimerRunning={isTimerRunning}
        onToggleTimer={toggleTimer}
        onNextQuarter={nextQuarter}
        onEndMatch={() => endMatch()} // Asegurar llamada
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