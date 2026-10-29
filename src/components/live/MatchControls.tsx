// src/components/live/MatchControls.tsx
import { Play, Pause, FastForward } from 'lucide-react';
import type { Player, Team } from '../../db/models';
import type { GameAction } from './PlayerSelectModal';
import { GameActionControls } from '../../features/match-creations/components/shared/GameActionControls';
import { LiveToolsBar } from '../../features/match-creations/components/shared/LiveToolsBar';

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

      {/* 1. TRANSPORTE: reloj y periodo juntos (lo que se usa a cada rato) */}
      <div className="transport-bar">
        <button
          type="button"
          onClick={onToggleTimer}
          className={`btn-transport ${isTimerRunning ? 'is-running' : 'is-paused'}`}
          title={isTimerRunning ? 'Pausar reloj' : 'Iniciar reloj'}
        >
          {isTimerRunning ? <Pause fill="currentColor" size={22} /> : <Play fill="currentColor" size={22} />}
          <span>{isTimerRunning ? 'Pausar' : 'Iniciar'}</span>
        </button>

        <button type="button" onClick={onNextQuarter} className="btn-transport is-secondary" title="Avanzar al siguiente periodo">
          <FastForward size={20} />
          <span>{nextPeriodLabel}</span>
        </button>
      </div>

      {/* 2. ANOTACIÓN: un bloque por equipo */}
      <div className="action-grid">
        <div className="team-column">
          <GameActionControls
            teamName={localTeam.name}
            variant="local"
            scoringOptions={[1, 2, 3]}
            onScore={(pts) => onActionRequest(localTeam.id!, localTeam.name, localPlayers, { type: 'score', points: pts })}
            onFoul={() => onActionRequest(localTeam.id!, localTeam.name, localPlayers, { type: 'foul' })}
          />
        </div>

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

      {/* 3. HERRAMIENTAS: secundarias, con "Finalizar" aislado */}
      {onToggleTrackPlayers && (
        <LiveToolsBar
          trackPlayers={trackPlayers}
          onToggleTrackPlayers={onToggleTrackPlayers}
          onEndMatch={onEndMatch}
          showBuzzer
        />
      )}
    </section>
  );
}
