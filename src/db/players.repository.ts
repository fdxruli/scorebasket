// src/db/players.repository.ts
import { db } from './db';
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

export const PlayersRepository = {
  validateJerseyNumber,

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
   * Guarda de forma atómica el nombre del equipo y la plantilla completa:
   * 1. Valida el nombre del equipo contra duplicados activos.
   * 2. Valida cada jugador y previene dorsales duplicados en la lista.
   * 3. Archiva los jugadores retirados para preservar el historial.
   * 4. Actualiza los existentes y agrega los nuevos en una sola transacción.
   */
  async saveTeamAndRoster(params: {
    teamId: number;
    teamName: string;
    players: Array<{ id?: number; name: string; number?: string | number | null }>;
  }): Promise<void> {
    const { teamId, teamName, players } = params;

    return db.transaction('rw', db.teams, db.players, async () => {
      // 1. Validar y actualizar nombre de equipo
      await TeamsRepository.rename(teamId, teamName);

      // 2. Validar cada jugador individualmente y verificar duplicados dentro de la lista
      const seenJerseys = new Set<number>();
      const validatedPlayers: Array<{ id?: number; name: string; number?: number }> = [];

      for (const p of players) {
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

      // 3. Gestionar archivado de los jugadores que ya no estén en la lista
      const currentDbPlayers = await db.players.where({ teamId }).toArray();
      const activeDbIds = currentDbPlayers
        .filter(p => !p.isArchived)
        .map(p => p.id)
        .filter((id): id is number => id !== undefined);

      const keptIds = validatedPlayers
        .map(p => p.id)
        .filter((id): id is number => id !== undefined);

      const idsToArchive = activeDbIds.filter(id => !keptIds.includes(id));
      for (const id of idsToArchive) {
        await db.players.update(id, {
          isArchived: true,
          archivedAt: new Date()
        });
      }

      // 4. Actualizar existentes
      const playersToUpdate = validatedPlayers.filter(p => p.id !== undefined);
      for (const p of playersToUpdate) {
        await db.players.update(p.id!, {
          name: p.name,
          number: p.number,
          isArchived: false,
          archivedAt: undefined
        });
      }

      // 5. Agregar nuevos
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
