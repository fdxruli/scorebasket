// src/features/match-creations/components/shared/LiveToolsBar.tsx
import React, { useState } from 'react';
import { Users, Shirt, Bell, Volume2, VolumeX, Flag, Timer, Zap } from 'lucide-react';
import { isSoundMuted, toggleSoundMute, unlockAudioContext, playBuzzer } from '../../../../utils/soundEffects';

interface Props {
  trackPlayers: boolean;
  onToggleTrackPlayers: () => void;
  onEndMatch: () => void;
  /** Chicharra manual: solo tiene sentido en partidos con reloj */
  showBuzzer?: boolean;
  endLabel?: string;
  /** Gestión opcional de quintetos en cancha (solo partidos Traditional) */
  onManageLineups?: () => void;
  lineupsEnabled?: boolean;
  /** Reloj de posesión opcional (24s / 14s) (solo partidos Traditional, DEPORT-04) */
  onToggleShotClock?: () => void;
  shotClockEnabled?: boolean;
  isTimerRunning?: boolean;
  /** Asistente automático de posesión y reloj (solo partidos Traditional, ASIST-01) */
  onToggleAssistant?: () => void;
  assistantEnabled?: boolean;
}

/**
 * Barra única de herramientas secundarias (iguales en los 3 modos):
 * preferencias a la izquierda, acción destructiva (finalizar) aislada a la derecha.
 */
export const LiveToolsBar: React.FC<Props> = ({
  trackPlayers,
  onToggleTrackPlayers,
  onEndMatch,
  showBuzzer = false,
  endLabel = 'Finalizar',
  onManageLineups,
  lineupsEnabled = false,
  onToggleShotClock,
  shotClockEnabled = false,
  isTimerRunning = false,
  onToggleAssistant,
  assistantEnabled = false
}) => {
  const [muted, setMuted] = useState<boolean>(() => isSoundMuted());

  const handleToggleMute = () => setMuted(toggleSoundMute());

  const handleBuzzer = () => {
    unlockAudioContext();
    playBuzzer();
  };

  return (
    <div className="tools-bar" role="toolbar" aria-label="Herramientas del partido">
      <div className="tools-bar-group">
        <button
          type="button"
          onClick={onToggleTrackPlayers}
          className={`tool-chip ${trackPlayers ? 'is-on' : ''}`}
          aria-pressed={trackPlayers}
          title="Elegir jugador al anotar"
        >
          <Users size={16} />
          <span className="tool-chip-label">Jugadores</span>
          <span className="tool-chip-state">{trackPlayers ? 'ON' : 'OFF'}</span>
        </button>

        {onManageLineups && (
          <button
            type="button"
            onClick={onManageLineups}
            className={`tool-chip ${lineupsEnabled ? 'is-on' : ''}`}
            aria-pressed={lineupsEnabled}
            title="Gestionar jugadores en cancha"
            aria-label="Gestionar jugadores en cancha"
            data-testid="btn-manage-lineups"
          >
            <Shirt size={16} />
            <span className="tool-chip-label">Quinteto</span>
            {lineupsEnabled && <span className="tool-chip-state">5v5</span>}
          </button>
        )}

        {onToggleShotClock && (
          <button
            type="button"
            onClick={onToggleShotClock}
            disabled={isTimerRunning}
            className={`tool-chip ${shotClockEnabled ? 'is-on' : ''}`}
            aria-pressed={shotClockEnabled}
            title={
              isTimerRunning
                ? 'Pausa el cronómetro para configurar el reloj de posesión'
                : 'Reloj de posesión (24s / 14s)'
            }
            aria-label="Reloj de posesión"
            data-testid="btn-toggle-shot-clock"
          >
            <Timer size={16} />
            <span className="tool-chip-label">Reloj 24/14</span>
            <span className="tool-chip-state">{shotClockEnabled ? 'ON' : 'OFF'}</span>
          </button>
        )}

        {onToggleAssistant && (
          <button
            type="button"
            onClick={onToggleAssistant}
            disabled={isTimerRunning}
            className={`tool-chip ${assistantEnabled ? 'is-on' : ''}`}
            aria-pressed={assistantEnabled}
            title={
              isTimerRunning
                ? 'Pausa el cronómetro para configurar el asistente'
                : !shotClockEnabled
                  ? 'Requiere activar primero el Reloj 24/14'
                  : 'Asistente automático de posesión y reloj'
            }
            aria-label="Asistente de posesión"
            data-testid="btn-toggle-assistant"
          >
            <Zap size={16} />
            <span className="tool-chip-label">Asistente</span>
            <span className="tool-chip-state">{assistantEnabled ? 'AUTO' : 'MANUAL'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleToggleMute}
          className={`tool-chip icon-only ${muted ? 'is-muted' : ''}`}
          aria-label={muted ? 'Activar sonido' : 'Silenciar sonido'}
          title={muted ? 'Sonido silenciado' : 'Sonido activo'}
        >
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>

        {showBuzzer && (
          <button
            type="button"
            onClick={handleBuzzer}
            className="tool-chip icon-only is-buzzer"
            aria-label="Sonar chicharra manual"
            title="Sonar chicharra manual"
          >
            <Bell size={17} />
          </button>
        )}
      </div>

      <button type="button" onClick={onEndMatch} className="tool-chip is-danger" title="Finalizar y cerrar partido">
        <Flag size={16} />
        <span className="tool-chip-label">{endLabel}</span>
      </button>
    </div>
  );
};
