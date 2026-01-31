// src/config/validations.ts
import type { MatchConfig } from '../db/models/MatchConfig';

/**
 * Límites y reglas de validación
 */
export const VALIDATION_RULES = {
  traditional: {
    minQuarters: 1,
    maxQuarters: 8,
    minMinutes: 1,
    maxMinutes: 30
  },
  race: {
    minScore: 1,
    maxScore: 100
  },
  bestOf: {
    minGames: 1,
    maxGames: 11,      // Debe ser impar
    minScorePerGame: 1,
    maxScorePerGame: 100
  }
} as const;

/**
 * Valida una configuración de partido
 */
export function validateMatchConfig(config: MatchConfig): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  switch (config.mode) {
    case 'traditional': {
      if (!config.traditional) {
        errors.push('Configuración tradicional requerida');
        break;
      }
      
      const { totalQuarters, minutesPerQuarter } = config.traditional;
      const rules = VALIDATION_RULES.traditional;
      
      if (totalQuarters < rules.minQuarters || totalQuarters > rules.maxQuarters) {
        errors.push(`Los cuartos deben estar entre ${rules.minQuarters} y ${rules.maxQuarters}`);
      }
      
      if (minutesPerQuarter < rules.minMinutes || minutesPerQuarter > rules.maxMinutes) {
        errors.push(`Los minutos deben estar entre ${rules.minMinutes} y ${rules.maxMinutes}`);
      }
      break;
    }
    
    case 'race': {
      if (!config.race) {
        errors.push('Configuración Race requerida');
        break;
      }
      
      const { targetScore } = config.race;
      const rules = VALIDATION_RULES.race;
      
      if (targetScore < rules.minScore || targetScore > rules.maxScore) {
        errors.push(`El puntaje objetivo debe estar entre ${rules.minScore} y ${rules.maxScore}`);
      }
      break;
    }
    
    case 'best-of-series': {
      if (!config.bestOf) {
        errors.push('Configuración Best-of requerida');
        break;
      }
      
      const { totalGames, targetScorePerGame } = config.bestOf;
      const rules = VALIDATION_RULES.bestOf;
      
      if (totalGames < rules.minGames || totalGames > rules.maxGames) {
        errors.push(`El número de partidos debe estar entre ${rules.minGames} y ${rules.maxGames}`);
      }
      
      if (totalGames % 2 === 0) {
        errors.push('El número de partidos debe ser impar (ej: 3, 5, 7)');
      }
      
      if (targetScorePerGame < rules.minScorePerGame || targetScorePerGame > rules.maxScorePerGame) {
        errors.push(`El puntaje por partido debe estar entre ${rules.minScorePerGame} y ${rules.maxScorePerGame}`);
      }
      break;
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Crea una configuración por defecto según el modo
 */
export function getDefaultConfig(mode: MatchConfig['mode']): MatchConfig {
  switch (mode) {
    case 'traditional':
      return {
        mode: 'traditional',
        traditional: {
          totalQuarters: VALIDATION_RULES.traditional.minQuarters * 4,
          minutesPerQuarter: 10
        }
      };
    
    case 'race':
      return {
        mode: 'race',
        race: {
          targetScore: 15,
          hasRematches: false,
          currentGame: 1
        }
      };
    
    case 'best-of-series':
      return {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 15,
          currentGame: 1,
          wins: { local: 0, visitor: 0 }
        }
      };
  }
}