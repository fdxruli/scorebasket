import { Clock, Info } from 'lucide-react';
import type { TraditionalConfig } from '../../../db/models/MatchConfig';
import { MODE_OPTIONS } from '../../../config/gamePresets';
import './ModeConfig.css';

interface TraditionalConfigProps {
  config: TraditionalConfig;
  onChange: (config: TraditionalConfig) => void;
}

export function TraditionalConfigComponent({ config, onChange }: TraditionalConfigProps) {
  const { quarterOptions, minuteOptions, timeoutOptions } = MODE_OPTIONS.traditional;

  const totalMinutes = config.totalQuarters * config.minutesPerQuarter;
  const timeoutsCount = config.timeoutsPerTeam ?? 3;

  return (
    <div className="mode-config traditional">
      <div className="config-header">
        <Clock size={20} className="text-secondary" />
        <h3>Configuración Tradicional</h3>
      </div>

      <div className="config-grid">
        {/* Selector de Cuartos */}
        <div className="config-group">
          <label className="config-label">Número de Periodos</label>
          
          <div className="preset-buttons">
            {quarterOptions.map(quarters => (
              <button
                key={quarters}
                type="button"
                onClick={() => onChange({ ...config, totalQuarters: quarters })}
                className={`preset-btn ${config.totalQuarters === quarters ? 'active' : ''}`}
              >
                {quarters}
              </button>
            ))}
          </div>

          <input
            type="number"
            min="1"
            max="8"
            value={config.totalQuarters}
            onChange={e => onChange({ ...config, totalQuarters: parseInt(e.target.value) || 1 })}
            className="input input-number"
            placeholder="Otro..."
          />
        </div>

        {/* Selector de Minutos */}
        <div className="config-group">
          <label className="config-label">Minutos por Periodo</label>
          
          <div className="preset-buttons">
            {minuteOptions.map(minutes => (
              <button
                key={minutes}
                type="button"
                onClick={() => onChange({ ...config, minutesPerQuarter: minutes })}
                className={`preset-btn ${config.minutesPerQuarter === minutes ? 'active' : ''}`}
              >
                {minutes}
              </button>
            ))}
          </div>

          <input
            type="number"
            min="1"
            max="30"
            value={config.minutesPerQuarter}
            onChange={e => onChange({ ...config, minutesPerQuarter: parseInt(e.target.value) || 1 })}
            className="input input-number"
            placeholder="Otro..."
          />
        </div>

        {/* Selector de Tiempos Fuera */}
        <div className="config-group">
          <label className="config-label">Tiempos Fuera por Equipo</label>
          
          <div className="preset-buttons">
            {(timeoutOptions || [1, 2, 3, 5]).map(timeouts => (
              <button
                key={timeouts}
                type="button"
                onClick={() => onChange({ ...config, timeoutsPerTeam: timeouts })}
                className={`preset-btn ${timeoutsCount === timeouts ? 'active' : ''}`}
              >
                {timeouts}
              </button>
            ))}
          </div>

          <input
            type="number"
            min="0"
            max="10"
            value={timeoutsCount}
            onChange={e => onChange({ ...config, timeoutsPerTeam: Math.max(0, parseInt(e.target.value) || 0) })}
            className="input input-number"
            placeholder="Otro..."
          />
        </div>
      </div>

      {/* Info Card */}
      <div className="config-info">
        <Info size={16} />
        <div>
          <strong>Duración estimada:</strong> {totalMinutes} min de juego • <strong>{timeoutsCount}</strong> tiempos fuera por equipo
        </div>
      </div>
    </div>
  );
}