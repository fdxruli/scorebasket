import { db } from './db';
import type { Team } from './models/Team';
import type { Player } from './models/Player';
import type { Match } from './models/Match';
import type { Score } from './models/Score';
import type { Foul } from './models/Foul';
import { validateMatchConfig } from '../config/validations';

// Exportación completa y restauración CONSERVADORA: no mezcla registros ni borra la BD.
// Los datos se cargan en un único commit atómico y solo si los cinco almacenes están vacíos.
export const LOCAL_BACKUP_FORMAT = 'scorebasket-local-backup';
export const LOCAL_BACKUP_VERSION = 1;

type BackupData = { teams: Team[]; players: Player[]; matches: Match[]; scores: Score[]; fouls: Foul[] };
export type BackupCounts = Record<keyof BackupData, number>;

type BackupEnvelope = {
  format: typeof LOCAL_BACKUP_FORMAT;
  version: typeof LOCAL_BACKUP_VERSION;
  sourceSchemaVersion: number;
  exportedAt: string;
  data: BackupData;
};

const keys = ['teams', 'players', 'matches', 'scores', 'fouls'] as const;

function recordOf(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Respaldo inválido: ${field} debe ser un objeto.`);
  }
  return value as Record<string, unknown>;
}

function validId(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Respaldo inválido: ID de ${name} incorrecto.`);
  }
  return value;
}

function validDate(raw: unknown, name: string): Date {
  if (typeof raw !== 'string') throw new Error(`Respaldo inválido: fecha ${name} no es texto.`);
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new Error(`Respaldo inválido: fecha ${name} incorrecta.`);
  return date;
}

function recoverDates<T>(row: T, names: readonly string[], label: string): T {
  const data = recordOf(row, label);
  const result = { ...data };
  for (const name of names) {
    if (result[name] !== undefined && result[name] !== null) {
      result[name] = validDate(result[name], `${label}.${name}`);
    }
  }
  return result as T;
}

function idsUnique(rows: unknown[], label: string): Set<number> {
  const ids = new Set<number>();
  for (const row of rows) {
    const id = validId(recordOf(row, label).id, label);
    if (ids.has(id)) throw new Error(`Respaldo inválido: ID repetido en ${label} (${id}).`);
    ids.add(id);
  }
  return ids;
}

function parseAndValidate(rawJson: string): BackupData {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawJson);
  } catch {
    throw new Error('El archivo no contiene un respaldo JSON válido.');
  }
  const envelope = recordOf(decoded, 'archivo');
  if (envelope.format !== LOCAL_BACKUP_FORMAT || envelope.version !== LOCAL_BACKUP_VERSION) {
    throw new Error('Formato o versión de respaldo no compatible.');
  }
  if (envelope.sourceSchemaVersion !== db.verno) {
    throw new Error('Este respaldo usa otra versión de esquema. No se restaurará automáticamente.');
  }
  const raw = recordOf(envelope.data, 'data');
  for (const key of keys) {
    if (!Array.isArray(raw[key])) throw new Error(`Respaldo inválido: falta la tabla ${key}.`);
  }

  const data: BackupData = {
    teams: (raw.teams as Team[]).map(row => recoverDates(row, ['createdAt', 'archivedAt'], 'teams')),
    players: (raw.players as Player[]).map(row => recoverDates(row, ['createdAt', 'archivedAt'], 'players')),
    matches: (raw.matches as Match[]).map(row => {
      const m = recoverDates(row, ['createdAt', 'finishedAt', 'timerLastStart'], 'matches');
      if (m.gameHistory !== undefined) {
        if (!Array.isArray(m.gameHistory)) throw new Error('Respaldo inválido: gameHistory incorrecto.');
        m.gameHistory = m.gameHistory.map((game, index) =>
          recoverDates(game, ['finishedAt'], `gameHistory[${index}]`));
      }
      return m;
    }),
    scores: (raw.scores as Score[]).map(row => recoverDates(row, ['createdAt'], 'scores')),
    fouls: (raw.fouls as Foul[]).map(row => recoverDates(row, ['createdAt'], 'fouls'))
  };

  const teamIds = idsUnique(data.teams, 'teams');
  const playerIds = idsUnique(data.players, 'players');
  const matchIds = idsUnique(data.matches, 'matches');
  idsUnique(data.scores, 'scores');
  idsUnique(data.fouls, 'fouls');
  const players = new Map(data.players.map(p => [p.id!, p]));
  const matches = new Map(data.matches.map(m => [m.id!, m]));

  for (const p of data.players) {
    if (!teamIds.has(validId(p.teamId, 'player.teamId'))) {
      throw new Error('Respaldo inválido: jugador referencia a un equipo inexistente.');
    }
  }
  for (const m of data.matches) {
    if (!teamIds.has(validId(m.localTeamId, 'localTeamId')) ||
        !teamIds.has(validId(m.visitorTeamId, 'visitorTeamId')) ||
        m.localTeamId === m.visitorTeamId) {
      throw new Error('Respaldo inválido: equipos del partido incoherentes.');
    }
    if (!['created','playing','paused','finished'].includes(m.status) ||
        !m.config || !validateMatchConfig(m.config).isValid) {
      throw new Error('Respaldo inválido: partido con configuración o estado incorrectos.');
    }
    for (const value of [m.localScore, m.visitorScore, m.localFouls, m.visitorFouls]) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('Respaldo inválido: contador deportivo incorrecto.');
      }
    }
  }

  for (const type of ['scores','fouls'] as const) {
    for (const action of data[type]) {
      const matchId = validId(action.matchId, `${type}.matchId`);
      const match = matches.get(matchId);
      if (!match || (action.teamId !== match.localTeamId && action.teamId !== match.visitorTeamId)) {
        throw new Error(`Respaldo inválido: ${type} apunta a otro partido/equipo.`);
      }
      if (!Number.isSafeInteger(action.quarter) || action.quarter < 1) {
        throw new Error(`Respaldo inválido: periodo incorrecto en ${type}.`);
      }
      if (action.playerId !== undefined && action.playerId !== null) {
        const id = validId(action.playerId, `${type}.playerId`);
        if (!playerIds.has(id) || players.get(id)?.teamId !== action.teamId) {
          throw new Error(`Respaldo inválido: jugador de ${type} no pertenece al equipo.`);
        }
      }
      if (type === 'scores' && ![1,2,3].includes((action as Score).points)) {
        throw new Error('Respaldo inválido: anotación con puntos incorrectos.');
      }
    }
  }
  return data;
}

