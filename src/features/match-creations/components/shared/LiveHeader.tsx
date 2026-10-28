import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, RotateCcw, History } from 'lucide-react';
import { useGameActions } from '../../hooks/useGameActions';
import { useLiveMatch } from '../context/LiveMatchContext';
import { LiveMatchHistoryModal } from '../../../../components/live/LiveMatchHistoryModal';

export const LiveHeader: React.FC = () => {
  const navigate = useNavigate();
  const { undoLastAction } = useGameActions();
  const { match } = useLiveMatch();
  const [showHistory, setShowHistory] = useState(false);

  return (
    <>
      <header className="live-header">
        {/* Botón Volver */}
        <button 
          onClick={() => navigate('/matches')} 
          className="live-btn-icon"
          title="Volver a Partidos"
        >
          <ChevronLeft size={28} />
        </button>

        {/* Espacio Central */}
        <div style={{ flex: 1 }} />

        <div className="flex-gap">
          {/* Botón Historial (log jugada por jugada) */}
          {match?.id && (
            <button
              onClick={() => setShowHistory(true)}
              className="live-btn-icon"
              title="Historial de jugadas"
            >
              <History size={22} />
            </button>
          )}

          {/* Botón Deshacer */}
          <button 
            onClick={undoLastAction} 
            className="live-btn-icon"
            title="Deshacer última acción"
          >
            <RotateCcw size={22} />
          </button>
        </div>
      </header>

      {showHistory && match?.id && (
        <LiveMatchHistoryModal
          matchId={match.id}
          onClose={() => setShowHistory(false)}
        />
      )}
    </>
  );
};
