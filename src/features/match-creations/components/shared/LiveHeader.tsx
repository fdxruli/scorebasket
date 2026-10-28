// src/features/match-creations/components/shared/LiveHeader.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, RotateCcw, History } from 'lucide-react';
import { useGameActions } from '../../hooks/useGameActions';
import { useLiveMatch } from '../context/LiveMatchContext';
import { LiveMatchHistoryModal } from '../../../../components/live/LiveMatchHistoryModal';
import { formatPeriodLabel } from '../../../../utils/matchHelpers';

export const LiveHeader: React.FC = () => {
  const navigate = useNavigate();
  const { undoLastAction } = useGameActions();
  const { match } = useLiveMatch();
  const [showHistory, setShowHistory] = useState(false);

  const mode = match?.config?.mode || 'traditional';
  const currentQuarter = match?.currentQuarter || 1;
  const totalQuarters = match?.config?.traditional?.totalQuarters || match?.totalQuarters || 4;

  const getStatusText = () => {
    if (mode === 'race') {
      return `RACE TO ${match?.config?.race?.targetScore || 21}`;
    }
    if (mode === 'best-of-series') {
      return `SERIE • SET ${currentQuarter}`;
    }
    return `EN CANCHA • ${formatPeriodLabel(currentQuarter, totalQuarters)}`;
  };

  return (
    <>
      <header className="live-header">
        {/* Botón Volver */}
        <button 
          onClick={() => navigate('/matches')} 
          className="live-btn-icon"
          title="Volver a Partidos"
        >
          <ChevronLeft size={24} />
        </button>

        {/* Indicador Central de Transmisión */}
        <div className="live-header-center">
          <div className="live-badge active">
            <span className="pulse-dot" style={{ backgroundColor: 'var(--success)', boxShadow: '0 0 8px var(--success)' }} />
            {getStatusText()}
          </div>
        </div>

        <div className="flex-gap">
          {/* Botón Historial (log jugada por jugada) */}
          {match?.id && (
            <button
              onClick={() => setShowHistory(true)}
              className="live-btn-icon"
              title="Historial de jugadas"
            >
              <History size={20} />
            </button>
          )}

          {/* Botón Deshacer */}
          <button 
            onClick={undoLastAction} 
            className="live-btn-icon"
            title="Deshacer última acción"
          >
            <RotateCcw size={20} />
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
