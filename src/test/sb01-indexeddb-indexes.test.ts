// src/test/sb01-indexeddb-indexes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { BasketControlDB, db } from '../db/db';
import { TeamsRepository } from '../db/teams.repository';

describe('SB-01: Índices de IndexedDB, Migraciones Históricas (v2, v6, v7 -> v8) y Eliminación Segura', () => {
  beforeEach(async () => {
    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();
  });

  it('Apertura de una base nueva con esquema versión 8', async () => {
    const testDb = new BasketControlDB(`test_db_new_${Date.now()}`);
    await testDb.open();
    expect(testDb.verno).toBe(8);

    // Verificar que los índices 'localTeamId' y 'visitorTeamId' existen en 'matches'
    const schema = testDb.tables.find(t => t.name === 'matches')?.schema;
    expect(schema?.indexes.some(i => i.name === 'localTeamId')).toBe(true);
    expect(schema?.indexes.some(i => i.name === 'visitorTeamId')).toBe(true);
    expect(schema?.indexes.some(i => i.name === 'config.mode')).toBe(true);

    testDb.close();
  });

  it('Migración histórica completa desde versión 2 hasta versión 8 preservando equipos, jugadores, partidos, anotaciones, faltas, IDs y vínculos', async () => {
    const dbName = `test_db_migration_v2_to_v8_${Date.now()}`;

    // 1. Crear base fiel al esquema original de versión 2
    const v2Db = new Dexie(dbName);
    v2Db.version(2).stores({
      teams: '++id, name, createdAt',
      players: '++id, teamId, name',
      matches: '++id, status, createdAt',
      scores: '++id, matchId, teamId, quarter, [matchId+quarter]',
      fouls: '++id, matchId, teamId, playerId, quarter, [matchId+quarter], [matchId+teamId+quarter], [matchId+playerId]'
    });
    await v2Db.open();

    // En v2 los equipos no tenían isArchived
    const teamLocalId = (await v2Db.table('teams').add({
      name: 'Bulls v2',
      createdAt: new Date('2025-01-10T10:00:00Z')
    })) as number;
    const teamVisitorId = (await v2Db.table('teams').add({
      name: 'Pistons v2',
      createdAt: new Date('2025-01-10T10:05:00Z')
    })) as number;

    const playerLocalId = (await v2Db.table('players').add({
      teamId: teamLocalId,
      name: 'Michael Jordan',
      number: 23
    })) as number;
    const playerVisitorId = (await v2Db.table('players').add({
      teamId: teamVisitorId,
      name: 'Isiah Thomas',
      number: 11
    })) as number;

    // En v2 los partidos no tenían totalQuarters, ni localScore/visitorScore desnormalizados, ni config
    const matchId = (await v2Db.table('matches').add({
      localTeamId: teamLocalId,
      visitorTeamId: teamVisitorId,
      status: 'finished',
      createdAt: new Date('2025-01-11T18:00:00Z')
    })) as number;

    const score1Id = (await v2Db.table('scores').add({
      matchId,
      teamId: teamLocalId,
      playerId: playerLocalId,
      points: 3,
      quarter: 1,
      createdAt: new Date('2025-01-11T18:02:00Z')
    })) as number;
    const score2Id = (await v2Db.table('scores').add({
      matchId,
      teamId: teamLocalId,
      playerId: playerLocalId,
      points: 2,
      quarter: 2,
      createdAt: new Date('2025-01-11T18:15:00Z')
    })) as number;
    const score3Id = (await v2Db.table('scores').add({
      matchId,
      teamId: teamVisitorId,
      playerId: playerVisitorId,
      points: 2,
      quarter: 1,
      createdAt: new Date('2025-01-11T18:04:00Z')
    })) as number;

    const foul1Id = (await v2Db.table('fouls').add({
      matchId,
      teamId: teamLocalId,
      playerId: playerLocalId,
      quarter: 1,
      createdAt: new Date('2025-01-11T18:06:00Z')
    })) as number;
    const foul2Id = (await v2Db.table('fouls').add({
      matchId,
      teamId: teamVisitorId,
      playerId: playerVisitorId,
      quarter: 2,
      createdAt: new Date('2025-01-11T18:18:00Z')
    })) as number;

    v2Db.close();

    // 2. Abrir con BasketControlDB actual (ejecuta upgrades v3 -> v4 -> v5 -> v6 -> v7 -> v8)
    const migratedDb = new BasketControlDB(dbName);
    await migratedDb.open();
    expect(migratedDb.verno).toBe(8);

    // Verificar preservación de equipos, IDs y upgrade v5 (isArchived = false)
    const mTeamLocal = await migratedDb.teams.get(teamLocalId);
    const mTeamVisitor = await migratedDb.teams.get(teamVisitorId);
    expect(mTeamLocal?.id).toBe(teamLocalId);
    expect(mTeamLocal?.name).toBe('Bulls v2');
    expect(mTeamLocal?.isArchived).toBe(false);
    expect(mTeamVisitor?.id).toBe(teamVisitorId);
    expect(mTeamVisitor?.name).toBe('Pistons v2');
    expect(mTeamVisitor?.isArchived).toBe(false);

    // Verificar preservación de jugadores y vínculos teamId
    const mPlayerLocal = await migratedDb.players.get(playerLocalId);
    const mPlayerVisitor = await migratedDb.players.get(playerVisitorId);
    expect(mPlayerLocal?.id).toBe(playerLocalId);
    expect(mPlayerLocal?.teamId).toBe(teamLocalId);
    expect(mPlayerLocal?.name).toBe('Michael Jordan');
    expect(mPlayerLocal?.number).toBe(23);
    expect(mPlayerVisitor?.id).toBe(playerVisitorId);
    expect(mPlayerVisitor?.teamId).toBe(teamVisitorId);

    // Verificar preservación de anotaciones y faltas
    const mScore1 = await migratedDb.scores.get(score1Id);
    const mScore2 = await migratedDb.scores.get(score2Id);
    const mScore3 = await migratedDb.scores.get(score3Id);
    expect(mScore1?.points).toBe(3);
    expect(mScore2?.points).toBe(2);
    expect(mScore3?.points).toBe(2);
    expect(mScore1?.matchId).toBe(matchId);
    expect(mScore1?.playerId).toBe(playerLocalId);

    const mFoul1 = await migratedDb.fouls.get(foul1Id);
    const mFoul2 = await migratedDb.fouls.get(foul2Id);
    expect(mFoul1?.matchId).toBe(matchId);
    expect(mFoul1?.teamId).toBe(teamLocalId);
    expect(mFoul2?.matchId).toBe(matchId);
    expect(mFoul2?.teamId).toBe(teamVisitorId);

    // Verificar partido migrado (v4 totalQuarters=4, v6 cálculo de scores/fouls, v7 config.traditional)
    const mMatch = await migratedDb.matches.get(matchId);
    expect(mMatch?.id).toBe(matchId);
    expect(mMatch?.localTeamId).toBe(teamLocalId);
    expect(mMatch?.visitorTeamId).toBe(teamVisitorId);
    expect(mMatch?.localScore).toBe(5); // 3 + 2 calculados en migración v6
    expect(mMatch?.visitorScore).toBe(2);
    expect(mMatch?.localFouls).toBe(1);
    expect(mMatch?.visitorFouls).toBe(1);
    expect(mMatch?.config.mode).toBe('traditional');
    expect(mMatch?.config.traditional?.totalQuarters).toBe(4);
    expect(mMatch?.config.traditional?.minutesPerQuarter).toBe(10);

    // Verificar funcionamiento de los nuevos índices v8
    const byLocal = await migratedDb.matches.where('localTeamId').equals(teamLocalId).toArray();
    expect(byLocal).toHaveLength(1);
    expect(byLocal[0].id).toBe(matchId);

    const byVisitor = await migratedDb.matches.where('visitorTeamId').equals(teamVisitorId).toArray();
    expect(byVisitor).toHaveLength(1);
    expect(byVisitor[0].id).toBe(matchId);

    migratedDb.close();
  });

  it('Migración histórica desde versión 6 hasta versión 8 preservando registros, estadísticas y vínculos', async () => {
    const dbName = `test_db_migration_v6_to_v8_${Date.now()}`;

    // 1. Crear base fiel al esquema versión 6
    const v6Db = new Dexie(dbName);
    v6Db.version(6).stores({
      teams: '++id, name, createdAt, isArchived',
      players: '++id, teamId, name, number',
      matches: '++id, status, createdAt, totalQuarters',
      scores: '++id, matchId, teamId, quarter, [matchId+quarter]',
      fouls: '++id, matchId, teamId, playerId, quarter, [matchId+quarter], [matchId+teamId+quarter], [matchId+playerId]'
    });
    await v6Db.open();

    const teamAId = (await v6Db.table('teams').add({
      name: 'Spurs v6',
      createdAt: new Date(),
      isArchived: false
    })) as number;
    const teamBId = (await v6Db.table('teams').add({
      name: 'Suns v6',
      createdAt: new Date(),
      isArchived: true
    })) as number;

    const playerAId = (await v6Db.table('players').add({
      teamId: teamAId,
      name: 'Tim Duncan',
      number: 21,
      createdAt: new Date(),
      isArchived: false
    })) as number;

    const matchV6Id = (await v6Db.table('matches').add({
      localTeamId: teamAId,
      visitorTeamId: teamBId,
      status: 'finished',
      createdAt: new Date(),
      totalQuarters: 4,
      quarterDuration: 12,
      localScore: 102,
      visitorScore: 99,
      localFouls: 14,
      visitorFouls: 16
    })) as number;

    const scoreV6Id = (await v6Db.table('scores').add({
      matchId: matchV6Id,
      teamId: teamAId,
      playerId: playerAId,
      points: 2,
      quarter: 4,
      createdAt: new Date()
    })) as number;

    const foulV6Id = (await v6Db.table('fouls').add({
      matchId: matchV6Id,
      teamId: teamAId,
      playerId: playerAId,
      quarter: 3,
      createdAt: new Date()
    })) as number;

    v6Db.close();

    // 2. Abrir con BasketControlDB (ejecuta v7 -> v8)
    const migratedDb = new BasketControlDB(dbName);
    await migratedDb.open();
    expect(migratedDb.verno).toBe(8);

    const preservedMatch = await migratedDb.matches.get(matchV6Id);
    expect(preservedMatch?.id).toBe(matchV6Id);
    expect(preservedMatch?.localScore).toBe(102);
    expect(preservedMatch?.visitorScore).toBe(99);
    expect(preservedMatch?.localFouls).toBe(14);
    expect(preservedMatch?.visitorFouls).toBe(16);
    expect(preservedMatch?.config).toEqual({
      mode: 'traditional',
      traditional: {
        totalQuarters: 4,
        minutesPerQuarter: 12
      }
    });

    const preservedTeamB = await migratedDb.teams.get(teamBId);
    expect(preservedTeamB?.isArchived).toBe(true);
    expect((await migratedDb.players.get(playerAId))?.name).toBe('Tim Duncan');
    expect((await migratedDb.scores.get(scoreV6Id))?.points).toBe(2);
    expect((await migratedDb.fouls.get(foulV6Id))?.quarter).toBe(3);

    const byVisitor = await migratedDb.matches.where('visitorTeamId').equals(teamBId).toArray();
    expect(byVisitor).toHaveLength(1);
    expect(byVisitor[0].id).toBe(matchV6Id);

    migratedDb.close();
  });

  it('Actualización desde versión 7 y conservación íntegra de todos los registros anteriores (equipos, jugadores, scores, fouls, matches)', async () => {
    const dbName = `test_db_migration_v7_to_v8_${Date.now()}`;

    // 1. Crear base en versión 7 simulada
    const v7Db = new Dexie(dbName);
    v7Db.version(7).stores({
      teams: '++id, name, createdAt, isArchived',
      players: '++id, teamId, name, number',
      matches: '++id, status, createdAt, config.mode',
      scores: '++id, matchId, teamId, quarter, [matchId+quarter]',
      fouls: '++id, matchId, teamId, playerId, quarter, [matchId+quarter], [matchId+teamId+quarter], [matchId+playerId]'
    });
    await v7Db.open();

    const team1Id = (await v7Db.table('teams').add({
      name: 'Lakers',
      createdAt: new Date(),
      isArchived: false
    })) as number;
    const team2Id = (await v7Db.table('teams').add({
      name: 'Celtics',
      createdAt: new Date(),
      isArchived: false
    })) as number;

    const player1Id = (await v7Db.table('players').add({
      teamId: team1Id,
      name: 'Kobe Bryant',
      number: 0,
      createdAt: new Date(),
      isArchived: false
    })) as number;

    const matchId = (await v7Db.table('matches').add({
      localTeamId: team1Id,
      visitorTeamId: team2Id,
      status: 'finished',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      localScore: 98,
      visitorScore: 95,
      localFouls: 10,
      visitorFouls: 12
    })) as number;

    const scoreId = (await v7Db.table('scores').add({
      matchId,
      teamId: team1Id,
      playerId: player1Id,
      points: 3,
      quarter: 4,
      createdAt: new Date()
    })) as number;

    const foulId = (await v7Db.table('fouls').add({
      matchId,
      teamId: team1Id,
      playerId: player1Id,
      quarter: 2,
      createdAt: new Date()
    })) as number;

    v7Db.close();

    // 2. Abrir con BasketControlDB que incluye versión 8
    const migratedDb = new BasketControlDB(dbName);
    await migratedDb.open();
    expect(migratedDb.verno).toBe(8);

    // Verificar que los datos anteriores se conservaron intactos
    const preservedTeam = await migratedDb.teams.get(team1Id);
    expect(preservedTeam?.name).toBe('Lakers');

    const preservedPlayer = await migratedDb.players.get(player1Id);
    expect(preservedPlayer?.name).toBe('Kobe Bryant');
    expect(preservedPlayer?.number).toBe(0);
    expect(preservedPlayer?.teamId).toBe(team1Id);

    const preservedScore = await migratedDb.scores.get(scoreId);
    expect(preservedScore?.points).toBe(3);
    expect(preservedScore?.matchId).toBe(matchId);

    const preservedFoul = await migratedDb.fouls.get(foulId);
    expect(preservedFoul?.quarter).toBe(2);
    expect(preservedFoul?.matchId).toBe(matchId);

    const preservedMatch = await migratedDb.matches.get(matchId);
    expect(preservedMatch?.localScore).toBe(98);
    expect(preservedMatch?.visitorScore).toBe(95);
    expect(preservedMatch?.localTeamId).toBe(team1Id);
    expect(preservedMatch?.visitorTeamId).toBe(team2Id);

    // Verificar que las consultas indexadas funcionan correctamente
    const localMatches = await migratedDb.matches.where('localTeamId').equals(team1Id).toArray();
    expect(localMatches.length).toBe(1);
    expect(localMatches[0].id).toBe(matchId);

    const visitorMatches = await migratedDb.matches.where('visitorTeamId').equals(team2Id).toArray();
    expect(visitorMatches.length).toBe(1);
    expect(visitorMatches[0].id).toBe(matchId);

    migratedDb.close();
  });

  it('Consulta por equipo local y por equipo visitante usando índices', async () => {
    const teamA = await TeamsRepository.create('Local Team');
    const teamB = await TeamsRepository.create('Visitor Team');
    const teamC = await TeamsRepository.create('Other Team');

    await db.matches.add({
      localTeamId: teamA,
      visitorTeamId: teamB,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      localScore: 10,
      visitorScore: 8,
      localFouls: 1,
      visitorFouls: 2
    });

    await db.matches.add({
      localTeamId: teamC,
      visitorTeamId: teamA,
      status: 'finished',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      localScore: 20,
      visitorScore: 22,
      localFouls: 0,
      visitorFouls: 0
    });

    const matchesAsLocal = await db.matches.where('localTeamId').equals(teamA).toArray();
    expect(matchesAsLocal.length).toBe(1);
    expect(matchesAsLocal[0].visitorTeamId).toBe(teamB);

    const matchesAsVisitor = await db.matches.where('visitorTeamId').equals(teamA).toArray();
    expect(matchesAsVisitor.length).toBe(1);
    expect(matchesAsVisitor[0].localTeamId).toBe(teamC);
  });

  it('Eliminación segura: permite eliminar equipo sin relaciones', async () => {
    const teamId = await TeamsRepository.create('Equipo Solitario');
    expect(await TeamsRepository.exists(teamId)).toBe(true);

    await TeamsRepository.remove(teamId);
    expect(await TeamsRepository.exists(teamId)).toBe(false);
  });

  it('Rechazo de eliminación cuando el equipo tiene jugadores asociados', async () => {
    const teamId = await TeamsRepository.create('Equipo Con Jugador');
    await db.players.add({
      teamId,
      name: 'Michael Jordan',
      number: 23,
      createdAt: new Date(),
      isArchived: false
    });

    await expect(TeamsRepository.remove(teamId)).rejects.toThrow(
      'No se puede eliminar un equipo con jugadores. Usa "Archivar" en su lugar.'
    );

    // El equipo sigue existiendo
    expect(await TeamsRepository.exists(teamId)).toBe(true);
  });

  it('Rechazo de eliminación cuando el equipo tiene partidos como local', async () => {
    const localId = await TeamsRepository.create('Equipo Local Con Partido');
    const visitorId = await TeamsRepository.create('Equipo Visitante Con Partido');

    await db.matches.add({
      localTeamId: localId,
      visitorTeamId: visitorId,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0
    });

    await expect(TeamsRepository.remove(localId)).rejects.toThrow(
      'No se puede eliminar un equipo con partidos registrados. Usa "Archivar" en su lugar.'
    );

    expect(await TeamsRepository.exists(localId)).toBe(true);
  });

  it('Rechazo de eliminación cuando el equipo tiene partidos como visitante', async () => {
    const localId = await TeamsRepository.create('Equipo Local 2');
    const visitorId = await TeamsRepository.create('Equipo Visitante 2');

    await db.matches.add({
      localTeamId: localId,
      visitorTeamId: visitorId,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0
    });

    await expect(TeamsRepository.remove(visitorId)).rejects.toThrow(
      'No se puede eliminar un equipo con partidos registrados. Usa "Archivar" en su lugar.'
    );

    expect(await TeamsRepository.exists(visitorId)).toBe(true);
  });

  it('Conservación íntegra de datos si una operación falla', async () => {
    const teamId = await TeamsRepository.create('Equipo Intacto');
    await db.players.add({
      teamId,
      name: 'Jugador 1',
      number: 7,
      createdAt: new Date(),
      isArchived: false
    });

    try {
      await TeamsRepository.remove(teamId);
    } catch {
      // Se esperaba el fallo
    }

    const team = await db.teams.get(teamId);
    expect(team).toBeDefined();
    expect(team?.name).toBe('Equipo Intacto');

    const players = await db.players.where('teamId').equals(teamId).toArray();
    expect(players.length).toBe(1);
  });
});
