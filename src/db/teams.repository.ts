import { db } from './db';
import type { Team } from './models';

export const TeamsRepository = {
  // --- Queries ---
  async getAll(): Promise<Team[]> {
    return db.teams.orderBy('createdAt').toArray();
  },

  async getById(teamId: number): Promise<Team | undefined> {
    return db.teams.get(teamId);
  },

  async exists(teamId: number): Promise<boolean> {
    const count = await db.teams.where('id').equals(teamId).count();
    return count > 0;
  },

  // --- Commands ---
  async create(name: string): Promise<number> {
    const trimmed = name.trim();

    if (!trimmed) {
      throw new Error('El nombre del equipo es obligatorio');
    }

    const duplicate = await db.teams
      .where('name')
      .equalsIgnoreCase(trimmed)
      .first();

    if (duplicate) {
      throw new Error('Ya existe un equipo con ese nombre');
    }

    return db.teams.add({
      name: trimmed,
      createdAt: new Date()
    });
  },

  async remove(teamId: number): Promise<void> {
    // 1️⃣ No borrar si tiene jugadores
    const playersCount = await db.players
      .where('teamId')
      .equals(teamId)
      .count();

    if (playersCount > 0) {
      throw new Error('No se puede eliminar un equipo con jugadores');
    }

    // 2️⃣ No borrar si tiene partidos
    const matchesCount = await db.matches
      .where('localTeamId')
      .equals(teamId)
      .count();

    const visitorMatchesCount = await db.matches
      .where('visitorTeamId')
      .equals(teamId)
      .count();

    if (matchesCount + visitorMatchesCount > 0) {
      throw new Error('No se puede eliminar un equipo con partidos');
    }

    await db.teams.delete(teamId);
  }
};
