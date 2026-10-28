// src/components/live/MatchControls.tsx
import { Play, Pause, FastForward, Flag, Users } from 'lucide-react';
import type { Player, Team } from '../../db/models';
import type { GameAction } from './PlayerSelectModal';
import { GameActionControls } from '../../features/match-creations/components/shared/GameActionControls';

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
  nextPeriodLabel?: string;
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
  onEndMatch,
  nextPeriodLabel = 'Sig. Periodo'
}: MatchControlsProps) {

  return (
    <section className="controls-panel">

      {/* GRILLA DE ACCIONES PRINCIPALES */}
      <div className="action-grid">

        {/* LADO LOCAL (IZQUIERDA) */}
        <div className="team-column">
          <GameActionControls
            teamName={localTeam.name}
            variant="local"
            scoringOptions={[1, 2, 3]}
            onScore={(pts) => onActionRequest(localTeam.id!, localTeam.name, localPlayers, { type: 'score', points: pts })}
            onFoul={() => onActionRequest(localTeam.id!, localTeam.name, localPlayers, { type: 'foul' })}
          />
        </div>

        {/* LADO VISITANTE (DERECHA) */}
        <div className="team-column">
          <GameActionControls
            teamName={visitorTeam.name}
            variant="visitor"
            scoringOptions={[1, 2, 3]}
            onScore={(pts) => onActionRequest(visitorTeam.id!, visitorTeam.name, visitorPlayers, { type: 'score', points: pts })}
            onFoul={() => onActionRequest(visitorTeam.id!, visitorTeam.name, visitorPlayers, { type: 'foul' })}
          />
        </div>

      </div>

      {/* BARRA INFERIOR DE RELOJ Y UTILIDADES */}
      <div className="bottom-bar">
        <button type="button" onClick={onEndMatch} className="btn-utility danger-subtle" title="Finalizar y cerrar partido">
          <Flag size={18} />
          <span>Finalizar</span>
        </button>

        {onToggleTrackPlayers && (
          <button
            type="button"
            onClick={onToggleTrackPlayers}
            className={`btn-utility ${trackPlayers ? 'active-toggle' : ''}`}
            title="Activar o desactivar selección de jugador al anotar"
          >
            <Users size={18} />
            <span>Jugadores: {trackPlayers ? 'ON' : 'OFF'}</span>
          </button>
        )}

        {/* BOTÓN PRINCIPAL PLAY/PAUSE */}
        <button
          type="button"
          onClick={onToggleTimer}
          className={`btn-main-play ${isTimerRunning ? 'play' : 'pause'}`}
          title={isTimerRunning ? 'Pausar reloj' : 'Iniciar reloj'}
        >
          {isTimerRunning ? (
            <Pause fill="currentColor" size={32} />
          ) : (
            <Play fill="currentColor" size={32} style={{ marginLeft: '0.2rem' }} />
          )}
        </button>

        <button type="button" onClick={onNextQuarter} className="btn-utility" title="Avanzar al siguiente periodo">
          <FastForward size={18} />
          <span>{nextPeriodLabel}</span>
        </button>
      </div>

    </section>
  );
}
