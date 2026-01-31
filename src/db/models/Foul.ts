// src/db/models/Foul.ts

export interface Foul {
  id?: number;
  matchId: number;
  teamId: number;
  playerId?: number;
  quarter: number;
  createdAt: Date;
}