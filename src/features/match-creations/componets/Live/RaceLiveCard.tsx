import { Link } from 'react-router-dom';
import { Target } from 'lucide-react';
import type { Match } from '../../../../db/models/Match';

interface Props { match: Match; localName: string; visitorName: string; }

export const RaceLiveCard = ({ match, localName, visitorName }: Props) => {
  const target = match.config.race?.targetScore || 21;
  const localPct = Math.min(100, (match.localScore / target) * 100);
  const visitorPct = Math.min(100, (match.visitorScore / target) * 100);

  return (
    <Link to={`/live/${match.id}`} className="match-card is-live" style={{ borderColor: 'rgba(234, 179, 8, 0.3)' }}>
      <div className="live-card-header">
        <div className="live-badge-status text-warning border-yellow-500/30">
          <Target size={12} />
          <span>RACE TO {target}</span>
        </div>
        <div className="text-xs text-muted font-bold uppercase">Partida #{match.config.race?.currentGame || 1}</div>
      </div>

      <div className="live-card-body relative">
        {/* Barras de progreso de fondo sutiles */}
        <div className="absolute left-0 top-0 h-full w-1 bg-blue-500/20"><div style={{height: `${localPct}%`}} className="bg-blue-500 w-full transition-all"/></div>
        <div className="absolute right-0 top-0 h-full w-1 bg-orange-500/20"><div style={{height: `${visitorPct}%`}} className="bg-orange-500 w-full transition-all"/></div>

        <TeamRow name={localName} score={match.localScore} target={target} isWinning={match.localScore > match.visitorScore} />
        <TeamRow name={visitorName} score={match.visitorScore} target={target} isWinning={match.visitorScore > match.localScore} />
      </div>
    </Link>
  );
};

const TeamRow = ({ name, score, target, isWinning }: any) => (
  <div className={`live-team-row ${isWinning ? 'winning' : ''}`}>
    <div className="team-info-group">
      <div className="team-avatar-placeholder">{name.substring(0, 1)}</div>
      <span className="live-team-name">{name}</span>
    </div>
    <div className="flex items-center gap-3">
        <div className="text-xs text-muted font-mono">{score}/{target}</div>
        <span className="live-team-score">{score}</span>
    </div>
  </div>
);