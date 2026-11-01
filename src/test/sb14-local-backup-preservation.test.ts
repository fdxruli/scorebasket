// src/test/sb14-local-backup-preservation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db';
import {
  LocalBackupService,
  StoragePersistenceService,
  BackupValidationError,
  DatabaseNotEmptyError,
  LOCAL_BACKUP_FORMAT,
  LOCAL_BACKUP_VERSION,
  computePureSha256,
  computeDataChecksum,
  computeEnvelopeChecksum,
  type CanonicalBackupEnvelope,
  type BackupEnvelope,
  type BackupData,
  type BackupMetadata,
  type BackupCounts
} from '../db/localBackup.service';
import { GameActionsRepository } from '../db/gameActions.repository';
import { MatchTimerService } from '../db/matchTimer.service';
import type { Match, Team, Player, Score, Foul } from '../db/models';

/**
 * Función auxiliar para generar respaldos de prueba íntegros y válidos,
 * calculando automáticamente los conteos del manifiesto y la suma SHA-256 canónica del sobre completo.
 */
async function buildTestBackup(
  data: Partial<BackupData>,
  metaOverrides?: Partial<BackupMetadata>,
  rootOverrides?: Record<string, unknown>
): Promise<string> {
  const fullData: BackupData = {
    teams: data.teams ?? [],
    players: data.players ?? [],
    matches: data.matches ?? [],
    scores: data.scores ?? [],
    fouls: data.fouls ?? []
  };

  const counts: BackupCounts = {
    teams: fullData.teams.length,
    players: fullData.players.length,
    matches: fullData.matches.length,
    scores: fullData.scores.length,
    fouls: fullData.fouls.length
  };

  const format = (rootOverrides?.format as string) ?? LOCAL_BACKUP_FORMAT;
  const version = (rootOverrides?.version as number) ?? LOCAL_BACKUP_VERSION;
  const app = (rootOverrides?.app as string) ?? 'ScoreBasket';
  const sourceSchemaVersion = (rootOverrides?.sourceSchemaVersion as number) ?? 8;
  const exportedAt = (rootOverrides?.exportedAt as string) ?? new Date().toISOString();

  const canonicalPayload: CanonicalBackupEnvelope = {
    app,
    counts: metaOverrides?.counts ?? counts,
    data: fullData,
    exportedAt,
    format,
    sourceSchemaVersion,
    version
  };

  const defaultChecksum = await computeEnvelopeChecksum(canonicalPayload);

  const envelope = {
    format,
    version,
    app,
    sourceSchemaVersion,
    exportedAt,
    metadata: {
      counts,
      checksumAlgorithm: 'SHA-256',
      checksum: defaultChecksum,
      generatedBy: 'ScoreBasket Test Helper',
      ...metaOverrides
    },
    data: fullData,
    ...rootOverrides
  };

  return JSON.stringify(envelope);
}

