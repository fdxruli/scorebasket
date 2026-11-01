// src/db/localBackup.service.ts
import { db } from './db';
import type { Team } from './models/Team';
import type { Player } from './models/Player';
import type { Match } from './models/Match';
import type { Score } from './models/Score';
import type { Foul } from './models/Foul';
import type { GameResult } from './models/MatchConfig';
import { validateMatchConfig } from '../config/validations';

export const LOCAL_BACKUP_FORMAT = 'scorebasket-local-backup';
export const LOCAL_BACKUP_VERSION = 1;

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

export class DatabaseNotEmptyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseNotEmptyError';
  }
}

export interface BackupData {
  teams: Team[];
  players: Player[];
  matches: Match[];
  scores: Score[];
  fouls: Foul[];
}

export type BackupCounts = Record<keyof BackupData, number>;

export interface BackupMetadata {
  counts: BackupCounts;
  checksum?: string;
}

export interface BackupEnvelope {
  format: typeof LOCAL_BACKUP_FORMAT;
  version: typeof LOCAL_BACKUP_VERSION;
  app: 'ScoreBasket';
  sourceSchemaVersion: number;
  exportedAt: string;
  metadata: BackupMetadata;
  data: BackupData;
}

export interface StorageStatus {
  supported: boolean;
  persisted: boolean;
  usage?: number;
  quota?: number;
  usageFormatted?: string;
  quotaFormatted?: string;
  percentUsed?: number;
}

const REQUIRED_TABLE_KEYS: readonly (keyof BackupData)[] = [
  'teams',
  'players',
  'matches',
  'scores',
  'fouls'
] as const;

/**
 * Calcula un checksum SHA-256 criptográfico para el contenido serializado.
 * Utiliza crypto.subtle cuando está disponible; en caso contrario, provee
 * un fallback determinista para entornos restringidos.
 */
export async function computeSha256(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto?.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fallback
    }
  }

  // Fallback FNV-1a 32-bit determinista
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function parseRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BackupValidationError(`El registro "${fieldName}" debe ser un objeto.`);
  }
  return value as Record<string, unknown>;
}

function parseValidId(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new BackupValidationError(`ID inválido en "${fieldName}". Se esperaba un entero positivo.`);
  }
  return value;
}

function parseValidDate(raw: unknown, fieldName: string): Date {
  if (raw instanceof Date) {
    if (!Number.isFinite(raw.getTime())) {
      throw new BackupValidationError(`Fecha inválida en "${fieldName}".`);
    }
    return raw;
  }

  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new BackupValidationError(`Fecha en "${fieldName}" no tiene formato serializable válido.`);
  }

  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new BackupValidationError(`Fecha inválida en "${fieldName}": ${String(raw)}.`);
  }
  return date;
}

function recoverDateFields<T>(
  row: T,
  dateFieldNames: readonly string[],
  recordLabel: string
): T {
  const record = parseRecord(row, recordLabel);
  const result: Record<string, unknown> = { ...record };

  for (const name of dateFieldNames) {
    const val = result[name];
    if (val !== undefined && val !== null) {
      result[name] = parseValidDate(val, `${recordLabel}.${name}`);
    }
  }

  return result as T;
}

function assertUniqueIds(rows: { id?: number }[], tableLabel: string): Set<number> {
  const ids = new Set<number>();
  for (const row of rows) {
    const id = parseValidId(row.id, `${tableLabel}.id`);
    if (ids.has(id)) {
      throw new BackupValidationError(`ID duplicado detectado en la tabla "${tableLabel}": #${id}.`);
    }
    ids.add(id);
  }
  return ids;
}

/**
 * Valida la estructura, tipos, relaciones, fechas y reglas de negocio del respaldo.
 * Aplica compatibilidad histórica no destructiva para migraciones anteriores (v2 - v7).
 */
