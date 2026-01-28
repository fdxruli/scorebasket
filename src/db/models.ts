// src/db/models.ts

export interface Team {
  id?: number;
  name: string;
  createdAt: Date;
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

  // 🆕 Configuración del partido
  totalQuarters: number;         // Número total de cuartos configurados
  quarterDuration: number;        // Duración de cada cuarto en minutos
  
  // Timer
  timerSecondsRemaining: number;
  timerLastStart?: Date;
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