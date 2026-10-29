// src/db/players.repository.ts
import { db } from './db';
import type { Player } from './models';
import { TeamsRepository } from './teams.repository';

export interface JerseyValidationResult {
  isValid: boolean;
  error?: string;
  normalizedNumber?: number;
}

export interface PlayerValidationResult {
  isValid: boolean;
  error?: string;
  normalizedName: string;
  normalizedNumber?: number;
}

export interface PlayerSnapshotItem {
  id: number;
  name: string;
  number?: number;
}

export interface TeamRosterSnapshot {
  teamName?: string;
  players: PlayerSnapshotItem[];
}

export interface SaveTeamAndRosterParams {
  teamId: number;
  teamName: string;
  players: Array<{ id?: number; name: string; number?: string | number | null }>;
  /**
   * Snapshot opcional del estado inicial cargado al abrir el editor (C-02).
   * Cuando se proporciona:
   * - Detecta modificaciones concurrentes externas en nombre del equipo o en jugadores existentes.
   * - Solo archiva jugadores que estaban presentes en el snapshot inicial y fueron retirados en el editor.
   * - Preserva jugadores agregados concurrentemente desde otra pestaña/operación sin archivarlos.
   */
  initialSnapshot?: TeamRosterSnapshot;
  /**
   * Lista explícita opcional de IDs de jugadores eliminados intencionalmente.
   */
  removedPlayerIds?: number[];
}

/**
 * Valida un dorsal individual:
 * - Opcional: undefined, null o cadena vacía retorna válido (undefined).
 * - Acepta expresamente "0" y 0.
 * - Normaliza cadenas con ceros a la izquierda (ej: "00" -> 0).
 * - Rechaza números negativos (-1, "-5").
 * - Rechaza números con decimales/fracciones (3.5, "1/2").
 * - Rechaza texto no numérico o parcialmente numérico ("12abc").
 * - Intervalo soportado: 0 a 99 inclusive.
 */
export function validateJerseyNumber(
  input: string | number | undefined | null
): JerseyValidationResult {
  if (input === undefined || input === null) {
    return { isValid: true, normalizedNumber: undefined };
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed === '') {
      return { isValid: true, normalizedNumber: undefined };
    }

    if (!/^\d+$/.test(trimmed)) {
      return {
        isValid: false,
        error: 'El dorsal debe ser un número entero entre 0 y 99.'
      };
    }

    const num = Number(trimmed);
    if (num < 0 || num > 99) {
      return {
        isValid: false,
        error: 'El dorsal debe estar entre 0 y 99.'
      };
    }

    return { isValid: true, normalizedNumber: num };
  }

  if (typeof input === 'number') {
    if (isNaN(input) || !Number.isInteger(input)) {
      return {
        isValid: false,
        error: 'El dorsal debe ser un número entero entre 0 y 99.'
      };
    }

    if (input < 0 || input > 99) {
      return {
        isValid: false,
        error: 'El dorsal debe estar entre 0 y 99.'
      };
    }

    return { isValid: true, normalizedNumber: input };
  }

  return {
    isValid: false,
    error: 'Formato de dorsal no válido.'
  };
}

export function createTeamRosterSnapshot(
  teamName: string,
  activePlayers: Player[]
): TeamRosterSnapshot {
  return {
    teamName,
    players: activePlayers
      .filter(p => !p.isArchived && p.id !== undefined)
      .map(p => ({
        id: p.id!,
        name: p.name,
        number: p.number
      }))
  };
}