export function validateAndNormalizeBackup(
  envelope: unknown,
  currentSchemaVersion: number = db.verno
): BackupData {
  const root = parseRecord(envelope, 'archivo');

  if (root.format !== LOCAL_BACKUP_FORMAT) {
    throw new BackupValidationError(
      `Formato de respaldo no reconocido: "${String(root.format)}". Se esperaba "${LOCAL_BACKUP_FORMAT}".`
    );
  }

  if (root.version !== LOCAL_BACKUP_VERSION) {
    throw new BackupValidationError(
      `Versión de formato de respaldo no soportada: ${String(root.version)}. Se esperaba versión ${LOCAL_BACKUP_VERSION}.`
    );
  }

  const sourceSchema = typeof root.sourceSchemaVersion === 'number'
    ? root.sourceSchemaVersion
    : currentSchemaVersion;

  if (sourceSchema > currentSchemaVersion) {
    throw new BackupValidationError(
      `El respaldo proviene de una versión de esquema posterior (${sourceSchema} > ${currentSchemaVersion}). Actualiza ScoreBasket antes de restaurar.`
    );
  }

  const rawData = parseRecord(root.data, 'data');
  for (const key of REQUIRED_TABLE_KEYS) {
    if (!Array.isArray(rawData[key])) {
      throw new BackupValidationError(`Respaldo incompleto: falta la tabla requerida "${key}".`);
    }
  }

  // 1. Deserializar fechas y normalizar modelos sin alterar campos originales
  const teams: Team[] = (rawData.teams as Team[]).map((row, idx) => {
    const recovered = recoverDateFields(row, ['createdAt', 'archivedAt'], `teams[${idx}]`);
    return {
      ...recovered,
      isArchived: recovered.isArchived ?? false
    };
  });

  const players: Player[] = (rawData.players as Player[]).map((row, idx) => {
    const recovered = recoverDateFields(row, ['createdAt', 'archivedAt'], `players[${idx}]`);
    return {
      ...recovered,
      isArchived: recovered.isArchived ?? false
    };
  });

  const matches: Match[] = (rawData.matches as Match[]).map((row, idx) => {
    const recovered = recoverDateFields(
      row,
      ['createdAt', 'finishedAt', 'timerLastStart'],
      `matches[${idx}]`
    );

    // Deserializar fechas anidadas en gameHistory
    let gameHistory: GameResult[] | undefined = undefined;
    if (recovered.gameHistory !== undefined) {
      if (!Array.isArray(recovered.gameHistory)) {
        throw new BackupValidationError(`matches[${idx}].gameHistory debe ser un arreglo de juegos.`);
      }
      gameHistory = recovered.gameHistory.map((game, gIdx) => {
        return recoverDateFields(game, ['finishedAt'], `matches[${idx}].gameHistory[${gIdx}]`);
      });
    }

    // Compatibilidad histórica para registros anteriores a v7
    let config = recovered.config;
    if (!config) {
      config = {
        mode: 'traditional',
        traditional: {
          totalQuarters: recovered.totalQuarters || 4,
          minutesPerQuarter: recovered.quarterDuration || 10
        }
      };
    }

    const match: Match = {
      ...recovered,
      config,
      ...(gameHistory !== undefined ? { gameHistory } : {}),
      localScore: recovered.localScore ?? 0,
      visitorScore: recovered.visitorScore ?? 0,
      localFouls: recovered.localFouls ?? 0,
      visitorFouls: recovered.visitorFouls ?? 0
    };

    return match;
  });

  const scores: Score[] = (rawData.scores as Score[]).map((row, idx) => {
    return recoverDateFields(row, ['createdAt'], `scores[${idx}]`);
  });

  const fouls: Foul[] = (rawData.fouls as Foul[]).map((row, idx) => {
    return recoverDateFields(row, ['createdAt'], `fouls[${idx}]`);
  });

  // 2. Unicidad e integridad de IDs primarios
  const teamIds = assertUniqueIds(teams, 'teams');
  const playerIds = assertUniqueIds(players, 'players');
  const matchIds = assertUniqueIds(matches, 'matches');
  assertUniqueIds(scores, 'scores');
  assertUniqueIds(fouls, 'fouls');

  const playerMap = new Map(players.map(p => [p.id!, p]));
  const matchMap = new Map(matches.map(m => [m.id!, m]));

  // 3. Validación relacional de jugadores -> equipos
  for (const player of players) {
    const teamId = parseValidId(player.teamId, `player[#${player.id}].teamId`);
    if (!teamIds.has(teamId)) {
      throw new BackupValidationError(
        `Relación inválida: el jugador "${player.name}" (#${player.id}) referencia al equipo inexistente #${teamId}.`
      );
    }
  }

  // 4. Validación de partidos
  const validStatuses = new Set(['created', 'playing', 'paused', 'finished']);
  for (const match of matches) {
    const localId = parseValidId(match.localTeamId, `match[#${match.id}].localTeamId`);
    const visitorId = parseValidId(match.visitorTeamId, `match[#${match.id}].visitorTeamId`);

    if (!teamIds.has(localId)) {
      throw new BackupValidationError(
        `Relación inválida: el partido #${match.id} referencia a un equipo local inexistente (#${localId}).`
      );
    }
    if (!teamIds.has(visitorId)) {
      throw new BackupValidationError(
        `Relación inválida: el partido #${match.id} referencia a un equipo visitante inexistente (#${visitorId}).`
      );
    }
    if (localId === visitorId) {
      throw new BackupValidationError(
        `Relación inválida: el partido #${match.id} tiene al mismo equipo como local y visitante (#${localId}).`
      );
    }

    if (!validStatuses.has(match.status)) {
      throw new BackupValidationError(
        `Estado deportivo inválido en el partido #${match.id}: "${match.status}".`
      );
    }

    const configValidation = validateMatchConfig(match.config);
    if (!configValidation.isValid) {
      throw new BackupValidationError(
        `Configuración deportiva inválida en el partido #${match.id}: ${configValidation.errors.join(', ')}.`
      );
    }

    for (const [fieldName, val] of [
      ['localScore', match.localScore],
      ['visitorScore', match.visitorScore],
      ['localFouls', match.localFouls],
      ['visitorFouls', match.visitorFouls]
    ] as const) {
      if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 0) {
        throw new BackupValidationError(
          `Contador deportivo inválido en partido #${match.id}: ${fieldName} debe ser un entero >= 0.`
        );
      }
    }

    if (match.gameHistory) {
      for (let gIdx = 0; gIdx < match.gameHistory.length; gIdx++) {
        const gh = match.gameHistory[gIdx];
        if (typeof gh.gameNumber !== 'number' || gh.gameNumber < 1) {
          throw new BackupValidationError(`Historial inválido en partido #${match.id}: gameNumber debe ser >= 1.`);
        }
        if (!['local', 'visitor', 'tie'].includes(gh.winner)) {
          throw new BackupValidationError(`Historial inválido en partido #${match.id}: ganador no reconocido.`);
        }
      }
    }
  }

  // 5. Validación relacional de acciones (scores y fouls)
  for (const score of scores) {
    const matchId = parseValidId(score.matchId, `score[#${score.id}].matchId`);
    if (!matchIds.has(matchId)) {
      throw new BackupValidationError(
        `Relación inválida: la anotación #${score.id} referencia a un partido inexistente (#${matchId}).`
      );
    }
    const match = matchMap.get(matchId)!;

    if (score.teamId !== match.localTeamId && score.teamId !== match.visitorTeamId) {
      throw new BackupValidationError(
        `Relación inválida: la anotación #${score.id} pertenece al equipo #${score.teamId}, que no participa en el partido #${matchId}.`
      );
    }

    if (!Number.isSafeInteger(score.quarter) || score.quarter < 1) {
      throw new BackupValidationError(`Periodo inválido en la anotación #${score.id}: debe ser un entero >= 1.`);
    }

    if (![1, 2, 3].includes(score.points)) {
      throw new BackupValidationError(`Puntuación inválida en la anotación #${score.id}: ${score.points} (debe ser 1, 2 o 3).`);
    }

    if (score.playerId !== undefined && score.playerId !== null) {
      const playerId = parseValidId(score.playerId, `score[#${score.id}].playerId`);
      if (!playerIds.has(playerId)) {
        throw new BackupValidationError(
          `Relación inválida: la anotación #${score.id} referencia al jugador inexistente #${playerId}.`
        );
      }
      const player = playerMap.get(playerId)!;
      if (player.teamId !== score.teamId) {
        throw new BackupValidationError(
          `Relación inválida: la anotación #${score.id} asigna puntos al jugador #${playerId} que pertenece al equipo #${player.teamId}, pero la anotación es para el equipo #${score.teamId}.`
        );
      }
    }
  }

  for (const foul of fouls) {
    const matchId = parseValidId(foul.matchId, `foul[#${foul.id}].matchId`);
    if (!matchIds.has(matchId)) {
      throw new BackupValidationError(
        `Relación inválida: la falta #${foul.id} referencia a un partido inexistente (#${matchId}).`
      );
    }
    const match = matchMap.get(matchId)!;

    if (foul.teamId !== match.localTeamId && foul.teamId !== match.visitorTeamId) {
      throw new BackupValidationError(
        `Relación inválida: la falta #${foul.id} pertenece al equipo #${foul.teamId}, que no participa en el partido #${matchId}.`
      );
    }

    if (!Number.isSafeInteger(foul.quarter) || foul.quarter < 1) {
      throw new BackupValidationError(`Periodo inválido en la falta #${foul.id}: debe ser un entero >= 1.`);
    }

    if (foul.playerId !== undefined && foul.playerId !== null) {
      const playerId = parseValidId(foul.playerId, `foul[#${foul.id}].playerId`);
      if (!playerIds.has(playerId)) {
        throw new BackupValidationError(
          `Relación inválida: la falta #${foul.id} referencia al jugador inexistente #${playerId}.`
        );
      }
      const player = playerMap.get(playerId)!;
      if (player.teamId !== foul.teamId) {
        throw new BackupValidationError(
          `Relación inválida: la falta #${foul.id} se registra para el jugador #${playerId} del equipo #${player.teamId}, pero la falta corresponde al equipo #${foul.teamId}.`
        );
      }
    }
  }

  return { teams, players, matches, scores, fouls };
}

