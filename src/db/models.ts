// src/db/models.ts
// Punto único de exportación para evitar modelos duplicados/desactualizados.

export type { Team } from './models/Team';
export type { Player } from './models/Player';
export type { Match, MatchStatus } from './models/Match';
export type { Score } from './models/Score';
export type { Foul } from './models/Foul';
export type {
  GameMode,
  TraditionalConfig,
  RaceConfig,
  BestOfConfig,
  MatchConfig,
  GameResult
} from './models/MatchConfig';