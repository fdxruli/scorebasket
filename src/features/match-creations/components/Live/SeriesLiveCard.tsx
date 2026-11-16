import { Link } from 'react-router-dom';
import { Layers, Trophy } from 'lucide-react';
import type { Match } from '../../../../db/models/Match';

interface Props { match: Match; localName: string; visitorName: string; }

export const SeriesLiveCard = ({ match, localName, visitorName }: Props) => {
  const setsWonLocal = match.config.bestOf?.wins?.local || 0;
  const setsWonVisitor = match.config.bestOf?.wins?.visitor || 0;
  const totalGames = match.config.bestOf?.totalGames || 3;
  const winsNeeded = Math.ceil(totalGames / 2);

  return (
    <Link to={`/live/${match.id}`} className="match-card is-live" style={{ borderColor: 'var(--success)' }}>
      <div className="live-card-header">
        <div
          className="live-badge-status text-success"
          style={{ borderColor: 'var(--success)' }}
        >
          <Trophy size={12} />
          <span>SERIE (MEJOR DE {totalGames})</span>
        </div>
        <div className="flex-gap text-main font-bold" style={{ fontSize: '0.75rem', gap: '0.25rem' }}>
          <Layers size={12} color="var(--text-muted)" /> SET {match.currentQuarter || 1}
        </div>
      </div>

      <div className="live-card-body">
        <TeamRow name={localName} sets={setsWonLocal} points={match.localScore} winsNeeded={winsNeeded} />
        <TeamRow name={visitorName} sets={setsWonVisitor} points={match.visitorScore} winsNeeded={winsNeeded} />
      </div>
    </Link>
  );
};

interface SeriesTeamRowProps {
  name: string;
  sets: number;
  points: number;
  winsNeeded: number;
}

const TeamRow = ({ name, sets, points, winsNeeded }: SeriesTeamRowProps) => (
  <div className="live-team-row">
    <div className="team-info-group">
      {/* Indicador de Sets ganados visual */}
      <div className="flex-col" style={{ gap: '3px', marginRight: '0.25rem' }}>
        {[...Array(winsNeeded)].map((_, i) => (
          <div
            key={i}
            style={{
              width: '5px',
              height: '5px',
              borderRadius: '9999px',
              backgroundColor: i < sets ? 'var(--success)' : 'var(--bg-surface-2)'
            }}
          />
        ))}
      </div>
      <span className="live-team-name">{name}</span>
    </div>
    
    <div className="flex-gap" style={{ gap: '1rem' }}>
      <div className="flex-col" style={{ alignItems: 'flex-end' }}>
        <span className="text-muted uppercase font-bold" style={{ fontSize: '0.65rem' }}>Puntos</span>
        <span className="font-mono font-bold" style={{ color: 'var(--text-muted)' }}>{points}</span>
      </div>
      <div className="flex-col" style={{ alignItems: 'center', minWidth: '30px' }}>
        <span className="text-success uppercase font-bold" style={{ fontSize: '0.65rem' }}>Sets</span>
        <span className="live-team-score text-success">{sets}</span>
      </div>
    </div>
  </div>
);
