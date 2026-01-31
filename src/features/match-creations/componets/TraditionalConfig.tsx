import { Clock, Info } from 'lucide-react';
import type { TraditionalConfig } from '../../../db/models';
import { MODE_OPTIONS } from '../../../config/gamePresets';
import './ModeConfig.css';

interface TraditionalConfigProps {
  config: TraditionalConfig;
  onChange: (config: TraditionalConfig) => void;
}

export function TraditionalConfigComponent({ config, onChange }: TraditionalConfigProps) {
  const { quarterOptions, minuteOptions } = MODE_OPTIONS.traditional;

  const totalMinutes = config.totalQuarters * config.minutesPerQuarter;

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
      </div>

      {/* Info Card */}
      <div className="config-info">
        <Info size={16} />
        <div>
          <strong>Duración total estimada:</strong> {totalMinutes} minutos de juego
        </div>
      </div>
    </div>
  );
}