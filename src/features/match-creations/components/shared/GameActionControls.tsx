import React from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  onScore: (points: number) => void;
  onFoul: () => void;
  disabled?: boolean;
  simpleScoring?: boolean;
  balancedLayout?: boolean;
  scoringOptions?: (1 | 2 | 3)[];
  variant: 'local' | 'visitor';
}

export const GameActionControls: React.FC<Props> = ({ 
  onScore, 
  onFoul, 
  disabled = false, 
  simpleScoring = false,
  balancedLayout = false,
  scoringOptions = [1, 2, 3],
  variant
}) => {
  
  const smBtnClass = variant === 'local' ? 'btn-local-sm' : 'btn-visitor-sm';
  const lgBtnClass = variant === 'local' ? 'btn-local-lg' : 'btn-visitor-lg';
  const xlBtnClass = variant === 'local' ? 'btn-local-xl' : 'btn-visitor-xl';
  const foulBtnClass = variant === 'local' ? 'btn-local-foul' : 'btn-visitor-foul';

  // Clase común para botones balanceados (Series Mode)
  const balancedBtnClass = variant === 'local' ? 'btn-local-lg' : 'btn-visitor-lg';

  return (
    <div className="flex-col w-full" style={{ gap: '0.75rem' }}>
      
      {simpleScoring ? (
        /* --- MODO SIMPLE (RACE / SERIES): +1 / +2 / (+3) en grilla dinámica --- */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${scoringOptions.length}, 1fr)`,
            gap: '0.5rem'
          }}
        >
          {scoringOptions.map((pts) => (
            <button
              key={pts}
              disabled={disabled}
              onClick={() => onScore(pts)}
              className={`btn-action ${xlBtnClass}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0.5rem 0',
                minWidth: 0,
                fontSize: scoringOptions.length === 2 ? '1.85rem' : '1.5rem',
                fontWeight: 800
              }}
            >
              +{pts}
            </button>
          ))}
        </div>

      ) : balancedLayout ? (
        /* --- MODO SERIES (MEJORADO: Jerarquía Vertical) --- */
        <div className="flex-col gap-sm">
          {scoringOptions.map((pts) => (
            <button
              key={pts}
              disabled={disabled}
              onClick={() => onScore(pts)}
              className={`btn-action ${balancedBtnClass}`}
              style={{ fontSize: '1.2rem' }}
            >
              +{pts}
            </button>
          ))}
        </div>
      ) : (
        /* --- MODO TRADICIONAL (Grid original) --- */
        <>
          <div className="btn-score-group">
            <button
              disabled={disabled}
              onClick={() => onScore(1)}
              className={`btn-action ${smBtnClass}`}
            >
              +1
            </button>
            <button
              disabled={disabled}
              onClick={() => onScore(2)}
              className={`btn-action ${smBtnClass}`}
            >
              +2
            </button>
          </div>

          <button
            disabled={disabled}
            onClick={() => onScore(3)}
            className={`btn-action ${lgBtnClass}`}
          >
            +3
          </button>
        </>
      )}

      {/* Botón de Falta */}
      <button
        disabled={disabled}
        onClick={onFoul}
        className={`btn-action ${foulBtnClass}`}
      >
        <AlertCircle size={16} />
        Falta
      </button>
    </div>
  );
};
