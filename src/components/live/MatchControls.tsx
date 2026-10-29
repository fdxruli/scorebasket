// src/components/live/MatchControls.tsx
import { Play, Pause, FastForward, Clock } from 'lucide-react';
import type { Player, Team } from '../../db/models';
import type { GameAction } from './PlayerSelectModal';
import { GameActionControls } from '../../features/match-creations/components/shared/GameActionControls';

interface MatchControlsProps {
  localTeam: Team;
  visitorTeam: Team;
  localPlayers: Player[];
  visitorPlayers: Player[];
  isTimerRunning: boolean;
  timeLeft?: number;
  canEditTimer?: boolean;
  onTimerClick?: () => void;
  possession?: 'local' | 'visitor' | null;
  onTogglePossession?: () => void;
  showTimer?: boolean;
  showPossession?: boolean;
  onActionRequest: (teamId: number, teamName: string, players: Player[], action: GameAction) => void;
  onToggleTimer: () => void;
  onNextQuarter: () => void;
  nextPeriodLabel?: string;
}

const formatTime = (seconds: number) => {
  const s = Math.ceil(seconds);
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
};

export function MatchControls({
  localTeam,
  visitorTeam,
  localPlayers,
  visitorPlayers,
  isTimerRunning,
  timeLeft,
  canEditTimer = false,
  onTimerClick,
  possession,
  onTogglePossession,
  showTimer = true,
  showPossession = true,
  onActionRequest,
  onToggleTimer,
  onNextQuarter,
  nextPeriodLabel = 'Sig. Periodo'
}: MatchControlsProps) {
  return (
    <section className="controls-panel">
      {/* 1. TRANSPORTE Y RELOJ UNIFICADOS: Reloj + Iniciar/Pausar + Ir a Q juntos */}
      {showTimer && (
        <div className="transport-bar">
          {timeLeft !== undefined && (
            <button
              type="button"
              onClick={canEditTimer ? onTimerClick : undefined}
              className={`btn-transport transport-clock ${isTimerRunning ? 'is-running' : 'is-paused'} ${canEditTimer ? 'is-editable' : ''}`}
              title={canEditTimer ? 'Toca para ajustar el reloj' : 'Pausa el reloj para editarlo'}
              disabled={!canEditTimer}
            >
              <Clock size={16} />
              <span className="transport-clock-digits">{formatTime(timeLeft)}</span>
              {canEditTimer && <span className="transport-clock-hint">EDITAR</span>}
            </button>
          )}

          <button
            type="button"
            onClick={onToggleTimer}
            className={`btn-transport ${isTimerRunning ? 'is-running' : 'is-paused'}`}
            title={isTimerRunning ? 'Pausar reloj' : 'Iniciar reloj'}
          >
            {isTimerRunning ? <Pause fill="currentColor" size={20} /> : <Play fill="currentColor" size={20} />}
            <span>{isTimerRunning ? 'Pausar' : 'Iniciar'}</span>
          </button>

          <button
            type="button"
            onClick={onNextQuarter}
            className="btn-transport is-secondary"
            title="Avanzar al siguiente periodo"
          >
            <FastForward size={18} />
            <span>{nextPeriodLabel}</span>
          </button>
        </div>
      )}

      {/* 2. BOTÓN DE POSESIÓN FLUIDO Y VISIBLE (entre transporte y puntos) */}
      {showPossession && onTogglePossession && (
        <div className="possession-hub-container">
          <button
            type="button"
            onClick={onTogglePossession}
            className={`btn-possession-fluid ${possession ? `is-${possession}` : 'is-neutral'}`}
            title="Alternar posesión de balón (toca para cambiar)"
            aria-label="Alternar posesión de balón"
          >
            <div className={`possession-side local ${possession === 'local' ? 'active' : ''}`}>
              <span className="possession-chevron">◀</span>
              <span className="possession-team-name">{localTeam.name}</span>
            </div>

            <div className="possession-center-divider">
              <span className="possession-pill-label">POSESIÓN</span>
            </div>

            <div className={`possession-side visitor ${possession === 'visitor' ? 'active' : ''}`}>
              <span className="possession-team-name">{visitorTeam.name}</span>
              <span className="possession-chevron">▶</span>
            </div>
          </button>
        </div>
      )}

      {/* 3. ANOTACIÓN: un bloque por equipo (Puntos y Falta al alcance de los pulgares) */}
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
    </section>
  );
}
