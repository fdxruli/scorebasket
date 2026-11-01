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
  checksum: string;
  checksumAlgorithm: 'SHA-256';
  generatedBy: string;
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
 * Constantes K de la especificación FIPS 180-4 (SHA-256).
 */
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

/**
 * Implementación determinista pura de SHA-256 (FIPS 180-4) en TypeScript.
 * Garantiza que el cálculo del checksum produzca exactamente los mismos
 * 256 bits (64 caracteres hexadecimales) en cualquier navegador, entorno
 * sin `crypto.subtle`, Web Worker o runtime de pruebas.
 */
export function computePureSha256(bytes: Uint8Array): string {
  let H0 = 0x6a09e667, H1 = 0xbb67ae85, H2 = 0x3c6ef372, H3 = 0xa54ff53a;
  let H4 = 0x510e527f, H5 = 0x9b05688c, H6 = 0x1f83d9ab, H7 = 0x5be0cd19;

  const l = bytes.length;
  const bitLen = l * 8;
  const padLen = (l % 64 < 56) ? (56 - (l % 64)) : (120 - (l % 64));
  const totalLen = l + padLen + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[l] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 4, bitLen >>> 0);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000));

  const W = new Uint32Array(64);
  const rotr = (n: number, b: number) => (n >>> b) | (n << (32 - b));

  for (let i = 0; i < totalLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = view.getUint32(i + t * 4);
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }

    let a = H0, b = H1, c = H2, d = H3, e = H4, f = H5, g = H6, h = H7;

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = (h + S1 + ch + SHA256_K[t] + W[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H0 = (H0 + a) >>> 0;
    H1 = (H1 + b) >>> 0;
    H2 = (H2 + c) >>> 0;
    H3 = (H3 + d) >>> 0;
    H4 = (H4 + e) >>> 0;
    H5 = (H5 + f) >>> 0;
    H6 = (H6 + g) >>> 0;
    H7 = (H7 + h) >>> 0;
  }

  const out = [H0, H1, H2, H3, H4, H5, H6, H7];
  return out.map(n => n.toString(16).padStart(8, '0')).join('');
}

/**
 * Calcula un checksum SHA-256 determinista para el contenido serializado.
 * Utiliza Web Crypto cuando está disponible por aceleración por hardware;
 * si no existe o falla, recurre a `computePureSha256`, garantizando
 * EXACTAMENTE el mismo valor hexadecimal en cualquier entorno.
 */
