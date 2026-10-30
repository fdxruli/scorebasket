import React from 'react';
// src/test/sb04-series-integrity.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db';
import { SeriesService } from '../db/series.service';
import { ScoreIntegrityService, validateGameHistoryContinuity } from '../db/scoreIntegrity.service';
import { GameActionsRepository } from '../db/gameActions.repository';
import type { Match, Score } from '../db/models';
import { useSeriesLogic } from '../features/match-creations/hooks/useSeriesLogic';

describe('SB_PHASE2A_R1: Integridad Transaccional, Idempotencia y Cierre de Best-of-Series', () => {
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

  const populateScoresForQuarter = async (
    matchId: number,
    quarter: number,
    localScore: number,
    visitorScore: number,
    options: { localPlayerId?: number; visitorPlayerId?: number } = {}
  ) => {
    const buildScoreList = (teamId: number, totalPoints: number, playerId?: number) => {
      const list: Omit<Score, 'id'>[] = [];
      let rem = totalPoints;
      let offset = 0;
      while (rem > 0) {
        const pts = rem >= 3 ? 3 : rem >= 2 ? 2 : 1;
        list.push({
          matchId,
          teamId,
          points: pts,
          quarter,
          playerId,
          createdAt: new Date(Date.now() - 60000 + (offset++) * 1000),
        });
        rem -= pts;
      }
      return list;
    };

    const localList = buildScoreList(localTeamId, localScore, options.localPlayerId);
    const visitorList = buildScoreList(visitorTeamId, visitorScore, options.visitorPlayerId);
    if (localList.length > 0) await db.scores.bulkAdd(localList as Score[]);
    if (visitorList.length > 0) await db.scores.bulkAdd(visitorList as Score[]);
  };

  const createBaseSeriesMatch = async (
    overrides: Partial<Match> = {},
    options: { createScores?: boolean; localPlayerId?: number; visitorPlayerId?: number } = { createScores: true }
  ) => {
    const localScore = overrides.localScore ?? 21;
    const visitorScore = overrides.visitorScore ?? 18;
    const currentQuarter = overrides.currentQuarter ?? 1;

    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      eventsProvenance: 'live_session',
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: currentQuarter,
          wins: { local: 0, visitor: 0 },
          winByTwo: false,
        },
      },
      currentQuarter,
      localScore,
      visitorScore,
      localFouls: 2,
      visitorFouls: 3,
      gameHistory: [],
      ...overrides,
    })) as number;

    if (options.createScores !== false && (localScore > 0 || visitorScore > 0)) {
      await populateScoresForQuarter(matchId, currentQuarter, localScore, visitorScore, {
        localPlayerId: options.localPlayerId,
        visitorPlayerId: options.visitorPlayerId,
      });
    }

    return matchId;
  };

  // T-SERIES-01: set no decisivo correcto
  it('T-SERIES-01: set no decisivo correcto avanza el set y mantiene la serie activa', async () => {
    const matchId = await createBaseSeriesMatch();

    const result = await SeriesService.confirmSet({
      matchId,
      setNumber: 1,
    });

    expect(result.status).toBe('confirmed');
    if (result.status === 'confirmed') {
      expect(result.seriesFinished).toBe(false);
      expect(result.setNumber).toBe(1);
      expect(result.winnerTeamId).toBe(localTeamId);
      expect(result.newWins).toEqual({ local: 1, visitor: 0 });
    }

    const matchAfter = (await db.matches.get(matchId))!;
    expect(matchAfter.status).toBe('playing');
    expect(matchAfter.finishedAt).toBeUndefined();
    expect(matchAfter.gameHistory).toHaveLength(1);
    expect(matchAfter.gameHistory![0]).toMatchObject({
      gameNumber: 1,
      localScore: 21,
      visitorScore: 18,
      winner: 'local',
    });
  });

  // T-SERIES-02: actualización exacta de victorias
  it('T-SERIES-02: actualización exacta de victorias para local y visitante', async () => {
    // Set 1 ganado por visitante (18 - 21)
    const matchId = await createBaseSeriesMatch({
      localScore: 18,
      visitorScore: 21,
    });

    const res1 = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(res1.status).toBe('confirmed');
    let match = (await db.matches.get(matchId))!;
    expect(match.config.bestOf?.wins).toEqual({ local: 0, visitor: 1 });

    // Set 2 ganado por local (21 - 12)
    await db.matches.update(matchId, { localScore: 21, visitorScore: 12 });
    await populateScoresForQuarter(matchId, 2, 21, 12);
    const res2 = await SeriesService.confirmSet({ matchId, setNumber: 2 });
    expect(res2.status).toBe('confirmed');
    match = (await db.matches.get(matchId))!;
    expect(match.config.bestOf?.wins).toEqual({ local: 1, visitor: 1 });
  });

  // T-SERIES-03: avance único del periodo
  it('T-SERIES-03: avance único del periodo en currentQuarter y config.bestOf.currentGame', async () => {
    const matchId = await createBaseSeriesMatch();

    await SeriesService.confirmSet({ matchId, setNumber: 1 });

    const match = (await db.matches.get(matchId))!;
    expect(match.currentQuarter).toBe(2);
    expect(match.config.bestOf?.currentGame).toBe(2);
  });

  // T-SERIES-04: reinicio correcto del marcador del nuevo set
  it('T-SERIES-04: reinicio correcto de puntuaciones y faltas para el nuevo set', async () => {
    const matchId = await createBaseSeriesMatch({
      localScore: 21,
      visitorScore: 19,
      localFouls: 4,
      visitorFouls: 2,
    });

    await SeriesService.confirmSet({ matchId, setNumber: 1 });

    const match = (await db.matches.get(matchId))!;
    expect(match.localScore).toBe(0);
    expect(match.visitorScore).toBe(0);
    expect(match.localFouls).toBe(0);
    expect(match.visitorFouls).toBe(0);
  });

  // T-SERIES-05: confirmación repetida sin mutación (idempotencia pura)
  it('T-SERIES-05: confirmación repetida devuelve already_confirmed sin mutar estado ni historial', async () => {
    const matchId = await createBaseSeriesMatch();

    const res1 = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(res1.status).toBe('confirmed');

    const snapshot = (await db.matches.get(matchId))!;

    // Segunda llamada idéntica
    const res2 = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(res2.status).toBe('already_confirmed');

    const matchAfterSecond = (await db.matches.get(matchId))!;
    expect(matchAfterSecond.config.bestOf?.wins).toEqual(snapshot.config.bestOf?.wins);
    expect(matchAfterSecond.currentQuarter).toBe(snapshot.currentQuarter);
    expect(matchAfterSecond.gameHistory).toEqual(snapshot.gameHistory);
  });

  // T-SERIES-06: dos confirmaciones concurrentes con Promise.all
  it('T-SERIES-06: dos confirmaciones concurrentes con Promise.all producen una sola transición persistida', async () => {
    const matchId = await createBaseSeriesMatch();

    const [resA, resB] = await Promise.all([
      SeriesService.confirmSet({ matchId, setNumber: 1 }),
      SeriesService.confirmSet({ matchId, setNumber: 1 }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual(['already_confirmed', 'confirmed']);

    const match = (await db.matches.get(matchId))!;
    expect(match.gameHistory).toHaveLength(1);
    expect(match.config.bestOf?.wins).toEqual({ local: 1, visitor: 0 });
    expect(match.currentQuarter).toBe(2);
  });

  // T-SERIES-07: callback atrasado tras avanzar al siguiente set
  it('T-SERIES-07: callback atrasado tras avanzar al siguiente set no altera el nuevo set', async () => {
    const matchId = await createBaseSeriesMatch();

    await SeriesService.confirmSet({ matchId, setNumber: 1 });

    // Ahora estamos en set 2 con marcador parcial (5-3) y sus eventos
    await db.matches.update(matchId, { localScore: 5, visitorScore: 3 });
    await populateScoresForQuarter(matchId, 2, 5, 3);

    // Llega confirmación retrasada del set 1
    const delayedRes = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(delayedRes.status).toBe('already_confirmed');

    const match = (await db.matches.get(matchId))!;
    expect(match.currentQuarter).toBe(2);
    expect(match.localScore).toBe(5);
    expect(match.visitorScore).toBe(3);
    expect(match.gameHistory).toHaveLength(1);
  });

  // T-SERIES-08: rechazo de resultados históricos contradictorios
  it('T-SERIES-08: rechazo de resultados históricos contradictorios', async () => {
    const matchId = await createBaseSeriesMatch();
    await SeriesService.confirmSet({ matchId, setNumber: 1 });

    // Intento de reconfirmar set 1 indicando un ganador contradictorio
    const resConflict = await SeriesService.confirmSet({
      matchId,
      setNumber: 1,
      expectedWinnerId: visitorTeamId,
    });

    expect(resConflict.status).toBe('rejected');
    if (resConflict.status === 'rejected') {
      expect(resConflict.reason).toMatch(/Conflicto de resultado histórico/i);
    }
  });

  // T-SERIES-09: rechazo de historial duplicado o incompleto
  it('T-SERIES-09: rechazo si el historial previo contiene duplicados o huecos', async () => {
    // Match configurado en set 3 pero sin set 1 en el historial (hueco)
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 3,
      localScore: 21,
      visitorScore: 10,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 3,
          wins: { local: 1, visitor: 0 },
        },
      },
      gameHistory: [
        { gameNumber: 2, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
      ],
    });

    const res = await SeriesService.confirmSet({ matchId, setNumber: 3 });
    expect(res.status).toBe('rejected');
    if (res.status === 'rejected') {
      expect(res.reason).toMatch(/Violación de integridad histórica previa/i);
    }
  });

  // T-SERIES-10: ganador inválido o ausente
  it('T-SERIES-10: rechaza confirmar cuando no existe un ganador reglamentario', async () => {
    const matchId = await createBaseSeriesMatch({
      localScore: 19,
      visitorScore: 15, // Meta es 21
    });

    const res = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(res.status).toBe('rejected');
    if (res.status === 'rejected') {
      expect(res.reason).toMatch(/no tiene un ganador reglamentario/i);
    }

    const match = (await db.matches.get(matchId))!;
    expect(match.gameHistory).toHaveLength(0);
    expect(match.currentQuarter).toBe(1);
  });

  // T-SERIES-11: diferencia de dos puntos exigida
  it('T-SERIES-11: respeta la regla winByTwo cuando está habilitada', async () => {
    const matchId = await createBaseSeriesMatch({
      localScore: 21,
      visitorScore: 20,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 1,
          wins: { local: 0, visitor: 0 },
          winByTwo: true,
        },
      },
    });

    // 21 - 20 no cumple winByTwo
    const resReject = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(resReject.status).toBe('rejected');

    // 22 - 20 sí cumple winByTwo
    await db.matches.update(matchId, { localScore: 22 });
    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 1,
      quarter: 1,
      createdAt: new Date(),
    } as Score);

    const resPass = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(resPass.status).toBe('confirmed');
  });

  // T-SERIES-12: finalización decisiva de Best-of-3
  it('T-SERIES-12: finalización decisiva de Best-of-3 al alcanzar 2 victorias', async () => {
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 2,
      localScore: 21,
      visitorScore: 14,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 2,
          wins: { local: 1, visitor: 0 },
        },
      },
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 17, winner: 'local', finishedAt: new Date(Date.now() - 60000) },
      ],
    });

    // Eventos históricos del set 1
    await populateScoresForQuarter(matchId, 1, 21, 17);

    const result = await SeriesService.confirmSet({ matchId, setNumber: 2 });
    expect(result.status).toBe('confirmed');
    if (result.status === 'confirmed') {
      expect(result.seriesFinished).toBe(true);
      expect(result.newWins).toEqual({ local: 2, visitor: 0 });
    }

    const match = (await db.matches.get(matchId))!;
    expect(match.status).toBe('finished');
    expect(match.finishedAt).toBeInstanceOf(Date);
    expect(match.gameHistory).toHaveLength(2);
    expect(match.config.bestOf?.wins).toEqual({ local: 2, visitor: 0 });
    expect(match.localScore).toBe(21);
    expect(match.visitorScore).toBe(14);
  });

  // T-SERIES-13: finalización decisiva de Best-of-1
  it('T-SERIES-13: finalización decisiva de Best-of-1 en el primer set', async () => {
    const matchId = await createBaseSeriesMatch({
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 1,
          targetScorePerGame: 21,
          currentGame: 1,
          wins: { local: 0, visitor: 0 },
        },
      },
    });

    const result = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(result.status).toBe('confirmed');
    if (result.status === 'confirmed') {
      expect(result.seriesFinished).toBe(true);
    }

    const match = (await db.matches.get(matchId))!;
    expect(match.status).toBe('finished');
    expect(match.finishedAt).toBeDefined();
    expect(match.gameHistory).toHaveLength(1);
    expect(match.config.bestOf?.wins).toEqual({ local: 1, visitor: 0 });
  });

  // T-SERIES-14: verificación de integridad tras finalizar la serie, incluida la entrada del último set
  it('T-SERIES-14: verificación de integridad consistente tras finalizar la serie con entrada final', async () => {
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 2,
      localScore: 21,
      visitorScore: 19,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 2,
          wins: { local: 1, visitor: 0 },
        },
      },
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date(Date.now() - 30000) },
      ],
    }, { createScores: false });

    // Puntos en scores para set 2 (7 canastas de 3 puntos para local = 21)
    for (let i = 0; i < 7; i++) {
      await db.scores.add({
        matchId,
        teamId: localTeamId,
        points: 3,
        quarter: 2,
        createdAt: new Date(Date.now() - 20000 + i * 1000),
      } as Score);
    }
    // Puntos en scores para set 2 para visitante (19 puntos)
    await db.scores.bulkAdd([
      { matchId, teamId: visitorTeamId, points: 3, quarter: 2, createdAt: new Date(Date.now() - 10000) },
      { matchId, teamId: visitorTeamId, points: 3, quarter: 2, createdAt: new Date(Date.now() - 9000) },
      { matchId, teamId: visitorTeamId, points: 3, quarter: 2, createdAt: new Date(Date.now() - 8000) },
      { matchId, teamId: visitorTeamId, points: 3, quarter: 2, createdAt: new Date(Date.now() - 7000) },
      { matchId, teamId: visitorTeamId, points: 3, quarter: 2, createdAt: new Date(Date.now() - 6000) },
      { matchId, teamId: visitorTeamId, points: 2, quarter: 2, createdAt: new Date(Date.now() - 5000) },
      { matchId, teamId: visitorTeamId, points: 2, quarter: 2, createdAt: new Date(Date.now() - 4000) },
    ] as Score[]);

    await SeriesService.confirmSet({ matchId, setNumber: 2 });

    const finishedMatch = (await db.matches.get(matchId))!;
    const scores = await db.scores.where('matchId').equals(matchId).toArray();

    const integrity = ScoreIntegrityService.verifyScoreIntegrity(finishedMatch, scores);
    expect(integrity.status).toBe('CONSISTENT');
    expect(integrity.isCompleteHistory).toBe(true);
  });

  // T-SERIES-15: persistencia tras recarga simulada
  it('T-SERIES-15: persistencia de datos y estado finished tras recarga simulada', async () => {
    const matchId = await createBaseSeriesMatch({
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 1,
          targetScorePerGame: 21,
          currentGame: 1,
          wins: { local: 0, visitor: 0 },
        },
      },
    });

    await SeriesService.confirmSet({ matchId, setNumber: 1 });

    // Simulación de recarga: nueva lectura fresca directamente desde IndexedDB
    const reloadedMatch = (await db.matches.get(matchId))!;
    expect(reloadedMatch.status).toBe('finished');
    expect(reloadedMatch.finishedAt).toBeDefined();
    expect(reloadedMatch.config.bestOf?.wins).toEqual({ local: 1, visitor: 0 });
    expect(reloadedMatch.gameHistory).toHaveLength(1);
    expect(reloadedMatch.gameHistory![0].winner).toBe('local');
  });

  // T-SERIES-16: cierre anticipado sin fabricar victorias
  it('T-SERIES-16: cierre anticipado sin countCurrentSet no fabrica victorias ficticias', async () => {
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 2,
      localScore: 10,
      visitorScore: 6,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 2,
          wins: { local: 1, visitor: 0 },
        },
      },
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date(Date.now() - 60000) },
      ],
    });

    const res = await SeriesService.finishSeriesEarly({
      matchId,
      countCurrentSet: false,
    });

    expect(res.status).toBe('finished');
    const match = (await db.matches.get(matchId))!;
    expect(match.status).toBe('finished');
    expect(match.config.bestOf?.wins).toEqual({ local: 1, visitor: 0 }); // Intactas
    expect(match.gameHistory).toHaveLength(1); // Set 2 NO fue añadido como victoria falsa
  });

  // T-SERIES-17: finalización idempotente
  it('T-SERIES-17: finalización idempotente en llamadas repetidas a finishSeriesEarly', async () => {
    const matchId = await createBaseSeriesMatch();
    await SeriesService.finishSeriesEarly({ matchId, countCurrentSet: false });

    const resRepeat = await SeriesService.finishSeriesEarly({ matchId, countCurrentSet: false });
    expect(resRepeat.status).toBe('already_finished');
  });

  // T-SERIES-18: rollback ante fallo transaccional real invocando SeriesService
  it('T-SERIES-18: rollback transaccional ante error inyectado no deja mutaciones parciales', async () => {
    const matchId = await createBaseSeriesMatch();
    const snapshotBefore = (await db.matches.get(matchId))!;
    const scoresBefore = await db.scores.where('matchId').equals(matchId).toArray();

    // Provocamos una excepción post-escritura en SeriesService.confirmSet mediante hook de test aislado
    SeriesService.__setTestPostWriteHook(() => {});
    try {
      await expect(
        SeriesService.confirmSet({
          matchId,
          setNumber: 1,
        })
      ).rejects.toThrow(/Inyección de fallo post-escritura/i);
    } finally {
      SeriesService.__setTestPostWriteHook(null);
    }

    // Verificamos que la instantánea de IndexedDB es exactamente idéntica
    const matchAfter = (await db.matches.get(matchId))!;
    const scoresAfter = await db.scores.where('matchId').equals(matchId).toArray();

    expect(matchAfter.localScore).toBe(snapshotBefore.localScore);
    expect(matchAfter.visitorScore).toBe(snapshotBefore.visitorScore);
    expect(matchAfter.status).toBe(snapshotBefore.status);
    expect(matchAfter.finishedAt).toBe(snapshotBefore.finishedAt);
    expect(matchAfter.currentQuarter).toBe(snapshotBefore.currentQuarter);
    expect(matchAfter.gameHistory).toEqual(snapshotBefore.gameHistory);
    expect(matchAfter.config.bestOf?.wins).toEqual(snapshotBefore.config.bestOf?.wins);
    expect(matchAfter.config.bestOf?.currentGame).toBe(snapshotBefore.config.bestOf?.currentGame);
    expect(scoresAfter).toEqual(scoresBefore);
  });

  // T-SERIES-19: un partido finalizado no admite nuevas confirmaciones ni modificaciones
  it('T-SERIES-19: un partido finalizado no admite nuevas confirmaciones ni eliminación de acciones', async () => {
    const matchId = await createBaseSeriesMatch({
      status: 'finished',
      finishedAt: new Date(),
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: new Date() },
      ],
    });

    // Intentar confirmar un nuevo set 2 en partido finalizado
    const resConfirm = await SeriesService.confirmSet({ matchId, setNumber: 2 });
    expect(resConfirm.status).toBe('rejected');
    if (resConfirm.status === 'rejected') {
      expect(resConfirm.reason).toMatch(/No se pueden registrar nuevos sets en un partido ya finalizado/i);
    }

    // Intentar eliminar acciones de partido finalizado
    const scoreId = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1,
      createdAt: new Date(),
    })) as number;

    await expect(
      GameActionsRepository.deleteActionSafely({
        matchId,
        actionId: scoreId,
        type: 'score',
      })
    ).rejects.toThrow(/partido finalizado/i);
  });

  // T-SERIES-20: un partido legacy con procedencia no acreditada no debe recibir marcadores falsos de completitud
  it('T-SERIES-20: partido con procedencia unverified no se marca como completitud acreditada', async () => {
    const matchId = await createBaseSeriesMatch({
      eventsProvenance: 'unverified',
      status: 'finished',
      finishedAt: new Date(),
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: new Date() },
      ],
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 1,
          targetScorePerGame: 21,
          currentGame: 1,
          wins: { local: 1, visitor: 0 },
        },
      },
    }, { createScores: false });

    const match = (await db.matches.get(matchId))!;
    const integrity = ScoreIntegrityService.verifyScoreIntegrity(match, []);
    expect(integrity.status).toBe('UNVERIFIED');
    expect(integrity.isCompleteHistory).toBe(false);
  });

  // --- R1.1: NUEVAS PRUEBAS OBLIGATORIAS (R11-01 a R11-15) ---

  // R11-01: marcador 21–18 sin eventos; la confirmación no puede acreditarse como íntegra ni persistir un cierre falsamente certificado
  it('R11-01: marcador 21–18 sin eventos es rechazado y no permite confirmar set', async () => {
    const matchId = await createBaseSeriesMatch({}, { createScores: false });

    const result = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toMatch(/Integridad de eventos no verificable/i);
    }

    const matchAfter = (await db.matches.get(matchId))!;
    expect(matchAfter.status).toBe('playing');
    expect(matchAfter.gameHistory).toHaveLength(0);
    expect(matchAfter.currentQuarter).toBe(1);
  });

  // R11-02: marcador distinto a la suma real de eventos; rechazar y preservar instantánea
  it('R11-02: marcador distinto a la suma real de eventos es rechazado y preserva la instantánea', async () => {
    const matchId = await createBaseSeriesMatch({
      localScore: 21,
      visitorScore: 18,
    }, { createScores: false });

    // Eventos suman solo 18 para local en vez de 21
    await populateScoresForQuarter(matchId, 1, 18, 18);

    const snapshotBefore = (await db.matches.get(matchId))!;

    const result = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toMatch(/Discrepancia detectada en el marcador/i);
    }

    const matchAfter = (await db.matches.get(matchId))!;
    expect(matchAfter).toEqual(snapshotBefore);
  });

  // R11-03: eventos de otro set o partido; no deben justificar el marcador
  it('R11-03: eventos de otro set o partido no justifican el marcador del set vigente', async () => {
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 1,
      localScore: 21,
      visitorScore: 18,
    }, { createScores: false });

    // Eventos registrados con quarter 2 (no el vigente 1)
    await populateScoresForQuarter(matchId, 2, 21, 18);

    const result = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toMatch(/Integridad de eventos no verificable/i);
    }
  });

  // R11-04: partido con eventos válidos; confirmar set no decisivo con integridad preservada
  it('R11-04: partido con eventos válidos confirma set no decisivo preservando integridad', async () => {
    const matchId = await createBaseSeriesMatch({
      localScore: 21,
      visitorScore: 18,
    });

    const result = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(result.status).toBe('confirmed');
    if (result.status === 'confirmed') {
      expect(result.seriesFinished).toBe(false);
      expect(result.newWins).toEqual({ local: 1, visitor: 0 });
    }

    const matchAfter = (await db.matches.get(matchId))!;
    expect(matchAfter.currentQuarter).toBe(2);
    expect(matchAfter.localScore).toBe(0);
    expect(matchAfter.visitorScore).toBe(0);
    expect(matchAfter.gameHistory).toHaveLength(1);
  });

  // R11-05: partido con eventos válidos; confirmar último set y comprobar CONSISTENT e isCompleteHistory === true
  it('R11-05: partido con eventos válidos confirma último set con CONSISTENT e isCompleteHistory === true', async () => {
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 2,
      localScore: 21,
      visitorScore: 15,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 2,
          wins: { local: 1, visitor: 0 },
        },
      },
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date(Date.now() - 30000) },
      ],
    });

    const result = await SeriesService.confirmSet({ matchId, setNumber: 2 });
    expect(result.status).toBe('confirmed');
    if (result.status === 'confirmed') {
      expect(result.seriesFinished).toBe(true);
    }

    const finishedMatch = (await db.matches.get(matchId))!;
    const scores = await db.scores.where('matchId').equals(matchId).toArray();

    const integrity = ScoreIntegrityService.verifyScoreIntegrity(finishedMatch, scores);
    expect(integrity.status).toBe('CONSISTENT');
    expect(integrity.isCompleteHistory).toBe(true);
  });

  // R11-06: cierre anticipado con historial previo incompleto; rechazar sin mutaciones
  it('R11-06: cierre anticipado con historial previo incompleto rechaza sin mutaciones', async () => {
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 3,
      localScore: 10,
      visitorScore: 8,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 3,
          wins: { local: 1, visitor: 0 },
        },
      },
      gameHistory: [
        // Falta set 2 (hueco)
        { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
      ],
    });

    const snapshotBefore = (await db.matches.get(matchId))!;

    const result = await SeriesService.finishSeriesEarly({
      matchId,
      countCurrentSet: false,
    });

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toMatch(/Violación de integridad histórica previa/i);
    }

    const matchAfter = (await db.matches.get(matchId))!;
    expect(matchAfter).toEqual(snapshotBefore);
  });

  // R11-07: cierre anticipado con victorias contradictorias; rechazar
  it('R11-07: cierre anticipado con victorias contradictorias rechaza la operación', async () => {
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 2,
      localScore: 10,
      visitorScore: 6,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 2,
          wins: { local: 0, visitor: 1 }, // Contradice victoria local en set 1
        },
      },
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
      ],
    });

    const result = await SeriesService.finishSeriesEarly({
      matchId,
      countCurrentSet: false,
    });

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toMatch(/Incoherencia en Best-of-Series: victorias acumuladas/i);
    }
  });

  // R11-08: cierre anticipado sin contabilizar set; conservar resultados previos y verificar el contrato de estado final
  it('R11-08: cierre anticipado sin contabilizar set conserva resultados previos y verifica el contrato de estado final', async () => {
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 2,
      localScore: 10,
      visitorScore: 6,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 2,
          wins: { local: 1, visitor: 0 },
        },
      },
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date(Date.now() - 40000) },
      ],
    });

    const result = await SeriesService.finishSeriesEarly({
      matchId,
      countCurrentSet: false,
    });

    expect(result.status).toBe('finished');
    if (result.status === 'finished') {
      expect(result.finalWins).toEqual({ local: 1, visitor: 0 });
    }

    const finishedMatch = (await db.matches.get(matchId))!;
    expect(finishedMatch.status).toBe('finished');
    expect(finishedMatch.gameHistory).toHaveLength(1); // Set 2 no se agregó
    expect(finishedMatch.config.bestOf?.wins).toEqual({ local: 1, visitor: 0 });

    const scores = await db.scores.where('matchId').equals(matchId).toArray();
    const integrity = ScoreIntegrityService.verifyScoreIntegrity(finishedMatch, scores);
    expect(integrity.status).toBe('CONSISTENT');
    expect(integrity.isCompleteHistory).toBe(true);
  });

  // R11-09: cierre anticipado contabilizando set con marcador legítimo y eventos coherentes
  it('R11-09: cierre anticipado contabilizando set con marcador legítimo y eventos coherentes', async () => {
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 2,
      localScore: 12,
      visitorScore: 8,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 2,
          wins: { local: 1, visitor: 0 },
        },
      },
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date(Date.now() - 40000) },
      ],
    });

    const result = await SeriesService.finishSeriesEarly({
      matchId,
      countCurrentSet: true,
    });

    expect(result.status).toBe('finished');
    if (result.status === 'finished') {
      expect(result.finalWins).toEqual({ local: 2, visitor: 0 });
    }

    const finishedMatch = (await db.matches.get(matchId))!;
    expect(finishedMatch.status).toBe('finished');
    expect(finishedMatch.gameHistory).toHaveLength(2);
    expect(finishedMatch.gameHistory![1]).toMatchObject({
      gameNumber: 2,
      localScore: 12,
      visitorScore: 8,
      winner: 'local',
    });
    expect(finishedMatch.config.bestOf?.wins).toEqual({ local: 2, visitor: 0 });

    const scores = await db.scores.where('matchId').equals(matchId).toArray();
    const integrity = ScoreIntegrityService.verifyScoreIntegrity(finishedMatch, scores);
    expect(integrity.status).toBe('CONSISTENT');
    expect(integrity.isCompleteHistory).toBe(true);
  });

  // R11-10: cierre anticipado de set con anotaciones inconsistentes; no certificar un resultado falso
  it('R11-10: cierre anticipado de set con anotaciones inconsistentes rechaza sin actualizar', async () => {
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 2,
      localScore: 12,
      visitorScore: 8,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 2,
          wins: { local: 1, visitor: 0 },
        },
      },
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
      ],
    }, { createScores: false });

    // Eventos solo suman 6 para local en vez de 12
    await populateScoresForQuarter(matchId, 2, 6, 8);

    const snapshotBefore = (await db.matches.get(matchId))!;

    const result = await SeriesService.finishSeriesEarly({
      matchId,
      countCurrentSet: true,
    });

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toMatch(/Discrepancia detectada en el marcador/i);
    }

    const matchAfter = (await db.matches.get(matchId))!;
    expect(matchAfter).toEqual(snapshotBefore);
  });

  // R11-11: invocación repetida de confirmación sobre historial duplicado; no responder como éxito idempotente
  it('R11-11: confirmación repetida sobre historial corrupto con duplicados rechaza en vez de aceptar', async () => {
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 2,
      localScore: 0,
      visitorScore: 0,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 2,
          wins: { local: 2, visitor: 0 },
        },
      },
      gameHistory: [
        // Set 1 duplicado en historial
        { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
        { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
      ],
    }, { createScores: false });

    const result = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toMatch(/Historial corrupto: existen múltiples entradas duplicadas/i);
    }
  });

  // R11-12: inyección de fallo después de la escritura real del servicio en finishSeriesEarly; rollback íntegro
  it('R11-12: inyección de fallo después de la escritura real en finishSeriesEarly realiza rollback íntegro', async () => {
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 2,
      localScore: 10,
      visitorScore: 6,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 2,
          wins: { local: 1, visitor: 0 },
        },
      },
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
      ],
    });

    const snapshotBefore = (await db.matches.get(matchId))!;
    const scoresBefore = await db.scores.where('matchId').equals(matchId).toArray();

    SeriesService.__setTestPostWriteHook(() => {});
    try {
      await expect(
        SeriesService.finishSeriesEarly({
          matchId,
          countCurrentSet: true,
        })
      ).rejects.toThrow(/Inyección de fallo post-escritura/i);
    } finally {
      SeriesService.__setTestPostWriteHook(null);
    }

    const matchAfter = (await db.matches.get(matchId))!;
    const scoresAfter = await db.scores.where('matchId').equals(matchId).toArray();

    expect(matchAfter).toEqual(snapshotBefore);
    expect(scoresAfter).toEqual(scoresBefore);
  });

  // R11-13: doble confirmación concurrente válida con eventos reales; una sola transición
  it('R11-13: doble confirmación concurrente con eventos reales produce una sola transición y ya confirmado', async () => {
    const matchId = await createBaseSeriesMatch({
      localScore: 21,
      visitorScore: 18,
    });

    const [resA, resB] = await Promise.all([
      SeriesService.confirmSet({ matchId, setNumber: 1 }),
      SeriesService.confirmSet({ matchId, setNumber: 1 }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual(['already_confirmed', 'confirmed']);

    const match = (await db.matches.get(matchId))!;
    expect(match.gameHistory).toHaveLength(1);
    expect(match.config.bestOf?.wins).toEqual({ local: 1, visitor: 0 });
    expect(match.currentQuarter).toBe(2);
  });

  // R11-14: corrección y confirmación de set con puntos contabilizados por jugadores, sin pérdida de eventos
  it('R11-14: corrección y confirmación de set con puntos contabilizados por jugadores conserva playerId y eventos', async () => {
    const playerId = 42;
    const matchId = await createBaseSeriesMatch({
      localScore: 20,
      visitorScore: 18,
    }, { createScores: true, localPlayerId: playerId });

    // Jugador anota el punto 21 decisivo
    const lastScoreId = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 1,
      quarter: 1,
      playerId,
      createdAt: new Date(),
    })) as number;

    await db.matches.update(matchId, { localScore: 21 });

    // Confirmar set
    const result = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(result.status).toBe('confirmed');

    // Comprobar que los scores en BD conservan su playerId
    const playerScores = await db.scores.where('matchId').equals(matchId).filter(s => s.playerId === playerId).toArray();
    expect(playerScores.length).toBeGreaterThan(0);
    const lastScore = await db.scores.get(lastScoreId);
    expect(lastScore?.playerId).toBe(playerId);
  });

  // R11-15: pruebas de Race terminado, activo y cierre anticipado contra el verificador compartido
  it('R11-15: validador compartido distingue correctamente Race activo, terminado y cierre anticipado', () => {
    // 1. Race activo: juego actual en historial es rechazado
    const raceActive = validateGameHistoryContinuity({
      mode: 'race',
      effectivePeriod: 2,
      isFinished: false,
      history: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
        { gameNumber: 2, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
      ],
    });
    expect(raceActive.isValid).toBe(false);
    expect(raceActive.reason).toMatch(/periodo #2 ya figura cerrado/i);

    // 2. Race terminado legítimo con juego final incluido: válido
    const raceFinished = validateGameHistoryContinuity({
      mode: 'race',
      effectivePeriod: 2,
      isFinished: true,
      matchScore: { local: 21, visitor: 18 },
      history: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
        { gameNumber: 2, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
      ],
    });
    expect(raceFinished.isValid).toBe(true);

    // 3. Race cerrado anticipadamente sin juego 2 en historial: válido
    const raceEarly = validateGameHistoryContinuity({
      mode: 'race',
      effectivePeriod: 2,
      isFinished: true,
      matchScore: { local: 10, visitor: 8 },
      history: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
      ],
    });
    expect(raceEarly.isValid).toBe(true);

    // 4. Race terminado con marcador contradictorio en el juego final: rechazado
    const raceMismatch = validateGameHistoryContinuity({
      mode: 'race',
      effectivePeriod: 2,
      isFinished: true,
      matchScore: { local: 20, visitor: 18 }, // No coincide con historial 21 - 18
      history: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
        { gameNumber: 2, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
      ],
    });
    expect(raceMismatch.isValid).toBe(false);
    expect(raceMismatch.reason).toMatch(/Marcador contradictorio en el periodo final/i);
  });

  // --- REGRESIONES DEL VALIDADOR COMPARTIDO (T-INTEGRITY-01 a T-INTEGRITY-06) ---

  // T-INTEGRITY-01: Race activo no admite el juego actual en gameHistory
  it('T-INTEGRITY-01: Race activo no admite el juego actual en gameHistory', () => {
    const res = validateGameHistoryContinuity({
      mode: 'race',
      effectivePeriod: 2,
      isFinished: false,
      history: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
        { gameNumber: 2, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
      ],
    });

    expect(res.isValid).toBe(false);
    expect(res.reason).toMatch(/periodo #2 ya figura cerrado en gameHistory/i);
  });

  // T-INTEGRITY-02: Race terminado legítimamente puede tener registrado el juego final sin quedar falsamente UNVERIFIED
  it('T-INTEGRITY-02: Race terminado legítimamente valida su historial con el juego final incluido', () => {
    const res = validateGameHistoryContinuity({
      mode: 'race',
      effectivePeriod: 2,
      isFinished: true,
      matchScore: { local: 21, visitor: 18 },
      history: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
        { gameNumber: 2, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
      ],
    });

    expect(res.isValid).toBe(true);
  });

  // T-INTEGRITY-03: Best-of-Series activo no admite el set actual cerrado
  it('T-INTEGRITY-03: Best-of-Series activo no admite el set actual en gameHistory', () => {
    const res = validateGameHistoryContinuity({
      mode: 'best-of-series',
      effectivePeriod: 1,
      isFinished: false,
      history: [
        { gameNumber: 1, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: new Date() },
      ],
    });

    expect(res.isValid).toBe(false);
    expect(res.reason).toMatch(/En el periodo 1 el historial debe estar vacío/i);
  });

  // T-INTEGRITY-04: Best-of-Series terminado legítimamente verifica su historial final
  it('T-INTEGRITY-04: Best-of-Series terminado legítimamente verifica su historial final', () => {
    const res = validateGameHistoryContinuity({
      mode: 'best-of-series',
      effectivePeriod: 2,
      isFinished: true,
      bestOfWins: { local: 2, visitor: 0 },
      matchScore: { local: 21, visitor: 19 },
      history: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
        { gameNumber: 2, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: new Date() },
      ],
    });

    expect(res.isValid).toBe(true);
  });

  // T-INTEGRITY-05: los partidos finalizados con duplicados, huecos o resultados contradictorios siguen siendo rechazados
  it('T-INTEGRITY-05: partidos finalizados con duplicados, huecos o resultados contradictorios son rechazados', () => {
    // 1. Duplicado
    const resDup = validateGameHistoryContinuity({
      mode: 'best-of-series',
      effectivePeriod: 2,
      isFinished: true,
      history: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
        { gameNumber: 1, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: new Date() },
      ],
    });
    expect(resDup.isValid).toBe(false);
    expect(resDup.reason).toMatch(/duplicado/i);

    // 2. Hueco
    const resGap = validateGameHistoryContinuity({
      mode: 'best-of-series',
      effectivePeriod: 3,
      isFinished: true,
      history: [
        { gameNumber: 2, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
        { gameNumber: 3, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: new Date() },
      ],
    });
    expect(resGap.isValid).toBe(false);
    expect(resGap.reason).toMatch(/Hueco detectado/i);

    // 3. Marcador contradictorio vs matchScore persistido
    const resScoreMismatch = validateGameHistoryContinuity({
      mode: 'best-of-series',
      effectivePeriod: 2,
      isFinished: true,
      matchScore: { local: 21, visitor: 10 }, // No coincide con historial 21-19
      history: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
        { gameNumber: 2, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: new Date() },
      ],
    });
    expect(resScoreMismatch.isValid).toBe(false);
    expect(resScoreMismatch.reason).toMatch(/Marcador contradictorio/i);

    // 4. Incoherencia de victorias acumuladas
    const resWinsMismatch = validateGameHistoryContinuity({
      mode: 'best-of-series',
      effectivePeriod: 2,
      isFinished: true,
      bestOfWins: { local: 1, visitor: 1 }, // Contradice 2 victorias locales en historial
      matchScore: { local: 21, visitor: 19 },
      history: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
        { gameNumber: 2, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: new Date() },
      ],
    });
    expect(resWinsMismatch.isValid).toBe(false);
    expect(resWinsMismatch.reason).toMatch(/Incoherencia en Best-of-Series: victorias acumuladas/i);
  });

  // T-INTEGRITY-06: el cambio no permite borrar eventos históricos cerrados
  it('T-INTEGRITY-06: GameActionsRepository bloquea borrar eventos de sets cerrados', async () => {
    const matchId = await createBaseSeriesMatch({
      currentQuarter: 2,
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          currentGame: 2,
          wins: { local: 1, visitor: 0 },
        },
      },
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
      ],
    });

    const scoreSet1Id = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1, // Set 1 ya está cerrado
      createdAt: new Date(),
    })) as number;

    await expect(
      GameActionsRepository.deleteActionSafely({
        matchId,
        actionId: scoreSet1Id,
        type: 'score',
      })
    ).rejects.toThrow(/No se pueden eliminar acciones de juegos o sets anteriores ya cerrados/i);
  });

  // =========================================================================
  // FASE 2A R1.2: C-05 y C-06 — CIERRE FINAL DE UX Y AISLAMIENTO DE TEST HOOKS
  // =========================================================================
  describe('FASE 2A R1.2: C-05 y C-06 (R12-01 a R12-10)', () => {
    // Harness de ejecución de hooks React en entorno Node / Vitest
    function renderHook<T>(hookFn: () => T) {
      const stateSlots: unknown[] = [];
      let slotIndex = 0;
      let currentResult: T;

      const dispatcher = {
        useState<S>(initialValue: S | (() => S)) {
          const index = slotIndex++;
          if (stateSlots.length <= index) {
            stateSlots.push(typeof initialValue === 'function' ? (initialValue as () => S)() : initialValue);
          }
          const setState = (newValue: S | ((prev: S) => S)) => {
            const current = stateSlots[index] as S;
            const val = typeof newValue === 'function' ? (newValue as (prev: S) => S)(current) : newValue;
            stateSlots[index] = val;
            rerender();
          };
          return [stateSlots[index] as S, setState] as const;
        },
        useRef<R>(initialValue: R) {
          const index = slotIndex++;
          if (stateSlots.length <= index) {
            stateSlots.push({ current: initialValue });
          }
          return stateSlots[index] as { current: R };
        },
        useCallback<F extends (...args: unknown[]) => unknown>(fn: F, deps?: unknown[]) {
          const index = slotIndex++;
          if (stateSlots.length <= index) {
            stateSlots.push({ fn, deps });
            return fn;
          }
          const prev = stateSlots[index] as { fn: F; deps?: unknown[] };
          const depsChanged = !prev.deps || !deps || deps.some((d: unknown, i: number) => !Object.is(d, prev.deps?.[i]));
          if (depsChanged) {
            stateSlots[index] = { fn, deps };
            return fn;
          }
          return prev.fn;
        },
        useMemo<M>(factory: () => M, deps?: unknown[]) {
          const index = slotIndex++;
          if (stateSlots.length <= index) {
            const value = factory();
            stateSlots.push({ value, deps });
            return value;
          }
          const prev = stateSlots[index] as { value: M; deps?: unknown[] };
          const depsChanged = !prev.deps || !deps || deps.some((d: unknown, i: number) => !Object.is(d, prev.deps?.[i]));
          if (depsChanged) {
            const value = factory();
            stateSlots[index] = { value, deps };
            return value;
          }
          return prev.value;
        },
        useEffect() {}
      };

      function rerender() {
        slotIndex = 0;
        const internals = (React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H?: unknown } })
          .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
        const prevH = internals?.H;
        if (internals) internals.H = dispatcher;
        try {
          currentResult = hookFn();
        } finally {
          if (internals) internals.H = prevH;
        }
      }

      rerender();
      return {
        get result() { return currentResult; },
        rerender
      };
    }

    // Controlador de componentes que replica la máquina de estados de SeriesEngine
    function useSeriesEngineModal(match: Match) {
      const [showEarlyFinishConfirm, setShowEarlyFinishConfirm] = React.useState(false);
      const series = useSeriesLogic({ match });

      const handleEarlyFinish = async (countCurrentSet: boolean) => {
        const result = await series.endSeries({ countCurrentSet });
        if (result && (result.status === 'finished' || result.status === 'already_finished')) {
          setShowEarlyFinishConfirm(false);
        }
        return result;
      };

      const handleDismiss = () => {
        series.clearError();
        setShowEarlyFinishConfirm(false);
      };

      const openEarlyFinishModal = () => {
        series.clearError();
        setShowEarlyFinishConfirm(true);
      };

      return {
        ...series,
        showEarlyFinishConfirm,
        setShowEarlyFinishConfirm,
        handleEarlyFinish,
        handleDismiss,
        openEarlyFinishModal,
      };
    }

    // R12-01: cierre anticipado válido muestra estado de procesamiento y concluye en finished
    it('R12-01: cierre anticipado válido muestra estado de procesamiento y concluye en finished cerrando modal', async () => {
      const matchId = await createBaseSeriesMatch({ localScore: 15, visitorScore: 10 });
      const match = (await db.matches.get(matchId))!;

      const hook = renderHook(() => useSeriesEngineModal(match));
      hook.result.openEarlyFinishModal();

      expect(hook.result.showEarlyFinishConfirm).toBe(true);
      expect(hook.result.errorMessage).toBeNull();
      expect(hook.result.isProcessing).toBe(false);

      const finishPromise = hook.result.handleEarlyFinish(true);
      expect(hook.result.isProcessing).toBe(true);
      expect(hook.result.showEarlyFinishConfirm).toBe(true);

      const result = await finishPromise;
      expect(result.status).toBe('finished');
      expect(hook.result.showEarlyFinishConfirm).toBe(false);
      expect(hook.result.errorMessage).toBeNull();
      expect(hook.result.isProcessing).toBe(false);

      const dbMatch = (await db.matches.get(matchId))!;
      expect(dbMatch.status).toBe('finished');
    });

    // R12-02: cierre anticipado rechazado mantiene el modal abierto y muestra errorMessage
    it('R12-02: cierre anticipado rechazado mantiene el modal abierto y muestra el mensaje de error', async () => {
      const matchId = await createBaseSeriesMatch({ localScore: 10, visitorScore: 10 });
      const match = (await db.matches.get(matchId))!;

      const hook = renderHook(() => useSeriesEngineModal(match));
      hook.result.openEarlyFinishModal();
      expect(hook.result.showEarlyFinishConfirm).toBe(true);

      const result = await hook.result.handleEarlyFinish(true);
      expect(result.status).toBe('rejected');
      expect(hook.result.showEarlyFinishConfirm).toBe(true);
      expect(hook.result.errorMessage).toMatch(/empatado/i);
      expect(hook.result.isProcessing).toBe(false);

      const dbMatch = (await db.matches.get(matchId))!;
      expect(dbMatch.status).toBe('playing');
    });

    // R12-03: cierre rechazado por eventos inconsistentes muestra el error concreto
    it('R12-03: cierre rechazado por eventos inconsistentes mantiene el modal abierto y detalla la discrepancia', async () => {
      const matchId = await createBaseSeriesMatch({ localScore: 10, visitorScore: 8 });
      // Sobrescribimos scores de local para generar discrepancia intencional
      await db.scores.where('matchId').equals(matchId).and(s => s.teamId === localTeamId).delete();
      await db.scores.bulkAdd([
        { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date() },
        { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date() },
      ]);

      const match = (await db.matches.get(matchId))!;
      const hook = renderHook(() => useSeriesEngineModal(match));
      hook.result.openEarlyFinishModal();

      const result = await hook.result.handleEarlyFinish(false);
      expect(result.status).toBe('rejected');
      expect(hook.result.showEarlyFinishConfirm).toBe(true);
      expect(hook.result.errorMessage).toMatch(/Discrepancia detectada en el marcador del set #1/i);

      const dbMatch = (await db.matches.get(matchId))!;
      expect(dbMatch.status).toBe('playing');
    });

    // R12-04: cierre rechazado por historial con huecos conserva todos los datos intactos
    it('R12-04: cierre rechazado por historial con huecos mantiene el modal abierto y no altera datos en BD', async () => {
      const matchId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        currentQuarter: 3,
        localScore: 5,
        visitorScore: 2,
        localFouls: 0,
        visitorFouls: 0,
        createdAt: new Date(),
        config: {
          mode: 'best-of-series',
          bestOf: {
            totalGames: 3,
            targetScorePerGame: 21,
            currentGame: 3,
            wins: { local: 1, visitor: 0 },
          },
        },
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
          // Falta el set 2: hueco
        ],
      })) as number;

      await populateScoresForQuarter(matchId, 3, 5, 2);
      const snapshotBefore = (await db.matches.get(matchId))!;

      const hook = renderHook(() => useSeriesEngineModal(snapshotBefore));
      hook.result.openEarlyFinishModal();

      const result = await hook.result.handleEarlyFinish(false);
      expect(result.status).toBe('rejected');
      expect(hook.result.showEarlyFinishConfirm).toBe(true);
      expect(hook.result.errorMessage).toMatch(/violación de integridad histórica/i);

      const snapshotAfter = (await db.matches.get(matchId))!;
      expect(snapshotAfter).toEqual(snapshotBefore);
    });

    // R12-05: excepción transaccional conserva el modal y presenta error sin fingir éxito
    it('R12-05: excepción transaccional en el servicio preserva el modal abierto y muestra el fallo', async () => {
      const matchId = await createBaseSeriesMatch({ localScore: 15, visitorScore: 10 });
      const match = (await db.matches.get(matchId))!;

      SeriesService.__setTestPostWriteHook(() => {
        throw new Error('Fallo transaccional crítico simulado en IndexedDB');
      });

      try {
        const hook = renderHook(() => useSeriesEngineModal(match));
        hook.result.openEarlyFinishModal();

        const result = await hook.result.handleEarlyFinish(false);
        expect(result.status).toBe('rejected');
        expect(hook.result.showEarlyFinishConfirm).toBe(true);
        expect(hook.result.errorMessage).toMatch(/Fallo transaccional crítico simulado en IndexedDB/i);
        expect(hook.result.isProcessing).toBe(false);

        const dbMatch = (await db.matches.get(matchId))!;
        expect(dbMatch.status).toBe('playing');
      } finally {
        SeriesService.__setTestPostWriteHook(null);
      }
    });

    // R12-06: doble clic no genera dos cierres simultáneos (protección con isSubmittingRef)
    it('R12-06: doble clic no genera dos cierres simultáneos y preserva la integridad', async () => {
      const matchId = await createBaseSeriesMatch({ localScore: 15, visitorScore: 10 });
      const match = (await db.matches.get(matchId))!;

      const hook = renderHook(() => useSeriesEngineModal(match));
      hook.result.openEarlyFinishModal();

      const [res1, res2] = await Promise.all([
        hook.result.handleEarlyFinish(false),
        hook.result.handleEarlyFinish(false),
      ]);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain('finished');
      expect(statuses).toContain('rejected');
      expect(hook.result.showEarlyFinishConfirm).toBe(false);

      const dbMatch = (await db.matches.get(matchId))!;
      expect(dbMatch.status).toBe('finished');
    });

    // R12-07: los botones quedan deshabilitados mientras la operación está pendiente
    it('R12-07: los botones reflejan estado de procesamiento y quedan deshabilitados mientras la operación está pendiente', async () => {
      const matchId = await createBaseSeriesMatch({ localScore: 15, visitorScore: 10 });
      const match = (await db.matches.get(matchId))!;

      SeriesService.__setTestPostWriteHook(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      try {
        const hook = renderHook(() => useSeriesEngineModal(match));
        hook.result.openEarlyFinishModal();

        const promise = hook.result.handleEarlyFinish(false);
        expect(hook.result.isProcessing).toBe(true);

        await promise;
        expect(hook.result.isProcessing).toBe(false);
      } finally {
        SeriesService.__setTestPostWriteHook(null);
      }
    });

    // R12-08: el usuario puede corregir una inconsistencia y reintentar con éxito
    it('R12-08: usuario puede corregir discrepancia de anotaciones y reintentar con éxito sin cerrar modal', async () => {
      const matchId = await createBaseSeriesMatch({ localScore: 10, visitorScore: 8 });
      // Generar discrepancia: eliminar puntos de local y dejar solo 6 puntos legítimos (dos triples)
      await db.scores.where('matchId').equals(matchId).and(s => s.teamId === localTeamId).delete();
      await db.scores.bulkAdd([
        { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date() },
        { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date() },
      ]);

      const match = (await db.matches.get(matchId))!;
      const hook = renderHook(() => useSeriesEngineModal(match));
      hook.result.openEarlyFinishModal();

      // Primer intento: falla y mantiene modal abierto
      const failRes = await hook.result.handleEarlyFinish(false);
      expect(failRes.status).toBe('rejected');
      expect(hook.result.showEarlyFinishConfirm).toBe(true);
      expect(hook.result.errorMessage).not.toBeNull();

      // Corrección de la discrepancia en la base de datos (añadir los 4 puntos faltantes)
      await db.scores.bulkAdd([
        { matchId, teamId: localTeamId, points: 2, quarter: 1, createdAt: new Date() },
        { matchId, teamId: localTeamId, points: 2, quarter: 1, createdAt: new Date() },
      ]);

      // Segundo intento (reintento del usuario desde el mismo modal abierto)
      const successRes = await hook.result.handleEarlyFinish(false);
      expect(successRes.status).toBe('finished');
      expect(hook.result.showEarlyFinishConfirm).toBe(false);
      expect(hook.result.errorMessage).toBeNull();

      const dbMatch = (await db.matches.get(matchId))!;
      expect(dbMatch.status).toBe('finished');
    });

    // R12-09: respuesta already_finished reconcilia la interfaz y no duplica datos
    it('R12-09: respuesta already_finished reconcilia la interfaz cerrando el modal de confirmación sin duplicar sets', async () => {
      const matchId = await createBaseSeriesMatch({ localScore: 15, visitorScore: 10 });
      await db.matches.update(matchId, { status: 'finished' });
      const finishedMatch = (await db.matches.get(matchId))!;

      const hook = renderHook(() => useSeriesEngineModal(finishedMatch));
      hook.result.setShowEarlyFinishConfirm(true);
      expect(hook.result.showEarlyFinishConfirm).toBe(true);

      const res = await hook.result.handleEarlyFinish(false);
      expect(res.status).toBe('already_finished');
      expect(hook.result.showEarlyFinishConfirm).toBe(false);

      const dbMatch = (await db.matches.get(matchId))!;
      expect(dbMatch.status).toBe('finished');
      expect(dbMatch.gameHistory?.length).toBe(0);
    });

    // R12-10: los mecanismos de prueba de rollback no quedan operativos fuera de NODE_ENV === 'test'
    it('R12-10: los mecanismos de prueba de rollback lanzan error fuera de NODE_ENV=test y no se exponen en params', async () => {
      const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
      const originalEnv = proc?.env?.NODE_ENV;
      try {
        if (proc && proc.env) {
          proc.env.NODE_ENV = 'production';
        }
        expect(() => {
          SeriesService.__setTestPostWriteHook(() => {});
        }).toThrow(/Mecanismo de prueba restringido exclusivamente al entorno de pruebas/i);
      } finally {
        if (proc && proc.env) {
          proc.env.NODE_ENV = originalEnv;
        }
      }

      // En entorno de test, el hook vuelve a null sin efectos colaterales
      SeriesService.__setTestPostWriteHook(null);
    });
  });

});
