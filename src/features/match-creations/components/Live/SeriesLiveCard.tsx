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
    <Link to={`/live/${match.id}`} className="match-card is-live" style={{ borderColor: 'rgba(34, 197, 94, 0.3)' }}>
      <div className="live-card-header">
        <div className="live-badge-status text-success border-green-500/30">
          <Trophy size={12} />
          <span>SERIE (MEJOR DE {totalGames})</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-main font-bold">
           <Layers size={12} className="text-muted"/> SET {match.currentQuarter}
        </div>
      </div>

      <div className="live-card-body">
        <TeamRow name={localName} sets={setsWonLocal} points={match.localScore} winsNeeded={winsNeeded} />
        <TeamRow name={visitorName} sets={setsWonVisitor} points={match.visitorScore} winsNeeded={winsNeeded} />
      </div>
    </Link>
  );
};

const TeamRow = ({ name, sets, points, winsNeeded }: any) => (
  <div className="live-team-row">
    <div className="team-info-group">
      {/* Indicador de Sets ganados visual */}
      <div className="flex flex-col gap-[2px] mr-1">
          {[...Array(winsNeeded)].map((_, i) => (
              <div key={i} className={`w-1 h-1 rounded-full ${i < sets ? 'bg-green-500' : 'bg-zinc-700'}`} />
          ))}
      </div>
      <span className="live-team-name">{name}</span>
    </div>
    
    <div className="flex items-center gap-4">
        <div className="flex flex-col items-end">
            <span className="text-[0.65rem] text-muted uppercase font-bold">Puntos</span>
            <span className="font-mono font-bold text-zinc-400">{points}</span>
        </div>
        <div className="flex flex-col items-center min-w-[30px]">
             <span className="text-[0.65rem] text-success uppercase font-bold">Sets</span>
             <span className="live-team-score text-success">{sets}</span>
        </div>
    </div>
  </div>
);