function countRecords(data: BackupData): BackupCounts {
  return {
    teams: data.teams.length,
    players: data.players.length,
    matches: data.matches.length,
    scores: data.scores.length,
    fouls: data.fouls.length
  };
}

export const StoragePersistenceService = {
  async getStatus(): Promise<StorageStatus> {
    if (typeof navigator === 'undefined' || !navigator.storage) {
      return { supported: false, persisted: false };
    }

    try {
      const persisted = navigator.storage.persisted
        ? await navigator.storage.persisted()
        : false;

      let usage: number | undefined;
      let quota: number | undefined;

      if (navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        usage = estimate.usage;
        quota = estimate.quota;
      }

      const formatBytes = (bytes?: number) => {
        if (bytes === undefined || !Number.isFinite(bytes)) return undefined;
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
      };

      const percentUsed =
        usage !== undefined && quota !== undefined && quota > 0
          ? Math.round((usage / quota) * 10000) / 100
          : undefined;

      return {
        supported: true,
        persisted: Boolean(persisted),
        usage,
        quota,
        usageFormatted: formatBytes(usage),
        quotaFormatted: formatBytes(quota),
        percentUsed
      };
    } catch {
      return { supported: false, persisted: false };
    }
  },

  async requestPersistence(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
      return false;
    }
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
};