export const PlayersRepository = {
  validateJerseyNumber,
  createTeamRosterSnapshot,

  async getById(playerId: number): Promise<Player | undefined> {
    return db.players.get(playerId);
  },

  async getActiveByTeam(teamId: number): Promise<Player[]> {
    const list = await db.players.where('teamId').equals(teamId).sortBy('number');
    return list.filter(p => !p.isArchived);
  },

  async archive(playerId: number): Promise<void> {
    return db.transaction('rw', db.players, async () => {
      const player = await db.players.get(playerId);
      if (!player) {
        throw new Error('El jugador no existe.');
      }
      await db.players.update(playerId, {
        isArchived: true,
        archivedAt: new Date()
      });
    });
  },

  /**
   * Valida un jugador frente a las reglas de negocio del equipo:
   * - Nombre no vacío.
   * - Formato de dorsal válido (0-99).
   * - No duplicado entre jugadores ACTIVOS del mismo equipo.
   * - Permite reutilizar dorsales de jugadores archivados.
   * - Permite el mismo dorsal en equipos distintos.
   */
  async validatePlayerOnTeam(
    teamId: number,
    player: { name: string; number?: string | number | null; id?: number }
  ): Promise<PlayerValidationResult> {
    const trimmedName = (player.name || '').trim();
    if (!trimmedName) {
      return {
        isValid: false,
        error: 'El nombre del jugador es obligatorio.',
        normalizedName: ''
      };
    }

    const jerseyVal = validateJerseyNumber(player.number);
    if (!jerseyVal.isValid) {
      return {
        isValid: false,
        error: jerseyVal.error,
        normalizedName: trimmedName
      };
    }

    if (jerseyVal.normalizedNumber !== undefined) {
      const targetNumber = jerseyVal.normalizedNumber;
      const duplicate = await db.players
        .where('teamId')
        .equals(teamId)
        .filter(p => !p.isArchived && p.id !== player.id && p.number === targetNumber)
        .first();

      if (duplicate) {
        return {
          isValid: false,
          error: `El dorsal #${targetNumber} ya está asignado a ${duplicate.name} en este equipo.`,
          normalizedName: trimmedName,
          normalizedNumber: targetNumber
        };
      }
    }

    return {
      isValid: true,
      normalizedName: trimmedName,
      normalizedNumber: jerseyVal.normalizedNumber
    };
  },

  /**
   * Da de alta un nuevo jugador con validación estricta y atómica.
   */
  async create(params: {
    teamId: number;
    name: string;
    number?: string | number | null;
  }): Promise<number> {
    return db.transaction('rw', db.players, db.teams, async () => {
      const team = await db.teams.get(params.teamId);
      if (!team) {
        throw new Error('El equipo no existe.');
      }

      const validation = await this.validatePlayerOnTeam(params.teamId, {
        name: params.name,
        number: params.number
      });

      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      return db.players.add({
        teamId: params.teamId,
        name: validation.normalizedName,
        number: validation.normalizedNumber,
        createdAt: new Date(),
        isArchived: false
      });
    });
  },

  /**
   * Actualiza los datos de un jugador existente garantizando la integridad de su dorsal.
   */
  async update(
    playerId: number,
    params: { name?: string; number?: string | number | null }
  ): Promise<void> {
    return db.transaction('rw', db.players, async () => {
      const player = await db.players.get(playerId);
      if (!player) {
        throw new Error('El jugador no existe.');
      }

      const newName = params.name !== undefined ? params.name : player.name;
      const newNumber = params.number !== undefined ? params.number : player.number;

      const validation = await this.validatePlayerOnTeam(player.teamId, {
        id: playerId,
        name: newName,
        number: newNumber
      });

      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      await db.players.update(playerId, {
        name: validation.normalizedName,
        number: validation.normalizedNumber
      });
    });
  },

  /**
   * Guarda de forma atómica el nombre del equipo y la plantilla completa (C-01 y C-02):
   * 1. Obtiene y verifica la existencia del equipo actual.
   * 2. Valida el nombre del equipo sin mutarlo prematuramente.
   * 3. Obtiene los jugadores actuales del equipo.
   * 4. Verifica el snapshot inicial si se proporciona (control de concurrencia optimista C-02).
   * 5. Examina todos los IDs recibidos: rechaza IDs duplicados, inexistentes, de otros equipos o archivados (C-01).
   * 6. Valida nombres, dorsales y duplicados contra la lista enviada y contra jugadores agregados concurrentemente.
   * 7. Aplica las modificaciones en BD únicamente cuando todas las validaciones han concluido con éxito.
   */
  async saveTeamAndRoster(params: SaveTeamAndRosterParams): Promise<void> {
    const { teamId, teamName, players, initialSnapshot, removedPlayerIds } = params;

    return db.transaction('rw', db.teams, db.players, async () => {
      // 1. Obtener el equipo actual y comprobar que existe
      const team = await db.teams.get(teamId);
      if (!team) {
        throw new Error('El equipo no existe.');
      }

      // 2. Validar el nombre del equipo (sin escribir todavía)
      const teamNameValidation = await TeamsRepository.validateTeamName(teamName, {
        excludeTeamId: teamId
      });
      if (!teamNameValidation.isValid) {
        throw new Error(teamNameValidation.error);
      }

      // 3. Obtener los jugadores existentes correspondientes al equipo
      const currentTeamPlayers = await db.players.where('teamId').equals(teamId).toArray();
      const teamPlayersById = new Map<number, Player>();
      for (const tp of currentTeamPlayers) {
        if (tp.id !== undefined) {
          teamPlayersById.set(tp.id, tp);
        }
      }

      // 4. Control de concurrencia optimista (C-02) si existe initialSnapshot
      const snapshotPlayersById = new Map<number, PlayerSnapshotItem>();
      if (initialSnapshot) {
        if (
          initialSnapshot.teamName !== undefined &&
          team.name !== initialSnapshot.teamName
        ) {
          throw new Error(
            'Conflicto de concurrencia: el nombre del equipo fue modificado externamente. Actualiza la plantilla antes de guardar.'
          );
        }

        for (const snap of initialSnapshot.players) {
          if (snapshotPlayersById.has(snap.id)) {
            throw new Error(`El identificador #${snap.id} está duplicado en el snapshot inicial.`);
          }
          const currentDbPlayer = teamPlayersById.get(snap.id);
          if (!currentDbPlayer || currentDbPlayer.isArchived) {
            throw new Error(
              `Conflicto de concurrencia: el jugador "${snap.name}" fue eliminado o archivado externamente. Actualiza la plantilla antes de guardar.`
            );
          }
          if (
            currentDbPlayer.name !== snap.name ||
            (currentDbPlayer.number ?? undefined) !== (snap.number ?? undefined)
          ) {
            throw new Error(
              `Conflicto de concurrencia: los datos del jugador "${snap.name}" fueron modificados externamente. Actualiza la plantilla antes de guardar.`
            );
          }
          snapshotPlayersById.set(snap.id, snap);
        }
      }

      // 5. Examinar todos los identificadores recibidos y validar cada jugador (C-01)
      const seenIds = new Set<number>();
      const seenJerseys = new Set<number>();
      const validatedPlayers: Array<{ id?: number; name: string; number?: number }> = [];

      for (const p of players) {
        if (p.id !== undefined) {
          // 5a. Rechazar identificadores duplicados dentro de la misma solicitud
          if (seenIds.has(p.id)) {
            throw new Error(`El identificador de jugador #${p.id} está duplicado en la solicitud.`);
          }
          seenIds.add(p.id);

          // 5b. Rechazar IDs inexistentes
          const existingPlayer = await db.players.get(p.id);
          if (!existingPlayer) {
            throw new Error(`El jugador con ID #${p.id} no existe.`);
          }

          // 5c. Rechazar IDs correspondientes a otros equipos
          if (existingPlayer.teamId !== teamId) {
            throw new Error(
              `El jugador con ID #${p.id} pertenece a otro equipo y no puede modificarse desde esta plantilla.`
            );
          }

          // 5d. Rechazar la reactivación implícita de jugadores archivados
          if (existingPlayer.isArchived) {
            throw new Error(
              `No se permite reactivar implícitamente al jugador archivado "${existingPlayer.name}" (ID #${p.id}).`
            );
          }

          // 5e. Si hay snapshot inicial, verificar que el ID formaba parte del snapshot conocido
          if (initialSnapshot && !snapshotPlayersById.has(p.id)) {
            throw new Error(
              `Conflicto de concurrencia: el jugador "${existingPlayer.name}" (ID #${p.id}) no estaba en el estado inicial del editor.`
            );
          }
        }

        // 5f. Comprobar nombres, dorsales y duplicados
        const trimmedName = (p.name || '').trim();
        if (!trimmedName) {
          throw new Error('Todos los jugadores deben tener un nombre.');
        }

        const jVal = validateJerseyNumber(p.number);
        if (!jVal.isValid) {
          throw new Error(jVal.error || `Dorsal inválido para el jugador ${trimmedName}.`);
        }

        if (jVal.normalizedNumber !== undefined) {
          if (seenJerseys.has(jVal.normalizedNumber)) {
            throw new Error(
              `El dorsal #${jVal.normalizedNumber} está duplicado en la plantilla que intentas guardar.`
            );
          }
          seenJerseys.add(jVal.normalizedNumber);
        }

        validatedPlayers.push({
          id: p.id,
          name: trimmedName,
          number: jVal.normalizedNumber
        });
      }

      // 6. Determinar qué jugadores deben archivarse y verificar no colisión con altas concurrentes (C-02)
      const keptIds = new Set(
        validatedPlayers.map(p => p.id).filter((id): id is number => id !== undefined)
      );
      const idsToArchive: number[] = [];

      if (initialSnapshot) {
        // Solo archivar jugadores que estaban en el snapshot inicial y fueron retirados por el usuario
        for (const snapId of snapshotPlayersById.keys()) {
          if (!keptIds.has(snapId)) {
            idsToArchive.push(snapId);
          }
        }

        if (removedPlayerIds) {
          for (const remId of removedPlayerIds) {
            if (!snapshotPlayersById.has(remId)) {
              throw new Error(
                `El jugador con ID #${remId} indicado para baja no pertenece al estado inicial del equipo.`
              );
            }
            if (!idsToArchive.includes(remId) && !keptIds.has(remId)) {
              idsToArchive.push(remId);
            }
          }
        }

        // Los jugadores activos agregados concurrentemente (que NO estaban en initialSnapshot)
        // se preservan activos y se valida que sus dorsales no colisionen con los de la plantilla editada.
        for (const dbPlayer of currentTeamPlayers) {
          if (
            !dbPlayer.isArchived &&
            dbPlayer.id !== undefined &&
            !snapshotPlayersById.has(dbPlayer.id)
          ) {
            if (dbPlayer.number !== undefined && seenJerseys.has(dbPlayer.number)) {
              throw new Error(
                `Conflicto de concurrencia: el dorsal #${dbPlayer.number} fue asignado externamente al jugador "${dbPlayer.name}".`
              );
            }
          }
        }
      } else if (removedPlayerIds) {
        for (const remId of removedPlayerIds) {
          const target = teamPlayersById.get(remId);
          if (!target) {
            throw new Error(`El jugador con ID #${remId} no pertenece a este equipo.`);
          }
          if (!target.isArchived && !keptIds.has(remId)) {
            idsToArchive.push(remId);
          }
        }

        const archiveSet = new Set(idsToArchive);
        for (const dbPlayer of currentTeamPlayers) {
          if (
            !dbPlayer.isArchived &&
            dbPlayer.id !== undefined &&
            !keptIds.has(dbPlayer.id) &&
            !archiveSet.has(dbPlayer.id)
          ) {
            if (dbPlayer.number !== undefined && seenJerseys.has(dbPlayer.number)) {
              throw new Error(
                `Conflicto de concurrencia: el dorsal #${dbPlayer.number} ya está asignado a "${dbPlayer.name}".`
              );
            }
          }
        }
      } else {
        // Modo sin snapshot explícito: archivar activos previos del equipo que no siguen en la lista
        for (const dbPlayer of currentTeamPlayers) {
          if (!dbPlayer.isArchived && dbPlayer.id !== undefined && !keptIds.has(dbPlayer.id)) {
            idsToArchive.push(dbPlayer.id);
          }
        }
      }

      // 7. Aplicar todas las modificaciones únicamente tras superar todas las validaciones (C-01 paso 10)
      await db.teams.update(teamId, { name: teamNameValidation.trimmedName });

      const archivedAt = new Date();
      for (const id of idsToArchive) {
        await db.players.update(id, {
          isArchived: true,
          archivedAt
        });
      }

      const playersToUpdate = validatedPlayers.filter(p => p.id !== undefined);
      for (const p of playersToUpdate) {
        await db.players.update(p.id!, {
          name: p.name,
          number: p.number
        });
      }

      const playersToAdd = validatedPlayers.filter(p => p.id === undefined);
      if (playersToAdd.length > 0) {
        await db.players.bulkAdd(
          playersToAdd.map(p => ({
            name: p.name,
            number: p.number,
            teamId,
            createdAt: new Date(),
            isArchived: false
          }))
        );
      }
    });
  }
};