function counts(data: BackupData): BackupCounts {
  return {
    teams: data.teams.length,
    players: data.players.length,
    matches: data.matches.length,
    scores: data.scores.length,
    fouls: data.fouls.length
  };
}

export const LocalBackupService = {
  async exportJson(): Promise<string> {
    const data = await db.transaction('r', db.teams, db.players, db.matches, db.scores, db.fouls,
      async (): Promise<BackupData> => {
        const [teams, players, matches, scores, fouls] = await Promise.all([
          db.teams.toArray(), db.players.toArray(), db.matches.toArray(),
          db.scores.toArray(), db.fouls.toArray()
        ]);
        return { teams, players, matches, scores, fouls };
      });
    const envelope: BackupEnvelope = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      sourceSchemaVersion: db.verno,
      exportedAt: new Date().toISOString(),
      data
    };
    return JSON.stringify(envelope);
  },

  async restoreIntoEmpty(rawJson: string): Promise<BackupCounts> {
    // Toda validación potencialmente costosa se hace ANTES de iniciar el bloqueo de escritura.
    const data = parseAndValidate(rawJson);
    await db.transaction('rw', db.teams, db.players, db.matches, db.scores, db.fouls, async () => {
      const existing = await Promise.all([
        db.teams.count(), db.players.count(), db.matches.count(),
        db.scores.count(), db.fouls.count()
      ]);
      if (existing.some(total => total !== 0)) {
        throw new Error('Restauración bloqueada: la base de datos debe estar completamente vacía. No se borrará ni reemplazará información existente.');
      }
      // Los IDs explícitos se conservan para que las relaciones sigan apuntando al mismo registro.
      // Si cualquier bulkAdd falla, IndexedDB revierte TODAS las tablas de esta transacción.
      await db.teams.bulkAdd(data.teams);
      await db.players.bulkAdd(data.players);
      await db.matches.bulkAdd(data.matches);
      await db.scores.bulkAdd(data.scores);
      await db.fouls.bulkAdd(data.fouls);
    });
    return counts(data);
  },

  async storageStatus(): Promise<{supported: boolean; persisted: boolean; usage?: number; quota?: number}> {
    if (typeof navigator === 'undefined' || !navigator.storage) return { supported:false, persisted:false };
    const [persisted, estimate] = await Promise.all([
      navigator.storage.persisted?.() ?? Promise.resolve(false),
      navigator.storage.estimate?.() ?? Promise.resolve({})
    ]);
    return { supported:true, persisted:Boolean(persisted), usage:estimate.usage, quota:estimate.quota };
  },

  async requestPersistentStorage(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    return navigator.storage.persist();
  }
};