export const LocalBackupService = {
  /**
   * Exporta todos los registros de los 5 almacenes locales en una única
   * transacción de lectura consistente, calculando un checksum SHA-256.
   */
  async exportJson(): Promise<string> {
    const data = await db.transaction(
      'r',
      [db.teams, db.players, db.matches, db.scores, db.fouls],
      async (): Promise<BackupData> => {
        const [teams, players, matches, scores, fouls] = await Promise.all([
          db.teams.toArray(),
          db.players.toArray(),
          db.matches.toArray(),
          db.scores.toArray(),
          db.fouls.toArray()
        ]);
        return { teams, players, matches, scores, fouls };
      }
    );

    const counts = countRecords(data);
    const serializedData = JSON.stringify(data);
    const checksum = await computeSha256(serializedData);

    const envelope: BackupEnvelope = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: db.verno,
      exportedAt: new Date().toISOString(),
      metadata: {
        counts,
        checksum
      },
      data
    };

    return JSON.stringify(envelope, null, 2);
  },

  /**
   * Dispara la descarga del archivo de respaldo en el navegador.
   */
  async exportToFile(customFilename?: string): Promise<{ filename: string; counts: BackupCounts }> {
    const json = await this.exportJson();
    const parsed = JSON.parse(json) as BackupEnvelope;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const defaultFilename = `scorebasket-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
    const filename = customFilename || defaultFilename;

    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    return { filename, counts: parsed.metadata.counts };
  },

  /**
   * Comprueba si la base de datos local está completamente vacía.
   */
  async isDatabaseEmpty(): Promise<boolean> {
    const counts = await Promise.all([
      db.teams.count(),
      db.players.count(),
      db.matches.count(),
      db.scores.count(),
      db.fouls.count()
    ]);
    return counts.every(c => c === 0);
  },

  /**
   * Obtiene el resumen de registros actuales en los 5 almacenes locales.
   */
  async getDatabaseCounts(): Promise<BackupCounts> {
    const [teams, players, matches, scores, fouls] = await Promise.all([
      db.teams.count(),
      db.players.count(),
      db.matches.count(),
      db.scores.count(),
      db.fouls.count()
    ]);
    return { teams, players, matches, scores, fouls };
  },

  /**
   * Restaura un respaldo JSON estrictamente sobre una base de datos vacía.
   * Valida envelope, formato, checksum, relaciones, fechas y modalidades ANTES
   * de escribir. La escritura es 100% transaccional y atómica; cualquier falla
   * provoca rollback total automático en IndexedDB.
   */
  async restoreIntoEmpty(
    rawJson: string,
    options?: { _faultInjectionAtTable?: keyof BackupData }
  ): Promise<BackupCounts> {
    // 1. Deserializar JSON
    let envelope: unknown;
    try {
      envelope = JSON.parse(rawJson);
    } catch {
      throw new BackupValidationError('El contenido provisto no es un JSON válido.');
    }

    // 2. Verificar suma de integridad (checksum) si está presente
    const root = parseRecord(envelope, 'archivo');
    if (root.metadata && typeof root.metadata === 'object' && !Array.isArray(root.metadata)) {
      const meta = root.metadata as Record<string, unknown>;
      if (typeof meta.checksum === 'string' && root.data) {
        const computedChecksum = await computeSha256(JSON.stringify(root.data));
        if (computedChecksum !== meta.checksum) {
          throw new BackupValidationError(
            'La suma de verificación (checksum) del archivo no coincide con los datos. El archivo está incompleto o fue modificado externamente.'
          );
        }
      }
    }

    // 3. Validar y normalizar los datos
    const normalizedData = validateAndNormalizeBackup(envelope, db.verno);

    // 4. Verificación previa fuera de la transacción
    const preCheckEmpty = await this.isDatabaseEmpty();
    if (!preCheckEmpty) {
      throw new DatabaseNotEmptyError(
        'Restauración bloqueada: la base de datos local contiene datos existentes. ' +
        'Para evitar pérdida accidental de información o sobreescritura, la restauración requiere una base de datos completamente vacía.'
      );
    }

    // 5. Escritura atómica en transacción multi-tabla
    await db.transaction('rw', [db.teams, db.players, db.matches, db.scores, db.fouls], async () => {
      // Re-verificar vaciado dentro del bloqueo transaccional (protección contra carreras concurrentes)
      const existing = await Promise.all([
        db.teams.count(),
        db.players.count(),
        db.matches.count(),
        db.scores.count(),
        db.fouls.count()
      ]);
      if (existing.some(c => c > 0)) {
        throw new DatabaseNotEmptyError(
          'Restauración bloqueada: se detectaron registros concurrentes en la base de datos local.'
        );
      }

      // Inserción preservando identificadores originales
      if (options?._faultInjectionAtTable === 'teams') {
        throw new Error('Simulated failure during teams bulkAdd');
      }
      await db.teams.bulkAdd(normalizedData.teams);

      if (options?._faultInjectionAtTable === 'players') {
        throw new Error('Simulated failure during players bulkAdd');
      }
      await db.players.bulkAdd(normalizedData.players);

      if (options?._faultInjectionAtTable === 'matches') {
        throw new Error('Simulated failure during matches bulkAdd');
      }
      await db.matches.bulkAdd(normalizedData.matches);

      if (options?._faultInjectionAtTable === 'scores') {
        throw new Error('Simulated failure during scores bulkAdd');
      }
      await db.scores.bulkAdd(normalizedData.scores);

      if (options?._faultInjectionAtTable === 'fouls') {
        throw new Error('Simulated failure during fouls bulkAdd');
      }
      await db.fouls.bulkAdd(normalizedData.fouls);
    });

    return countRecords(normalizedData);
  },

  /**
   * Consulta el estado de persistencia y cuota del navegador.
   */
  async storageStatus(): Promise<StorageStatus> {
    return StoragePersistenceService.getStatus();
  },

  /**
   * Solicita almacenamiento persistente al navegador.
   */
  async requestPersistentStorage(): Promise<boolean> {
    return StoragePersistenceService.requestPersistence();
  }
};
