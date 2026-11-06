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
    maxMinutes: 30,
    minTimeouts: 0,
    maxTimeouts: 10
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
 * Valida una configuración de partido.
 * Inspecciona rigurosamente tipos, límites numéricos enteros, ausencia de NaN/Infinity,
 * presencia de subconfiguraciones requeridas y coherencia deportiva.
 */
export function validateMatchConfig(config: unknown): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {
      isValid: false,
      errors: ['Configuración de partido inválida o ausente (debe ser un objeto)']
    };
  }

  const cfg = config as Partial<MatchConfig>;

  if (!cfg.mode || !['traditional', 'race', 'best-of-series'].includes(cfg.mode)) {
    return {
      isValid: false,
      errors: [`Modo de juego inválido o no reconocido: "${String(cfg.mode)}". Los modos válidos son traditional, race y best-of-series.`]
    };
  }

  const isStrictInteger = (val: unknown, min: number, max: number): boolean => {
    return (
      typeof val === 'number' &&
      Number.isInteger(val) &&
      !Number.isNaN(val) &&
      Number.isFinite(val) &&
      val >= min &&
      val <= max
    );
  };

  switch (cfg.mode) {
    case 'traditional': {
      if (!cfg.traditional || typeof cfg.traditional !== 'object' || Array.isArray(cfg.traditional)) {
        errors.push('Configuración tradicional requerida y debe ser un objeto');
        break;
      }

      const { totalQuarters, minutesPerQuarter, timeoutsPerTeam, shotClockEnabled, possessionAssistantEnabled } = cfg.traditional;
      const rules = VALIDATION_RULES.traditional;

      if (!isStrictInteger(totalQuarters, rules.minQuarters, rules.maxQuarters)) {
        errors.push(
          `Los cuartos deben ser un número entero entre ${rules.minQuarters} y ${rules.maxQuarters}`
        );
      }

      if (!isStrictInteger(minutesPerQuarter, rules.minMinutes, rules.maxMinutes)) {
        errors.push(
          `Los minutos deben ser un número entero entre ${rules.minMinutes} y ${rules.maxMinutes}`
        );
      }

      if (
        timeoutsPerTeam !== undefined &&
        !isStrictInteger(timeoutsPerTeam, rules.minTimeouts, rules.maxTimeouts)
      ) {
        errors.push(
          `Los tiempos fuera deben ser un número entero entre ${rules.minTimeouts} y ${rules.maxTimeouts}`
        );
      }

      if (possessionAssistantEnabled && !shotClockEnabled) {
        errors.push('El asistente automático de posesión requiere tener habilitado el reloj de posesión.');
      }
      break;
    }

    case 'race': {
      if (!cfg.race || typeof cfg.race !== 'object' || Array.isArray(cfg.race)) {
        errors.push('Configuración Race requerida y debe ser un objeto');
        break;
      }

      const { targetScore } = cfg.race;
      const rules = VALIDATION_RULES.race;

      if (!isStrictInteger(targetScore, rules.minScore, rules.maxScore)) {
        errors.push(
          `El puntaje objetivo debe ser un número entero entre ${rules.minScore} y ${rules.maxScore}`
        );
      }
      break;
    }

    case 'best-of-series': {
      if (!cfg.bestOf || typeof cfg.bestOf !== 'object' || Array.isArray(cfg.bestOf)) {
        errors.push('Configuración Best-of requerida y debe ser un objeto');
        break;
      }

      const { totalGames, targetScorePerGame } = cfg.bestOf;
      const rules = VALIDATION_RULES.bestOf;

      if (!isStrictInteger(totalGames, rules.minGames, rules.maxGames)) {
        errors.push(
          `El número de partidos debe ser un número entero entre ${rules.minGames} y ${rules.maxGames}`
        );
      } else if (totalGames % 2 === 0) {
        errors.push('El número de partidos debe ser impar (ej: 3, 5, 7)');
      }

      if (!isStrictInteger(targetScorePerGame, rules.minScorePerGame, rules.maxScorePerGame)) {
        errors.push(
          `El puntaje por partido debe ser un número entero entre ${rules.minScorePerGame} y ${rules.maxScorePerGame}`
        );
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
          minutesPerQuarter: 10,
          timeoutsPerTeam: 3,
          shotClockEnabled: false,
          possessionAssistantEnabled: false,
          possessionAssistantHaptics: true
        }
      };
    
    case 'race':
      return {
        mode: 'race',
        race: {
          targetScore: 15,
          hasRematches: false,
          currentGame: 1,
          winByTwo: false,
          scoringSystem: 'standard'
        }
      };
    
    case 'best-of-series':
      return {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 15,
          currentGame: 1,
          wins: { local: 0, visitor: 0 },
          winByTwo: false,
          scoringSystem: 'standard'
        }
      };
  }
}
