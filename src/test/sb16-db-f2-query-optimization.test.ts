// src/test/sb16-db-f2-query-optimization.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db';
import { TeamsRepository } from '../db/teams.repository';
import { GameActionsRepository } from '../db/gameActions.repository';
import { LocalBackupService } from '../db/localBackup.service';
import type { Match, Player } from '../db/models';

describe('DB-F2: Optimización de consultas, índices y rendimiento local (QA-01 a QA-14)', () => {
  beforeEach(async () => {
    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();
  });

  // QA-01: Partidos activos correctamente listados
  it('QA-01: lista partidos activos correctamente utilizando el índice de estado sin incluir finalizados', async () => {
    const tLocal = await db.teams.add({ name: 'Local A', createdAt: new Date(), isArchived: false });
    const tVisitor = await db.teams.add({ name: 'Visitante B', createdAt: new Date(), isArchived: false });

    await db.matches.bulkAdd([
      {
        localTeamId: tLocal,
        visitorTeamId: tVisitor,
        status: 'created',
        createdAt: new Date('2026-11-01T01:00:00Z'),
        config: { mode: 'traditional' },
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0
      },
      {
        localTeamId: tLocal,
        visitorTeamId: tVisitor,
        status: 'playing',
        createdAt: new Date('2026-11-01T02:00:00Z'),
        config: { mode: 'race' },
        localScore: 12,
        visitorScore: 10,
        localFouls: 1,
        visitorFouls: 2
      },
      {
        localTeamId: tLocal,
        visitorTeamId: tVisitor,
        status: 'paused',
        createdAt: new Date('2026-11-01T03:00:00Z'),
        config: { mode: 'best-of-series' },
        localScore: 5,
        visitorScore: 4,
        localFouls: 0,
        visitorFouls: 0
      },
      {
        localTeamId: tLocal,
        visitorTeamId: tVisitor,
        status: 'finished',
        createdAt: new Date('2026-11-01T04:00:00Z'),
        config: { mode: 'traditional' },
        localScore: 80,
        visitorScore: 78,
        localFouls: 12,
        visitorFouls: 14
      }
    ]);

    const rawActive = await db.matches
      .where('status')
      .anyOf(['created', 'playing', 'paused'])
      .reverse()
      .sortBy('createdAt');

    expect(rawActive.length).toBe(3);
    const statuses = rawActive.map(m => m.status);
    expect(statuses).toContain('created');
    expect(statuses).toContain('playing');
    expect(statuses).toContain('paused');
    expect(statuses).not.toContain('finished');
  });

  // QA-02: Partidos finalizados correctamente listados
  it('QA-02: lista partidos finalizados correctamente mediante el índice de estado sin incluir activos', async () => {
    const tLocal = await db.teams.add({ name: 'Local A', createdAt: new Date(), isArchived: false });
    const tVisitor = await db.teams.add({ name: 'Visitante B', createdAt: new Date(), isArchived: false });

    await db.matches.bulkAdd([
      {
        localTeamId: tLocal,
        visitorTeamId: tVisitor,
        status: 'playing',
        createdAt: new Date('2026-11-01T01:00:00Z'),
        config: { mode: 'traditional' },
        localScore: 10,
        visitorScore: 10,
        localFouls: 0,
        visitorFouls: 0
      },
      {
        localTeamId: tLocal,
        visitorTeamId: tVisitor,
        status: 'finished',
        createdAt: new Date('2026-11-01T02:00:00Z'),
        config: { mode: 'traditional' },
        localScore: 65,
        visitorScore: 60,
        localFouls: 5,
        visitorFouls: 8
      }
    ]);

    const finishedMatches = await db.matches.where('status').equals('finished').toArray();
    expect(finishedMatches.length).toBe(1);
    expect(finishedMatches[0].status).toBe('finished');
    expect(finishedMatches[0].localScore).toBe(65);
  });

  // QA-03: Orden cronológico conservado
  it('QA-03: conserva estrictamente el orden cronológico inverso (más reciente primero)', async () => {
    const tLocal = await db.teams.add({ name: 'Local A', createdAt: new Date(), isArchived: false });
    const tVisitor = await db.teams.add({ name: 'Visitante B', createdAt: new Date(), isArchived: false });

    const dates = [
      new Date('2026-10-25T10:00:00Z'),
      new Date('2026-10-28T15:30:00Z'),
      new Date('2026-11-01T12:00:00Z')
    ];

    await db.matches.bulkAdd([
      {
        localTeamId: tLocal,
        visitorTeamId: tVisitor,
        status: 'finished',
        createdAt: dates[0],
        config: { mode: 'traditional' },
        localScore: 40,
        visitorScore: 35,
        localFouls: 4,
        visitorFouls: 4
      },
      {
        localTeamId: tLocal,
        visitorTeamId: tVisitor,
        status: 'finished',
        createdAt: dates[2],
        config: { mode: 'traditional' },
        localScore: 50,
        visitorScore: 48,
        localFouls: 2,
        visitorFouls: 3
      },
      {
        localTeamId: tLocal,
        visitorTeamId: tVisitor,
        status: 'finished',
        createdAt: dates[1],
        config: { mode: 'traditional' },
        localScore: 45,
        visitorScore: 42,
        localFouls: 3,
        visitorFouls: 5
      }
    ]);

    const orderedMatches: Match[] = [];
    await db.matches
      .orderBy('createdAt')
      .reverse()
      .each(m => {
        if (m.status === 'finished') orderedMatches.push(m);
      });

    expect(orderedMatches.length).toBe(3);
    expect(orderedMatches[0].createdAt.getTime()).toBe(dates[2].getTime());
    expect(orderedMatches[1].createdAt.getTime()).toBe(dates[1].getTime());
    expect(orderedMatches[2].createdAt.getTime()).toBe(dates[0].getTime());
  });

  // QA-04: Filtrado correcto por modalidad
  it('QA-04: filtra partidos finalizados por modalidad respetando traditional, race y best-of-series', async () => {
    const tLocal = await db.teams.add({ name: 'Local A', createdAt: new Date(), isArchived: false });
    const tVisitor = await db.teams.add({ name: 'Visitante B', createdAt: new Date(), isArchived: false });

    await db.matches.bulkAdd([
      {
        localTeamId: tLocal,
        visitorTeamId: tVisitor,
        status: 'finished',
        createdAt: new Date('2026-11-01T01:00:00Z'),
        config: { mode: 'traditional' },
        localScore: 50,
        visitorScore: 45,
        localFouls: 5,
        visitorFouls: 5
      },
      {
        localTeamId: tLocal,
        visitorTeamId: tVisitor,
        status: 'finished',
        createdAt: new Date('2026-11-01T02:00:00Z'),
        config: { mode: 'race' },
        localScore: 21,
        visitorScore: 19,
        localFouls: 2,
        visitorFouls: 1
      },
      {
        localTeamId: tLocal,
        visitorTeamId: tVisitor,
        status: 'finished',
        createdAt: new Date('2026-11-01T03:00:00Z'),
        config: { mode: 'best-of-series' },
        localScore: 2,
        visitorScore: 1,
        localFouls: 0,
        visitorFouls: 0
      }
    ]);

    const getMatchesByMode = async (filter: 'all' | 'traditional' | 'race' | 'best-of-series') => {
      const results: Match[] = [];
      await db.matches
        .orderBy('createdAt')
        .reverse()
        .each(m => {
          if (m.status !== 'finished') return;
          const mode = m.config?.mode || 'traditional';
          if (filter !== 'all' && mode !== filter) return;
          results.push(m);
        });
      return results;
    };

    expect((await getMatchesByMode('all')).length).toBe(3);
    expect((await getMatchesByMode('traditional')).length).toBe(1);
    expect((await getMatchesByMode('race')).length).toBe(1);
    expect((await getMatchesByMode('best-of-series')).length).toBe(1);
  });

  // QA-05: Paginación sin duplicados ni omisiones
  it('QA-05: paginación e incremento de límite recupera registros sin duplicados ni omisiones', async () => {
    const tLocal = await db.teams.add({ name: 'Local A', createdAt: new Date(), isArchived: false });
    const tVisitor = await db.teams.add({ name: 'Visitante B', createdAt: new Date(), isArchived: false });

    const TOTAL_MATCHES = 45;
    const baseTime = Date.now();
    const matches: Match[] = [];

    for (let i = 0; i < TOTAL_MATCHES; i++) {
      matches.push({
        localTeamId: tLocal,
        visitorTeamId: tVisitor,
        status: 'finished',
        createdAt: new Date(baseTime + i * 1000),
        config: { mode: 'traditional' },
        localScore: i,
        visitorScore: i,
        localFouls: 0,
        visitorFouls: 0
      });
    }
    await db.matches.bulkAdd(matches);

    // Consulta con límite 20
    const page1: Match[] = [];
    await db.matches
      .orderBy('createdAt')
      .reverse()
      .until(() => page1.length >= 20)
      .each(m => {
        if (m.status === 'finished') page1.push(m);
      });

    // Consulta con límite incrementado a 40
    const page2: Match[] = [];
    await db.matches
      .orderBy('createdAt')
      .reverse()
      .until(() => page2.length >= 40)
      .each(m => {
        if (m.status === 'finished') page2.push(m);
      });

    // Consulta con límite total 45
    const page3: Match[] = [];
    await db.matches
      .orderBy('createdAt')
      .reverse()
      .until(() => page3.length >= 50)
      .each(m => {
        if (m.status === 'finished') page3.push(m);
      });

    expect(page1.length).toBe(20);
    expect(page2.length).toBe(40);
    expect(page3.length).toBe(45);

    // Verificar que page1 es prefijo exacto de page2
    for (let i = 0; i < 20; i++) {
      expect(page1[i].id).toBe(page2[i].id);
    }

    // Verificar unicidad absoluta (sin duplicados)
    const page2Ids = new Set(page2.map(m => m.id));
    expect(page2Ids.size).toBe(40);

    const page3Ids = new Set(page3.map(m => m.id));
    expect(page3Ids.size).toBe(45);
  });

  // QA-06: Actualización reactiva de listas
  it('QA-06: la transición de estado de playing a finished actualiza correctamente los conjuntos activos y finalizados', async () => {
    const tLocal = await db.teams.add({ name: 'Local A', createdAt: new Date(), isArchived: false });
    const tVisitor = await db.teams.add({ name: 'Visitante B', createdAt: new Date(), isArchived: false });

    const matchId = await db.matches.add({
      localTeamId: tLocal,
      visitorTeamId: tVisitor,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      localScore: 50,
      visitorScore: 48,
      localFouls: 2,
      visitorFouls: 2
    });

    const activeBefore = await db.matches
      .where('status')
      .anyOf(['created', 'playing', 'paused'])
      .count();
    const finishedBefore = await db.matches.where('status').equals('finished').count();

    expect(activeBefore).toBe(1);
    expect(finishedBefore).toBe(0);

    // Finalizar el partido
    await db.matches.update(matchId, { status: 'finished' });

    const activeAfter = await db.matches
      .where('status')
      .anyOf(['created', 'playing', 'paused'])
      .count();
    const finishedAfter = await db.matches.where('status').equals('finished').count();

    expect(activeAfter).toBe(0);
    expect(finishedAfter).toBe(1);
  });

  // QA-07: Equipos con sus jugadores correctos (agrupación Map)
  it('QA-07: agrupa jugadores por equipo correctamente mediante Map en tiempo lineal preservando integridad', async () => {
    const t1 = await db.teams.add({ name: 'Equipo 1', createdAt: new Date(), isArchived: false });
    const t2 = await db.teams.add({ name: 'Equipo 2', createdAt: new Date(), isArchived: false });

    await db.players.bulkAdd([
      { teamId: t1, name: 'Jugador 1-A', number: 10, isArchived: false, createdAt: new Date() },
      { teamId: t1, name: 'Jugador 1-B', number: 11, isArchived: false, createdAt: new Date() },
      { teamId: t2, name: 'Jugador 2-A', number: 7, isArchived: false, createdAt: new Date() }
    ]);

    const rawTeams = await TeamsRepository.getAll();
    const allPlayers = await db.players.toArray();

    const rosterByTeamId = new Map<number, Player[]>();
    for (const p of allPlayers) {
      if (p.isArchived || p.teamId === undefined) continue;
      let roster = rosterByTeamId.get(p.teamId);
      if (!roster) {
        roster = [];
        rosterByTeamId.set(p.teamId, roster);
      }
      roster.push(p);
    }

    const enrichedTeams = rawTeams.map(team => ({
      ...team,
      roster: rosterByTeamId.get(team.id!) || []
    }));

    const team1Enriched = enrichedTeams.find(t => t.id === t1);
    const team2Enriched = enrichedTeams.find(t => t.id === t2);

    expect(team1Enriched?.roster.length).toBe(2);
    expect(team1Enriched?.roster.map(p => p.name)).toEqual(['Jugador 1-A', 'Jugador 1-B']);
    expect(team2Enriched?.roster.length).toBe(1);
    expect(team2Enriched?.roster[0].name).toBe('Jugador 2-A');
  });

  // QA-08: Jugadores archivados correctamente tratados
  it('QA-08: excluye jugadores archivados de las plantillas activas de equipos sin eliminarlos de la BD', async () => {
    const tId = await db.teams.add({ name: 'Equipo Alpha', createdAt: new Date(), isArchived: false });

    await db.players.bulkAdd([
      { teamId: tId, name: 'Activo 1', number: 1, isArchived: false, createdAt: new Date() },
      { teamId: tId, name: 'Archivado 1', number: 2, isArchived: true, createdAt: new Date() }
    ]);

    const allPlayers = await db.players.toArray();
    const rosterByTeamId = new Map<number, Player[]>();
    for (const p of allPlayers) {
      if (p.isArchived || p.teamId === undefined) continue;
      let roster = rosterByTeamId.get(p.teamId);
      if (!roster) {
        roster = [];
        rosterByTeamId.set(p.teamId, roster);
      }
      roster.push(p);
    }

    const activeRoster = rosterByTeamId.get(tId) || [];
    expect(activeRoster.length).toBe(1);
    expect(activeRoster[0].name).toBe('Activo 1');

    // Confirmar que el jugador archivado sigue presente en la base de datos
    const dbPlayers = await db.players.where('teamId').equals(tId).toArray();
    expect(dbPlayers.length).toBe(2);
    expect(dbPlayers.find(p => p.name === 'Archivado 1')?.isArchived).toBe(true);
  });

  // QA-09: Faltas por periodo y por equipo
  it('QA-09: consulta faltas de periodo usando el índice compuesto [matchId+quarter] con discriminación por equipo', async () => {
    const matchId = 100;
    const localTeamId = 10;
    const visitorTeamId = 20;

    await db.fouls.bulkAdd([
      // Cuarto 1
      { matchId, teamId: localTeamId, quarter: 1, createdAt: new Date() },
      { matchId, teamId: visitorTeamId, quarter: 1, createdAt: new Date() },
      // Cuarto 2
      { matchId, teamId: localTeamId, quarter: 2, createdAt: new Date() },
      { matchId, teamId: localTeamId, quarter: 2, createdAt: new Date() },
      { matchId, teamId: visitorTeamId, quarter: 2, createdAt: new Date() },
      // Cuarto 3
      { matchId, teamId: visitorTeamId, quarter: 3, createdAt: new Date() }
    ]);

    // Consultar cuarto 2 vía [matchId+quarter]
    const q2Fouls = await db.fouls.where('[matchId+quarter]').equals([matchId, 2]).toArray();
    expect(q2Fouls.length).toBe(3);

    const localQ2 = q2Fouls.filter(f => f.teamId === localTeamId).length;
    const visitorQ2 = q2Fouls.filter(f => f.teamId === visitorTeamId).length;

    expect(localQ2).toBe(2);
    expect(visitorQ2).toBe(1);

    // Consultar cuarto 1 vía [matchId+quarter]
    const q1Fouls = await db.fouls.where('[matchId+quarter]').equals([matchId, 1]).toArray();
    expect(q1Fouls.length).toBe(2);
    expect(q1Fouls.filter(f => f.teamId === localTeamId).length).toBe(1);
    expect(q1Fouls.filter(f => f.teamId === visitorTeamId).length).toBe(1);
  });

  // QA-10: Anotaciones consultadas en orden correcto
  it('QA-10: consulta anotaciones y faltas del periodo vigente vía [matchId+quarter] identificando la última jugada', async () => {
    const matchId = 200;
    const teamId = 1;
    const quarter = 2;

    const t0 = new Date('2026-11-01T10:00:00Z');
    const t1 = new Date('2026-11-01T10:01:00Z');
    const t2 = new Date('2026-11-01T10:02:00Z');

    await db.scores.bulkAdd([
      { matchId, teamId, quarter: 1, points: 2, createdAt: t0 },
      { matchId, teamId, quarter: 2, points: 3, createdAt: t1 }
    ]);

    await db.fouls.bulkAdd([
      { matchId, teamId, quarter: 2, createdAt: t2 }
    ]);

    const [periodScores, periodFouls] = await Promise.all([
      db.scores.where('[matchId+quarter]').equals([matchId, quarter]).toArray(),
      db.fouls.where('[matchId+quarter]').equals([matchId, quarter]).toArray()
    ]);

    expect(periodScores.length).toBe(1);
    expect(periodScores[0].points).toBe(3);

    expect(periodFouls.length).toBe(1);

    const latestScore = [...periodScores].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const latestFoul = [...periodFouls].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    const isScoreLatest =
      latestScore && (!latestFoul || latestScore.createdAt.getTime() >= latestFoul.createdAt.getTime());

    expect(isScoreLatest).toBe(false); // La falta ocurrió en t2, posterior a la canasta en t1
  });

  // QA-11: Integridad de historial de partidos
  it('QA-11: LiveMatchHistoryModal y consultas de historial localizan equipos y jugadores sin cargar tablas completas', async () => {
    const tLocal = await db.teams.add({ name: 'Equipo Sol', createdAt: new Date(), isArchived: false });
    const tVisitor = await db.teams.add({ name: 'Equipo Luna', createdAt: new Date(), isArchived: false });
    const tNoise = await db.teams.add({ name: 'Equipo Externo', createdAt: new Date(), isArchived: false });

    const pLocal = await db.players.add({ teamId: tLocal, name: 'Solista 1', isArchived: false, createdAt: new Date() });
    await db.players.add({ teamId: tVisitor, name: 'Lunático 1', isArchived: false, createdAt: new Date() });
    await db.players.add({ teamId: tNoise, name: 'Extraño 1', isArchived: false, createdAt: new Date() });

    const matchId = await db.matches.add({
      localTeamId: tLocal,
      visitorTeamId: tVisitor,
      status: 'finished',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      localScore: 2,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0
    });

    await db.scores.add({
      matchId,
      teamId: tLocal,
      playerId: pLocal,
      points: 2,
      quarter: 1,
      createdAt: new Date()
    });

    // Simular consulta optimizada de LiveMatchHistoryModal
    const matchData = await db.matches.get(matchId);
    expect(matchData).toBeDefined();

    const teamIds = [matchData!.localTeamId, matchData!.visitorTeamId].filter((id): id is number => typeof id === 'number');

    const [scores, fouls, matchPlayers, matchTeams] = await Promise.all([
      db.scores.where({ matchId }).toArray(),
      db.fouls.where({ matchId }).toArray(),
      db.players.where('teamId').anyOf(teamIds).toArray(),
      db.teams.where('id').anyOf(teamIds).toArray()
    ]);

    expect(scores.length).toBe(1);
    expect(fouls.length).toBe(0);
    expect(matchTeams.length).toBe(2);
    expect(matchTeams.map(t => t.name)).not.toContain('Equipo Externo');
    expect(matchPlayers.length).toBe(2);
    expect(matchPlayers.map(p => p.name)).not.toContain('Extraño 1');
  });

  // QA-12: Compatibilidad de respaldo DB-F1
  it('QA-12: el respaldo y restauración DB-F1 opera con total fidelidad tras las optimizaciones de consulta', async () => {
    const tLocal = await db.teams.add({ name: 'Bulls', createdAt: new Date(), isArchived: false });
    const tVisitor = await db.teams.add({ name: 'Lakers', createdAt: new Date(), isArchived: false });

    const pLocal = await db.players.add({ teamId: tLocal, name: 'Jordan', number: 23, isArchived: false, createdAt: new Date() });
    const pVisitor = await db.players.add({ teamId: tVisitor, name: 'Kobe', number: 24, isArchived: false, createdAt: new Date() });

    const matchId = await db.matches.add({
      localTeamId: tLocal,
      visitorTeamId: tVisitor,
      status: 'finished',
      createdAt: new Date(),
      config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
      localScore: 89,
      visitorScore: 85,
      localFouls: 4,
      visitorFouls: 5
    });

    await db.scores.add({
      matchId,
      teamId: tLocal,
      playerId: pLocal,
      points: 2,
      quarter: 1,
      createdAt: new Date()
    });

    await db.fouls.add({
      matchId,
      teamId: tVisitor,
      playerId: pVisitor,
      quarter: 1,
      createdAt: new Date()
    });

    // 1. Exportar respaldo usando LocalBackupService (DB-F1)
    const backupJson = await LocalBackupService.exportJson();
    expect(backupJson).toBeDefined();

    // 2. Limpiar base de datos
    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();

    expect(await db.matches.count()).toBe(0);

    // 3. Restaurar respaldo
    const counts = await LocalBackupService.restoreIntoEmpty(backupJson);
    expect(counts.teams).toBe(2);
    expect(counts.matches).toBe(1);

    // 4. Verificar integridad de las entidades restauradas
    expect(await db.teams.count()).toBe(2);
    expect(await db.players.count()).toBe(2);
    expect(await db.matches.count()).toBe(1);
    expect(await db.scores.count()).toBe(1);
    expect(await db.fouls.count()).toBe(1);

    const restoredMatch = await db.matches.get(matchId);
    expect(restoredMatch?.localScore).toBe(89);
    expect(restoredMatch?.visitorScore).toBe(85);
  });

  // QA-13: Ausencia de alteraciones deportivas
  it('QA-13: preserva las invariantes deportivas y el contrato de eliminación segura tras optimizaciones', async () => {
    const tLocal = await db.teams.add({ name: 'Local C', createdAt: new Date(), isArchived: false });
    const tVisitor = await db.teams.add({ name: 'Visitante D', createdAt: new Date(), isArchived: false });

    const matchId = await db.matches.add({
      localTeamId: tLocal,
      visitorTeamId: tVisitor,
      status: 'playing',
      createdAt: new Date(),
      eventsProvenance: 'live_session',
      config: { mode: 'traditional' },
      currentQuarter: 1,
      localScore: 5,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0
    });

    const s1 = await db.scores.add({
      matchId,
      teamId: tLocal,
      points: 3,
      quarter: 1,
      createdAt: new Date()
    });

    await db.scores.add({
      matchId,
      teamId: tLocal,
      points: 2,
      quarter: 1,
      createdAt: new Date()
    });

    // Eliminar anotación s1 de forma segura mediante GameActionsRepository
    const delResult = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: s1,
      type: 'score'
    });

    expect(delResult.success).toBe(true);
    expect(delResult.newScore?.local).toBe(2);

    const updatedMatch = await db.matches.get(matchId);
    expect(updatedMatch?.localScore).toBe(2);
  });

  // QA-14: Preservación de esquema v8 no destructivo y retrocompatible
  it('QA-14: el esquema de IndexedDB conserva la versión 8 sin requerir migraciones destructivas ni duplicación de índices', () => {
    expect(db.verno).toBe(8);

    // Verificar que las tablas esperadas existen con sus índices
    const matchTable = db.matches;
    expect(matchTable.schema.indexes.some(idx => idx.name === 'status')).toBe(true);
    expect(matchTable.schema.indexes.some(idx => idx.name === 'createdAt')).toBe(true);
    expect(matchTable.schema.indexes.some(idx => idx.name === 'config.mode')).toBe(true);
    expect(matchTable.schema.indexes.some(idx => idx.name === 'localTeamId')).toBe(true);
    expect(matchTable.schema.indexes.some(idx => idx.name === 'visitorTeamId')).toBe(true);

    const foulTable = db.fouls;
    expect(foulTable.schema.indexes.some(idx => idx.name === '[matchId+quarter]')).toBe(true);
    expect(foulTable.schema.indexes.some(idx => idx.name === '[matchId+teamId+quarter]')).toBe(true);
    expect(foulTable.schema.indexes.some(idx => idx.name === '[matchId+playerId]')).toBe(true);

    const scoreTable = db.scores;
    expect(scoreTable.schema.indexes.some(idx => idx.name === '[matchId+quarter]')).toBe(true);
  });
});
