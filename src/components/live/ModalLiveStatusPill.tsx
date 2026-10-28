// src/components/live/ModalLiveStatusPill.tsx
import React, { useContext } from 'react';
import { LiveMatchContext } from '../../features/match-creations/components/context/LiveMatchContext';
import { useMatchTimer } from '../../hooks/useMatchTimer';
import { formatPeriodLabel } from '../../utils/matchHelpers';
import { Clock, Target, Layers } from 'lucide-react';

export const ModalLiveStatusPill: React.FC = () => {
  const context = useContext(LiveMatchContext);
  const match = context?.match;
  const localTeam = context?.localTeam;
  const visitorTeam = context?.visitorTeam;

  // Solo lectura: enableAutoPause = false para nunca pausar ni interferir con el motor del reloj
  const { timeLeft, isRunning } = useMatchTimer(match, false);

  if (!match) return null;

  const mode = match.config?.mode || 'traditional';
  const localScore = match.localScore ?? 0;
  const visitorScore = match.visitorScore ?? 0;
  const localLabel = (localTeam?.name || 'LOC').trim();
  const visitorLabel = (visitorTeam?.name || 'VIS').trim();

  const formatClock = (seconds: number) => {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  if (mode === 'traditional') {
    const currentQuarter = match.currentQuarter || 1;
    const totalQuarters = match.config?.traditional?.totalQuarters || match.totalQuarters || 4;
    const periodLabel = formatPeriodLabel(currentQuarter, totalQuarters);
    const isZero = timeLeft <= 0;

    return (
      <div className="modal-live-status-pill" aria-live="polite">
        <span className={`mls-state-badge ${isRunning ? 'is-running' : isZero ? 'is-zero' : 'is-paused'}`}>
          <span className={`mls-dot ${isRunning ? 'pulse-dot' : ''}`} />
          <span>{isRunning ? 'EN JUEGO' : isZero ? 'TIEMPO 00:00' : 'PAUSADO'}</span>
        </span>

        <span className="mls-sep">·</span>

        <span className="mls-period">{periodLabel}</span>

        <span className="mls-sep">·</span>

        <span className={`mls-clock ${isRunning ? 'running' : ''} ${isZero ? 'zero' : ''}`}>
          <Clock size={12} />
          <span>{formatClock(timeLeft)}</span>
        </span>

        <span className="mls-sep">·</span>

        <span className="mls-score">
          <span className="mls-team local">{localLabel}</span>
          <strong className="mls-pts">{localScore}</strong>
          <span className="mls-dash">-</span>
          <strong className="mls-pts">{visitorScore}</strong>
          <span className="mls-team visitor">{visitorLabel}</span>
        </span>
      </div>
    );
  }

  if (mode === 'race') {
    const currentGame = match.config?.race?.currentGame || 1;
    const targetScore = match.config?.race?.targetScore || 21;

    return (
      <div className="modal-live-status-pill" aria-live="polite">
        <span className="mls-period">
          <Target size={12} color="var(--primary)" />
          <span>Juego #{currentGame}</span>
        </span>

        <span className="mls-sep">·</span>

        <span className="mls-meta">Meta: {targetScore} PTS</span>

        <span className="mls-sep">·</span>

        <span className="mls-score">
          <span className="mls-team local">{localLabel}</span>
          <strong className="mls-pts">{localScore}</strong>
          <span className="mls-dash">-</span>
          <strong className="mls-pts">{visitorScore}</strong>
          <span className="mls-team visitor">{visitorLabel}</span>
        </span>
      </div>
    );
  }

  // best-of-series
  const currentSet = match.currentQuarter || match.config?.bestOf?.currentGame || 1;
  const pointsPerSet = match.config?.bestOf?.targetScorePerGame || 21;
  const localSets = match.config?.bestOf?.wins?.local || 0;
  const visitorSets = match.config?.bestOf?.wins?.visitor || 0;

  return (
    <div className="modal-live-status-pill" aria-live="polite">
      <span className="mls-period">
        <Layers size={12} color="var(--secondary-light)" />
        <span>Set #{currentSet} ({localSets}-{visitorSets})</span>
      </span>

      <span className="mls-sep">·</span>

      <span className="mls-meta">Meta: {pointsPerSet} PTS</span>

      <span className="mls-sep">·</span>

      <span className="mls-score">
        <span className="mls-team local">{localLabel}</span>
        <strong className="mls-pts">{localScore}</strong>
        <span className="mls-dash">-</span>
        <strong className="mls-pts">{visitorScore}</strong>
        <span className="mls-team visitor">{visitorLabel}</span>
      </span>
    </div>
  );
};