export async function computeDataChecksum(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);

  if (typeof crypto !== 'undefined' && crypto?.subtle?.digest) {
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Si crypto.subtle lanza error imprevisto, se ejecuta el cálculo puro FIPS
    }
  }

  return computePureSha256(data);
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
 * Aplica compatibilidad histórica no destructiva para esquemas v2 - v7 y
 * resuelve la seguridad temporal ante la restauración de partidos con cronómetro en marcha.
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

  const rawScores = rawData.scores as Score[];
  const rawFouls = rawData.fouls as Foul[];

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

    // Compatibilidad histórica para marcadores desnormalizados anteriores a v6:
    // Si el registro legacy no contenía localScore/visitorScore, agregamos desde scores y fouls del respaldo
    let localScore = recovered.localScore;
    let visitorScore = recovered.visitorScore;
    let localFouls = recovered.localFouls;
    let visitorFouls = recovered.visitorFouls;

    if (localScore === undefined && recovered.id !== undefined) {
      localScore = rawScores
        .filter(s => s.matchId === recovered.id && s.teamId === recovered.localTeamId)
        .reduce((acc, curr) => acc + (curr.points || 0), 0);
    }
    if (visitorScore === undefined && recovered.id !== undefined) {
      visitorScore = rawScores
        .filter(s => s.matchId === recovered.id && s.teamId === recovered.visitorTeamId)
        .reduce((acc, curr) => acc + (curr.points || 0), 0);
    }
    if (localFouls === undefined && recovered.id !== undefined) {
      localFouls = rawFouls
        .filter(f => f.matchId === recovered.id && f.teamId === recovered.localTeamId).length;
    }
    if (visitorFouls === undefined && recovered.id !== undefined) {
      visitorFouls = rawFouls
        .filter(f => f.matchId === recovered.id && f.teamId === recovered.visitorTeamId).length;
    }

    const match: Match = {
      ...recovered,
      config,
      ...(gameHistory !== undefined ? { gameHistory } : {}),
      localScore: localScore ?? 0,
      visitorScore: visitorScore ?? 0,
      localFouls: localFouls ?? 0,
      visitorFouls: visitorFouls ?? 0
    };

    // SEGURIDAD Y AUTORIDAD TEMPORAL EN PARTIDOS ACTIVOS:
    // Si el partido fue respaldado mientras el cronómetro estaba corriendo (timerLastStart definido),
    // la referencia física de reloj de la sesión anterior no existe en la máquina o pestaña destino.
    // Para evitar que la proyección temporal descuente horas/días acumulados y vacíe el cuarto a 00:00:
    // 1. Se detiene el cronómetro preventivamente (timerLastStart = undefined).
    // 2. Se preservan intactos los segundos restantes exactos (timerSecondsRemaining).
    // 3. Se limpian los identificadores de pestaña y contratos de lease obsoletos.
    // 4. Se establece `timerRecoveryState: 'recovery_required'` para que TraditionalEngine
    //    despliegue el panel de confirmación y ajuste manual del árbitro (Fase 2C C-29 / C-31).
    if (recovered.timerLastStart !== undefined && match.status !== 'finished') {
      match.timerLastStart = undefined;
      match.timerOwnerTabId = undefined;
      match.timerLeaseExpiresAt = 0;
      match.timerLockMode = undefined;
      match.timerRecoveryState = 'recovery_required';
      match.timerRecoveryReason =
        'Partido restaurado desde respaldo con cronómetro en marcha. Tiempo detenido preventivamente para evitar salto anómalo.';
    }

    return match;
  });

  const scores: Score[] = rawScores.map((row, idx) => {
    return recoverDateFields(row, ['createdAt'], `scores[${idx}]`);
  });

  const fouls: Foul[] = rawFouls.map((row, idx) => {
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
   * transacción de lectura consistente, calculando un checksum SHA-256 estándar.
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
    const rawHash = await computeDataChecksum(serializedData);
    const checksum = `sha256:${rawHash}`;

    const envelope: BackupEnvelope = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: db.verno,
      exportedAt: new Date().toISOString(),
      metadata: {
        counts,
        checksum,
        checksumAlgorithm: 'SHA-256',
        generatedBy: 'ScoreBasket LocalBackupService v1'
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
   * Valida envelope, formato, checksum SHA-256, relaciones, fechas y modalidades
   * ANTES de escribir. La escritura es 100% transaccional y atómica; cualquier falla
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
        const serializedPayload = JSON.stringify(root.data);
        const actualChecksum = meta.checksum;

        if (actualChecksum.startsWith('sha256:')) {
          const rawHash = actualChecksum.slice('sha256:'.length);
          const computed = await computeDataChecksum(serializedPayload);
          if (computed !== rawHash) {
            throw new BackupValidationError(
              'La suma de verificación SHA-256 no coincide con los datos del respaldo. El archivo está incompleto o fue alterado.'
            );
          }
        } else if (actualChecksum.startsWith('fnv1a:')) {
          // Compatibilidad con respaldos emitidos en versiones de desarrollo tempranas
          let hash = 0x811c9dc5;
          for (let i = 0; i < serializedPayload.length; i++) {
            hash ^= serializedPayload.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
          }
          const computedFnv = `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
          if (computedFnv !== actualChecksum) {
            throw new BackupValidationError(
              'La suma de verificación FNV-1a no coincide con los datos del respaldo.'
            );
          }
        } else {
          // Si el hash no tiene prefijo, se evalúa contra SHA-256 directo
          const computed = await computeDataChecksum(serializedPayload);
          if (computed !== actualChecksum) {
            throw new BackupValidationError(
              'La suma de verificación del archivo no coincide con los datos. El archivo está corrupto o fue modificado externamente.'
            );
          }
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
