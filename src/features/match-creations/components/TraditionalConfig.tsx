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

      {/* Opciones opcionales de control de tiempo y posesión (DEPORT-04, ASIST-01) */}
      <div className="config-toggles-section" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        <label className="config-toggle-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', cursor: 'pointer' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Reloj de posesión (24s / 14s)</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Contador de tiro reglamentario para jugadas rápidas</span>
          </div>
          <input
            type="checkbox"
            checked={Boolean(config.shotClockEnabled)}
            onChange={e => {
              const checked = e.target.checked;
              onChange({
                ...config,
                shotClockEnabled: checked,
                possessionAssistantEnabled: checked ? config.possessionAssistantEnabled : false
              });
            }}
            data-testid="toggle-shot-clock"
            style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
          />
        </label>

        <label className="config-toggle-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', cursor: config.shotClockEnabled ? 'pointer' : 'not-allowed', opacity: config.shotClockEnabled ? 1 : 0.5 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Asistente automático de posesión</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cambia posesión y reinicia a 24s tras canastas (+2/+3) y robos</span>
          </div>
          <input
            type="checkbox"
            disabled={!config.shotClockEnabled}
            checked={Boolean(config.shotClockEnabled && config.possessionAssistantEnabled)}
            onChange={e => {
              onChange({
                ...config,
                possessionAssistantEnabled: e.target.checked
              });
            }}
            data-testid="toggle-possession-assistant"
            style={{ width: '1.2rem', height: '1.2rem', cursor: config.shotClockEnabled ? 'pointer' : 'not-allowed' }}
          />
        </label>

        {config.shotClockEnabled && config.possessionAssistantEnabled && (
          <label className="config-toggle-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Avisos y vibración háptica</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Vibración táctil al anotar, robar o expirar posesión</span>
            </div>
            <input
              type="checkbox"
              checked={config.possessionAssistantHaptics !== false}
              onChange={e => {
                onChange({
                  ...config,
                  possessionAssistantHaptics: e.target.checked
                });
              }}
              data-testid="toggle-possession-haptics"
              style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
            />
          </label>
        )}
      </div>

      {/* Info Card */}
      <div className="config-info" style={{ marginTop: '1rem' }}>
        <Info size={16} />
        <div>
          <strong>Duración estimada:</strong> {totalMinutes} min de juego • <strong>{timeoutsCount}</strong> tiempos fuera por equipo
        </div>
      </div>
    </div>
  );
}
