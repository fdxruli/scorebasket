import React, { useState } from 'react';
import { useLiveMatch } from '../context/LiveMatchContext';
import { useGameActions } from '../../hooks/useGameActions';
import { useSeriesLogic } from '../../hooks/useSeriesLogic';
import { LiveHeader } from '../shared/LiveHeader';
import { GameActionControls } from '../shared/GameActionControls';
import { Scoreboard } from '../../../../components/live/Scoreboard';
import { PlayerSelectModal, type GameAction } from '../../../../components/live/PlayerSelectModal';
import { Trophy, Layers } from 'lucide-react';

export const SeriesEngine: React.FC = () => {
  const { match, localTeam, visitorTeam } = useLiveMatch();
  const { addScore, addFoul } = useGameActions();

  if (!match || !localTeam || !visitorTeam) return null;

  const {
    currentSet,
    localSetsWon,
    visitorSetsWon,
    setsToWin,
    showSetEndModal,
    showSeriesEndModal,
    confirmSetEnd,
    endSeries,
    setWinnerId
  } = useSeriesLogic({ match });

  // Estado para selección de jugador
  const [currentAction, setCurrentAction] = useState<{
    teamId: number;
    teamName: string;
    players: any[];
    action: GameAction;
  } | null>(null);

  const requestAction = (teamId: number, teamName: string, players: any[], action: GameAction) => {
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

      {/* Indicador de Set Actual */}
      <div className="absolute top-[80px] left-1/2 -translate-x-1/2 z-20">
        <div className="bg-zinc-900 border border-zinc-700 px-4 py-1 rounded-full flex items-center gap-2 shadow-lg">
          <Layers size={14} className="text-secondary" />
          <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">
            SET {currentSet} <span className="text-zinc-500">DE {((setsToWin * 2) - 1)}</span>
          </span>
        </div>
      </div>

      {/* Scoreboard Principal: Muestra SETS GANADOS */}
      <div className="relative">
        <Scoreboard
          localName={localTeam.name}
          visitorName={visitorTeam.name}
          localScore={localSetsWon}      // <--- Truco: Sets en lugar de puntos
          visitorScore={visitorSetsWon}  // <--- Truco: Sets en lugar de puntos
          localFouls={0} // Opcional: mostrar faltas o no en la vista macro
          visitorFouls={0}
          timeLeft={0}
          isTimerRunning={false}
        />
        
        {/* Puntos del Set Actual (Superpuestos o debajo) */}
        <div className="flex justify-center gap-12 -mt-4 mb-4 relative z-10">
          <div className="bg-black/50 backdrop-blur-md border border-blue-500/30 px-4 py-1 rounded-xl text-center min-w-[80px]">
            <div className="text-[10px] text-blue-300 uppercase font-bold">Puntos Set</div>
            <div className="text-2xl font-mono font-bold text-white">{match.localScore}</div>
          </div>
          
          <div className="bg-black/50 backdrop-blur-md border border-orange-500/30 px-4 py-1 rounded-xl text-center min-w-[80px]">
            <div className="text-[10px] text-orange-300 uppercase font-bold">Puntos Set</div>
            <div className="text-2xl font-mono font-bold text-white">{match.visitorScore}</div>
          </div>
        </div>
      </div>

      {/* Controles */}
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

      {/* Modales */}
      {currentAction && (
        <PlayerSelectModal
          teamName={currentAction.teamName}
          players={currentAction.players}
          action={currentAction.action}
          onSelect={confirmAction}
          onCancel={() => setCurrentAction(null)}
        />
      )}

      {/* Modal Fin de Set */}
      {showSetEndModal && (
        <div className="game-modal-overlay">
          <div className="game-modal-card">
            <div className="modal-icon-wrapper">
              <Trophy size={40} className="text-blue-400" />
            </div>
            <h3>Fin del Set {currentSet}</h3>
            <p className="text-white mb-4">
              Ganador del set: <strong>{setWinnerId === localTeam.id ? localTeam.name : visitorTeam.name}</strong>
            </p>
            <p className="text-sm text-muted mb-6">
              El marcador de puntos se reiniciará para el siguiente set.
            </p>
            <button onClick={confirmSetEnd} className="btn-modal-primary btn-next-q">
              Confirmar y Siguiente Set
            </button>
          </div>
        </div>
      )}

      {/* Modal Fin de Serie */}
      {showSeriesEndModal && (
        <div className="game-modal-overlay">
          <div className="game-modal-card is-end">
            <div className="modal-icon-wrapper">
              <Trophy size={40} className="text-yellow-500" />
            </div>
            <h3>¡Serie Finalizada!</h3>
            <p className="text-lg text-white font-bold my-4">
              Ganador: {localSetsWon > visitorSetsWon ? localTeam.name : visitorTeam.name}
            </p>
            <div className="text-2xl font-mono mb-6 bg-white/5 py-2 px-6 rounded-lg">
              {localSetsWon} - {visitorSetsWon}
            </div>
            <button onClick={endSeries} className="btn-modal-primary btn-finish">
              Finalizar Partido
            </button>
          </div>
        </div>
      )}
    </div>
  );
};