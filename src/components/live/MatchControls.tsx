// src/components/live/MatchControls.tsx
import { Play, Pause, FastForward, X, AlertCircle, Users } from 'lucide-react';
import type { Player, Team } from '../../db/models';
import type { GameAction } from './PlayerSelectModal';

interface MatchControlsProps {
  localTeam: Team;
  visitorTeam: Team;
  localPlayers: Player[];
  visitorPlayers: Player[];
  isTimerRunning: boolean;
  trackPlayers?: boolean;
  onToggleTrackPlayers?: () => void;
  onActionRequest: (teamId: number, teamName: string, players: Player[], action: GameAction) => void;
  onToggleTimer: () => void;
  onNextQuarter: () => void;
  onEndMatch: () => void;
}

export function MatchControls({
  localTeam, visitorTeam,
  localPlayers, visitorPlayers,
  isTimerRunning,
  trackPlayers = true,
  onToggleTrackPlayers,
  onActionRequest,
  onToggleTimer,
  onNextQuarter,
  onEndMatch
}: MatchControlsProps) {

  return (
    <section className="controls-panel">
      
      {/* GRILLA DE ACCIONES PRINCIPALES */}
      <div className="action-grid">
        
        {/* LADO LOCAL (IZQUIERDA) */}
        <div className="team-column">
          <div className="btn-score-group">
             <button 
               onClick={() => onActionRequest(localTeam.id!, localTeam.name, localPlayers, {type:'score', points:1})} 
               className="btn-action btn-local-sm"
             >
               +1
             </button>
             <button 
               onClick={() => onActionRequest(localTeam.id!, localTeam.name, localPlayers, {type:'score', points:2})} 
               className="btn-action btn-local-sm"
             >
               +2
             </button>
          </div>
          <button 
             onClick={() => onActionRequest(localTeam.id!, localTeam.name, localPlayers, {type:'score', points:3})} 
             className="btn-action btn-local-lg"
          >
             +3
          </button>
          <button 
             onClick={() => onActionRequest(localTeam.id!, localTeam.name, localPlayers, {type:'foul'})} 
             className="btn-action btn-local-foul"
          >
             <AlertCircle size={14} />
             Falta {localTeam.name.substring(0,3)}
          </button>
        </div>

        {/* LADO VISITANTE (DERECHA) */}
        <div className="team-column">
          <div className="btn-score-group">
             <button 
               onClick={() => onActionRequest(visitorTeam.id!, visitorTeam.name, visitorPlayers, {type:'score', points:1})} 
               className="btn-action btn-visitor-sm"
             >
               +1
             </button>
             <button 
               onClick={() => onActionRequest(visitorTeam.id!, visitorTeam.name, visitorPlayers, {type:'score', points:2})} 
               className="btn-action btn-visitor-sm"
             >
               +2
             </button>
          </div>
          <button 
             onClick={() => onActionRequest(visitorTeam.id!, visitorTeam.name, visitorPlayers, {type:'score', points:3})} 
             className="btn-action btn-visitor-lg"
          >
             +3
          </button>
          <button 
             onClick={() => onActionRequest(visitorTeam.id!, visitorTeam.name, visitorPlayers, {type:'foul'})} 
             className="btn-action btn-visitor-foul"
          >
             <AlertCircle size={14} />
             Falta {visitorTeam.name.substring(0,3)}
          </button>
        </div>

      </div>

      {/* CHIP TOGGLE JUGADORES ON / OFF */}
      {onToggleTrackPlayers && (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={onToggleTrackPlayers}
            className="btn btn-secondary"
            style={{
              fontSize: '0.75rem',
              padding: '0.4rem 0.9rem',
              borderRadius: '999px',
              borderColor: trackPlayers ? 'var(--primary)' : 'var(--border-color)',
              color: trackPlayers ? 'var(--primary-light)' : 'var(--text-muted)',
              backgroundColor: trackPlayers ? 'rgba(255, 95, 31, 0.14)' : 'rgba(255, 255, 255, 0.03)'
            }}
          >
            <Users size={14} />
            Jugadores: {trackPlayers ? 'ON' : 'OFF'}
          </button>
        </div>
      )}

      {/* BARRA DE UTILIDADES E INICIO */}
      <div className="bottom-bar">
        <button onClick={onEndMatch} className="btn-utility">
            <X size={20} />
            <span>Fin</span>
        </button>

        {/* BOTÓN GIGANTE PLAY/PAUSE */}
        <button onClick={onToggleTimer} className={`btn-main-play ${isTimerRunning ? 'play' : 'pause'}`}>
          {isTimerRunning ? (
             <Pause fill="currentColor" size={36} />
          ) : (
             <Play fill="currentColor" size={36} style={{ marginLeft: '0.25rem' }} />
          )}
        </button>

        <button onClick={onNextQuarter} className="btn-utility">
            <FastForward size={20} />
            <span>Sig Q</span>
        </button>
      </div>

    </section>
  );
}
