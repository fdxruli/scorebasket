// src/db/models/Score.ts

export interface Score {
  id?: number;
  matchId: number;
  teamId: number;
  playerId?: number;
  points: 1 | 2 | 3;
  quarter: number;
  createdAt: Date;
}