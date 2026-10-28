// src/features/match-creations/components/RaceConfig.tsx
import { Target, RotateCcw, Info, ShieldCheck } from 'lucide-react';
import type { RaceConfig } from '../../../db/models/MatchConfig';
import { MODE_OPTIONS } from '../../../config/gamePresets';
import './ModeConfig.css';

interface RaceConfigProps {
  config: RaceConfig;
  onChange: (config: RaceConfig) => void;
}

export function RaceConfigComponent({ config, onChange }: RaceConfigProps) {
  const { targetScores } = MODE_OPTIONS.race;
  const scoringSystem = config.scoringSystem || 'standard';
  const winByTwo = config.winByTwo ?? false;

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

      {/* Selector de Sistema de Puntos */}
      <div className="config-group" style={{ marginTop: '1rem' }}>
        <label className="config-label">Sistema de Puntos</label>
        <p className="config-hint">Valores de anotación disponibles durante la reta</p>
        <div className="preset-buttons" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button
            type="button"
            onClick={() => onChange({ ...config, scoringSystem: 'standard' })}
            className={`preset-btn ${scoringSystem === 'standard' ? 'active' : ''}`}
            style={{ fontSize: '0.88rem', fontFamily: 'var(--font-sans)' }}
          >
            Estándar (+1, +2, +3)
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...config, scoringSystem: 'street' })}
            className={`preset-btn ${scoringSystem === 'street' ? 'active' : ''}`}
            style={{ fontSize: '0.88rem', fontFamily: 'var(--font-sans)' }}
          >
            Callejero (+1, +2)
          </button>
        </div>
      </div>

      {/* Toggle Win by 2 */}
      <div className="config-group" style={{ marginTop: '0.5rem' }}>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={winByTwo}
            onChange={e => onChange({ ...config, winByTwo: e.target.checked })}
            className="toggle-input"
          />
          <div className="toggle-switch">
            <div className="toggle-slider" />
          </div>
          <div className="toggle-text">
            <ShieldCheck size={18} />
            <span>Ganar por diferencia de 2 puntos (Win by 2)</span>
          </div>
        </label>
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
