// src/db/teams.repository.ts
import { db } from './db';
import type { Team } from './models';

export const TeamsRepository = {
  // --- Queries ---
  
  /**
   * Obtiene todos los equipos NO archivados
   * Útil para la lista principal y selección de equipos
   */
  async getAll(): Promise<Team[]> {
    return db.teams
      .filter(team => !team.isArchived)
      .sortBy('createdAt');
  },

  /**
   * Obtiene TODOS los equipos (incluidos archivados)
   * Útil para historial y consultas completas
   */
  async getAllIncludingArchived(): Promise<Team[]> {
    return db.teams.orderBy('createdAt').toArray();
  },

  /**
   * Obtiene solo equipos archivados
   */
  async getArchived(): Promise<Team[]> {
    return db.teams
      .filter(team => !!team.isArchived)
      .toArray();
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

    // Solo validar duplicados entre equipos NO archivados
    const duplicate = await db.teams
      .where('name')
      .equalsIgnoreCase(trimmed)
      .and(team => !team.isArchived) // 🆕 Ignorar archivados
      .first();

    if (duplicate) {
      throw new Error('Ya existe un equipo activo con ese nombre');
    }

    return db.teams.add({
      name: trimmed,
      createdAt: new Date(),
      isArchived: false // 🆕 Explícitamente NO archivado
    });
  },

  /**
   * 🆕 SOFT DELETE: Archiva un equipo en lugar de borrarlo
   * Preserva todo el historial de partidos y estadísticas
   */
  async archive(teamId: number): Promise<void> {
    const team = await db.teams.get(teamId);
    
    if (!team) {
      throw new Error('El equipo no existe');
    }

    if (team.isArchived) {
      throw new Error('El equipo ya está archivado');
    }

    await db.teams.update(teamId, {
      isArchived: true,
      archivedAt: new Date()
    });
  },

  /**
   * 🆕 RESTAURAR: Desarchiva un equipo
   */
  async unarchive(teamId: number): Promise<void> {
    const team = await db.teams.get(teamId);
    
    if (!team) {
      throw new Error('El equipo no existe');
    }

    if (!team.isArchived) {
      throw new Error('El equipo no está archivado');
    }

    // Validar que no exista otro equipo activo con el mismo nombre
    const duplicate = await db.teams
      .where('name')
      .equalsIgnoreCase(team.name)
      .and(t => !t.isArchived && t.id !== teamId)
      .first();

    if (duplicate) {
      throw new Error(`Ya existe un equipo activo llamado "${team.name}"`);
    }

    await db.teams.update(teamId, {
      isArchived: false,
      archivedAt: undefined
    });
  },

  /**
   * ⚠️ HARD DELETE: Borra físicamente un equipo
   * SOLO usar en casos excepcionales (ej: datos de prueba)
   * REQUIERE que NO tenga partidos ni jugadores
   */
  async remove(teamId: number): Promise<void> {
    // 1️⃣ No borrar si tiene jugadores
    const playersCount = await db.players
      .where('teamId')
      .equals(teamId)
      .count();

    if (playersCount > 0) {
      throw new Error('No se puede eliminar un equipo con jugadores. Usa "Archivar" en su lugar.');
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
      throw new Error('No se puede eliminar un equipo con partidos registrados. Usa "Archivar" en su lugar.');
    }

    await db.teams.delete(teamId);
  }
};