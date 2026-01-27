import { Play, Pause, FastForward, X, AlertCircle } from 'lucide-react';
import type { Player, Team } from '../../db/models';
import type { GameAction } from './PlayerSelectModal';

interface MatchControlsProps {
  localTeam: Team;
  visitorTeam: Team;
  localPlayers: Player[];
  visitorPlayers: Player[];
  isTimerRunning: boolean;
  
  // Eventos
  onActionRequest: (teamId: number, teamName: string, players: Player[], action: GameAction) => void;
  onToggleTimer: () => void;
  onNextQuarter: () => void;
  onEndMatch: () => void;
}

export function MatchControls({
  localTeam, visitorTeam,
  localPlayers, visitorPlayers,
  isTimerRunning,
  onActionRequest,
  onToggleTimer,
  onNextQuarter,
  onEndMatch
}: MatchControlsProps) {

  return (
    <section className="controls-section">
      {/* Grid de Puntos y Faltas */}
      <div className="points-grid">
        
        {/* Columna Local */}
        <div className="team-actions local-theme">
          <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onActionRequest(localTeam.id!, localTeam.name, localPlayers, {type:'score', points:1})} className="btn-point">+1</button>
              <button onClick={() => onActionRequest(localTeam.id!, localTeam.name, localPlayers, {type:'score', points:2})} className="btn-point">+2</button>
          </div>
          <button onClick={() => onActionRequest(localTeam.id!, localTeam.name, localPlayers, {type:'score', points:3})} className="btn-point bg-blue-500/20! border-blue-500/40! text-blue-400!">+3</button>
          
          <button onClick={() => onActionRequest(localTeam.id!, localTeam.name, localPlayers, {type:'foul'})} 
            className="flex items-center justify-center gap-2 py-3 mt-1 rounded-lg bg-red-900/20 text-red-400 border border-red-900/30 text-xs font-bold uppercase tracking-wider active:scale-95"
          >
            <AlertCircle size={14} /> Falta
          </button>
        </div>

        <div className="separator"></div>

        {/* Columna Visitante */}
        <div className="team-actions visitor-theme">
          <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onActionRequest(visitorTeam.id!, visitorTeam.name, visitorPlayers, {type:'score', points:1})} className="btn-point">+1</button>
              <button onClick={() => onActionRequest(visitorTeam.id!, visitorTeam.name, visitorPlayers, {type:'score', points:2})} className="btn-point">+2</button>
          </div>
          <button onClick={() => onActionRequest(visitorTeam.id!, visitorTeam.name, visitorPlayers, {type:'score', points:3})} className="btn-point bg-orange-500/20! border-orange-500/40! text-orange-400!">+3</button>
          
          <button onClick={() => onActionRequest(visitorTeam.id!, visitorTeam.name, visitorPlayers, {type:'foul'})} 
            className="flex items-center justify-center gap-2 py-3 mt-1 rounded-lg bg-red-900/20 text-red-400 border border-red-900/30 text-xs font-bold uppercase tracking-wider active:scale-95"
          >
            <AlertCircle size={14} /> Falta
          </button>
        </div>
      </div>

      {/* Controles Maestros */}
      <div className="master-controls">
        <button onClick={onEndMatch} className="btn-secondary-action w-16">
            <div className="p-2 rounded-full bg-gray-800 text-gray-400"><X size={18} /></div>
            <span>Fin</span>
        </button>

        <button onClick={onToggleTimer} className={`btn-play-pause ${isTimerRunning ? 'is-playing' : 'is-paused'}`}>
          {isTimerRunning ? <Pause fill="currentColor" size={32} /> : <Play fill="currentColor" size={32} className="ml-1" />}
        </button>

        <button onClick={onNextQuarter} className="btn-secondary-action w-16">
            <div className="p-2 rounded-full bg-gray-800 text-gray-400"><FastForward size={18} /></div>
            <span>Sig Q</span>
        </button>
      </div>
    </section>
  );
}