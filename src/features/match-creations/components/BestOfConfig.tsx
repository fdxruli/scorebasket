// src/features/match-creation/components/BestOfConfig.tsx
import { Trophy, Target, Info } from 'lucide-react';
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