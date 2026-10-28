// src/features/match-creation/components/ConfigSummary.tsx
import { Clock, Target, Trophy, Calendar } from 'lucide-react';
import type { MatchConfig } from '../../../db/models/MatchConfig';
import { getModeName } from '../../../utils/matchHelpers';
import './ConfigSummary.css';

interface ConfigSummaryProps {
  config: MatchConfig;
}

export function ConfigSummary({ config }: ConfigSummaryProps) {
  return (
    <div className="config-summary">
      <div className="summary-header">
        <Calendar size={18} />
        <h3>Resumen de Configuración</h3>
      </div>

      <div className="summary-body">
        <div className="summary-row">
          <span className="summary-label">Modo de Juego:</span>
          <span className="summary-value">{getModeName(config.mode)}</span>
        </div>

        {config.mode === 'traditional' && config.traditional && (
          <>
            <div className="summary-row">
              <span className="summary-label">
                <Clock size={14} />
                Periodos:
              </span>
              <span className="summary-value">{config.traditional.totalQuarters}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Duración:</span>
              <span className="summary-value">
                {config.traditional.minutesPerQuarter} min/periodo
              </span>
            </div>
            <div className="summary-total">
              Tiempo total: <strong>{config.traditional.totalQuarters * config.traditional.minutesPerQuarter} minutos</strong>
            </div>
          </>
        )}

        {config.mode === 'race' && config.race && (
          <>
            <div className="summary-row">
              <span className="summary-label">
                <Target size={14} />
                Objetivo:
              </span>
              <span className="summary-value">{config.race.targetScore} puntos</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Revancha:</span>
              <span className={`summary-badge ${config.race.hasRematches ? 'success' : 'muted'}`}>
                {config.race.hasRematches ? 'Permitida' : 'No permitida'}
              </span>
            </div>
          </>
        )}

        {config.mode === 'best-of-series' && config.bestOf && (
          <>
            <div className="summary-row">
              <span className="summary-label">
                <Trophy size={14} />
                Serie:
              </span>
              <span className="summary-value">Mejor de {config.bestOf.totalGames}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">Puntos/Partido:</span>
              <span className="summary-value">{config.bestOf.targetScorePerGame}</span>
            </div>
            <div className="summary-total">
              Victorias necesarias: <strong>{Math.ceil(config.bestOf.totalGames / 2)}</strong>
            </div>
          </>
        )}
      </div>
    </div>
  );
}