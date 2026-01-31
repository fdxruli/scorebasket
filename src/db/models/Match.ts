// src/db/models/Match.ts
import type { MatchConfig, GameResult } from './MatchConfig';

export type MatchStatus = 'created' | 'playing' | 'paused' | 'finished';

export interface Match {
  id?: number;
  
  // Equipos participantes
  localTeamId: number;
  visitorTeamId: number;
  
  // Estado general del partido
  status: MatchStatus;
  createdAt: Date;
  finishedAt?: Date;
  
  // 🆕 Configuración del partido (reemplaza campos individuales)
  config: MatchConfig;
  
  // Estadísticas actuales (desnormalizadas para performance)
  localScore: number;
  visitorScore: number;
  localFouls: number;
  visitorFouls: number;
  
  // --- Campos específicos por modo ---
  
  // Solo para modo TRADITIONAL (con tiempo)
  currentQuarter?: number;
  timerSecondsRemaining?: number;
  timerLastStart?: Date;
  
  // Solo para modos RACE y BEST-OF (sin tiempo)
  gameHistory?: GameResult[];   // Historial de partidos completados
  
  // DEPRECATED (mantener temporalmente para migración)
  /** @deprecated Use config.traditional.totalQuarters */
  totalQuarters?: number;
  /** @deprecated Use config.traditional.minutesPerQuarter */
  quarterDuration?: number;
}