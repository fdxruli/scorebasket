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

export const GameActionControls: React.FC<Props> = ({
  teamName,
  onScore,
  onFoul,
  disabled = false,
  scoringOptions = [1, 2, 3],
  variant
}) => {
  const isLocal = variant === 'local';
  const smBtnClass = isLocal ? 'btn-local-sm' : 'btn-visitor-sm';
  const lgBtnClass = isLocal ? 'btn-local-lg' : 'btn-visitor-lg';
  const xlBtnClass = isLocal ? 'btn-local-xl' : 'btn-visitor-xl';
  const foulBtnClass = isLocal ? 'btn-local-foul' : 'btn-visitor-foul';

  const isTwoOptions = scoringOptions.length === 2;

  return (
    <div className={`team-controls-pad ${variant}`}>
      {/* Identificador claro de columna para no confundir equipo al anotar rápido */}
      {teamName && (
        <div className={`pad-team-header ${variant}`}>
          <span className="pad-team-dot" />
          <span className="pad-team-name">{teamName}</span>
        </div>
      )}

      {isTwoOptions ? (
        /* --- MODO CALLE / RETA (1 y 2 Puntos): 2 Botones Gigantes --- */
        <div className="btn-score-group is-street">
          {scoringOptions.map((pts) => (
            <button
              key={pts}
              type="button"
              disabled={disabled}
              onClick={() => onScore(pts)}
              className={`btn-action ${xlBtnClass}`}
            >
              <span className="btn-score-num">+{pts}</span>
              <span className="btn-score-sub">{pts === 1 ? 'PUNTO' : 'DOBLE'}</span>
            </button>
          ))}
        </div>
      ) : (
        /* --- MODO ESTÁNDAR (1, 2 y 3 Puntos): +1 y +2 arriba, +3 prominente abajo --- */
        <>
          <div className="btn-score-group">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onScore(1)}
              className={`btn-action ${smBtnClass}`}
            >
              <span className="btn-score-num">+1</span>
              <span className="btn-score-sub">LIBRE</span>
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onScore(2)}
              className={`btn-action ${smBtnClass}`}
            >
              <span className="btn-score-num">+2</span>
              <span className="btn-score-sub">DOBLE</span>
            </button>
          </div>

          <button
            type="button"
            disabled={disabled}
            onClick={() => onScore(3)}
            className={`btn-action ${lgBtnClass}`}
          >
            <span className="btn-score-num">+3</span>
            <span className="btn-score-sub">TRIPLE</span>
          </button>
        </>
      )}

      {/* Botón de Falta Grande y Visible */}
      <button
        type="button"
        disabled={disabled}
        onClick={onFoul}
        className={`btn-action ${foulBtnClass}`}
      >
        <AlertCircle size={18} />
        <span>FALTA {teamName ? teamName.substring(0, 8) : ''}</span>
      </button>
    </div>
  );
};
