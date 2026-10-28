// src/features/match-creation/components/GameModeSelector.tsx
import { Clock, Target, Trophy } from 'lucide-react';
import type { GameMode } from '../../../db/models/MatchConfig';
import './GameModeSelector.css';

interface GameModeSelectorProps {
  selectedMode: GameMode;
  onModeChange: (mode: GameMode) => void;
}

interface ModeOption {
  mode: GameMode;
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    mode: 'traditional',
    icon: <Clock size={32} />,
    title: 'Tradicional',
    description: 'Juego por tiempo dividido en cuartos',
    color: 'blue'
  },
  {
    mode: 'race',
    icon: <Target size={32} />,
    title: 'Race to Score',
    description: 'El primero en llegar a X puntos gana',
    color: 'orange'
  },
  {
    mode: 'best-of-series',
    icon: <Trophy size={32} />,
    title: 'Best of Series',
    description: 'Mejor de X partidos consecutivos',
    color: 'green'
  }
];

export function GameModeSelector({ selectedMode, onModeChange }: GameModeSelectorProps) {
  return (
    <div className="game-mode-selector">
      <h3 className="mode-selector-title">Modo de Juego</h3>
      
      <div className="mode-cards-grid">
        {MODE_OPTIONS.map(option => (
          <button
            key={option.mode}
            onClick={() => onModeChange(option.mode)}
            className={`mode-card ${selectedMode === option.mode ? 'active' : ''} ${option.color}`}
          >
            <div className="mode-icon">
              {option.icon}
            </div>
            
            <div className="mode-info">
              <h4 className="mode-title">{option.title}</h4>
              <p className="mode-description">{option.description}</p>
            </div>
            
            {selectedMode === option.mode && (
              <div className="mode-checkmark">✓</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}