import React from 'react';
import { useLiveMatch } from '../context/LiveMatchContext';
import { useGameActions } from '../../hooks/useGameActions';
import { useTraditionalLogic } from '../../hooks/useTraditionalLogic';

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
    // timerDisplay, // <--- Ya no necesitamos este string formateado aquí
    timeLeft,       // <--- Usaremos este número (segundos) para el Scoreboard
    isTimerRunning,
    toggleTimer,
    // currentQuarter, // Si no lo usas directamente aquí, puedes omitirlo
    // showQuarterEndModal, // (Asegúrate de mantener la lógica de modales si la tenías abajo)
    nextQuarter,
    showMatchEndModal,
    endMatch
  } = useTraditionalLogic({ match });

  // ... (Mantén tu lógica de playerModal igual) ...
  const [playerModal, setPlayerModal] = React.useState<{
    isOpen: boolean;
    teamId: number;
    actionType: 'score' | 'foul';
    points?: 1 | 2 | 3;
  }>({ isOpen: false, teamId: 0, actionType: 'score' });
  
  // ... (Mantén los handlers handleScoreClick, handleFoulClick, handlePlayerSelect igual) ...
  const handleScoreClick = (teamId: number, points: 1 | 2 | 3) => {
    setPlayerModal({ isOpen: true, teamId, actionType: 'score', points });
  };

  const handleFoulClick = (teamId: number) => {
    setPlayerModal({ isOpen: true, teamId, actionType: 'foul' });
  };

  const handlePlayerSelect = (playerId: number | null) => {
      // ... (Tu lógica existente) ...
      if (playerId === null && playerModal.actionType === 'foul') {
         addFoul(playerModal.teamId, undefined);
      } else if (playerId !== null) {
          if (playerModal.actionType === 'score') {
            addScore(playerModal.teamId, playerModal.points || 1, playerId);
          } else {
            addFoul(playerModal.teamId, playerId);
          }
      }
      setPlayerModal({ ...playerModal, isOpen: false });
  };

  return (
    <div className="live-layout">
      <LiveHeader />

      {/* --- CORRECCIÓN AQUÍ --- */}
      <Scoreboard 
        localName={localTeam.name}
        visitorName={visitorTeam.name}
        localScore={match.localScore}
        visitorScore={match.visitorScore}
        localFouls={match.localFouls}
        visitorFouls={match.visitorFouls}
        
        // 1. Pasamos el tiempo real del hook
        timeLeft={timeLeft} 
        
        // 2. Pasamos el estado real del reloj para la animación
        isTimerRunning={isTimerRunning}
      />

      {/* 3. ELIMINAMOS ESTE BLOQUE:
         <div className="absolute top-[80px] left-1/2 -translate-x-1/2 z-20">
            <div className="timer-pill">{timerDisplay}</div>
         </div>
         
         Al eliminarlo, el único reloj visible será el del Scoreboard (en medio),
         que ahora sí recibirá el tiempo correcto.
      */}

      <MatchControls 
        localTeam={localTeam}
        visitorTeam={visitorTeam}
        localPlayers={localTeam.players}
        visitorPlayers={visitorTeam.players}
        isTimerRunning={isTimerRunning}
        onToggleTimer={toggleTimer}
        onNextQuarter={nextQuarter}
        onEndMatch={() => endMatch()}
        onActionRequest={(teamId, _, __, action) => {
            if (action.type === 'score') handleScoreClick(teamId, action.points);
            else handleFoulClick(teamId);
        }}
      />

      {/* ... (Mantén tus modales igual) ... */}
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