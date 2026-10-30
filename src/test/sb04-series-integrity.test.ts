// src/test/sb04-series-integrity.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db';
import { SeriesService } from '../db/series.service';
import { ScoreIntegrityService, validateGameHistoryContinuity } from '../db/scoreIntegrity.service';
import { GameActionsRepository } from '../db/gameActions.repository';
import type { Match, Score } from '../db/models';

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

  const createBaseSeriesMatch = async (overrides: Partial<Match> = {}) => {
    return (await db.matches.add({
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
          currentGame: 1,
          wins: { local: 0, visitor: 0 },
          winByTwo: false,
        },
      },
      currentQuarter: 1,
      localScore: 21,
      visitorScore: 18,
      localFouls: 2,
      visitorFouls: 3,
      gameHistory: [],
      ...overrides,
    })) as number;
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

    // Ahora estamos en set 2 con marcador parcial (5-3)
    await db.matches.update(matchId, { localScore: 5, visitorScore: 3 });

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
        { gameNumber: 1, localScore: 21, visitorScore: 17, winner: 'local', finishedAt: new Date() },
      ],
    });

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
    });

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
        { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
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

  // T-SERIES-18: rollback ante fallo transaccional real
  it('T-SERIES-18: rollback transaccional ante error no deja mutaciones parciales', async () => {
    const matchId = await createBaseSeriesMatch();
    const snapshotBefore = (await db.matches.get(matchId))!;

    // Forzamos un fallo dentro de una transacción custom que simula confirmSet con error
    await expect(
      db.transaction('rw', [db.matches, db.scores], async () => {
        await db.matches.update(matchId, { localScore: 999 });
        throw new Error('Fallo provocado para verificar rollback');
      })
    ).rejects.toThrow('Fallo provocado para verificar rollback');

    const matchAfter = (await db.matches.get(matchId))!;
    expect(matchAfter.localScore).toBe(snapshotBefore.localScore);
    expect(matchAfter.status).toBe(snapshotBefore.status);
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
    });

    const match = (await db.matches.get(matchId))!;
    const integrity = ScoreIntegrityService.verifyScoreIntegrity(match, []);
    expect(integrity.status).toBe('UNVERIFIED');
    expect(integrity.isCompleteHistory).toBe(false);
  });

  // --- REGRESIONES DEL VALIDADOR COMPARTIDO ---

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
});
