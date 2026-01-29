// src/db/models.ts

export interface Team {
  id?: number;
  name: string;
  createdAt: Date;
  isArchived?: boolean;
  archivedAt?: Date;
}

export interface Player {
  id?: number;
  name: string;
  number?: number;
  teamId: number;
  createdAt: Date;
}

export type MatchStatus = 'created' | 'playing' | 'finished';

export interface Match {
  id?: number;
  localTeamId: number;
  visitorTeamId: number;
  currentQuarter: number;
  status: MatchStatus;
  createdAt: Date;
  finishedAt?: Date;

  // Configuración
  totalQuarters: number;
  quarterDuration: number;
  
  // Timer
  timerSecondsRemaining: number;
  timerLastStart?: Date;

  // --- 🟢 NUEVOS CAMPOS DESNORMALIZADOS (OPTIMIZACIÓN) ---
  localScore?: number;
  visitorScore?: number;
  localFouls?: number;   // Faltas Totales Acumuladas
  visitorFouls?: number; // Faltas Totales Acumuladas
}

export interface Score {
  id?: number;
  matchId: number;
  teamId: number;
  playerId?: number;
  points: 1 | 2 | 3;
  quarter: number;
  createdAt: Date;
}

export interface Foul {
  id?: number;
  matchId: number;
  teamId: number;
  playerId?: number;
  quarter: number;
  createdAt: Date;
}