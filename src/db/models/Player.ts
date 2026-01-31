// src/db/models/Player.ts

export interface Player {
  id?: number;
  name: string;
  number?: number;
  teamId: number;
  createdAt: Date;
}