describe('DB-F1: Conservación, Respaldo y Recuperación Local (QA-01 a QA-38)', () => {
  beforeEach(async () => {
    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();
  });

  // QA-01: Respaldo de base vacía
  it('QA-01: Respaldo de base vacía genera un envelope válido y estructurado con contadores en cero', async () => {
    const json = await LocalBackupService.exportJson();
    expect(typeof json).toBe('string');

    const envelope = JSON.parse(json) as BackupEnvelope;
    expect(envelope.format).toBe(LOCAL_BACKUP_FORMAT);
    expect(envelope.version).toBe(LOCAL_BACKUP_VERSION);
    expect(envelope.app).toBe('ScoreBasket');
    expect(envelope.sourceSchemaVersion).toBe(db.verno);
    expect(envelope.metadata.counts).toEqual({
      teams: 0,
      players: 0,
      matches: 0,
      scores: 0,
      fouls: 0
    });
    expect(envelope.data.teams).toEqual([]);
    expect(envelope.data.matches).toEqual([]);
  });

  // QA-02: Respaldo con múltiples equipos y jugadores
  it('QA-02: Respaldo con múltiples equipos y jugadores conserva todos los campos', async () => {
    const team1Id = (await db.teams.add({
      name: 'Lakers',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      isArchived: false
    })) as number;

    const team2Id = (await db.teams.add({
      name: 'Celtics',
      createdAt: new Date('2026-01-01T11:00:00Z'),
      isArchived: false
    })) as number;

    const p1Id = (await db.players.add({
      name: 'LeBron James',
      number: 23,
      teamId: team1Id,
      createdAt: new Date('2026-01-01T10:05:00Z'),
      isArchived: false
    })) as number;

    const p2Id = (await db.players.add({
      name: 'Jayson Tatum',
      number: 0, // Dorsal cero (válido en baloncesto)
      teamId: team2Id,
      createdAt: new Date('2026-01-01T11:05:00Z'),
      isArchived: false
    })) as number;

    const json = await LocalBackupService.exportJson();
    const envelope = JSON.parse(json) as BackupEnvelope;

    expect(envelope.metadata.counts.teams).toBe(2);
    expect(envelope.metadata.counts.players).toBe(2);

    const exportedP2 = envelope.data.players.find(p => p.id === p2Id);
    expect(exportedP2?.number).toBe(0);
    expect(exportedP2?.teamId).toBe(team2Id);
    expect(envelope.data.teams.some(t => t.id === team1Id)).toBe(true);
    expect(envelope.data.players.some(p => p.id === p1Id)).toBe(true);
  });

  // QA-03: Respaldo de partidos Traditional
  it('QA-03: Respaldo de partidos Traditional preserva temporizador, autoridad y configuraciones deportivas', async () => {
    const team1Id = (await db.teams.add({ name: 'T1', createdAt: new Date() })) as number;
    const team2Id = (await db.teams.add({ name: 'T2', createdAt: new Date() })) as number;

    const matchId = (await db.matches.add({
      localTeamId: team1Id,
      visitorTeamId: team2Id,
      status: 'playing',
      createdAt: new Date('2026-02-01T18:00:00Z'),
      config: {
        mode: 'traditional',
        traditional: {
          totalQuarters: 4,
          minutesPerQuarter: 12,
          timeoutsPerTeam: 3
        }
      },
      currentQuarter: 2,
      timerSecondsRemaining: 450,
      timerLastStart: new Date('2026-02-01T18:15:00Z'),
      possession: 'local',
      localTimeouts: 1,
      visitorTimeouts: 0,
      timerEpoch: 7,
      timerOwnerTabId: 'tab-alpha-99',
      timerLeaseExpiresAt: Date.now() + 10000,
      timerRecoveryState: 'normal',
      eventsProvenance: 'live_session',
      localScore: 28,
      visitorScore: 24,
      localFouls: 3,
      visitorFouls: 4
    })) as number;

    const json = await LocalBackupService.exportJson();
    const envelope = JSON.parse(json) as BackupEnvelope;
    const exportedMatch = envelope.data.matches.find(m => m.id === matchId);

    expect(exportedMatch).toBeDefined();
    expect(exportedMatch?.config.mode).toBe('traditional');
    expect(exportedMatch?.config.traditional?.totalQuarters).toBe(4);
    expect(exportedMatch?.config.traditional?.minutesPerQuarter).toBe(12);
    expect(exportedMatch?.timerSecondsRemaining).toBe(450);
    expect(exportedMatch?.possession).toBe('local');
    expect(exportedMatch?.timerEpoch).toBe(7);
    expect(exportedMatch?.timerOwnerTabId).toBe('tab-alpha-99');
    expect(exportedMatch?.eventsProvenance).toBe('live_session');
    expect(exportedMatch?.localScore).toBe(28);
    expect(exportedMatch?.visitorScore).toBe(24);
  });

  // QA-04: Respaldo de partidas Race con revanchas
  it('QA-04: Respaldo de partidas Race con revanchas preserva targetScore, hasRematches e historial', async () => {
    const team1Id = (await db.teams.add({ name: 'Street A', createdAt: new Date() })) as number;
    const team2Id = (await db.teams.add({ name: 'Street B', createdAt: new Date() })) as number;

    const matchId = (await db.matches.add({
      localTeamId: team1Id,
      visitorTeamId: team2Id,
      status: 'playing',
      createdAt: new Date('2026-03-01T16:00:00Z'),
      config: {
        mode: 'race',
        race: {
          targetScore: 21,
          hasRematches: true,
          currentGame: 2,
          winByTwo: true,
          scoringSystem: 'street'
        }
      },
      localScore: 5,
      visitorScore: 2,
      localFouls: 1,
      visitorFouls: 0,
      gameHistory: [
        {
          gameNumber: 1,
          localScore: 22,
          visitorScore: 20,
          winner: 'local',
          finishedAt: new Date('2026-03-01T16:20:00Z'),
          duration: 1200
        }
      ]
    })) as number;

    const json = await LocalBackupService.exportJson();
    const envelope = JSON.parse(json) as BackupEnvelope;
    const exportedMatch = envelope.data.matches.find(m => m.id === matchId);

    expect(exportedMatch?.config.mode).toBe('race');
    expect(exportedMatch?.config.race?.targetScore).toBe(21);
    expect(exportedMatch?.config.race?.hasRematches).toBe(true);
    expect(exportedMatch?.config.race?.currentGame).toBe(2);
    expect(exportedMatch?.config.race?.scoringSystem).toBe('street');
    expect(exportedMatch?.gameHistory?.length).toBe(1);
    expect(exportedMatch?.gameHistory?.[0].winner).toBe('local');
    expect(exportedMatch?.gameHistory?.[0].localScore).toBe(22);
  });

  // QA-05: Respaldo de Best-of-Series con varios sets
  it('QA-05: Respaldo de Best-of-Series con varios sets conserva estadísticas de serie completas', async () => {
    const team1Id = (await db.teams.add({ name: 'Series A', createdAt: new Date() })) as number;
    const team2Id = (await db.teams.add({ name: 'Series B', createdAt: new Date() })) as number;

    const matchId = (await db.matches.add({
      localTeamId: team1Id,
      visitorTeamId: team2Id,
      status: 'finished',
      createdAt: new Date('2026-04-01T10:00:00Z'),
      finishedAt: new Date('2026-04-01T12:00:00Z'),
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 15,
          currentGame: 3,
          wins: { local: 2, visitor: 1 }
        }
      },
      localScore: 15,
      visitorScore: 11,
      localFouls: 2,
      visitorFouls: 3,
      gameHistory: [
        {
          gameNumber: 1,
          localScore: 15,
          visitorScore: 12,
          winner: 'local',
          finishedAt: new Date('2026-04-01T10:30:00Z')
        },
        {
          gameNumber: 2,
          localScore: 10,
          visitorScore: 15,
          winner: 'visitor',
          finishedAt: new Date('2026-04-01T11:15:00Z')
        },
        {
          gameNumber: 3,
          localScore: 15,
          visitorScore: 11,
          winner: 'local',
          finishedAt: new Date('2026-04-01T11:55:00Z')
        }
      ]
    })) as number;

    const json = await LocalBackupService.exportJson();
    const envelope = JSON.parse(json) as BackupEnvelope;
    const exportedMatch = envelope.data.matches.find(m => m.id === matchId);

    expect(exportedMatch?.config.mode).toBe('best-of-series');
    expect(exportedMatch?.config.bestOf?.wins).toEqual({ local: 2, visitor: 1 });
    expect(exportedMatch?.gameHistory?.length).toBe(3);
    expect(exportedMatch?.status).toBe('finished');
  });

  // QA-06: Conservación de IDs originales
  it('QA-06: La restauración sobre base vacía preserva exactamente los IDs primarios originales', async () => {
    const rawBackup = await buildTestBackup({
      teams: [
        { id: 42, name: 'Team 42', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 99, name: 'Team 99', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      players: [
        { id: 105, name: 'Player 105', number: 7, teamId: 42, createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      matches: [
        {
          id: 777,
          localTeamId: 42,
          visitorTeamId: 99,
          status: 'playing',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
          localScore: 3,
          visitorScore: 0,
          localFouls: 1,
          visitorFouls: 0
        }
      ],
      scores: [
        { id: 9001, matchId: 777, teamId: 42, playerId: 105, points: 3, quarter: 1, createdAt: new Date('2026-01-01T00:01:00Z') }
      ],
      fouls: [
        { id: 8001, matchId: 777, teamId: 42, playerId: 105, quarter: 1, createdAt: new Date('2026-01-01T00:02:00Z') }
      ]
    });

    await LocalBackupService.restoreIntoEmpty(rawBackup);

    const restoredTeam42 = await db.teams.get(42);
    expect(restoredTeam42?.name).toBe('Team 42');

    const restoredPlayer105 = await db.players.get(105);
    expect(restoredPlayer105?.id).toBe(105);
    expect(restoredPlayer105?.teamId).toBe(42);

    const restoredMatch777 = await db.matches.get(777);
    expect(restoredMatch777?.id).toBe(777);

    const restoredScore = await db.scores.get(9001);
    expect(restoredScore?.id).toBe(9001);
    expect(restoredScore?.matchId).toBe(777);

    const restoredFoul = await db.fouls.get(8001);
    expect(restoredFoul?.id).toBe(8001);
    expect(restoredFoul?.matchId).toBe(777);
  });

  // QA-07: Conservación de relaciones
  it('QA-07: Conservación de relaciones foráneas entre equipos, jugadores, partidos y eventos', async () => {
    const tLocal = (await db.teams.add({ name: 'Alpha', createdAt: new Date() })) as number;
    const tVisitor = (await db.teams.add({ name: 'Beta', createdAt: new Date() })) as number;
    const player = (await db.players.add({ name: 'Shooter', teamId: tLocal, createdAt: new Date() })) as number;

    const match = (await db.matches.add({
      localTeamId: tLocal,
      visitorTeamId: tVisitor,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
      localScore: 2,
      visitorScore: 0,
      localFouls: 1,
      visitorFouls: 0
    })) as number;

    const score = (await db.scores.add({
      matchId: match,
      teamId: tLocal,
      playerId: player,
      points: 2,
      quarter: 1,
      createdAt: new Date()
    })) as number;

    const foul = (await db.fouls.add({
      matchId: match,
      teamId: tLocal,
      playerId: player,
      quarter: 1,
      createdAt: new Date()
    })) as number;

    const json = await LocalBackupService.exportJson();

    // Vaciar y restaurar
    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();

    await LocalBackupService.restoreIntoEmpty(json);

    const rScore = await db.scores.get(score);
    const rFoul = await db.fouls.get(foul);
    const rMatch = await db.matches.get(match);
    const rPlayer = await db.players.get(player);

    expect(rScore?.matchId).toBe(rMatch?.id);
    expect(rScore?.teamId).toBe(rMatch?.localTeamId);
    expect(rScore?.playerId).toBe(rPlayer?.id);

    expect(rFoul?.matchId).toBe(rMatch?.id);
    expect(rFoul?.teamId).toBe(rMatch?.localTeamId);
    expect(rFoul?.playerId).toBe(rPlayer?.id);
  });

  // QA-08: Conservación de jugadores archivados
  it('QA-08: Conservación de jugadores y equipos archivados con fecha archivedAt intacta', async () => {
    const archiveDate = new Date('2026-05-10T12:00:00Z');
    const teamId = (await db.teams.add({
      name: 'Archived Team',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      isArchived: true,
      archivedAt: archiveDate
    })) as number;

    const playerId = (await db.players.add({
      name: 'Retired Veteran',
      teamId,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      isArchived: true,
      archivedAt: archiveDate
    })) as number;

    const json = await LocalBackupService.exportJson();

    await db.teams.clear();
    await db.players.clear();

    await LocalBackupService.restoreIntoEmpty(json);

    const restoredTeam = await db.teams.get(teamId);
    expect(restoredTeam?.isArchived).toBe(true);
    expect(restoredTeam?.archivedAt?.toISOString()).toBe(archiveDate.toISOString());
    expect(restoredTeam?.archivedAt instanceof Date).toBe(true);

    const restoredPlayer = await db.players.get(playerId);
    expect(restoredPlayer?.isArchived).toBe(true);
    expect(restoredPlayer?.archivedAt?.toISOString()).toBe(archiveDate.toISOString());
    expect(restoredPlayer?.archivedAt instanceof Date).toBe(true);
  });

  // QA-09: Conservación de fechas
  it('QA-09: Las fechas se deserializan estrictamente como instancias nativas de Date (incluyendo fechas anidadas)', async () => {
    const rawBackup = await buildTestBackup({
      teams: [
        { id: 1, name: 'T1', createdAt: new Date('2026-01-15T08:30:00.000Z'), archivedAt: new Date('2026-01-15T09:00:00.000Z'), isArchived: true },
        { id: 2, name: 'T2', createdAt: new Date('2026-01-15T08:35:00.000Z'), isArchived: false }
      ],
      players: [],
      matches: [
        {
          id: 10,
          localTeamId: 1,
          visitorTeamId: 2,
          status: 'finished',
          createdAt: new Date('2026-01-15T09:00:00.000Z'),
          finishedAt: new Date('2026-01-15T10:15:00.000Z'),
          config: { mode: 'race', race: { targetScore: 10, hasRematches: false, currentGame: 1 } },
          localScore: 10,
          visitorScore: 8,
          localFouls: 0,
          visitorFouls: 0,
          gameHistory: [
            {
              gameNumber: 1,
              localScore: 10,
              visitorScore: 8,
              winner: 'local',
              finishedAt: new Date('2026-01-15T10:14:55.000Z')
            }
          ]
        }
      ],
      scores: [],
      fouls: []
    });

    await LocalBackupService.restoreIntoEmpty(rawBackup);

    const team = (await db.teams.get(1))!;
    expect(team.createdAt instanceof Date).toBe(true);
    expect(team.archivedAt instanceof Date).toBe(true);

    const match = (await db.matches.get(10))!;
    expect(match.createdAt instanceof Date).toBe(true);
    expect(match.finishedAt instanceof Date).toBe(true);
    expect(match.gameHistory?.[0].finishedAt instanceof Date).toBe(true);
    expect(match.createdAt.getTime()).toBe(new Date('2026-01-15T09:00:00.000Z').getTime());
    expect(match.gameHistory?.[0].finishedAt?.getTime()).toBe(
      new Date('2026-01-15T10:14:55.000Z').getTime()
    );
  });

  // QA-10: Conservación de marcadores y faltas
  it('QA-10: Conservación exacta de marcadores y faltas desnormalizados e históricos sin recálculos', async () => {
    const t1 = (await db.teams.add({ name: 'T1', createdAt: new Date() })) as number;
    const t2 = (await db.teams.add({ name: 'T2', createdAt: new Date() })) as number;

    const matchId = (await db.matches.add({
      localTeamId: t1,
      visitorTeamId: t2,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
      localScore: 55,
      visitorScore: 48,
      localFouls: 6,
      visitorFouls: 4
    })) as number;

    const json = await LocalBackupService.exportJson();
    await db.matches.clear();
    await db.teams.clear();

    await LocalBackupService.restoreIntoEmpty(json);

    const restoredMatch = (await db.matches.get(matchId))!;
    expect(restoredMatch.localScore).toBe(55);
    expect(restoredMatch.visitorScore).toBe(48);
    expect(restoredMatch.localFouls).toBe(6);
    expect(restoredMatch.visitorFouls).toBe(4);
  });

  // QA-11: Rechazo de archivo malformado
  it('QA-11: Rechaza archivos corruptos, JSON inválido o con suma de verificación (checksum) alterada', async () => {
    // 1. JSON no parseable
    await expect(LocalBackupService.restoreIntoEmpty('{ not a valid json: ...'))
      .rejects.toThrow(BackupValidationError);

    // 2. Falta de envoltorio o campos requeridos
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify({ someKey: 'invalid' })))
      .rejects.toThrow(BackupValidationError);

    // 3. Envelope con checksum alterado
    const validJson = await LocalBackupService.exportJson();
    const envelope = JSON.parse(validJson) as BackupEnvelope;
    envelope.metadata.checksum = 'tampered_or_invalid_checksum_hash';

    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(envelope)))
      .rejects.toThrow(/checksum|suma de verificación/i);
  });

  // QA-12: Rechazo de respaldo de versión incompatible sin pérdida de datos
  it('QA-12: Rechaza respaldos generados por esquemas posteriores sin tocar la base local', async () => {
    const futureEnvelope = await buildTestBackup({}, undefined, { sourceSchemaVersion: 999 });

    await expect(LocalBackupService.restoreIntoEmpty(futureEnvelope))
      .rejects.toThrow(/versión de esquema posterior/i);
  });

  // QA-13: Rechazo de IDs duplicados
  it('QA-13: Rechaza respaldos que contengan IDs duplicados en cualquier almacén', async () => {
    const envelopeDuplicateTeams = await buildTestBackup({
      teams: [
        { id: 1, name: 'Team One', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 1, name: 'Team Duplicate', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ]
    });

    await expect(LocalBackupService.restoreIntoEmpty(envelopeDuplicateTeams))
      .rejects.toThrow(/ID duplicado/i);
  });

  // QA-14: Detección de relaciones inválidas
  it('QA-14: Rechaza respaldos con relaciones foráneas rotas o huérfanas', async () => {
    // Jugador referencia a un equipo inexistente
    const brokenPlayer = await buildTestBackup({
      teams: [{ id: 1, name: 'Valid Team', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }],
      players: [{ id: 10, name: 'Orphan Player', number: 5, teamId: 999, createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }]
    });

    await expect(LocalBackupService.restoreIntoEmpty(brokenPlayer))
      .rejects.toThrow(/Relación inválida.*inexistente/i);

    // Partido con mismo equipo local y visitante
    const sameTeamMatch = await buildTestBackup({
      teams: [{ id: 1, name: 'Team One', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }],
      matches: [
        {
          id: 5,
          localTeamId: 1,
          visitorTeamId: 1, // Mismo equipo
          status: 'playing',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
          localScore: 0,
          visitorScore: 0,
          localFouls: 0,
          visitorFouls: 0
        }
      ]
    });

    await expect(LocalBackupService.restoreIntoEmpty(sameTeamMatch))
      .rejects.toThrow(/mismo equipo/i);
  });

  // QA-15: Rechazo de restauración sobre una base no vacía
  it('QA-15: Rechaza terminantemente restaurar sobre una base de datos que ya contiene registros', async () => {
    // Insertar un equipo preexistente
    await db.teams.add({ name: 'Existing Team', createdAt: new Date() });

    const validJson = await LocalBackupService.exportJson();

    await expect(LocalBackupService.restoreIntoEmpty(validJson))
      .rejects.toThrow(DatabaseNotEmptyError);
  });

  // QA-16: Rollback de una restauración que falla durante su ejecución
  it('QA-16: Atomicidad transaccional: una falla durante la restauración revierte todas las tablas al estado vacío', async () => {
    const rawBackup = await buildTestBackup({
      teams: [
        { id: 1, name: 'Team A', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 2, name: 'Team B', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      players: [
        { id: 10, name: 'Player A1', number: 10, teamId: 1, createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      matches: [
        {
          id: 100,
          localTeamId: 1,
          visitorTeamId: 2,
          status: 'playing',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
          localScore: 2,
          visitorScore: 0,
          localFouls: 0,
          visitorFouls: 0
        }
      ],
      scores: [
        { id: 500, matchId: 100, teamId: 1, playerId: 10, points: 2, quarter: 1, createdAt: new Date('2026-01-01T00:00:00Z') }
      ],
      fouls: []
    });

    // Forzar fallo simulado al insertar scores
    await expect(
      LocalBackupService.restoreIntoEmpty(rawBackup, {
        _faultInjectionAtTable: 'scores'
      })
    ).rejects.toThrow(/Simulated failure/);

    // Verificar que NADA quedó grabado en la base (rollback total)
    const teamsCount = await db.teams.count();
    const playersCount = await db.players.count();
    const matchesCount = await db.matches.count();
    const scoresCount = await db.scores.count();

    expect(teamsCount).toBe(0);
    expect(playersCount).toBe(0);
    expect(matchesCount).toBe(0);
    expect(scoresCount).toBe(0);
  });

  // QA-17: Restauración completa en una base vacía
  it('QA-17: Restauración completa en base vacía pobla las cinco tablas y retorna contadores exactos', async () => {
    const rawBackup = await buildTestBackup({
      teams: [
        { id: 1, name: 'Warriors', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 2, name: 'Rockets', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      players: [
        { id: 30, name: 'Curry', number: 30, teamId: 1, createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 13, name: 'Harden', number: 13, teamId: 2, createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      matches: [
        {
          id: 50,
          localTeamId: 1,
          visitorTeamId: 2,
          status: 'playing',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 12 } },
          localScore: 5,
          visitorScore: 0,
          localFouls: 1,
          visitorFouls: 0
        }
      ],
      scores: [
        { id: 101, matchId: 50, teamId: 1, playerId: 30, points: 3, quarter: 1, createdAt: new Date('2026-01-01T00:01:00Z') },
        { id: 102, matchId: 50, teamId: 1, playerId: 30, points: 2, quarter: 1, createdAt: new Date('2026-01-01T00:02:00Z') }
      ],
      fouls: [
        { id: 201, matchId: 50, teamId: 1, playerId: 30, quarter: 1, createdAt: new Date('2026-01-01T00:03:00Z') }
      ]
    });

    const counts = await LocalBackupService.restoreIntoEmpty(rawBackup);

    expect(counts).toEqual({
      teams: 2,
      players: 2,
      matches: 1,
      scores: 2,
      fouls: 1
    });

    expect(await db.teams.count()).toBe(2);
    expect(await db.players.count()).toBe(2);
    expect(await db.matches.count()).toBe(1);
    expect(await db.scores.count()).toBe(2);
    expect(await db.fouls.count()).toBe(1);
  });

  // QA-18: Equivalencia entre datos originales y restaurados
  it('QA-18: Prueba de equivalencia estricta antes de exportar y tras restaurar', async () => {
    const tLocal = (await db.teams.add({ name: 'Equiv Local', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false })) as number;
    const tVisitor = (await db.teams.add({ name: 'Equiv Visitor', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false })) as number;
    const p1 = (await db.players.add({ name: 'Player E1', number: 10, teamId: tLocal, createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false })) as number;

    const mId = (await db.matches.add({
      localTeamId: tLocal,
      visitorTeamId: tVisitor,
      status: 'playing',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
      localScore: 3,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      timerSecondsRemaining: 600,
      timerLeaseExpiresAt: 0,
      timerRecoveryState: 'normal'
    })) as number;

    await db.scores.add({
      matchId: mId,
      teamId: tLocal,
      playerId: p1,
      points: 3,
      quarter: 1,
      createdAt: new Date('2026-01-01T10:02:00Z')
    });

    const initialTeams = await db.teams.toArray();
    const initialPlayers = await db.players.toArray();
    const initialMatches = await db.matches.toArray();
    const initialScores = await db.scores.toArray();

    const json = await LocalBackupService.exportJson();

    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();

    await LocalBackupService.restoreIntoEmpty(json);

    const restoredTeams = await db.teams.toArray();
    const restoredPlayers = await db.players.toArray();
    const restoredMatches = await db.matches.toArray();
    const restoredScores = await db.scores.toArray();

    expect(restoredTeams).toEqual(initialTeams);
    expect(restoredPlayers).toEqual(initialPlayers);
    expect(restoredMatches).toEqual(initialMatches);
    expect(restoredScores).toEqual(initialScores);
  });

  // QA-19: Compatibilidad con registros de distintas versiones históricas
  it('QA-19: Adapta registros históricos de esquemas anteriores (v2 a v6) sin config ni isArchived', async () => {
    const legacyBackup = await buildTestBackup(
      {
        teams: [
          { id: 1, name: 'Legacy Team 1', createdAt: new Date('2025-01-01T00:00:00Z') } as unknown as Team,
          { id: 2, name: 'Legacy Team 2', createdAt: new Date('2025-01-01T00:00:00Z') } as unknown as Team
        ],
        players: [],
        matches: [
          {
            id: 88,
            localTeamId: 1,
            visitorTeamId: 2,
            status: 'playing',
            createdAt: new Date('2025-01-01T00:00:00Z'),
            totalQuarters: 4,
            quarterDuration: 10,
            localScore: 10,
            visitorScore: 8,
            localFouls: 2,
            visitorFouls: 1
            // Sin config (esquema v6)
          } as unknown as Match
        ],
        scores: [],
        fouls: []
      },
      undefined,
      { sourceSchemaVersion: 6 }
    );

    await LocalBackupService.restoreIntoEmpty(legacyBackup);

    const team = (await db.teams.get(1))!;
    expect(team.isArchived).toBe(false);

    const match = (await db.matches.get(88))!;
    expect(match.config).toBeDefined();
    expect(match.config.mode).toBe('traditional');
    expect(match.config.traditional?.totalQuarters).toBe(4);
    expect(match.config.traditional?.minutesPerQuarter).toBe(10);
    expect(match.localScore).toBe(10);
    expect(match.visitorScore).toBe(8);
  });

  // QA-20: Correcto manejo de errores de almacenamiento
  it('QA-20: Manejo seguro y tolerante de StoragePersistenceService en cualquier entorno', async () => {
    const status = await StoragePersistenceService.getStatus();
    expect(typeof status.supported).toBe('boolean');
    expect(typeof status.persisted).toBe('boolean');

    const requested = await StoragePersistenceService.requestPersistence();
    expect(typeof requested).toBe('boolean');
  });

  // QA-21: Restauración y funcionamiento posterior de un partido
  it('QA-21: Un partido restaurado puede ser continuado y modificado por los servicios deportivos del sistema', async () => {
    const tLocal = (await db.teams.add({ name: 'Active T1', createdAt: new Date() })) as number;
    const tVisitor = (await db.teams.add({ name: 'Active T2', createdAt: new Date() })) as number;
    const player = (await db.players.add({ name: 'Point Guard', teamId: tLocal, createdAt: new Date() })) as number;

    const matchId = (await db.matches.add({
      localTeamId: tLocal,
      visitorTeamId: tVisitor,
      status: 'playing',
      createdAt: new Date(),
      eventsProvenance: 'live_session',
      config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
      currentQuarter: 1,
      localScore: 2,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0
    })) as number;

    const scoreId = (await db.scores.add({
      matchId,
      teamId: tLocal,
      playerId: player,
      points: 2,
      quarter: 1,
      createdAt: new Date()
    })) as number;

    const json = await LocalBackupService.exportJson();

    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();

    await LocalBackupService.restoreIntoEmpty(json);

    // Ahora eliminamos la acción del partido restaurado usando GameActionsRepository
    const deleteResult = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: scoreId,
      type: 'score'
    });

    expect(deleteResult.success).toBe(true);
    expect(deleteResult.deleted).toBe(true);

    const updatedMatch = (await db.matches.get(matchId))!;
    expect(updatedMatch.localScore).toBe(0);
  });

  // QA-22: Ninguna modificación accidental a resultados deportivos
  it('QA-22: Los resultados históricos cerrados, empates o victorias de sets no sufren mutación', async () => {
    const t1 = (await db.teams.add({ name: 'T1', createdAt: new Date() })) as number;
    const t2 = (await db.teams.add({ name: 'T2', createdAt: new Date() })) as number;

    const matchId = (await db.matches.add({
      localTeamId: t1,
      visitorTeamId: t2,
      status: 'finished',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      config: {
        mode: 'race',
        race: { targetScore: 21, hasRematches: true, currentGame: 2 }
      },
      localScore: 21,
      visitorScore: 19,
      localFouls: 5,
      visitorFouls: 7,
      gameHistory: [
        {
          gameNumber: 1,
          localScore: 21,
          visitorScore: 19,
          winner: 'local',
          finishedAt: new Date('2026-01-01T00:30:00Z')
        }
      ]
    })) as number;

    const json = await LocalBackupService.exportJson();
    await db.matches.clear();
    await db.teams.clear();

    await LocalBackupService.restoreIntoEmpty(json);

    const restored = (await db.matches.get(matchId))!;
    expect(restored.status).toBe('finished');
    expect(restored.gameHistory?.[0].winner).toBe('local');
    expect(restored.gameHistory?.[0].localScore).toBe(21);
    expect(restored.gameHistory?.[0].visitorScore).toBe(19);
  });

  // QA-23: Pruebas de concurrencia y bloqueo entre operaciones
  it('QA-23: Concurrencia: la restauración detecta inserciones concurrentes en el momento de la transacción y aborta limpiamente', async () => {
    const rawBackup = await buildTestBackup({
      teams: [{ id: 1, name: 'Team One', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }]
    });

    // Verificamos que si se inserta un equipo concurrentemente antes de la transacción,
    // restoreIntoEmpty rechaza con DatabaseNotEmptyError
    await db.teams.add({ name: 'Concurrent Inserted Team', createdAt: new Date() });

    await expect(LocalBackupService.restoreIntoEmpty(rawBackup))
      .rejects.toThrow(DatabaseNotEmptyError);
  });

  // QA-24: Prueba de volumen con conjunto de datos grande
  it('QA-24: Prueba de volumen con 50 equipos, 250 jugadores, 100 partidos y 1300 eventos', async () => {
    const teamCount = 50;
    const playersPerTeam = 5;
    const matchCount = 100;

    const teams: Team[] = [];
    for (let i = 1; i <= teamCount; i++) {
      teams.push({
        id: i,
        name: `Team ${i}`,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        isArchived: false
      });
    }

    const players: Player[] = [];
    let pId = 1;
    for (let t = 1; t <= teamCount; t++) {
      for (let p = 1; p <= playersPerTeam; p++) {
        players.push({
          id: pId++,
          teamId: t,
          name: `Player ${t}-${p}`,
          number: p,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          isArchived: false
        });
      }
    }

    const matches: Match[] = [];
    const scores: Score[] = [];
    const fouls: Foul[] = [];
    let sId = 1;
    let fId = 1;

    for (let m = 1; m <= matchCount; m++) {
      const localTeamId = ((m * 2 - 1) % teamCount) + 1;
      let visitorTeamId = ((m * 2) % teamCount) + 1;
      if (localTeamId === visitorTeamId) {
        visitorTeamId = (localTeamId % teamCount) + 1;
      }

      matches.push({
        id: m,
        localTeamId,
        visitorTeamId,
        status: m % 2 === 0 ? 'finished' : 'playing',
        createdAt: new Date('2026-01-02T10:00:00Z'),
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10 }
        },
        localScore: 20,
        visitorScore: 18,
        localFouls: 2,
        visitorFouls: 2
      });

      // 10 scores por partido = 1000 scores
      for (let s = 1; s <= 10; s++) {
        scores.push({
          id: sId++,
          matchId: m,
          teamId: s % 2 === 0 ? localTeamId : visitorTeamId,
          points: (s % 3 + 1) as 1 | 2 | 3,
          quarter: 1,
          createdAt: new Date('2026-01-02T10:01:00Z')
        });
      }

      // 3 fouls por partido = 300 fouls
      for (let f = 1; f <= 3; f++) {
        fouls.push({
          id: fId++,
          matchId: m,
          teamId: f % 2 === 0 ? localTeamId : visitorTeamId,
          quarter: 1,
          createdAt: new Date('2026-01-02T10:02:00Z')
        });
      }
    }

    // Cargar en la base de datos
    await db.teams.bulkAdd(teams);
    await db.players.bulkAdd(players);
    await db.matches.bulkAdd(matches);
    await db.scores.bulkAdd(scores);
    await db.fouls.bulkAdd(fouls);

    const startExport = performance.now();
    const json = await LocalBackupService.exportJson();
    const exportTime = performance.now() - startExport;

    expect(json.length).toBeGreaterThan(100000); // > 100 KB
    expect(exportTime).toBeLessThan(5000); // Debe exportar rápidamente

    // Vaciar y restaurar
    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();

    const startRestore = performance.now();
    const counts = await LocalBackupService.restoreIntoEmpty(json);
    const restoreTime = performance.now() - startRestore;

    expect(counts.teams).toBe(50);
    expect(counts.players).toBe(250);
    expect(counts.matches).toBe(100);
    expect(counts.scores).toBe(1000);
    expect(counts.fouls).toBe(300);
    expect(restoreTime).toBeLessThan(10000);

    expect(await db.teams.count()).toBe(50);
    expect(await db.players.count()).toBe(250);
    expect(await db.matches.count()).toBe(100);
    expect(await db.scores.count()).toBe(1000);
    expect(await db.fouls.count()).toBe(300);
  });

  // QA-25: Adversarial - Integridad Criptográfica SHA-256 (FIPS 180-4 y Tampering)
  it('QA-25: Integridad Criptográfica SHA-256 cumple vectores NIST FIPS 180-4 y detecta tampering de 1 byte', async () => {
    // Vector 1: Cadena vacía
    const emptySha = computePureSha256(new TextEncoder().encode(''));
    expect(emptySha).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

    // Vector 2: "abc"
    const abcSha = computePureSha256(new TextEncoder().encode('abc'));
    expect(abcSha).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    // Vector 3: 448 bits block test
    const longSha = computePureSha256(
      new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')
    );
    expect(longSha).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');

    // Equivalencia con computeDataChecksum
    const computedData = await computeDataChecksum('abc');
    expect(computedData).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    // Tampering test: exportar base con un equipo, alterar un solo carácter en el payload
    await db.teams.add({ name: 'Equipo Original', createdAt: new Date() });
    const json = await LocalBackupService.exportJson();
    await db.teams.clear();

    const parsed = JSON.parse(json);
    expect(parsed.metadata.checksumAlgorithm).toBe('SHA-256');
    expect(parsed.metadata.checksum.startsWith('sha256:')).toBe(true);

    // Alteramos el nombre de un equipo sin actualizar el checksum
    parsed.data.teams[0].name = 'Equipo Alterado';
    const tamperedJson = JSON.stringify(parsed);

    await expect(LocalBackupService.restoreIntoEmpty(tamperedJson)).rejects.toThrow(
      BackupValidationError
    );
    await expect(LocalBackupService.restoreIntoEmpty(tamperedJson)).rejects.toThrow(
      /checksum|SHA-256|alterado/i
    );
  });

  // QA-26: Adversarial - Recuperación Temporal de Partidos Activos en Tránsito
  it('QA-26: Recuperación de partidos activos en tránsito: detiene reloj, previene salto temporal y limpia autorizaciones obsoletas', async () => {
    const t1 = (await db.teams.add({ name: 'Local Activo', createdAt: new Date() })) as number;
    const t2 = (await db.teams.add({ name: 'Visitante Activo', createdAt: new Date() })) as number;

    // Partido en juego iniciado hace 15 minutos en otra máquina / pestaña
    const matchId = (await db.matches.add({
      localTeamId: t1,
      visitorTeamId: t2,
      status: 'playing',
      createdAt: new Date('2026-02-01T10:00:00Z'),
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10 }
      },
      currentQuarter: 1,
      timerSecondsRemaining: 480, // Quedan 8:00
      timerLastStart: new Date(Date.now() - 900000), // Empezó hace 15 minutos (900 s)
      timerOwnerTabId: 'zombie-tab-999',
      timerLeaseExpiresAt: Date.now() - 60000, // Lease expirado
      timerEpoch: 4,
      localScore: 10,
      visitorScore: 8,
      localFouls: 1,
      visitorFouls: 2
    })) as number;

    const json = await LocalBackupService.exportJson();
    await db.matches.clear();
    await db.teams.clear();

    // Restauramos en una base vacía
    await LocalBackupService.restoreIntoEmpty(json);

    const restored = (await db.matches.get(matchId))!;
    expect(restored).toBeDefined();

    // 1. El temporizador debe pausarse preventivamente para evitar salto anómalo (no descontar 900s)
    expect(restored.timerLastStart).toBeUndefined();
    expect(restored.timerSecondsRemaining).toBe(480); // Exactamente los 8 minutos preservados

    // 2. La autorización obsoleta de pestaña debe limpiarse
    expect(restored.timerOwnerTabId).toBeUndefined();
    expect(restored.timerLeaseExpiresAt).toBe(0);

    // 3. El estado de recuperación debe quedar en 'recovery_required'
    expect(restored.timerRecoveryState).toBe('recovery_required');
    expect(restored.timerRecoveryReason).toContain('detenido preventivamente');

    // 4. Al proyectar tiempo mediante MatchTimerService, no debe marcar 00:00 ni expirar
    const projection = MatchTimerService.projectTime(restored);
    expect(projection.timeLeft).toBe(480);
    expect(projection.isRunning).toBe(false);
    expect(projection.expired).toBe(false);
    expect(projection.isClockShiftDetected).toBe(true);
    expect(projection.confidence).toBe('uncertain');
  });

  // QA-27: Adversarial - Continuidad del Generador de Claves Auto-incrementales tras Restaurar
  it('QA-27: Continuidad de claves: tras restaurar registros con IDs explícitos, db.table.add() genera el siguiente ID sin colisión', async () => {
    // Respaldo con equipos en IDs no contiguos: 10 y 5000
    const rawBackup = await buildTestBackup({
      teams: [
        { id: 10, name: 'Team Diez', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 5000, name: 'Team Cinco Mil', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ]
    });

    await LocalBackupService.restoreIntoEmpty(rawBackup);

    // Verificar que los equipos 10 y 5000 existen intactos
    expect(await db.teams.get(10)).toBeDefined();
    expect(await db.teams.get(5000)).toBeDefined();

    // Insertar un nuevo equipo mediante db.teams.add() sin ID explícito
    const nextId = (await db.teams.add({
      name: 'Team Cinco Mil Uno',
      createdAt: new Date(),
      isArchived: false
    })) as number;

    // Según la especificación W3C de IndexedDB (3.1.5 Key Generators),
    // el generador avanza a max(restoredId) + 1, garantizando que nunca
    // colisione con registros restaurados con IDs explícitos.
    expect(nextId).toBeGreaterThan(5000);
    expect(nextId).toBe(5001);

    const retrieved = await db.teams.get(nextId);
    expect(retrieved?.name).toBe('Team Cinco Mil Uno');
  });

  // QA-28: Adversarial - Compatibilidad con Esquemas Legacy v2 a v5
  it('QA-28: Compatibilidad legacy: reconstruye marcadores, faltas y configuración por defecto en esquemas antiguos v2 a v5', async () => {
    const rawLegacyBackup = await buildTestBackup(
      {
        teams: [
          { id: 1, name: 'Legacy Local', createdAt: new Date('2024-05-01T10:00:00Z'), isArchived: false },
          { id: 2, name: 'Legacy Visitor', createdAt: new Date('2024-05-01T10:00:00Z'), isArchived: false }
        ],
        matches: [
          {
            id: 100,
            localTeamId: 1,
            visitorTeamId: 2,
            status: 'playing',
            createdAt: new Date('2024-05-01T10:30:00Z'),
            timerSecondsRemaining: 300
          } as unknown as Match
        ],
        scores: [
          { id: 1, matchId: 100, teamId: 1, points: 2, quarter: 1, createdAt: new Date('2024-05-01T10:32:00Z') },
          { id: 2, matchId: 100, teamId: 1, points: 3, quarter: 1, createdAt: new Date('2024-05-01T10:34:00Z') },
          { id: 3, matchId: 100, teamId: 2, points: 2, quarter: 1, createdAt: new Date('2024-05-01T10:35:00Z') }
        ],
        fouls: [
          { id: 1, matchId: 100, teamId: 1, quarter: 1, createdAt: new Date('2024-05-01T10:33:00Z') },
          { id: 2, matchId: 100, teamId: 2, quarter: 1, createdAt: new Date('2024-05-01T10:36:00Z') }
        ]
      },
      undefined,
      { sourceSchemaVersion: 3 }
    );

    await LocalBackupService.restoreIntoEmpty(rawLegacyBackup);

    const restoredMatch = (await db.matches.get(100))!;
    expect(restoredMatch).toBeDefined();

    // Reconstrucción determinista de contadores deportivos
    expect(restoredMatch.localScore).toBe(5); // 2 + 3
    expect(restoredMatch.visitorScore).toBe(2); // 2
    expect(restoredMatch.localFouls).toBe(1);
    expect(restoredMatch.visitorFouls).toBe(1);

    // Configuración por defecto a tradicional
    expect(restoredMatch.config).toBeDefined();
    expect(restoredMatch.config.mode).toBe('traditional');

    // eventsProvenance NO debe ser falsificado como 'live_session'
    expect(restoredMatch.eventsProvenance).toBeUndefined();
  });

  // QA-29: Adversarial - Rollback Atómico Multialmacén ante Fallo en Restauración
  it('QA-29: Rollback multialmacén: si los datos son inválidos, ningún registro queda escrito en ninguna tabla', async () => {
    // Backup con una violación relacional (un jugador apunta a un equipo inexistente)
    const invalidRelationalBackup = await buildTestBackup({
      teams: [{ id: 1, name: 'Team One', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }],
      players: [{ id: 1, teamId: 999, name: 'Ghost Player', number: 7, createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }]
    });

    await expect(LocalBackupService.restoreIntoEmpty(invalidRelationalBackup))
      .rejects.toThrow(BackupValidationError);

    // Ninguna tabla debe contener datos (rollback total)
    expect(await db.teams.count()).toBe(0);
    expect(await db.players.count()).toBe(0);
    expect(await db.matches.count()).toBe(0);
    expect(await db.scores.count()).toBe(0);
    expect(await db.fouls.count()).toBe(0);
  });

  // QA-30: R2-01 - Checksum obligatorio (ausente o vacío es rechazado terminantemente)
  it('QA-30: R2-01 - Rechaza restauraciones si metadata.checksum está ausente, vacío o nulo', async () => {
    const validJson = await LocalBackupService.exportJson();
    const parsed = JSON.parse(validJson) as BackupEnvelope;

    // Checksum eliminado
    delete (parsed.metadata as Partial<BackupMetadata>).checksum;
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsed)))
      .rejects.toThrow(/checksum.*obligatoria/i);

    // Checksum cadena vacía
    parsed.metadata.checksum = '';
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsed)))
      .rejects.toThrow(/checksum.*obligatoria/i);

    // Checksum solo espacios
    parsed.metadata.checksum = '   ';
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsed)))
      .rejects.toThrow(/checksum.*obligatoria/i);
  });

  // QA-31: R2-01 - Validación estricta de algoritmo y formato de hash
  it('QA-31: R2-01 - Rechaza algoritmos no admitidos (FNV-1a) y hashes SHA-256 malformados', async () => {
    const validJson = await LocalBackupService.exportJson();
    const parsed = JSON.parse(validJson) as BackupEnvelope;

    // Algoritmo inseguro o no admitido
    (parsed.metadata as unknown as Record<string, unknown>).checksumAlgorithm = 'FNV-1a';
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsed)))
      .rejects.toThrow(/Algoritmo de suma de verificación no admitido/i);

    // Algoritmo restaurado a SHA-256 pero hash malformado (sin prefijo sha256:)
    parsed.metadata.checksumAlgorithm = 'SHA-256';
    parsed.metadata.checksum = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsed)))
      .rejects.toThrow(/Formato de suma de verificación inválido/i);

    // Longitud incorrecta (menor a 64 hex caracteres)
    parsed.metadata.checksum = 'sha256:1234abcd';
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsed)))
      .rejects.toThrow(/Formato de suma de verificación inválido/i);
  });

  // QA-32: R2-05 - Manifiesto inconsistente (counts discordante con registros reales)
  it('QA-32: R2-05 - Rechaza respaldos donde metadata.counts no concuerde con el contenido real', async () => {
    const validJson = await buildTestBackup({
      teams: [{ id: 1, name: 'Team One', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }]
    });
    const parsed = JSON.parse(validJson) as BackupEnvelope;

    // Conteo declarado falsificado (Real es 1, declaramos 99)
    parsed.metadata.counts.teams = 99;

    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsed)))
      .rejects.toThrow(/Manifiesto inconsistente en la tabla "teams"/i);
  });

  // QA-33: R2-02 - Fechas obligatorias (createdAt) ausentes, nulas, malformadas o fuera de rango
  it('QA-33: R2-02 - Rechaza registros con fecha obligatoria createdAt ausente, nula, inválida o fuera de rango (2000-2100)', async () => {
    // 1. createdAt ausente en Team
    const missingCreatedAt = await buildTestBackup({
      teams: [{ id: 1, name: 'No Date Team', isArchived: false } as unknown as Team]
    });
    await expect(LocalBackupService.restoreIntoEmpty(missingCreatedAt))
      .rejects.toThrow(/campo de fecha obligatorio.*createdAt/i);

    // 2. createdAt null en Player
    const nullCreatedAt = await buildTestBackup({
      teams: [{ id: 1, name: 'Valid Team', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }],
      players: [{ id: 1, name: 'P1', number: 7, teamId: 1, createdAt: null as unknown as Date, isArchived: false }]
    });
    await expect(LocalBackupService.restoreIntoEmpty(nullCreatedAt))
      .rejects.toThrow(/campo de fecha obligatorio.*createdAt/i);

    // 3. createdAt malformado en Match
    const invalidDateMatch = await buildTestBackup({
      teams: [
        { id: 1, name: 'T1', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 2, name: 'T2', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      matches: [
        {
          id: 1,
          localTeamId: 1,
          visitorTeamId: 2,
          status: 'playing',
          createdAt: 'fecha-totalmente-invalida' as unknown as Date,
          config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
          localScore: 0,
          visitorScore: 0,
          localFouls: 0,
          visitorFouls: 0
        }
      ]
    });
    await expect(LocalBackupService.restoreIntoEmpty(invalidDateMatch))
      .rejects.toThrow(/Fecha inválida/i);

    // 4. Fecha fuera de rango plausible (anterior al año 2000)
    const epochZeroMatch = await buildTestBackup({
      teams: [{ id: 1, name: 'T1', createdAt: new Date('1990-01-01T00:00:00Z'), isArchived: false }]
    });
    await expect(LocalBackupService.restoreIntoEmpty(epochZeroMatch))
      .rejects.toThrow(/rango histórico admisible/i);
  });

  // QA-34: R2-02 - Fechas opcionales y anidadas
  it('QA-34: R2-02 - Procesa fechas opcionales válidas y rechaza fechas anidadas corruptas', async () => {
    const backupWithValidOptionals = await buildTestBackup({
      teams: [
        {
          id: 1,
          name: 'Archived Team',
          createdAt: new Date('2026-01-01T10:00:00Z'),
          archivedAt: new Date('2026-01-05T12:00:00Z'),
          isArchived: true
        },
        {
          id: 2,
          name: 'Active Team',
          createdAt: new Date('2026-01-01T10:00:00Z'),
          isArchived: false
        }
      ],
      matches: [
        {
          id: 10,
          localTeamId: 1,
          visitorTeamId: 2,
          status: 'finished',
          createdAt: new Date('2026-01-02T10:00:00Z'),
          finishedAt: new Date('2026-01-02T11:30:00Z'),
          config: { mode: 'race', race: { targetScore: 21, hasRematches: false, currentGame: 1 } },
          localScore: 21,
          visitorScore: 19,
          localFouls: 0,
          visitorFouls: 0,
          gameHistory: [
            {
              gameNumber: 1,
              localScore: 21,
              visitorScore: 19,
              winner: 'local',
              finishedAt: new Date('2026-01-02T11:29:00Z')
            }
          ]
        }
      ]
    });

    await LocalBackupService.restoreIntoEmpty(backupWithValidOptionals);

    const restoredTeam = (await db.teams.get(1))!;
    expect(restoredTeam.archivedAt).toBeInstanceOf(Date);
    expect(restoredTeam.archivedAt?.toISOString()).toBe('2026-01-05T12:00:00.000Z');

    const restoredMatch = (await db.matches.get(10))!;
    expect(restoredMatch.finishedAt).toBeInstanceOf(Date);
    expect(restoredMatch.gameHistory?.[0].finishedAt).toBeInstanceOf(Date);

    await db.teams.clear();
    await db.matches.clear();

    // Fecha anidada corrupta en gameHistory
    const corruptNestedDate = await buildTestBackup({
      teams: [
        { id: 1, name: 'T1', createdAt: new Date('2026-01-01T10:00:00Z'), isArchived: false },
        { id: 2, name: 'T2', createdAt: new Date('2026-01-01T10:00:00Z'), isArchived: false }
      ],
      matches: [
        {
          id: 10,
          localTeamId: 1,
          visitorTeamId: 2,
          status: 'finished',
          createdAt: new Date('2026-01-02T10:00:00Z'),
          config: { mode: 'race', race: { targetScore: 21, hasRematches: false, currentGame: 1 } },
          localScore: 21,
          visitorScore: 19,
          localFouls: 0,
          visitorFouls: 0,
          gameHistory: [
            {
              gameNumber: 1,
              localScore: 21,
              visitorScore: 19,
              winner: 'local',
              finishedAt: 'fecha-anidada-invalida' as unknown as Date
            }
          ]
        }
      ]
    });

    await expect(LocalBackupService.restoreIntoEmpty(corruptNestedDate))
      .rejects.toThrow(/Fecha inválida/i);
  });

  // QA-35: R2-03 - Validación de configuraciones deportivas
  it('QA-35: R2-03 - Rechaza modos desconocidos, NaN, Infinity y fraccionarios en configuración de partido', async () => {
    // 1. Modo de juego desconocido
    const unknownMode = await buildTestBackup({
      teams: [
        { id: 1, name: 'T1', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 2, name: 'T2', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      matches: [
        {
          id: 1,
          localTeamId: 1,
          visitorTeamId: 2,
          status: 'playing',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          config: { mode: 'waterpolo' } as unknown as Match['config'],
          localScore: 0,
          visitorScore: 0,
          localFouls: 0,
          visitorFouls: 0
        }
      ]
    });
    await expect(LocalBackupService.restoreIntoEmpty(unknownMode))
      .rejects.toThrow(/Modo de juego inválido/i);

    // 2. Número fraccionario en totalQuarters
    const floatQuarters = await buildTestBackup({
      teams: [
        { id: 1, name: 'T1', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 2, name: 'T2', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      matches: [
        {
          id: 1,
          localTeamId: 1,
          visitorTeamId: 2,
          status: 'playing',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          config: { mode: 'traditional', traditional: { totalQuarters: 4.5 as unknown as number, minutesPerQuarter: 10 } } as unknown as Match['config'],
          localScore: 0,
          visitorScore: 0,
          localFouls: 0,
          visitorFouls: 0
        }
      ]
    });
    await expect(LocalBackupService.restoreIntoEmpty(floatQuarters))
      .rejects.toThrow(/cuartos deben ser un número entero/i);

    // 3. NaN en minutesPerQuarter
    const nanMinutes = await buildTestBackup({
      teams: [
        { id: 1, name: 'T1', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 2, name: 'T2', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      matches: [
        {
          id: 1,
          localTeamId: 1,
          visitorTeamId: 2,
          status: 'playing',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: NaN } } as unknown as Match['config'],
          localScore: 0,
          visitorScore: 0,
          localFouls: 0,
          visitorFouls: 0
        }
      ]
    });
    await expect(LocalBackupService.restoreIntoEmpty(nanMinutes))
      .rejects.toThrow(/minutos deben ser un número entero/i);

    // 4. Infinity en targetScore de Race
    const infTarget = await buildTestBackup({
      teams: [
        { id: 1, name: 'T1', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 2, name: 'T2', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      matches: [
        {
          id: 1,
          localTeamId: 1,
          visitorTeamId: 2,
          status: 'playing',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          config: { mode: 'race', race: { targetScore: Infinity as unknown as number, hasRematches: false } } as unknown as Match['config'],
          localScore: 0,
          visitorScore: 0,
          localFouls: 0,
          visitorFouls: 0
        }
      ]
    });
    await expect(LocalBackupService.restoreIntoEmpty(infTarget))
      .rejects.toThrow(/puntaje objetivo debe ser un número entero/i);

    // 5. Número par en totalGames de Best-of-Series
    const evenGames = await buildTestBackup({
      teams: [
        { id: 1, name: 'T1', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 2, name: 'T2', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      matches: [
        {
          id: 1,
          localTeamId: 1,
          visitorTeamId: 2,
          status: 'playing',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          config: { mode: 'best-of-series', bestOf: { totalGames: 4, targetScorePerGame: 21, currentGame: 1, wins: { local: 0, visitor: 0 } } } as unknown as Match['config'],
          localScore: 0,
          visitorScore: 0,
          localFouls: 0,
          visitorFouls: 0
        }
      ]
    });
    await expect(LocalBackupService.restoreIntoEmpty(evenGames))
      .rejects.toThrow(/número de partidos debe ser impar/i);
  });

  // QA-36: R2-04 - Autoridad temporal en partidos pausados
  it('QA-36: R2-04 - La restauración siempre purga timerOwnerTabId y contratos de lease en partidos pausados', async () => {
    const pausedMatchBackup = await buildTestBackup({
      teams: [
        { id: 1, name: 'T1', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 2, name: 'T2', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      matches: [
        {
          id: 1,
          localTeamId: 1,
          visitorTeamId: 2,
          status: 'paused',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
          currentQuarter: 2,
          timerSecondsRemaining: 300,
          // Partido pausado pero con rastro de autoridad de una pestaña ajena
          timerLastStart: undefined,
          timerOwnerTabId: 'zombie-tab-from-other-machine',
          timerLeaseExpiresAt: Date.now() + 60000,
          timerLockMode: 'web_locks',
          timerRecoveryState: 'normal',
          localScore: 10,
          visitorScore: 8,
          localFouls: 1,
          visitorFouls: 1
        }
      ]
    });

    await LocalBackupService.restoreIntoEmpty(pausedMatchBackup);

    const restored = (await db.matches.get(1))!;
    expect(restored).toBeDefined();

    // Las referencias efímeras de la sesión anterior deben ser anuladas
    expect(restored.timerOwnerTabId).toBeUndefined();
    expect(restored.timerLeaseExpiresAt).toBe(0);
    expect(restored.timerLockMode).toBeUndefined();

    // El tiempo restante debe estar preservado intacto
    expect(restored.timerSecondsRemaining).toBe(300);
    expect(restored.timerLastStart).toBeUndefined();

    // Como estaba legítimamente pausado y con tiempo coherente, su estado es normal
    expect(restored.timerRecoveryState).toBe('normal');
  });

  // QA-37: R2-06 - Integridad de codificación UTF-8 y prevención de mojibake
  it('QA-37: R2-06 - Preserva íntegramente caracteres UTF-8 en respaldos y previene mojibake o secuencias corruptas', async () => {
    // 1. Verificar preservación de caracteres en español, acentos, símbolos y emojis
    const unicodeBackup = await buildTestBackup({
      teams: [
        {
          id: 1,
          name: 'CB Atlético Málaga — 1ª División 🏀',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          isArchived: false
        },
        {
          id: 2,
          name: 'Bàsquet Peña San José & València 🏆',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          isArchived: false
        }
      ],
      players: [
        {
          id: 1,
          name: 'José María González — Capitán',
          number: 23,
          teamId: 1,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          isArchived: false
        }
      ]
    });

    // Validar que el payload JSON generado es decodificable estrictamente como UTF-8 sin errores
    const encoder = new TextEncoder();
    const encodedBytes = encoder.encode(unicodeBackup);
    const strictDecoder = new TextDecoder('utf-8', { fatal: true });
    expect(() => strictDecoder.decode(encodedBytes)).not.toThrow();

    // Restaurar y verificar que los nombres se mantienen exactos sin mojibake
    await LocalBackupService.restoreIntoEmpty(unicodeBackup);

    const team1 = await db.teams.get(1);
    const team2 = await db.teams.get(2);
    const player1 = await db.players.get(1);

    expect(team1?.name).toBe('CB Atlético Málaga — 1ª División 🏀');
    expect(team2?.name).toBe('Bàsquet Peña San José & València 🏆');
    expect(player1?.name).toBe('José María González — Capitán');

    // 2. Verificar que se rechazan respaldos con secuencias corruptas de mojibake (ej. U+FFFD o patrones CP850/UTF-8 doblados)
    const corruptedBackup = unicodeBackup.replace('Málaga', 'M\uFFFDlaga');
    await expect(LocalBackupService.restoreIntoEmpty(corruptedBackup))
      .rejects.toThrow(); // Falla por checksum o validación
  });

  // QA-38: R2-08 - Experiencia de exportación y compatibilidad móvil
  it('QA-38: R2-08 - exportToFile ejecuta desasociación asíncrona de URL y reporta downloadInitiated', async () => {
    await db.teams.add({ name: 'Export Team', createdAt: new Date(), isArchived: false });

    const result = await LocalBackupService.exportToFile('test-export-r2.json');

    expect(result.filename).toBe('test-export-r2.json');
    expect(result.counts.teams).toBe(1);
    expect(typeof result.downloadInitiated).toBe('boolean');
  });

  // QA-39: R2.1 - Integridad del envelope: alteración de sourceSchemaVersion
  it('QA-39: R2.1 - Rechaza respaldos donde sourceSchemaVersion haya sido alterado respecto a la firma original', async () => {
    const validJson = await buildTestBackup({
      teams: [{ id: 1, name: 'Team Schema Test', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }]
    });
    const parsed = JSON.parse(validJson);

    // Alterar sourceSchemaVersion (ej. de 8 a 2 para intentar forzar reglas de migración obsoletas)
    parsed.sourceSchemaVersion = 2;

    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsed)))
      .rejects.toThrow(/suma de verificación SHA-256 no coincide con el contenido y metadatos/i);
  });

  // QA-40: R2.1 - Integridad del envelope: alteración de version y política anti-downgrade
  it('QA-40: R2.1 - Rechaza alteración de version del sobre y bloquea intentos de degradación a versión 1', async () => {
    const validJson = await buildTestBackup({
      teams: [{ id: 1, name: 'Team Version Test', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }]
    });
    const parsed = JSON.parse(validJson);

    // 1. Intento de degradación a versión 1
    parsed.version = 1;
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsed)))
      .rejects.toThrow(/Versión de formato de respaldo obsoleta \(versión 1\)/i);

    // 2. Versión desconocida / futura
    parsed.version = 99;
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsed)))
      .rejects.toThrow(/Versión de formato de respaldo no soportada: 99/i);
  });

  // QA-41: R2.1 - Integridad del envelope: alteración de format o app
  it('QA-41: R2.1 - Rechaza respaldos con alteración en format o app', async () => {
    const validJson = await buildTestBackup({
      teams: [{ id: 1, name: 'Team Format Test', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }]
    });

    const parsedFormat = JSON.parse(validJson);
    parsedFormat.format = 'compromised-format';
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsedFormat)))
      .rejects.toThrow(/Formato de respaldo no reconocido/i);

    const parsedApp = JSON.parse(validJson);
    parsedApp.app = 'OtherApp';
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsedApp)))
      .rejects.toThrow(/Aplicación no compatible/i);
  });

  // QA-42: R2.1 - Integridad del envelope: alteración de exportedAt
  it('QA-42: R2.1 - Detecta y rechaza la alteración de la marca temporal exportedAt', async () => {
    const validJson = await buildTestBackup({
      teams: [{ id: 1, name: 'Team Date Test', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }]
    });
    const parsed = JSON.parse(validJson);

    // Modificar la fecha de exportación
    parsed.exportedAt = '2026-12-31T23:59:59.000Z';

    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsed)))
      .rejects.toThrow(/suma de verificación SHA-256 no coincide con el contenido y metadatos/i);
  });

  // QA-43: R2.1 - Integridad del envelope: alteración de registros en data
  it('QA-43: R2.1 - Detecta y rechaza cualquier modificación interna de los registros en data', async () => {
    const validJson = await buildTestBackup({
      teams: [{ id: 1, name: 'Team Original', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }]
    });
    const parsed = JSON.parse(validJson);

    // Modificar el nombre del equipo en data
    parsed.data.teams[0].name = 'Team Tampered';

    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(parsed)))
      .rejects.toThrow(/suma de verificación SHA-256 no coincide con el contenido y metadatos/i);
  });

  // QA-44: R2.1 - Inmutabilidad estricta y preservación temporal de partidos finalizados
  it('QA-44: R2.1 - La restauración preserva estrictamente el estado finished y el tiempo restante de partidos terminados', async () => {
    const finishedMatchBackup = await buildTestBackup({
      teams: [
        { id: 1, name: 'Team Final A', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false },
        { id: 2, name: 'Team Final B', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false }
      ],
      matches: [
        {
          id: 50,
          localTeamId: 1,
          visitorTeamId: 2,
          status: 'finished',
          createdAt: new Date('2026-01-01T10:00:00Z'),
          finishedAt: new Date('2026-01-01T11:45:00Z'),
          config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
          currentQuarter: 4,
          timerSecondsRemaining: 0,
          timerLastStart: undefined,
          timerOwnerTabId: 'old-tab-finished',
          timerLeaseExpiresAt: Date.now() + 10000,
          timerLockMode: 'web_locks',
          timerRecoveryState: 'normal',
          localScore: 88,
          visitorScore: 82,
          localFouls: 4,
          visitorFouls: 3
        }
      ]
    });

    await LocalBackupService.restoreIntoEmpty(finishedMatchBackup);

    const restored = (await db.matches.get(50))!;
    expect(restored).toBeDefined();

    // 1. El estado finished es ESTRICTAMENTE inmutable (nunca pasa a paused)
    expect(restored.status).toBe('finished');

    // 2. Limpieza de autoridades efímeras de la sesión previa
    expect(restored.timerOwnerTabId).toBeUndefined();
    expect(restored.timerLeaseExpiresAt).toBe(0);
    expect(restored.timerLockMode).toBeUndefined();

    // 3. Reloj inerte y sin necesidad de recuperación
    expect(restored.timerLastStart).toBeUndefined();
    expect(restored.timerSecondsRemaining).toBe(0);
    expect(restored.timerRecoveryState).toBe('normal');

    // 4. Marcadores deportivos íntegros
    expect(restored.localScore).toBe(88);
    expect(restored.visitorScore).toBe(82);
  });

  // QA-45: R2.1 - Exportación y restauración canónica determinista
  it('QA-45: R2.1 - Exporta y restaura bajo la especificación canónica JCS v2 con total coherencia', async () => {
    await db.teams.add({ name: 'Canonical Team', createdAt: new Date('2026-01-01T00:00:00Z'), isArchived: false });

    const exportedJson = await LocalBackupService.exportJson();
    const parsed = JSON.parse(exportedJson);

    expect(parsed.format).toBe('scorebasket-local-backup');
    expect(parsed.version).toBe(2);
    expect(parsed.metadata.checksumAlgorithm).toBe('SHA-256');
    expect(parsed.metadata.checksum).toMatch(/^sha256:[a-f0-9]{64}$/i);

    // Vaciar y restaurar
    await db.teams.clear();
    const counts = await LocalBackupService.restoreIntoEmpty(exportedJson);
    expect(counts.teams).toBe(1);

    const reExportedJson = await LocalBackupService.exportJson();
    const reParsed = JSON.parse(reExportedJson);
    expect(reParsed.data.teams[0].name).toBe('Canonical Team');
  });
});
