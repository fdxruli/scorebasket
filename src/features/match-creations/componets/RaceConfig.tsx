// src/features/match-creation/components/RaceConfig.tsx
import { Target, RotateCcw, Info } from 'lucide-react';
import type { RaceConfig } from '../../../db/models';
import { MODE_OPTIONS } from '../../../config/gamePresets';
import './ModeConfig.css';

interface RaceConfigProps {
  config: RaceConfig;
  onChange: (config: RaceConfig) => void;
}

export function RaceConfigComponent({ config, onChange }: RaceConfigProps) {
  const { targetScores } = MODE_OPTIONS.race;

  return (
    <div className="mode-config race">
      <div className="config-header">
        <Target size={20} className="text-primary" />
        <h3>Configuración Race to Score</h3>
      </div>

      <div className="config-group">
        <label className="config-label">Puntos Objetivo</label>
        <p className="config-hint">El primer equipo en alcanzar esta cantidad gana</p>
        
        <div className="preset-buttons">
          {targetScores.map(score => (
            <button
              key={score}
              type="button"
              onClick={() => onChange({ ...config, targetScore: score })}
              className={`preset-btn large ${config.targetScore === score ? 'active' : ''}`}
            >
              {score}
            </button>
          ))}
        </div>

        <input
          type="number"
          min="1"
          max="100"
          value={config.targetScore}
          onChange={e => onChange({ ...config, targetScore: parseInt(e.target.value) || 1 })}
          className="input input-number"
          placeholder="Otro puntaje..."
        />
      </div>

      {/* Toggle de Revancha */}
      <div className="config-group">
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={config.hasRematches}
            onChange={e => onChange({ ...config, hasRematches: e.target.checked })}
            className="toggle-input"
          />
          <div className="toggle-switch">
            <div className="toggle-slider" />
          </div>
          <div className="toggle-text">
            <RotateCcw size={18} />
            <span>Permitir "Dar la Vuelta"</span>
          </div>
        </label>

        {config.hasRematches && (
          <div className="config-info success">
            <Info size={16} />
            <p>
              Después de cada partido, podrás jugar una revancha inmediata 
              con los mismos equipos y configuración.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}