// src/features/match-creations/components/shared/GameActionControls.tsx
import React from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  teamName?: string;
  onScore: (points: 1 | 2 | 3) => void;
  onFoul: () => void;
  disabled?: boolean;
  simpleScoring?: boolean;
  balancedLayout?: boolean;
  scoringOptions?: (1 | 2 | 3)[];
  variant: 'local' | 'visitor';
}

const SCORE_LABELS: Record<1 | 2 | 3, string> = { 1: 'LIBRE', 2: 'DOBLE', 3: 'TRIPLE' };

export const GameActionControls: React.FC<Props> = ({
  teamName,
  onScore,
  onFoul,
  disabled = false,
  scoringOptions = [1, 2, 3],
  variant
}) => {
  // Mobile-first: todos los puntos del equipo en UNA sola fila y la falta justo debajo,
  // para que cada equipo sea un bloque compacto y no haya que buscar botones.
  return (
    <div className={`team-controls-pad ${variant}`}>
      {teamName && (
        <div className={`pad-team-header ${variant}`}>
          <span className="pad-team-dot" />
          <span className="pad-team-name">{teamName}</span>
        </div>
      )}

      <div className={`btn-score-group count-${scoringOptions.length}`}>
        {scoringOptions.map((pts) => (
          <button
            key={pts}
            type="button"
            disabled={disabled}
            onClick={() => onScore(pts)}
            className={`btn-action btn-score btn-${variant}-score ${pts === 3 ? 'is-three' : ''}`}
            aria-label={`Sumar ${pts} punto${pts > 1 ? 's' : ''} a ${teamName ?? variant}`}
          >
            <span className="btn-score-num">+{pts}</span>
            <span className="btn-score-sub">{SCORE_LABELS[pts]}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={onFoul}
        className={`btn-action btn-${variant}-foul`}
        aria-label={`Falta de ${teamName ?? variant}`}
      >
        <AlertCircle size={16} />
        <span>FALTA</span>
      </button>
    </div>
  );
};
