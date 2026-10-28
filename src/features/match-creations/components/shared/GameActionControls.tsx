import React from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  onScore: (points: number) => void;
  onFoul: () => void;
  disabled?: boolean;
  simpleScoring?: boolean;
  balancedLayout?: boolean;
  variant: 'local' | 'visitor';
}

export const GameActionControls: React.FC<Props> = ({ 
  onScore, 
  onFoul, 
  disabled = false, 
  simpleScoring = false,
  balancedLayout = false,
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
        /* --- MODO SIMPLE (RACE): +1 / +2 / +3 en grilla de 3 columnas --- */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
          {[1, 2, 3].map((pts) => (
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
                fontSize: '1.5rem',
                fontWeight: 800
              }}
            >
              +{pts}
            </button>
          ))}
        </div>

      ) : balancedLayout ? (
        /* --- MODO SERIES (MEJORADO: Jerarquía Vertical 1, 2, 3) --- */
        <div className="flex-col gap-sm">
          <button
            disabled={disabled}
            onClick={() => onScore(1)}
            className={`btn-action ${balancedBtnClass}`}
            style={{ fontSize: '1.2rem' }}
          >
            +1
          </button>
          <button
            disabled={disabled}
            onClick={() => onScore(2)}
            className={`btn-action ${balancedBtnClass}`}
            style={{ fontSize: '1.2rem' }}
          >
            +2
          </button>
          <button
            disabled={disabled}
            onClick={() => onScore(3)}
            className={`btn-action ${balancedBtnClass}`}
            style={{ fontSize: '1.2rem' }}
          >
            +3
          </button>
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
