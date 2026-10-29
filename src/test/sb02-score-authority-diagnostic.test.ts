// src/test/sb02-score-authority-diagnostic.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db';
import { GameActionsRepository } from '../db/gameActions.repository';
import type { Score } from '../db/models';

describe('R1.3-B: Diagnóstico de Autoridad de Marcadores y Riesgos SB-02', () => {
  let localTeamId: number;
  let visitorTeamId: number;

  beforeEach(async () => {
    await db.matches.clear();
    await db.teams.clear();
    await db.scores.clear();
    await db.fouls.clear();

    localTeamId = (await db.teams.add({
      name: 'Local Team',
      createdAt: new Date(),
      isArchived: false,
    })) as number;

    visitorTeamId = (await db.teams.add({
      name: 'Visitor Team',
      createdAt: new Date(),
      isArchived: false,
    })) as number;
  });

  it('D1: deleteActionSafely rechaza íntegramente la eliminación si existe una discrepancia preexistente (10 vs 6)', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      currentQuarter: 1,
      localScore: 10, // DISCREPANCIA INTENCIONAL: marcador almacenado = 10
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
    })) as number;

    // Pero en db.scores solo hay registros por un total real de 6 puntos (3 + 3)
    const score1 = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 1,
      createdAt: new Date(Date.now() - 2000),
    })) as number;

    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 1,
      createdAt: new Date(Date.now() - 1000),
    });

    const scoresBefore = await db.scores.where('matchId').equals(matchId).toArray();
    const sumBefore = scoresBefore.reduce((acc, s) => acc + s.points, 0);
    expect(sumBefore).toBe(6); // Real en BD = 6
    const matchBefore = await db.matches.get(matchId);
    expect(matchBefore?.localScore).toBe(10); // Almacenado = 10 (desfase de +4)

    // En R1.4, eliminar una acción cuando existe discrepancia comprobada (10 vs 6) debe ser rechazada íntegramente
    await expect(
      GameActionsRepository.deleteActionSafely({
        matchId,
        actionId: score1,
        type: 'score',
      })
    ).rejects.toThrow('Discrepancia detectada en el marcador');

    // Comprobar que ningún dato fue alterado
    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localScore).toBe(10);
    const scoreStillExists = await db.scores.get(score1);
    expect(scoreStillExists).toBeDefined();
  });

  it('D2: Rechazo de subdesbordamiento cuando el marcador almacenado es menor que el valor de la jugada', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      currentQuarter: 1,
      localScore: 1, // Marcador corrupto menor que la jugada real (3 pts)
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
    })) as number;

    const scoreId = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 1,
      createdAt: new Date(),
    })) as number;

    // R1.4: Rechazar subdesbordamiento sin truncar con Math.max
    await expect(
      GameActionsRepository.deleteActionSafely({
        matchId,
        actionId: scoreId,
        type: 'score',
      })
    ).rejects.toThrow('Subdesbordamiento de marcador detectado');

    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localScore).toBe(1);
    const scoreStillExists = await db.scores.get(scoreId);
    expect(scoreStillExists).toBeDefined();
  });

  it('D3: Modo Race — Semántica de revancha y peligro crítico de recálculo global sin filtrar por periodo', async () => {
    // 1. Simular un partido Race a 21 puntos
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'race',
        race: {
          targetScore: 21,
          currentGame: 1,
          hasRematches: true,
          winByTwo: false,
        },
      },
      localScore: 21,
      visitorScore: 15,
      localFouls: 2,
      visitorFouls: 1,
    })) as number;

    // Registros de anotaciones del Juego 1 (cerrado con victoria Local 21 - 15)
    await db.scores.bulkAdd([
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 50000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 40000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 30000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 25000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 20000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 15000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 10000) }, // Total = 21
    ] as Score[]);

    // 2. Ejecutar revancha (handleRematch): almacena juego en gameHistory y reinicia localScore a 0
    await db.matches.update(matchId, {
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
      ],
      config: {
        mode: 'race',
        race: {
          targetScore: 21,
          currentGame: 2, // Juego 2 activo
          hasRematches: true,
          winByTwo: false,
        },
      },
    });

    // 3. En Juego 2, Local anota 5 puntos en total (un triple y un doble)
    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 2,
      createdAt: new Date(Date.now() - 2000),
    });

    const scoreGame2 = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 2,
      createdAt: new Date(Date.now() - 1000),
    })) as number;

    await db.matches.update(matchId, { localScore: 5 });

    const matchGame2 = await db.matches.get(matchId);
    expect(matchGame2?.localScore).toBe(5); // El marcador vigente en Race es EXCLUSIVAMENTE del juego actual

    // 4. Si se elimina la última canasta de 2 puntos con deleteActionSafely:
    const deleteRes = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: scoreGame2,
      type: 'score',
    });
    expect(deleteRes.success).toBe(true);
    expect(deleteRes.newScore?.local).toBe(3); // 5 - 2 = 3 pts en Juego 2

    // 5. DEMOSTRACIÓN DE RIESGO: ¿Qué pasaría con un recálculo GLOBAL no filtrado?
    const allMatchScores = await db.scores.where('matchId').equals(matchId).toArray();
    const naiveGlobalRecalculatedLocal = allMatchScores
      .filter(s => s.teamId === localTeamId)
      .reduce((sum, s) => sum + s.points, 0);

    // Suma global = 21 (del juego 1) + 3 (del juego 2) = 24
    expect(naiveGlobalRecalculatedLocal).toBe(24);

    // Si se aplicara naiveGlobalRecalculatedLocal a match.localScore:
    // El juego 2 saltaría a 24 puntos y el motor Race declararía erróneamente un ganador INMEDIATO
    // de un juego que apenas va 3 a 0.
    expect(naiveGlobalRecalculatedLocal >= 21).toBe(true); // Superaría la meta de 21 inmediatamente

    // Por el contrario, un recálculo seguro DEBE filtrar por quarter === currentGame:
    const safeFilteredRecalculatedLocal = allMatchScores
      .filter(s => s.teamId === localTeamId && s.quarter === 2)
      .reduce((sum, s) => sum + s.points, 0);
    expect(safeFilteredRecalculatedLocal).toBe(3); // Correcto para Juego 2
  });

  it('D4: Modo Best-of-Series — Semántica de set y peligro de recálculo global no filtrado', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 2, // Set 2 en curso
          wins: { local: 1, visitor: 0 },
        },
      },
      currentQuarter: 2,
      localScore: 6, // Marcador del SET 2
      visitorScore: 4,
      localFouls: 0,
      visitorFouls: 0,
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
      ],
    })) as number;

    // Scores del Set 1 (21 pts)
    await db.scores.bulkAdd([
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 30000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 25000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 20000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 15000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 10000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 8000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 6000) },
    ] as Score[]);

    // Scores del Set 2 (6 pts)
    await db.scores.bulkAdd([
      { matchId, teamId: localTeamId, points: 3, quarter: 2, createdAt: new Date(Date.now() - 2000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 2, createdAt: new Date(Date.now() - 1000) },
    ] as Score[]);

    const allScores = await db.scores.where('matchId').equals(matchId).toArray();
    const naiveTotal = allScores
      .filter(s => s.teamId === localTeamId)
      .reduce((acc, s) => acc + s.points, 0);

    // Suma global = 21 + 6 = 27
    expect(naiveTotal).toBe(27);

    // En cambio, el marcador del set activo es 6
    const set2Scores = allScores
      .filter(s => s.teamId === localTeamId && s.quarter === 2)
      .reduce((acc, s) => acc + s.points, 0);
    expect(set2Scores).toBe(6);

    const match = await db.matches.get(matchId);
    expect(match?.localScore).toBe(6);
  });

  it('D5: Protección activa contra eliminación de jugadas de periodos anteriores ya cerrados', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'race',
        race: { targetScore: 21, currentGame: 2, hasRematches: true },
      },
      localScore: 4,
      visitorScore: 2,
      localFouls: 0,
      visitorFouls: 0,
    })) as number;

    const oldScoreId = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1, // Pertenece a un juego cerrado
      createdAt: new Date(Date.now() - 100000),
    })) as number;

    // Intentar eliminar debe ser rechazado
    await expect(
      GameActionsRepository.deleteActionSafely({
        matchId,
        actionId: oldScoreId,
        type: 'score',
      })
    ).rejects.toThrow('No se pueden eliminar acciones de juegos o sets anteriores ya cerrados.');

    // El marcador del juego 2 debe permanecer intacto
    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localScore).toBe(4);
  });

  it('D6: Modo Traditional — Puntos acumulados en matches vs Faltas visualizadas por cuarto', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 },
      },
      currentQuarter: 2, // Cuarto 2
      localScore: 25,    // Puntos acumulados de Q1 + Q2
      visitorScore: 20,
      localFouls: 4,     // Faltas acumuladas en matches.localFouls (2 en Q1 + 2 en Q2)
      visitorFouls: 3,
    })) as number;

    // Faltas en BD: 2 en Q1 y 2 en Q2
    await db.fouls.bulkAdd([
      { matchId, teamId: localTeamId, quarter: 1, createdAt: new Date(Date.now() - 50000) },
      { matchId, teamId: localTeamId, quarter: 1, createdAt: new Date(Date.now() - 40000) },
      { matchId, teamId: localTeamId, quarter: 2, createdAt: new Date(Date.now() - 20000) },
      { matchId, teamId: localTeamId, quarter: 2, createdAt: new Date(Date.now() - 10000) },
    ]);

    const fouls = await db.fouls.where('matchId').equals(matchId).toArray();
    const totalLocalFouls = fouls.filter(f => f.teamId === localTeamId).length;
    const q2LocalFouls = fouls.filter(f => f.teamId === localTeamId && f.quarter === 2).length;

    expect(totalLocalFouls).toBe(4); // matches.localFouls guarda el total del partido (4)
    expect(q2LocalFouls).toBe(2);    // TraditionalEngine muestra las faltas del cuarto actual (2) para bonus
  });
});
