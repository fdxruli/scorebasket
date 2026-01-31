// src/config/gamePresets.ts
import type { MatchConfig } from '../db/models';

/**
 * Presets predefinidos para configuración rápida
 */
export const GAME_PRESETS = {
  // Modos tradicionales
  NBA: {
    mode: 'traditional' as const,
    traditional: {
      totalQuarters: 4,
      minutesPerQuarter: 12
    }
  },
  
  FIBA: {
    mode: 'traditional' as const,
    traditional: {
      totalQuarters: 4,
      minutesPerQuarter: 10
    }
  },
  
  CUSTOM_QUARTERS: {
    mode: 'traditional' as const,
    traditional: {
      totalQuarters: 4,
      minutesPerQuarter: 10
    }
  },
  
  // Modos Race (Streetball)
  RACE_TO_10: {
    mode: 'race' as const,
    race: {
      targetScore: 10,
      hasRematches: false,
      currentGame: 1
    }
  },
  
  RACE_TO_15: {
    mode: 'race' as const,
    race: {
      targetScore: 15,
      hasRematches: false,
      currentGame: 1
    }
  },
  
  RACE_TO_21: {
    mode: 'race' as const,
    race: {
      targetScore: 21,
      hasRematches: false,
      currentGame: 1
    }
  },
  
  // Modos Best-of
  BEST_OF_3: {
    mode: 'best-of-series' as const,
    bestOf: {
      totalGames: 3,
      targetScorePerGame: 15,
      currentGame: 1,
      wins: { local: 0, visitor: 0 }
    }
  },
  
  BEST_OF_5: {
    mode: 'best-of-series' as const,
    bestOf: {
      totalGames: 5,
      targetScorePerGame: 15,
      currentGame: 1,
      wins: { local: 0, visitor: 0 }
    }
  }
} as const;

/**
 * Opciones comunes para cada modo
 */
export const MODE_OPTIONS = {
  race: {
    targetScores: [5, 10, 11, 15, 21, 25, 30],
    defaultTarget: 15
  },
  bestOf: {
    seriesLengths: [3, 5, 7],
    scoreOptions: [10, 11, 15, 21],
    defaultSeries: 3,
    defaultScore: 15
  },
  traditional: {
    quarterOptions: [2, 4, 6, 8],
    minuteOptions: [5, 8, 10, 12, 15, 20],
    defaultQuarters: 4,
    defaultMinutes: 10
  }
} as const;