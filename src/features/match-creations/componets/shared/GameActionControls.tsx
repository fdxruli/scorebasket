import React from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  onScore: (points: number) => void;
  onFoul: () => void;
  disabled?: boolean;
}

export const GameActionControls: React.FC<Props> = ({ onScore, onFoul, disabled = false }) => {
  return (
    <div className="flex flex-col gap-2 w-full max-w-[200px]">
      {/* Botones de Puntos */}
      <div className="grid grid-cols-2 gap-2">
        <button
          disabled={disabled}
          onClick={() => onScore(1)}
          className="btn-action btn-sm"
          style={{ 
            background: 'rgba(255, 255, 255, 0.1)', 
            color: 'white', 
            border: '1px solid rgba(255,255,255,0.2)' 
          }}
        >
          +1
        </button>
        <button
          disabled={disabled}
          onClick={() => onScore(2)}
          className="btn-action btn-sm"
          style={{ 
            background: 'rgba(255, 255, 255, 0.1)', 
            color: 'white', 
            border: '1px solid rgba(255,255,255,0.2)' 
          }}
        >
          +2
        </button>
      </div>

      {/* Botón de +3 (Ancho completo) */}
      <button
        disabled={disabled}
        onClick={() => onScore(3)}
        className="btn-action"
        style={{ 
          background: 'rgba(255, 255, 255, 0.15)', 
          color: 'white', 
          fontWeight: 800,
          border: '1px solid rgba(255,255,255,0.3)',
          fontSize: '1.25rem'
        }}
      >
        +3
      </button>

      {/* Botón de Falta */}
      <button
        disabled={disabled}
        onClick={onFoul}
        className="btn-action"
        style={{ 
          background: 'transparent', 
          border: '1px dashed rgba(239, 68, 68, 0.5)', 
          color: '#fca5a5',
          fontSize: '0.75rem',
          height: '2.5rem',
          textTransform: 'uppercase'
        }}
      >
        <AlertCircle size={14} className="mr-2" />
        Falta
      </button>
    </div>
  );
};