import React, { useState } from 'react';
// Esta ruta es correcta si ambos están en "componets"
import { useLiveMatch } from '../context/LiveMatchContext'; 
import { useGameActions } from '../../hooks/useGameActions';
import { useRaceLogic } from '../../hooks/useRaceLogic';
import { LiveHeader } from '../shared/LiveHeader';
import { GameActionControls } from '../shared/GameActionControls';
import { Scoreboard } from '../../../../components/live/Scoreboard';
import { PlayerSelectModal, type GameAction } from '../../../../components/live/PlayerSelectModal';
import { Target, Trophy } from 'lucide-react';

export const RaceEngine: React.FC = () => {
  const { match, localTeam, visitorTeam } = useLiveMatch();
  const { addScore, addFoul } = useGameActions();

  if (!match || !localTeam || !visitorTeam) return null;
  
  const { targetScore, showMatchEndModal, endMatch, winnerTeamId } = useRaceLogic({ match });

  const [currentAction, setCurrentAction] = useState<{
    teamId: number;
    teamName: string;
    players: any[];
    action: GameAction;
  } | null>(null);

  const requestAction = (teamId: number, teamName: string, players: any[], action: GameAction) => {
    if (showMatchEndModal) return;
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

  return (
    <div className="live-layout">
      <LiveHeader />

      <div className="absolute top-[80px] left-1/2 -translate-x-1/2 z-20 flex flex-col items-center">
        <div className="bg-zinc-900 border border-zinc-700 px-4 py-1 rounded-full flex items-center gap-2 shadow-lg">
          <Target size={14} className="text-primary" />
          <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">
            Meta: <span className="text-white text-sm">{targetScore}</span>
          </span>
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
      />

      <section className="controls-panel">
        <div className="flex justify-around items-end w-full gap-4 pb-4">
          <GameActionControls 
            onScore={(pts) => requestAction(localTeam.id!, localTeam.name, localTeam.players, { type: 'score', points: pts as 1|2|3 })}
            onFoul={() => requestAction(localTeam.id!, localTeam.name, localTeam.players, { type: 'foul' })}
          />

          <div className="h-32 w-[1px] bg-white/10 mx-2"></div>

          <GameActionControls 
            onScore={(pts) => requestAction(visitorTeam.id!, visitorTeam.name, visitorTeam.players, { type: 'score', points: pts as 1|2|3 })}
            onFoul={() => requestAction(visitorTeam.id!, visitorTeam.name, visitorTeam.players, { type: 'foul' })}
          />
        </div>
      </section>

      {currentAction && (
        <PlayerSelectModal
          teamName={currentAction.teamName}
          players={currentAction.players}
          action={currentAction.action}
          onSelect={confirmAction}
          onCancel={() => setCurrentAction(null)}
        />
      )}

      {showMatchEndModal && (
        <div className="game-modal-overlay">
          <div className="game-modal-card is-end">
            <div className="modal-icon-wrapper">
              <Trophy size={40} className="text-yellow-500" />
            </div>
            <h3>¡Tenemos un Ganador!</h3>
            <p className="text-lg text-white font-bold my-4">
              {winnerTeamId === localTeam.id ? localTeam.name : visitorTeam.name}
            </p>
            <p className="text-sm text-muted mb-6">
              Ha alcanzado la meta de {targetScore} puntos.
            </p>
            <button onClick={endMatch} className="btn-modal-primary btn-finish">
              Finalizar Partido
            </button>
          </div>
        </div>
      )}
    </div>
  );
};