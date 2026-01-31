// src/db/models/Team.ts

export interface Team {
  id?: number;
  name: string;
  createdAt: Date;
  isArchived?: boolean;
  archivedAt?: Date;
}