// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { db } from '../db/db';
import { LiveMatchProvider, useLiveMatch } from '../features/match-creations/components/context/LiveMatchContext';
import { useGameActions } from '../features/match-creations/hooks/useGameActions';
import { GameActionsRepository } from '../db/gameActions.repository';
import { SeriesService } from '../db/series.service';
import { ScoreIntegrityService } from '../db/scoreIntegrity.service';
import type { Match, Score } from '../db/models';
import * as soundEffects from '../utils/soundEffects';

describe('DB-F4: Integridad de operaciones concurrentes en IndexedDB (QA-01 a QA-08)', () => {
  let localTeamId: number;
  let visitorTeamId: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(soundEffects, 'unlockAudioContext').mockImplementation(() => {});
    vi.spyOn(soundEffects, 'playScorePop').mockImplementation(() => {});
    vi.spyOn(soundEffects, 'playWhistle').mockImplementation(() => {});
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();

    localTeamId = Number(
      await db.teams.add({
        name: 'Halcones Locales',
        createdAt: new Date(),
        isArchived: false,
      })
    );

    visitorTeamId = Number(
      await db.teams.add({
        name: 'Toros Visitantes',
        createdAt: new Date(),
        isArchived: false,
      })
    );
  });

  afterEach(() => {
    cleanup();
  });

  /**
   * Helper para simular un contexto de pestaña conectado a la misma IndexedDB
   */
  const createTabContext = (matchId: number) => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LiveMatchProvider matchId={matchId}>{children}</LiveMatchProvider>
    );

    return renderHook(
      () => {
        const live = useLiveMatch();
        const actions = useGameActions();
        return {
          ...actions,
          liveMatch: live.match,
          isLoading: live.isLoading,
        };
      },
      { wrapper }
    );
  };

  /**
   * Helper para crear un partido base de Best-of-Series
   */
  const createSeriesMatch = async (overrides: Partial<Match> = {}) => {
    const matchId = Number(
      await db.matches.add({
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
            scoringSystem: 'standard',
          },
        },
        currentQuarter: 1,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: [],
        ...overrides,
      })
    );
    return matchId;
  };

  /**
   * Helper para crear un partido base de Race
   */
  const createRaceMatch = async (overrides: Partial<Match> = {}) => {
    const matchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
        config: {
          mode: 'race',
          race: {
            targetScore: 21,
            hasRematches: true,
            currentGame: 1,
            winByTwo: false,
            scoringSystem: 'standard',
          },
        },
        currentQuarter: 1,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: [],
        ...overrides,
      })
    );
    return matchId;
  };

  // =========================================================================
  // QA-01: Dos anotaciones concurrentes legítimas
  // =========================================================================
  it('QA-01: dos anotaciones concurrentes legítimas sobre el mismo partido conservan ambos eventos y actualizan contadores sin pérdidas', async () => {
    const matchId = await createSeriesMatch();

    const tab1 = createTabContext(matchId);
    const tab2 = createTabContext(matchId);

    await waitFor(() => expect(tab1.result.current.liveMatch).toBeDefined());
    await waitFor(() => expect(tab2.result.current.liveMatch).toBeDefined());

    // Disparo concurrente de dos anotaciones legítimas desde contextos distintos
    const [res1, res2] = await Promise.all([
      tab1.result.current.addScore(localTeamId, 2),
      tab2.result.current.addScore(visitorTeamId, 3),
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);

    // Verificación en IndexedDB
    const updatedMatch = (await db.matches.get(matchId))!;
    expect(updatedMatch.localScore).toBe(2);
    expect(updatedMatch.visitorScore).toBe(3);

    const scores = await db.scores.where('matchId').equals(matchId).toArray();
    expect(scores).toHaveLength(2);

    const localScores = scores.filter(s => s.teamId === localTeamId);
    const visitorScores = scores.filter(s => s.teamId === visitorTeamId);
    expect(localScores).toHaveLength(1);
    expect(localScores[0].points).toBe(2);
    expect(visitorScores).toHaveLength(1);
    expect(visitorScores[0].points).toBe(3);

    // Contrato de integridad matemática y procedencia
    const integrity = ScoreIntegrityService.verifyScoreIntegrity(updatedMatch, scores);
    expect(integrity.status).toBe('CONSISTENT');
    expect(integrity.isCompleteHistory).toBe(true);
  });

  // =========================================================================
  // QA-02: Dos faltas concurrentes
  // =========================================================================
  it('QA-02: dos faltas concurrentes sobre el mismo partido conservan ambos registros y actualizan contadores fielmente', async () => {
    const matchId = await createSeriesMatch();

    const tab1 = createTabContext(matchId);
    const tab2 = createTabContext(matchId);

    await waitFor(() => expect(tab1.result.current.liveMatch).toBeDefined());
    await waitFor(() => expect(tab2.result.current.liveMatch).toBeDefined());

    const [res1, res2] = await Promise.all([
      tab1.result.current.addFoul(localTeamId),
      tab2.result.current.addFoul(visitorTeamId),
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);

    const updatedMatch = (await db.matches.get(matchId))!;
    expect(updatedMatch.localFouls).toBe(1);
    expect(updatedMatch.visitorFouls).toBe(1);

    const fouls = await db.fouls.where('matchId').equals(matchId).toArray();
    expect(fouls).toHaveLength(2);
    expect(fouls.some(f => f.teamId === localTeamId)).toBe(true);
    expect(fouls.some(f => f.teamId === visitorTeamId)).toBe(true);
  });

  // =========================================================================
  // QA-03: Eliminación repetida de una misma acción
  // =========================================================================
  it('QA-03: eliminación repetida de una misma acción solo descuenta una vez y no produce subdesbordamientos', async () => {
    const matchId = await createSeriesMatch({ localScore: 3 });

    const scoreId = Number(
      await db.scores.add({
        matchId,
        teamId: localTeamId,
        points: 3,
        quarter: 1,
        createdAt: new Date(),
      })
    );

    // Dos peticiones concurrentes para eliminar la misma acción
    const [resA, resB] = await Promise.all([
      GameActionsRepository.deleteActionSafely({ matchId, actionId: scoreId, type: 'score' }),
      GameActionsRepository.deleteActionSafely({ matchId, actionId: scoreId, type: 'score' }),
    ]);

    const deletedCount = [resA.deleted, resB.deleted].filter(Boolean).length;
    expect(deletedCount).toBe(1);

    const matchAfter = (await db.matches.get(matchId))!;
    expect(matchAfter.localScore).toBe(0); // Descontó exactamente 3, nunca -3

    // Una llamada posterior repetida tampoco descuenta
    const resC = await GameActionsRepository.deleteActionSafely({ matchId, actionId: scoreId, type: 'score' });
    expect(resC.deleted).toBe(false);

    const matchFinal = (await db.matches.get(matchId))!;
    expect(matchFinal.localScore).toBe(0);
  });

  // =========================================================================
  // QA-04: Anotación frente a cierre de set
  // =========================================================================
  it('QA-04A: anotación tardía iniciada desde una vista que mostraba el set anterior no contamina el siguiente set cerrado', async () => {
    const matchId = await createSeriesMatch({
      localScore: 21,
      visitorScore: 18,
    });

    // Registrar eventos para el set 1
    const s1: Omit<Score, 'id'>[] = [
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 3000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 2000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 1000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 900) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 800) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 700) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 600) }, // 21 pts
      { matchId, teamId: visitorTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 500) },
      { matchId, teamId: visitorTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 400) },
      { matchId, teamId: visitorTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 300) },
      { matchId, teamId: visitorTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 200) },
      { matchId, teamId: visitorTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 100) },
      { matchId, teamId: visitorTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 50) }, // 18 pts
    ];
    await db.scores.bulkAdd(s1 as Score[]);

    // Ambas pestañas se abren viendo el set 1
    const tab1 = createTabContext(matchId);
    const tab2 = createTabContext(matchId);

    await waitFor(() => expect(tab1.result.current.liveMatch?.currentQuarter).toBe(1));
    await waitFor(() => expect(tab2.result.current.liveMatch?.currentQuarter).toBe(1));

    // Tab 1 confirma el set 1 -> el partido avanza a set 2 (marcadores 0-0)
    const confirmRes = await SeriesService.confirmSet({
      matchId,
      setNumber: 1,
      expectedWinnerId: localTeamId,
      expectedScore: { local: 21, visitor: 18 },
    });
    expect(confirmRes.status).toBe('confirmed');

    const matchAfterConfirm = (await db.matches.get(matchId))!;
    expect(matchAfterConfirm.currentQuarter).toBe(2);
    expect(matchAfterConfirm.localScore).toBe(0);
    expect(matchAfterConfirm.visitorScore).toBe(0);
    expect(matchAfterConfirm.gameHistory).toHaveLength(1);

    // Tab 2 (cuya vista de render aún tiene closure de set 1) intenta registrar puntos
    const lateScoreRes = await tab2.result.current.addScore(visitorTeamId, 2);
    expect(lateScoreRes.success).toBe(false);
    expect(lateScoreRes.error).toContain('ya cambió');

    // Comprobar que el set 2 NO fue contaminado
    const matchAfterLateAttempt = (await db.matches.get(matchId))!;
    expect(matchAfterLateAttempt.currentQuarter).toBe(2);
    expect(matchAfterLateAttempt.localScore).toBe(0);
    expect(matchAfterLateAttempt.visitorScore).toBe(0);

    const set2Scores = await db.scores.where('matchId').equals(matchId).filter(s => s.quarter === 2).toArray();
    expect(set2Scores).toHaveLength(0); // 0 puntos en el set 2
  });

  it('QA-04B: anotación previa impide la confirmación de un set con marcador obsoleto o sin ganador', async () => {
    const matchId = await createSeriesMatch({
      localScore: 20,
      visitorScore: 18,
    });

    const s1: Omit<Score, 'id'>[] = [
      { matchId, teamId: localTeamId, points: 2, quarter: 1, createdAt: new Date(Date.now() - 2000) },
      { matchId, teamId: visitorTeamId, points: 2, quarter: 1, createdAt: new Date(Date.now() - 1000) },
    ];
    await db.scores.bulkAdd(s1 as Score[]);
    await db.matches.update(matchId, { localScore: 2, visitorScore: 2 });

    const tab1 = createTabContext(matchId);
    await waitFor(() => expect(tab1.result.current.liveMatch).toBeDefined());

    // Tab 1 agrega 1 punto
    await tab1.result.current.addScore(localTeamId, 1);

    // Intento de confirmar set esperando un marcador desfasado
    const confirmRes = await SeriesService.confirmSet({
      matchId,
      setNumber: 1,
      expectedWinnerId: localTeamId,
      expectedScore: { local: 21, visitor: 18 },
    });

    // Rechazado porque el marcador real difiere del esperado y no hay ganador reglamentario
    expect(confirmRes.status).toBe('rejected');
    if (confirmRes.status === 'rejected') {
      expect(confirmRes.reason).toMatch(/difiere del marcador esperado|no tiene un ganador/i);
    }

    const matchCheck = (await db.matches.get(matchId))!;
    expect(matchCheck.currentQuarter).toBe(1); // Set 1 sigue activo
    expect(matchCheck.gameHistory).toHaveLength(0);
  });

  it('QA-04C: en modalidad Race, acción tardía tras dar la vuelta/revancha no contamina el nuevo juego', async () => {
    const matchId = await createRaceMatch({
      localScore: 21,
      visitorScore: 19,
    });

    const tab1 = createTabContext(matchId);
    const tab2 = createTabContext(matchId);

    await waitFor(() => expect(tab1.result.current.liveMatch).toBeDefined());
    await waitFor(() => expect(tab2.result.current.liveMatch).toBeDefined());

    // Se procesa la revancha: Juego 1 va al historial, Juego 2 inicia en 0-0
    await db.transaction('rw', db.matches, async () => {
      const current = (await db.matches.get(matchId))!;
      await db.matches.update(matchId, {
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: [
          {
            gameNumber: 1,
            localScore: 21,
            visitorScore: 19,
            winner: 'local',
            finishedAt: new Date(),
          },
        ],
        config: {
          ...current.config,
          race: {
            ...current.config.race!,
            currentGame: 2,
          },
        },
      });
    });

    // Tab 2 (que estaba viendo el Juego 1) intenta agregar una falta o punto tardío
    const lateFoulRes = await tab2.result.current.addFoul(visitorTeamId, undefined, { expectedPeriod: 1 });
    expect(lateFoulRes.success).toBe(false);
    expect(lateFoulRes.error).toContain('ya cambió');

    const matchAfter = (await db.matches.get(matchId))!;
    expect(matchAfter.config.race?.currentGame).toBe(2);
    expect(matchAfter.localFouls).toBe(0);
    expect(matchAfter.visitorFouls).toBe(0);

    const foulsGame2 = await db.fouls.where('matchId').equals(matchId).filter(f => f.quarter === 2).toArray();
    expect(foulsGame2).toHaveLength(0);
  });

  // =========================================================================
  // QA-05: Confirmación repetida de un set
  // =========================================================================
  it('QA-05: dos llamadas concurrentes a confirmSet resultan exactamente en una confirmación y una respuesta idempotente already_confirmed', async () => {
    const matchId = await createSeriesMatch({
      localScore: 21,
      visitorScore: 15,
    });

    // Crear eventos válidos para el set 1
    const s1: Omit<Score, 'id'>[] = [];
    for (let i = 0; i < 7; i++) {
      s1.push({ matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 1000 + i * 10) });
    }
    for (let i = 0; i < 5; i++) {
      s1.push({ matchId, teamId: visitorTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 500 + i * 10) });
    }
    await db.scores.bulkAdd(s1 as Score[]);

    // Concurrencia real sobre confirmSet
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

  // =========================================================================
  // QA-06: Fallo intermedio y rollback transaccional
  // =========================================================================
  it('QA-06: rechazo transaccional no deja escrituras parciales ni contadores inconsistentes', async () => {
    const matchId = await createSeriesMatch({
      localScore: 0,
      visitorScore: 0,
    });

    const tab = createTabContext(matchId);
    await waitFor(() => expect(tab.result.current.liveMatch).toBeDefined());

    // Intento de registrar puntos con número inválido de puntos (normalización rechaza)
    await tab.result.current.addScore(localTeamId, 5 as unknown as 1 | 2 | 3);

    const matchAfter = (await db.matches.get(matchId))!;
    expect(matchAfter.localScore).toBe(0);

    const scores = await db.scores.where('matchId').equals(matchId).toArray();
    expect(scores).toHaveLength(0);
  });

  // =========================================================================
  // QA-07: Recarga y lectura consistente del resultado
  // =========================================================================
  it('QA-07: tras operaciones concurrentes, consultas independientes leen un estado unificado y matemáticamente consistente', async () => {
    const matchId = await createSeriesMatch();

    const tab1 = createTabContext(matchId);
    const tab2 = createTabContext(matchId);

    await waitFor(() => expect(tab1.result.current.liveMatch).toBeDefined());
    await waitFor(() => expect(tab2.result.current.liveMatch).toBeDefined());

    // Operaciones concurrentes sucesivas
    await Promise.all([
      tab1.result.current.addScore(localTeamId, 2),
      tab2.result.current.addScore(localTeamId, 3),
    ]);

    await Promise.all([
      tab1.result.current.addScore(visitorTeamId, 1),
      tab2.result.current.addFoul(visitorTeamId),
    ]);

    // Lectura desde dos transacciones de lectura independientes
    const readQueryA = await db.transaction('r', db.matches, db.scores, db.fouls, async () => {
      const m = await db.matches.get(matchId);
      const sc = await db.scores.where('matchId').equals(matchId).toArray();
      const fo = await db.fouls.where('matchId').equals(matchId).toArray();
      return { m, sc, fo };
    });

    const readQueryB = await db.transaction('r', db.matches, db.scores, db.fouls, async () => {
      const m = await db.matches.get(matchId);
      const sc = await db.scores.where('matchId').equals(matchId).toArray();
      const fo = await db.fouls.where('matchId').equals(matchId).toArray();
      return { m, sc, fo };
    });

    expect(readQueryA.m?.localScore).toBe(5);
    expect(readQueryA.m?.visitorScore).toBe(1);
    expect(readQueryA.m?.visitorFouls).toBe(1);
    expect(readQueryA.sc).toHaveLength(3);
    expect(readQueryA.fo).toHaveLength(1);

    expect(readQueryB.m?.localScore).toBe(readQueryA.m?.localScore);
    expect(readQueryB.m?.visitorScore).toBe(readQueryA.m?.visitorScore);
    expect(readQueryB.sc.length).toBe(readQueryA.sc.length);

    const integrity = ScoreIntegrityService.verifyScoreIntegrity(readQueryA.m!, readQueryA.sc);
    expect(integrity.status).toBe('CONSISTENT');
  });

  // =========================================================================
  // QA-08: Anotación versus Undo concurrente
  // =========================================================================
  it('QA-08: anotación concurrente con undoLastAction preserva la coherencia y contrato de integridad', async () => {
    const matchId = await createSeriesMatch({
      localScore: 2,
      visitorScore: 0,
    });

    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1,
      createdAt: new Date(Date.now() - 5000),
    });

    const tab1 = createTabContext(matchId);
    const tab2 = createTabContext(matchId);

    await waitFor(() => expect(tab1.result.current.liveMatch).toBeDefined());
    await waitFor(() => expect(tab2.result.current.liveMatch).toBeDefined());

    // Tab 1 agrega 3 puntos y Tab 2 ejecuta Deshacer concurrentemente
    await Promise.all([
      tab1.result.current.addScore(localTeamId, 3),
      tab2.result.current.undoLastAction(),
    ]);

    const finalMatch = (await db.matches.get(matchId))!;
    const finalScores = await db.scores.where('matchId').equals(matchId).toArray();

    // Verificamos que independientemente del orden de resolución de transacciones,
    // el marcador almacenado coincide con la suma de las anotaciones reales
    const localSum = finalScores
      .filter(s => s.teamId === localTeamId)
      .reduce((acc, s) => acc + s.points, 0);

    expect(finalMatch.localScore).toBe(localSum);

    const integrity = ScoreIntegrityService.verifyScoreIntegrity(finalMatch, finalScores);
    expect(integrity.status).toBe('CONSISTENT');
  });

  // =========================================================================
  // QA-09: Best-of-Series — avanzar de Set 1 a Set 2 actualiza callbacks,
  // acepta anotaciones para Set 2 y rechaza acciones de la vista de Set 1
  // =========================================================================
  it('QA-09: Best-of-Series: avanzar de Set 1 a Set 2 actualiza callbacks de useGameActions, acepta Set 2 y rechaza vista obsoleta de Set 1', async () => {
    // 1. Crear una serie Best-of-Series con marcador inicial 19-10
    const matchId = await createSeriesMatch({
      localScore: 19,
      visitorScore: 10,
    });

    // Agregar eventos base respetando el contrato de integridad de puntuación
    const initialScores: Omit<Score, 'id'>[] = [];
    for (let i = 0; i < 6; i++) {
      initialScores.push({ matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 5000 + i * 10) });
    }
    initialScores.push({ matchId, teamId: localTeamId, points: 1, quarter: 1, createdAt: new Date(Date.now() - 4000) }); // 19 pts local
    for (let i = 0; i < 3; i++) {
      initialScores.push({ matchId, teamId: visitorTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 3000 + i * 10) });
    }
    initialScores.push({ matchId, teamId: visitorTeamId, points: 1, quarter: 1, createdAt: new Date(Date.now() - 2000) }); // 10 pts visitante
    await db.scores.bulkAdd(initialScores as Score[]);

    const tab = createTabContext(matchId);
    await waitFor(() => expect(tab.result.current.liveMatch).toBeDefined());
    expect(tab.result.current.liveMatch?.config?.bestOf?.currentGame).toBe(1);

    // Guardar referencia a los callbacks generados durante el Set 1
    const addScoreSet1 = tab.result.current.addScore;
    const undoSet1 = tab.result.current.undoLastAction;

    // 2. Registrar 2 puntos para que el equipo local alcance 21 y confirmar válidamente el Set 1
    const scoreRes = await tab.result.current.addScore(localTeamId, 2);
    expect(scoreRes.success).toBe(true);

    const matchBeforeConfirm = (await db.matches.get(matchId))!;
    expect(matchBeforeConfirm.localScore).toBe(21);

    const confirmRes = await SeriesService.confirmSet({ matchId, setNumber: 1 });
    expect(confirmRes.status).toBe('confirmed');

    // 3 y 4. Mantener el mismo partido, avanzar al Set 2 y confirmar que React actualiza el periodo visible
    await waitFor(() => {
      expect(tab.result.current.liveMatch?.config?.bestOf?.currentGame).toBe(2);
      expect(tab.result.current.liveMatch?.localScore).toBe(0);
      expect(tab.result.current.liveMatch?.visitorScore).toBe(0);
    });

    // Comprobar que los callbacks de useGameActions se actualizaron con la nueva referencia de match
    expect(tab.result.current.addScore).not.toBe(addScoreSet1);
    expect(tab.result.current.undoLastAction).not.toBe(undoSet1);

    // 5 y 6. Registrar una anotación válida desde la nueva vista: se acepta y pertenece al Set 2
    const scoreSet2Res = await tab.result.current.addScore(localTeamId, 3);
    expect(scoreSet2Res.success).toBe(true);

    const matchAfterSet2Score = (await db.matches.get(matchId))!;
    expect(matchAfterSet2Score.localScore).toBe(3);

    const scoresSet2 = await db.scores
      .where('matchId')
      .equals(matchId)
      .and(s => s.quarter === 2)
      .toArray();
    expect(scoresSet2).toHaveLength(1);
    expect(scoresSet2[0].points).toBe(3);
    expect(scoresSet2[0].quarter).toBe(2);

    // 7. Confirmar que una acción realmente iniciada desde la vista obsoleta del Set 1 es rechazada
    const staleActionRes = await addScoreSet1(visitorTeamId, 2);
    expect(staleActionRes.success).toBe(false);
    expect(staleActionRes.error).toMatch(/periodo|set/i);

    const staleUndoRes = await undoSet1();
    expect(staleUndoRes.success).toBe(false);

    // Comprobar que el Set 2 no se vio alterado por las acciones obsoletas
    const finalMatch = (await db.matches.get(matchId))!;
    expect(finalMatch.localScore).toBe(3);
    expect(finalMatch.visitorScore).toBe(0);

    const allScores = await db.scores.where('matchId').equals(matchId).toArray();
    const set2Scores = allScores.filter(s => s.quarter === 2);
    expect(set2Scores).toHaveLength(1);
  });

  // =========================================================================
  // QA-10: Race — avanzar de Juego 1 a Juego 2 actualiza callbacks,
  // acepta acciones para Juego 2 y rechaza acciones de Juego 1
  // =========================================================================
  it('QA-10: Race: avanzar de Juego 1 a Juego 2 actualiza callbacks de useGameActions, acepta Juego 2 y rechaza vista obsoleta de Juego 1', async () => {
    // 1. Crear un partido Race
    const matchId = await createRaceMatch();

    const tab = createTabContext(matchId);
    await waitFor(() => expect(tab.result.current.liveMatch).toBeDefined());
    expect(tab.result.current.liveMatch?.config?.race?.currentGame).toBe(1);

    const addScoreGame1 = tab.result.current.addScore;
    const addFoulGame1 = tab.result.current.addFoul;

    // 2. Registrar puntos en Juego 1
    const s1 = await tab.result.current.addScore(localTeamId, 2);
    expect(s1.success).toBe(true);

    // 3. Simular revancha / avance a Juego 2 (como hace RaceEngine al dar la revancha)
    await db.matches.update(matchId, {
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      'config.race.currentGame': 2,
      gameHistory: [
        {
          gameNumber: 1,
          finalScore: { local: 2, visitor: 0 },
          winner: 'local',
          durationSeconds: 120,
          endedAt: new Date(),
        },
      ],
    });

    // 4. Confirmar que React actualiza el periodo visible a Juego 2
    await waitFor(() => {
      expect(tab.result.current.liveMatch?.config?.race?.currentGame).toBe(2);
      expect(tab.result.current.liveMatch?.localScore).toBe(0);
    });

    // Callbacks actualizados
    expect(tab.result.current.addScore).not.toBe(addScoreGame1);
    expect(tab.result.current.addFoul).not.toBe(addFoulGame1);

    // 5 y 6. Registrar anotación válida desde la nueva vista: se acepta y pertenece al Juego 2
    const scoreGame2Res = await tab.result.current.addScore(localTeamId, 3);
    expect(scoreGame2Res.success).toBe(true);

    const matchAfterGame2 = (await db.matches.get(matchId))!;
    expect(matchAfterGame2.localScore).toBe(3);

    const game2Scores = await db.scores
      .where('matchId')
      .equals(matchId)
      .and(s => s.quarter === 2)
      .toArray();
    expect(game2Scores).toHaveLength(1);
    expect(game2Scores[0].points).toBe(3);

    // 7. Acción iniciada desde la vista previa de Juego 1 es rechazada
    const staleActionRes = await addScoreGame1(visitorTeamId, 2);
    expect(staleActionRes.success).toBe(false);
    expect(staleActionRes.error).toMatch(/periodo|set/i);

    const staleFoulRes = await addFoulGame1(visitorTeamId);
    expect(staleFoulRes.success).toBe(false);
    expect(staleFoulRes.error).toMatch(/periodo|set/i);

    // El estado del Juego 2 permanece inalterado
    const matchFinal = (await db.matches.get(matchId))!;
    expect(matchFinal.localScore).toBe(3);
    expect(matchFinal.visitorScore).toBe(0);
    expect(matchFinal.visitorFouls).toBe(0);
  });
});
