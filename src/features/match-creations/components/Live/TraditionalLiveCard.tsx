import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Play, Pause } from 'lucide-react';
import { useMatchTimer } from '../../../../hooks/useMatchTimer';
import { db } from '../../../../db/db';
import type { Match } from '../../../../db/models/Match';
import { formatPeriodLabel } from '../../../../utils/matchHelpers';

interface Props { match: Match; localName: string; visitorName: string; }

export const TraditionalLiveCard = ({ match, localName, visitorName }: Props) => {
  const { timeLeft, isRunning } = useMatchTimer(match, false);
  const currentQuarter = match.currentQuarter || 1;
  const totalQuarters = match.config?.traditional?.totalQuarters || match.totalQuarters || 4;

  const currentQuarterFouls = useLiveQuery(async () => {
    if (!match.id) {
      return {
        local: match.localFouls || 0,
        visitor: match.visitorFouls || 0
      };
    }

    const fouls = await db.fouls.where('matchId').equals(match.id).toArray();
    const quarterFouls = fouls.filter(foul => foul.quarter === currentQuarter);

    return {
      local: quarterFouls.filter(foul => foul.teamId === match.localTeamId).length,
      visitor: quarterFouls.filter(foul => foul.teamId === match.visitorTeamId).length
    };
  }, [match.id, match.localFouls, match.visitorFouls, currentQuarter]);

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
        <div
          className="live-badge-status"
          style={isRunning
            ? { color: 'var(--primary)', borderColor: 'rgba(249, 115, 22, 0.3)' }
            : { color: 'var(--text-muted)' }
          }
        >
          <div
            style={{
              width: '0.5rem',
              height: '0.5rem',
              borderRadius: '9999px',
              backgroundColor: isRunning ? 'var(--primary)' : '#52525b'
            }}
          />
          {isRunning ? 'EN JUEGO' : 'PAUSADO'}
        </div>
        <div
          className="flex-gap font-mono font-bold text-main"
          style={{ fontSize: '0.875rem' }}
        >
          <span
            className="text-muted uppercase"
            style={{ fontSize: '0.75rem', letterSpacing: '0.1em', marginRight: '0.25rem' }}
          >
            {formatPeriodLabel(currentQuarter, totalQuarters)}
          </span>
          {isRunning
            ? <Play size={10} color="var(--primary)" fill="currentColor" />
            : <Pause size={10} color="var(--text-muted)" fill="currentColor" />
          }
          {formatTime(timeLeft)}
        </div>
      </div>
      
      {/* Body: Marcador estándar */}
      <div className="live-card-body">
        <TeamRow name={localName} score={match.localScore} fouls={currentQuarterFouls?.local ?? 0} isWinning={match.localScore > match.visitorScore} />
        <TeamRow name={visitorName} score={match.visitorScore} fouls={currentQuarterFouls?.visitor ?? 0} isWinning={match.visitorScore > match.localScore} />
      </div>
    </Link>
  );
};

interface TraditionalTeamRowProps {
  name: string;
  score: number;
  fouls: number;
  isWinning: boolean;
}

// Subcomponente simple para reutilizar diseño
const TeamRow = ({ name, score, fouls, isWinning }: TraditionalTeamRowProps) => (
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
