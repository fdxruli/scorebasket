// src/features/match-creations/components/BestOfConfig.tsx
import { Trophy, Target, Info, ShieldCheck } from 'lucide-react';
import type { BestOfConfig } from '../../../db/models/MatchConfig';
import { MODE_OPTIONS } from '../../../config/gamePresets';
import './ModeConfig.css';

interface BestOfConfigProps {
  config: BestOfConfig;
  onChange: (config: BestOfConfig) => void;
}

export function BestOfConfigComponent({ config, onChange }: BestOfConfigProps) {
  const { seriesLengths, scoreOptions } = MODE_OPTIONS.bestOf;

  const winsNeeded = Math.ceil(config.totalGames / 2);
  const scoringSystem = config.scoringSystem || 'standard';
  const winByTwo = config.winByTwo ?? false;

  return (
    <div className="mode-config best-of">
      <div className="config-header">
        <Trophy size={20} className="text-success" />
        <h3>Configuración Best of Series</h3>
      </div>

      <div className="config-grid">
        {/* Serie */}
        <div className="config-group">
          <label className="config-label">Mejor de...</label>
          <p className="config-hint">Total de partidos a jugar</p>
          
          <div className="preset-buttons">
            {seriesLengths.map(games => (
              <button
                key={games}
                type="button"
                onClick={() => onChange({ ...config, totalGames: games })}
                className={`preset-btn ${config.totalGames === games ? 'active' : ''}`}
              >
                {games}
              </button>
            ))}
          </div>
        </div>

        {/* Puntos por Partido */}
        <div className="config-group">
          <label className="config-label">
            <Target size={16} />
            Puntos por Partido
          </label>
          <p className="config-hint">Cada partido termina al llegar a...</p>
          
          <div className="preset-buttons">
            {scoreOptions.map(score => (
              <button
                key={score}
                type="button"
                onClick={() => onChange({ ...config, targetScorePerGame: score })}
                className={`preset-btn ${config.targetScorePerGame === score ? 'active' : ''}`}
              >
                {score}
              </button>
            ))}
          </div>

          <input
            type="number"
            min="1"
            max="100"
            value={config.targetScorePerGame}
            onChange={e => onChange({ ...config, targetScorePerGame: parseInt(e.target.value) || 1 })}
            className="input input-number"
            placeholder="Otro..."
          />
        </div>
      </div>

      {/* Selector de Sistema de Puntos */}
      <div className="config-group" style={{ marginTop: '1.15rem' }}>
        <label className="config-label">Sistema de Puntos</label>
        <p className="config-hint">Valores de anotación disponibles en cada set</p>
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

      {/* Info Card */}
      <div className="config-info success">
        <Info size={16} />
        <div>
          <strong>Para ganar la serie:</strong> {winsNeeded} {winsNeeded === 1 ? 'victoria' : 'victorias'} necesarias
        </div>
      </div>
    </div>
  );
}
