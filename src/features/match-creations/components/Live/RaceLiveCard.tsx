import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { Target } from 'lucide-react';
import type { Match } from '../../../../db/models/Match';

interface Props { match: Match; localName: string; visitorName: string; }

// Barra de progreso lateral (inline: las clases utilitarias estilo Tailwind no existen en src/styles)
const progressTrack = (side: 'left' | 'right', color: string): CSSProperties => ({
  position: 'absolute',
  top: 0,
  [side]: 0,
  height: '100%',
  width: '4px',
  background: `${color}33`
});

const progressFill = (pct: number, color: string): CSSProperties => ({
  height: `${pct}%`,
  width: '100%',
  background: color,
  transition: 'all 0.3s ease'
});

export const RaceLiveCard = ({ match, localName, visitorName }: Props) => {
  const target = match.config.race?.targetScore || 21;
  const localPct = Math.min(100, (match.localScore / target) * 100);
  const visitorPct = Math.min(100, (match.visitorScore / target) * 100);
  const gameHistory = match.gameHistory || [];
  const localGames = gameHistory.filter(g => g.winner === 'local').length;
  const visitorGames = gameHistory.filter(g => g.winner === 'visitor').length;

  return (
    <Link to={`/live/${match.id}`} className="match-card is-live" style={{ borderColor: 'rgba(234, 179, 8, 0.3)' }}>
      <div className="live-card-header">
        <div className="live-badge-status" style={{ color: 'var(--warning, #eab308)', borderColor: 'rgba(234, 179, 8, 0.3)' }}>
          <Target size={12} />
          <span>RACE TO {target}</span>
        </div>
        <div className="text-xs text-muted font-bold uppercase">
          Juego #{match.config.race?.currentGame || 1}
          {gameHistory.length > 0 && ` • ${localGames}-${visitorGames}`}
        </div>
      </div>

      <div className="live-card-body" style={{ position: 'relative' }}>
        {/* Barras de progreso de fondo sutiles */}
        <div style={progressTrack('left', '#3b82f6')}><div style={progressFill(localPct, '#3b82f6')} /></div>
        <div style={progressTrack('right', '#f97316')}><div style={progressFill(visitorPct, '#f97316')} /></div>

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
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div className="text-xs text-muted font-mono">{score}/{target}</div>
        <span className="live-team-score">{score}</span>
    </div>
  </div>
);