import { Link } from 'react-router-dom';
import { Play, Pause } from 'lucide-react';
import { useMatchTimer } from '../../../../hooks/useMatchTimer';
import type { Match } from '../../../../db/models/Match';

interface Props { match: Match; localName: string; visitorName: string; }

export const TraditionalLiveCard = ({ match, localName, visitorName }: Props) => {
  const { timeLeft, isRunning } = useMatchTimer(match, false);

  const formatTime = (seconds: number) => {
    const s = Math.ceil(seconds);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  return (
    <Link to={`/live/${match.id}`} className="match-card is-live">
      {/* Header Tradicional: Estado + Q + Cronómetro */}
      <div className="live-card-header">
        <div className={`live-badge-status ${isRunning ? 'text-primary border-orange-500/30' : 'text-muted'}`}>
          <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-primary animate-pulse' : 'bg-zinc-600'}`}></div>
          {isRunning ? 'EN JUEGO' : 'PAUSADO'}
        </div>
        <div className="flex items-center gap-2 font-mono text-sm font-bold text-main">
          <span className="text-muted text-xs uppercase tracking-widest mr-2">Q{match.currentQuarter}</span>
          {isRunning ? <Play size={10} className="text-primary" fill="currentColor" /> : <Pause size={10} className="text-muted" fill="currentColor" />}
          {formatTime(timeLeft)}
        </div>
      </div>
      
      {/* Body: Marcador estándar */}
      <div className="live-card-body">
        <TeamRow name={localName} score={match.localScore} fouls={match.localFouls} isWinning={match.localScore > match.visitorScore} />
        <TeamRow name={visitorName} score={match.visitorScore} fouls={match.visitorFouls} isWinning={match.visitorScore > match.localScore} />
      </div>
    </Link>
  );
};

// Subcomponente simple para reutilizar diseño
const TeamRow = ({ name, score, fouls, isWinning }: any) => (
  <div className={`live-team-row ${isWinning ? 'winning' : ''}`}>
    <div className="team-info-group">
      <div className="team-avatar-placeholder">{name.substring(0, 1)}</div>
      <span className="live-team-name">{name}</span>
    </div>
    <div className="stats-box">
      <div className="stat-fouls"><strong>{fouls}</strong><span>FAL</span></div>
      <span className="live-team-score">{score}</span>
    </div>
  </div>
);