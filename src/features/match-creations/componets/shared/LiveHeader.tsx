import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, RotateCcw } from 'lucide-react';
import { useGameActions } from '../../hooks/useGameActions';

export const LiveHeader: React.FC = () => {
  const navigate = useNavigate();
  const { undoLastAction } = useGameActions();

  return (
    <header className="live-header">
      {/* Botón Volver */}
      <button 
        onClick={() => navigate('/matches')} 
        className="live-btn-icon"
        title="Volver a Partidos"
      >
        <ChevronLeft size={28} />
      </button>

      {/* Título o Espacio Central (Opcional, se puede dejar vacío para mantener estilo) */}
      <div className="flex-1"></div>

      {/* Botón Deshacer */}
      <button 
        onClick={undoLastAction} 
        className="live-btn-icon"
        title="Deshacer última acción"
      >
        <RotateCcw size={22} />
      </button>
    </header>
  );
};