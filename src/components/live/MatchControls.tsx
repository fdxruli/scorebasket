// src/components/live/MatchControls.tsx
import { Play, Pause, FastForward, Clock } from 'lucide-react';
import type { Player, Team } from '../../db/models';
import type { GameAction } from './PlayerSelectModal';
import { GameActionControls } from '../../features/match-creations/components/shared/GameActionControls';
import { formatShotClock } from '../../db/matchTimer.service';

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
  onSelectPossession?: (team: 'local' | 'visitor') => void;
  showTimer?: boolean;
  showPossession?: boolean;
  actionDisabled?: boolean;
  onActionRequest: (teamId: number, teamName: string, players: Player[], action: GameAction) => void;
  onToggleTimer: () => void;
  onNextQuarter: () => void;
  nextPeriodLabel?: string;
  showShotClock?: boolean;
  shotClockEnabled?: boolean;
  shotClockTimeLeft?: number;
  isShotClockRunning?: boolean;
  isShotClockExpired?: boolean;
  onResetShotClock?: (seconds: 24 | 14) => void;
  assistantEnabled?: boolean;
  onTurnover?: () => void;
  showInitialPrompt?: boolean;
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
  onSelectPossession,
  showTimer = true,
  showPossession = true,
  actionDisabled = false,
  onActionRequest,
  onToggleTimer,
  onNextQuarter,
  nextPeriodLabel = 'Sig. Periodo',
  showShotClock = false,
  shotClockEnabled = false,
  shotClockTimeLeft,
  isShotClockRunning = false,
  isShotClockExpired = false,
  onResetShotClock,
  assistantEnabled = false,
  onTurnover,
  showInitialPrompt = false
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

      {/* 1b. RELOJ DE POSESIÓN (SHOT CLOCK) (DEPORT-04) */}
      {showShotClock && shotClockEnabled && (
        <div className="shot-clock-bar" data-testid="shot-clock-bar">
          <div
            className={`shot-clock-display ${isShotClockRunning ? 'is-running' : 'is-paused'} ${isShotClockExpired ? 'is-expired' : ''}`}
            data-testid="shot-clock-display"
            title={isShotClockExpired ? 'Posesión agotada' : isShotClockRunning ? 'Posesión en marcha' : 'Posesión pausada'}
          >
            <span className="shot-clock-label">POSESIÓN</span>
            <span className="shot-clock-digits" data-testid="shot-clock-digits">
              {formatShotClock(shotClockTimeLeft ?? 24)}
            </span>
          </div>

          <div className="shot-clock-actions">
            <button
              type="button"
              onClick={() => onResetShotClock?.(24)}
              disabled={actionDisabled}
              className="btn-shot-reset btn-shot-24"
              data-testid="btn-shot-24"
              title="Reiniciar posesión a 24 segundos"
              aria-label="Reiniciar posesión a 24 segundos"
            >
              <span className="shot-btn-num">24</span>
              <span className="shot-btn-sub">seg</span>
            </button>

            <button
              type="button"
              onClick={() => onResetShotClock?.(14)}
              disabled={actionDisabled}
              className="btn-shot-reset btn-shot-14"
              data-testid="btn-shot-14"
              title="Reiniciar posesión a 14 segundos"
              aria-label="Reiniciar posesión a 14 segundos"
            >
              <span className="shot-btn-num">14</span>
              <span className="shot-btn-sub">seg</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. BOTÓN DE POSESIÓN FLUIDO Y VISIBLE (entre transporte y puntos) */}
      {showPossession && (onTogglePossession || onSelectPossession) && (
        <div className="possession-hub-container">
          <div
            className={`btn-possession-fluid ${possession ? `is-${possession}` : 'is-neutral'} ${showInitialPrompt ? 'has-pending-prompt' : ''}`}
            data-testid="possession-hub"
          >
            <button
              type="button"
              onClick={() => onSelectPossession ? onSelectPossession('local') : onTogglePossession?.()}
              className={`possession-side local ${possession === 'local' ? 'active' : ''}`}
              title={`Asignar posesión a ${localTeam.name}`}
              aria-label={`Posesión ${localTeam.name}`}
              data-testid="btn-possession-local"
            >
              <span className="possession-chevron">◀</span>
              <span className="possession-team-name">{localTeam.name}</span>
            </button>

            {assistantEnabled && possession ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTurnover?.();
                }}
                disabled={actionDisabled}
                className="btn-possession-turnover"
                data-testid="btn-turnover"
                title="Cambio de posesión o robo (reinicia a 24s)"
                aria-label="Cambio de posesión o robo"
              >
                <span className="turnover-icon">⇄</span>
                <span className="turnover-text">Cambio / Robo</span>
              </button>
            ) : showInitialPrompt ? (
              <div className="possession-initial-prompt" data-testid="possession-prompt">
                <span className="prompt-pulse-dot" />
                <span className="prompt-text">¿Quién tiene el balón?</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={onTogglePossession}
                className="possession-center-divider"
                title="Alternar posesión"
                aria-label="Alternar posesión"
                data-testid="btn-possession-toggle"
              >
                <span className="possession-pill-label">POSESIÓN</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onSelectPossession ? onSelectPossession('visitor') : onTogglePossession?.()}
              className={`possession-side visitor ${possession === 'visitor' ? 'active' : ''}`}
              title={`Asignar posesión a ${visitorTeam.name}`}
              aria-label={`Posesión ${visitorTeam.name}`}
              data-testid="btn-possession-visitor"
            >
              <span className="possession-team-name">{visitorTeam.name}</span>
              <span className="possession-chevron">▶</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. ANOTACIÓN: un bloque por equipo (Puntos y Falta al alcance de los pulgares) */}
      <div className="action-grid">
        <div className="team-column">
          <GameActionControls
            teamName={localTeam.name}
            variant="local"
            scoringOptions={[1, 2, 3]}
            disabled={actionDisabled}
            onScore={(pts) => onActionRequest(localTeam.id!, localTeam.name, localPlayers, { type: 'score', points: pts })}
            onFoul={() => onActionRequest(localTeam.id!, localTeam.name, localPlayers, { type: 'foul' })}
          />
        </div>

        <div className="team-column">
          <GameActionControls
            teamName={visitorTeam.name}
            variant="visitor"
            scoringOptions={[1, 2, 3]}
            disabled={actionDisabled}
            onScore={(pts) => onActionRequest(visitorTeam.id!, visitorTeam.name, visitorPlayers, { type: 'score', points: pts })}
            onFoul={() => onActionRequest(visitorTeam.id!, visitorTeam.name, visitorPlayers, { type: 'foul' })}
          />
        </div>
      </div>
    </section>
  );
}
