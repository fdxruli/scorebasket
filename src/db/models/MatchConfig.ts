// src/db/models/MatchConfig.ts

/**
 * Tipos de modos de juego disponibles
 */
export type GameMode = 'traditional' | 'race' | 'best-of-series';

/**
 * Configuración para modo tradicional (por tiempo)
 */
export interface TraditionalConfig {
  totalQuarters: number;        // Número de periodos (ej: 4)
  minutesPerQuarter: number;    // Duración en minutos (ej: 10)
}

/**
 * Configuración para modo "Race to X"
 * (Primero en llegar a X puntos gana)
 */
export interface RaceConfig {
  targetScore: number;          // Puntos objetivo (ej: 10, 15, 21)
  hasRematches: boolean;        // ¿Permitir "dar la vuelta"?
  currentGame: number;          // Número del partido actual (1, 2, 3...)
}

/**
 * Configuración para modo "Best of Series"
 * (Mejor de X partidos)
 */
export interface BestOfConfig {
  totalGames: number;           // Total de partidos (ej: 3, 5, 7)
  targetScorePerGame: number;   // Puntos para ganar cada partido
  currentGame: number;          // Partido actual (1-based)
  wins: {
    local: number;              // Victorias del equipo local
    visitor: number;            // Victorias del equipo visitante
  };
}

/**
 * Configuración unificada del partido
 * Solo UNO de los modos estará presente según el tipo seleccionado
 */
export interface MatchConfig {
  mode: GameMode;
  traditional?: TraditionalConfig;
  race?: RaceConfig;
  bestOf?: BestOfConfig;
}

/**
 * Resultado de un partido individual
 * Usado para historial en modos Race y Best-of
 */
export interface GameResult {
  gameNumber: number;           // Número del partido (1, 2, 3...)
  localScore: number;
  visitorScore: number;
  winner: 'local' | 'visitor' | 'tie';
  finishedAt: Date;
  duration?: number;            // Duración en segundos (opcional)
}