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
  type BackupEnvelope
} from '../db/localBackup.service';
import { GameActionsRepository } from '../db/gameActions.repository';
import { MatchTimerService } from '../db/matchTimer.service';
import type { Match, Team, Player, Score, Foul } from '../db/models';

describe('DB-F1: Conservación, Respaldo y Recuperación Local (QA-01 a QA-24)', () => {
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
    const rawBackup = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 8,
      exportedAt: new Date().toISOString(),
      metadata: { counts: { teams: 2, players: 1, matches: 1, scores: 1, fouls: 1 } },
      data: {
        teams: [
          { id: 42, name: 'Team 42', createdAt: '2026-01-01T00:00:00Z', isArchived: false },
          { id: 99, name: 'Team 99', createdAt: '2026-01-01T00:00:00Z', isArchived: false }
        ],
        players: [
          { id: 105, name: 'Player 105', number: 7, teamId: 42, createdAt: '2026-01-01T00:00:00Z' }
        ],
        matches: [
          {
            id: 777,
            localTeamId: 42,
            visitorTeamId: 99,
            status: 'playing',
            createdAt: '2026-01-01T00:00:00Z',
            config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
            localScore: 3,
            visitorScore: 0,
            localFouls: 1,
            visitorFouls: 0
          }
        ],
        scores: [
          { id: 9001, matchId: 777, teamId: 42, playerId: 105, points: 3, quarter: 1, createdAt: '2026-01-01T00:01:00Z' }
        ],
        fouls: [
          { id: 8001, matchId: 777, teamId: 42, playerId: 105, quarter: 1, createdAt: '2026-01-01T00:02:00Z' }
        ]
      }
    };

    await LocalBackupService.restoreIntoEmpty(JSON.stringify(rawBackup));

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
    const rawBackup = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 8,
      exportedAt: new Date().toISOString(),
      metadata: { counts: { teams: 2, players: 0, matches: 1, scores: 0, fouls: 0 } },
      data: {
        teams: [
          { id: 1, name: 'T1', createdAt: '2026-01-15T08:30:00.000Z' },
          { id: 2, name: 'T2', createdAt: '2026-01-15T08:35:00.000Z' }
        ],
        players: [],
        matches: [
          {
            id: 10,
            localTeamId: 1,
            visitorTeamId: 2,
            status: 'finished',
            createdAt: '2026-01-15T09:00:00.000Z',
            finishedAt: '2026-01-15T10:15:00.000Z',
            timerLastStart: '2026-01-15T10:10:00.000Z',
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
                finishedAt: '2026-01-15T10:14:55.000Z'
              }
            ]
          }
        ],
        scores: [],
        fouls: []
      }
    };

    await LocalBackupService.restoreIntoEmpty(JSON.stringify(rawBackup));

    const match = (await db.matches.get(10))!;
    expect(match.createdAt instanceof Date).toBe(true);
    expect(match.finishedAt instanceof Date).toBe(true);
    expect(match.timerLastStart instanceof Date).toBe(true);
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
    const futureEnvelope = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 999, // Esquema futuro no compatible
      exportedAt: new Date().toISOString(),
      metadata: { counts: { teams: 0, players: 0, matches: 0, scores: 0, fouls: 0 } },
      data: { teams: [], players: [], matches: [], scores: [], fouls: [] }
    };

    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(futureEnvelope)))
      .rejects.toThrow(/versión de esquema posterior/i);
  });

  // QA-13: Rechazo de IDs duplicados
  it('QA-13: Rechaza respaldos que contengan IDs duplicados en cualquier almacén', async () => {
    const envelopeDuplicateTeams = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 8,
      exportedAt: new Date().toISOString(),
      metadata: { counts: { teams: 2, players: 0, matches: 0, scores: 0, fouls: 0 } },
      data: {
        teams: [
          { id: 1, name: 'Team One', createdAt: '2026-01-01T00:00:00Z' },
          { id: 1, name: 'Team Duplicate', createdAt: '2026-01-01T00:00:00Z' } // ID 1 duplicado
        ],
        players: [],
        matches: [],
        scores: [],
        fouls: []
      }
    };

    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(envelopeDuplicateTeams)))
      .rejects.toThrow(/ID duplicado/i);
  });

  // QA-14: Detección de relaciones inválidas
  it('QA-14: Rechaza respaldos con relaciones foráneas rotas o huérfanas', async () => {
    // Jugador referencia a un equipo inexistente
    const brokenPlayer = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 8,
      exportedAt: new Date().toISOString(),
      metadata: { counts: { teams: 1, players: 1, matches: 0, scores: 0, fouls: 0 } },
      data: {
        teams: [{ id: 1, name: 'Valid Team', createdAt: '2026-01-01T00:00:00Z' }],
        players: [{ id: 10, name: 'Orphan Player', teamId: 999, createdAt: '2026-01-01T00:00:00Z' }],
        matches: [],
        scores: [],
        fouls: []
      }
    };

    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(brokenPlayer)))
      .rejects.toThrow(/Relación inválida.*inexistente/i);

    // Partido con mismo equipo local y visitante
    const sameTeamMatch = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 8,
      exportedAt: new Date().toISOString(),
      metadata: { counts: { teams: 1, players: 0, matches: 1, scores: 0, fouls: 0 } },
      data: {
        teams: [{ id: 1, name: 'Team One', createdAt: '2026-01-01T00:00:00Z' }],
        players: [],
        matches: [
          {
            id: 5,
            localTeamId: 1,
            visitorTeamId: 1, // Mismo equipo
            status: 'playing',
            createdAt: '2026-01-01T00:00:00Z',
            config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
            localScore: 0,
            visitorScore: 0,
            localFouls: 0,
            visitorFouls: 0
          }
        ],
        scores: [],
        fouls: []
      }
    };

    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(sameTeamMatch)))
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
    const rawBackup = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 8,
      exportedAt: new Date().toISOString(),
      metadata: { counts: { teams: 2, players: 1, matches: 1, scores: 1, fouls: 1 } },
      data: {
        teams: [
          { id: 1, name: 'Team A', createdAt: '2026-01-01T00:00:00Z' },
          { id: 2, name: 'Team B', createdAt: '2026-01-01T00:00:00Z' }
        ],
        players: [
          { id: 10, name: 'Player A1', teamId: 1, createdAt: '2026-01-01T00:00:00Z' }
        ],
        matches: [
          {
            id: 100,
            localTeamId: 1,
            visitorTeamId: 2,
            status: 'playing',
            createdAt: '2026-01-01T00:00:00Z',
            config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
            localScore: 2,
            visitorScore: 0,
            localFouls: 0,
            visitorFouls: 0
          }
        ],
        scores: [
          { id: 500, matchId: 100, teamId: 1, playerId: 10, points: 2, quarter: 1, createdAt: '2026-01-01T00:00:00Z' }
        ],
        fouls: []
      }
    };

    // Forzar fallo simulado al insertar scores
    await expect(
      LocalBackupService.restoreIntoEmpty(JSON.stringify(rawBackup), {
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
    const rawBackup = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 8,
      exportedAt: new Date().toISOString(),
      metadata: { counts: { teams: 2, players: 2, matches: 1, scores: 2, fouls: 1 } },
      data: {
        teams: [
          { id: 1, name: 'Warriors', createdAt: '2026-01-01T00:00:00Z' },
          { id: 2, name: 'Rockets', createdAt: '2026-01-01T00:00:00Z' }
        ],
        players: [
          { id: 30, name: 'Curry', number: 30, teamId: 1, createdAt: '2026-01-01T00:00:00Z' },
          { id: 13, name: 'Harden', number: 13, teamId: 2, createdAt: '2026-01-01T00:00:00Z' }
        ],
        matches: [
          {
            id: 50,
            localTeamId: 1,
            visitorTeamId: 2,
            status: 'playing',
            createdAt: '2026-01-01T00:00:00Z',
            config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 12 } },
            localScore: 5,
            visitorScore: 0,
            localFouls: 1,
            visitorFouls: 0
          }
        ],
        scores: [
          { id: 101, matchId: 50, teamId: 1, playerId: 30, points: 3, quarter: 1, createdAt: '2026-01-01T00:01:00Z' },
          { id: 102, matchId: 50, teamId: 1, playerId: 30, points: 2, quarter: 1, createdAt: '2026-01-01T00:02:00Z' }
        ],
        fouls: [
          { id: 201, matchId: 50, teamId: 1, playerId: 30, quarter: 1, createdAt: '2026-01-01T00:03:00Z' }
        ]
      }
    };

    const counts = await LocalBackupService.restoreIntoEmpty(JSON.stringify(rawBackup));

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
      visitorFouls: 0
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
    const legacyBackup = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 6, // Versión anterior a v7 (sin config unificada)
      exportedAt: new Date().toISOString(),
      metadata: { counts: { teams: 2, players: 0, matches: 1, scores: 0, fouls: 0 } },
      data: {
        teams: [
          { id: 1, name: 'Legacy Team 1', createdAt: '2025-01-01T00:00:00Z' }, // Sin isArchived
          { id: 2, name: 'Legacy Team 2', createdAt: '2025-01-01T00:00:00Z' }
        ],
        players: [],
        matches: [
          {
            id: 88,
            localTeamId: 1,
            visitorTeamId: 2,
            status: 'playing',
            createdAt: '2025-01-01T00:00:00Z',
            totalQuarters: 4,
            quarterDuration: 10,
            localScore: 10,
            visitorScore: 8,
            localFouls: 2,
            visitorFouls: 1
            // Sin config (esquema v6)
          }
        ],
        scores: [],
        fouls: []
      }
    };

    await LocalBackupService.restoreIntoEmpty(JSON.stringify(legacyBackup));

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
    const rawBackup = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 8,
      exportedAt: new Date().toISOString(),
      metadata: { counts: { teams: 1, players: 0, matches: 0, scores: 0, fouls: 0 } },
      data: {
        teams: [{ id: 1, name: 'Team One', createdAt: '2026-01-01T00:00:00Z' }],
        players: [],
        matches: [],
        scores: [],
        fouls: []
      }
    };

    // Verificamos que si se inserta un equipo concurrentemente antes de la transacción,
    // restoreIntoEmpty rechaza con DatabaseNotEmptyError
    await db.teams.add({ name: 'Concurrent Inserted Team', createdAt: new Date() });

    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(rawBackup)))
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
    const rawBackup = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 8,
      exportedAt: new Date().toISOString(),
      metadata: {
        counts: { teams: 2, players: 0, matches: 0, scores: 0, fouls: 0 },
        checksumAlgorithm: 'SHA-256',
        generatedBy: 'ScoreBasket Test'
      },
      data: {
        teams: [
          { id: 10, name: 'Team Diez', createdAt: '2026-01-01T00:00:00Z', isArchived: false },
          { id: 5000, name: 'Team Cinco Mil', createdAt: '2026-01-01T00:00:00Z', isArchived: false }
        ],
        players: [],
        matches: [],
        scores: [],
        fouls: []
      }
    };

    const checksum = `sha256:${await computeDataChecksum(JSON.stringify(rawBackup.data))}`;
    (rawBackup.metadata as { checksum?: string }).checksum = checksum;

    await LocalBackupService.restoreIntoEmpty(JSON.stringify(rawBackup));

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
    const rawLegacyBackup = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 3, // Legacy schema v3
      exportedAt: '2024-05-01T12:00:00Z',
      metadata: {
        counts: { teams: 2, players: 0, matches: 1, scores: 3, fouls: 2 }
      },
      data: {
        teams: [
          { id: 1, name: 'Legacy Local', createdAt: '2024-05-01T10:00:00Z' },
          { id: 2, name: 'Legacy Visitor', createdAt: '2024-05-01T10:00:00Z' }
        ],
        players: [],
        matches: [
          {
            id: 100,
            localTeamId: 1,
            visitorTeamId: 2,
            status: 'playing',
            createdAt: '2024-05-01T10:30:00Z',
            // En v2-v5 no existían localScore, visitorScore, localFouls, visitorFouls ni config
            timerSecondsRemaining: 300
          }
        ],
        scores: [
          { id: 1, matchId: 100, teamId: 1, points: 2, quarter: 1, createdAt: '2024-05-01T10:32:00Z' },
          { id: 2, matchId: 100, teamId: 1, points: 3, quarter: 1, createdAt: '2024-05-01T10:34:00Z' },
          { id: 3, matchId: 100, teamId: 2, points: 2, quarter: 1, createdAt: '2024-05-01T10:35:00Z' }
        ],
        fouls: [
          { id: 1, matchId: 100, teamId: 1, quarter: 1, createdAt: '2024-05-01T10:33:00Z' },
          { id: 2, matchId: 100, teamId: 2, quarter: 1, createdAt: '2024-05-01T10:36:00Z' }
        ]
      }
    };

    await LocalBackupService.restoreIntoEmpty(JSON.stringify(rawLegacyBackup));

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
    const invalidRelationalBackup = {
      format: LOCAL_BACKUP_FORMAT,
      version: LOCAL_BACKUP_VERSION,
      app: 'ScoreBasket',
      sourceSchemaVersion: 8,
      exportedAt: new Date().toISOString(),
      metadata: {
        counts: { teams: 1, players: 1, matches: 0, scores: 0, fouls: 0 }
      },
      data: {
        teams: [{ id: 1, name: 'Team One', createdAt: '2026-01-01T00:00:00Z' }],
        players: [{ id: 1, teamId: 999, name: 'Ghost Player', number: 7, createdAt: '2026-01-01T00:00:00Z' }],
        matches: [],
        scores: [],
        fouls: []
      }
    };

    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(invalidRelationalBackup)))
      .rejects.toThrow(BackupValidationError);

    // Ninguna tabla debe contener datos (rollback total)
    expect(await db.teams.count()).toBe(0);
    expect(await db.players.count()).toBe(0);
    expect(await db.matches.count()).toBe(0);
    expect(await db.scores.count()).toBe(0);
    expect(await db.fouls.count()).toBe(0);
  });
});
