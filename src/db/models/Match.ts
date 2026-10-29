// src/db/models/Match.ts
import type { MatchConfig, GameResult } from './MatchConfig';

export type MatchStatus = 'created' | 'playing' | 'paused' | 'finished';
export type MatchEventsProvenance = 'live_session' | 'unverified';

export interface Match {
  id?: number;
  
  // Equipos participantes
  localTeamId: number;
  visitorTeamId: number;
  
  // Estado general del partido
  status: MatchStatus;
  createdAt: Date;
  finishedAt?: Date;
  
  // Evidencia de procedencia y trazabilidad de eventos (R1.5)
  eventsProvenance?: MatchEventsProvenance;
  
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
  possession?: 'local' | 'visitor' | null;
  localTimeouts?: number;
  visitorTimeouts?: number;
  
  // Solo para modos RACE y BEST-OF (sin tiempo)
  gameHistory?: GameResult[];   // Historial de partidos completados
  
  // DEPRECATED (mantener temporalmente para migración)
  /** @deprecated Use config.traditional.totalQuarters */
  totalQuarters?: number;
  /** @deprecated Use config.traditional.minutesPerQuarter */
  quarterDuration?: number;
}
