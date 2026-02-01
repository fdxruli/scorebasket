import React from 'react';
import { AlertCircle, Plus } from 'lucide-react';

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
    <div className="flex flex-col gap-3 w-full">
      
      {simpleScoring ? (
        /* --- MODO SIMPLE (RACE) --- */
        <button
          disabled={disabled}
          onClick={() => onScore(1)}
          className={`btn-action ${xlBtnClass}`}
          style={{ 
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            fontWeight: 800
          }}
        >
          <Plus size={32} strokeWidth={4} /> 1
        </button>

      ) : balancedLayout ? (
        /* --- MODO SERIES (MEJORADO: Jerarquía Vertical 1, 2, 3) --- */
        /* Usamos flex vertical para un orden claro y botones de tamaño consistente */
        <div className="flex flex-col gap-2">
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
          <div className="grid grid-cols-2 gap-2">
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
        <AlertCircle size={16} className="mr-2" />
        Falta
      </button>
    </div>
  );
};