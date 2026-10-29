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

  /**
   * Valida el nombre de un equipo de forma centralizada:
   * - Rechaza nombres vacíos o solo espacios.
   * - Compara case-insensitive contra equipos activos.
   * - Permite ignorar un equipo al editarlo (excludeTeamId).
   * - Valida contra rivalTeamId cuando aplique.
   * - Permite nombres duplicados contra equipos archivados.
   */
  async validateTeamName(
    name: string,
    options?: { excludeTeamId?: number; rivalTeamId?: number }
  ): Promise<{ isValid: boolean; error?: string; trimmedName: string }> {
    const trimmed = name.trim();
    if (!trimmed) {
      return { isValid: false, error: 'El nombre del equipo es obligatorio', trimmedName: '' };
    }

    const lower = trimmed.toLowerCase();

    if (options?.rivalTeamId !== undefined) {
      const rival = await db.teams.get(options.rivalTeamId);
      if (rival && rival.name.trim().toLowerCase() === lower) {
        return { isValid: false, error: 'Ambos equipos no pueden tener el mismo nombre.', trimmedName: trimmed };
      }
    }

    const duplicate = await db.teams
      .where('name')
      .equalsIgnoreCase(trimmed)
      .and(t => !t.isArchived && t.id !== options?.excludeTeamId)
      .first();

    if (duplicate) {
      return { isValid: false, error: 'Ya existe un equipo activo con ese nombre', trimmedName: trimmed };
    }

    return { isValid: true, trimmedName: trimmed };
  },

  // --- Commands ---
  async create(name: string): Promise<number> {
    const initialValidation = await this.validateTeamName(name);
    if (!initialValidation.isValid) {
      throw new Error(initialValidation.error);
    }

    return db.transaction('rw', db.teams, async () => {
      // Re-comprobar dentro de la transacción para proteger contra condiciones de carrera
      const validation = await this.validateTeamName(name);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      return db.teams.add({
        name: validation.trimmedName,
        createdAt: new Date(),
        isArchived: false
      });
    });
  },

  async rename(teamId: number, newName: string, rivalTeamId?: number): Promise<void> {
    return db.transaction('rw', db.teams, async () => {
      const team = await db.teams.get(teamId);
      if (!team) {
        throw new Error('El equipo no existe');
      }

      const validation = await this.validateTeamName(newName, {
        excludeTeamId: teamId,
        rivalTeamId
      });

      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      await db.teams.update(teamId, { name: validation.trimmedName });
    });
  },

  /**
   * 🆕 SOFT DELETE: Archiva un equipo en lugar de borrarlo
   * Preserva todo el historial de partidos y estadísticas
   */
  async archive(teamId: number): Promise<void> {
    return db.transaction('rw', db.teams, async () => {
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
    });
  },

  /**
   * 🆕 RESTAURAR: Desarchiva un equipo
   */
  async unarchive(teamId: number): Promise<void> {
    return db.transaction('rw', db.teams, async () => {
      const team = await db.teams.get(teamId);
      
      if (!team) {
        throw new Error('El equipo no existe');
      }

      if (!team.isArchived) {
        throw new Error('El equipo no está archivado');
      }

      // Validar que no exista otro equipo activo con el mismo nombre
      const validation = await this.validateTeamName(team.name, { excludeTeamId: teamId });
      if (!validation.isValid) {
        throw new Error(`Ya existe un equipo activo llamado "${team.name}"`);
      }

      await db.teams.update(teamId, {
        isArchived: false,
        archivedAt: undefined
      });
    });
  },

  /**
   * ⚠️ HARD DELETE: Borra físicamente un equipo
   * SOLO usar en casos excepcionales (ej: datos de prueba)
   * REQUIERE que NO tenga partidos ni jugadores
   */
  async remove(teamId: number): Promise<void> {
    return db.transaction('rw', db.teams, db.players, db.matches, async () => {
      const team = await db.teams.get(teamId);
      if (!team) {
        throw new Error('El equipo no existe');
      }

      // 1️⃣ No borrar si tiene jugadores
      const playersCount = await db.players
        .where('teamId')
        .equals(teamId)
        .count();

      if (playersCount > 0) {
        throw new Error('No se puede eliminar un equipo con jugadores. Usa "Archivar" en su lugar.');
      }

      // 2️⃣ No borrar si tiene partidos registrados (índices v8)
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
    });
  }
};
