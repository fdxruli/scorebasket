// src/test/sb01-indexeddb-indexes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { BasketControlDB, db } from '../db/db';
import { TeamsRepository } from '../db/teams.repository';

describe('SB-01: Índices de IndexedDB y Eliminación Segura de Equipos', () => {
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

  it('Actualización desde versión 7 y conservación íntegra de registros anteriores', async () => {
    const dbName = `test_db_migration_${Date.now()}`;
    
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

    const team1Id = await v7Db.table('teams').add({
      name: 'Lakers',
      createdAt: new Date(),
      isArchived: false
    });
    const team2Id = await v7Db.table('teams').add({
      name: 'Celtics',
      createdAt: new Date(),
      isArchived: false
    });

    const matchId = await v7Db.table('matches').add({
      localTeamId: team1Id,
      visitorTeamId: team2Id,
      status: 'finished',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      localScore: 98,
      visitorScore: 95
    });

    v7Db.close();

    // 2. Abrir con BasketControlDB que incluye versión 8
    const migratedDb = new BasketControlDB(dbName);
    await migratedDb.open();
    expect(migratedDb.verno).toBe(8);

    // Verificar que los datos anteriores se conservaron intactos
    const preservedTeam = await migratedDb.teams.get(team1Id);
    expect(preservedTeam?.name).toBe('Lakers');

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
