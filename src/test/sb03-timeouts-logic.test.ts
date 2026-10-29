import { describe, it, expect, beforeEach } from 'vitest';
import { BasketControlDB, db } from '../db/db';
import { TimeoutService } from '../db/timeout.service';
import {
  advanceTraditionalQuarter,
  startTraditionalOvertime,
} from '../features/match-creations/hooks/useTraditionalLogic';

describe('SB-03 & C-04: Timeouts Limits, Quarter Transitions, Overtime, and Persistence', () => {
  let localTeamId: number;
  let visitorTeamId: number;

  beforeEach(async () => {
    await db.matches.clear();
    await db.teams.clear();

    localTeamId = (await db.teams.add({
      name: 'Local',
      createdAt: new Date(),
      isArchived: false,
    })) as number;

    visitorTeamId = (await db.teams.add({
      name: 'Visitor',
      createdAt: new Date(),
      isArchived: false,
    })) as number;
  });

  it('Límite cero: no permite consumir tiempos fuera', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 0 },
      },
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      localTimeouts: 0,
      visitorTimeouts: 0,
    })) as number;

    const res = await TimeoutService.requestTimeout(matchId, 'local');
    expect(res.success).toBe(false);

    const match = await db.matches.get(matchId);
    expect(match?.localTimeouts).toBe(0);
  });

  it('Límite uno: permite 1 tiempo fuera y rechaza el segundo sin reiniciar', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 1 },
      },
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      localTimeouts: 0,
      visitorTimeouts: 0,
    })) as number;

    // Primer consumo: Exitoso
    const res1 = await TimeoutService.requestTimeout(matchId, 'local');
    expect(res1.success).toBe(true);

    const match1 = await db.matches.get(matchId);
    expect(match1?.localTimeouts).toBe(1);

    // Segundo consumo: Rechazado, y NO reinicia a 0
    const res2 = await TimeoutService.requestTimeout(matchId, 'local');
    expect(res2.success).toBe(false);
    expect(res2.error).toContain('Tiempos fuera agotados');

    const match2 = await db.matches.get(matchId);
    expect(match2?.localTimeouts).toBe(1); // Sigue en 1, NO se reseteó a 0
  });

  it('Límite tres: consume hasta 3 y solicitud posterior al agotamiento mantiene el contador en 3', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 },
      },
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      localTimeouts: 0,
      visitorTimeouts: 0,
    })) as number;

    // Consumo 1
    await TimeoutService.requestTimeout(matchId, 'local');
    // Consumo 2
    await TimeoutService.requestTimeout(matchId, 'local');
    // Consumo 3
    const res3 = await TimeoutService.requestTimeout(matchId, 'local');
    expect(res3.success).toBe(true);

    let match = await db.matches.get(matchId);
    expect(match?.localTimeouts).toBe(3);

    // Solicitud posterior (intento 4): debe fallar y mantenerse en 3
    const res4 = await TimeoutService.requestTimeout(matchId, 'local');
    expect(res4.success).toBe(false);

    match = await db.matches.get(matchId);
    expect(match?.localTimeouts).toBe(3); // ¡No se reinició a 0!

    // Quinto intento consecutivo: sigue rechazado y en 3
    const res5 = await TimeoutService.requestTimeout(matchId, 'local');
    expect(res5.success).toBe(false);

    match = await db.matches.get(matchId);
    expect(match?.localTimeouts).toBe(3);
  });

  it('Límite cinco: consumo independiente hasta 5 para local y visitante', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 5 },
      },
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      localTimeouts: 0,
      visitorTimeouts: 0,
    })) as number;

    // Local consume 5
    for (let i = 0; i < 5; i++) {
      const res = await TimeoutService.requestTimeout(matchId, 'local');
      expect(res.success).toBe(true);
    }
    // Visita consume 2
    await TimeoutService.requestTimeout(matchId, 'visitor');
    await TimeoutService.requestTimeout(matchId, 'visitor');

    const match = await db.matches.get(matchId);
    expect(match?.localTimeouts).toBe(5);
    expect(match?.visitorTimeouts).toBe(2);

    // Local agotado
    const localOver = await TimeoutService.requestTimeout(matchId, 'local');
    expect(localOver.success).toBe(false);

    // Visita aún tiene disponibles
    const visitorNext = await TimeoutService.requestTimeout(matchId, 'visitor');
    expect(visitorNext.success).toBe(true);

    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localTimeouts).toBe(5);
    expect(matchAfter?.visitorTimeouts).toBe(3);
  });

  it('Doble pulsación rápida (concurrencia): no permite exceder el límite configurado', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 1 },
      },
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      localTimeouts: 0,
      visitorTimeouts: 0,
    })) as number;

    // Dos pulsaciones concurrentes cuando solo quedaba 1 timeout
    const [p1, p2] = await Promise.all([
      TimeoutService.requestTimeout(matchId, 'local'),
      TimeoutService.requestTimeout(matchId, 'local'),
    ]);

    const successCount = [p1.success, p2.success].filter(Boolean).length;
    expect(successCount).toBe(1);

    const match = await db.matches.get(matchId);
    expect(match?.localTimeouts).toBe(1);
  });

  it('Partido finalizado rechaza solicitudes de tiempo fuera', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 },
      },
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      localTimeouts: 1,
      visitorTimeouts: 1,
    })) as number;

    await db.matches.update(matchId, { status: 'finished' });

    const res = await TimeoutService.requestTimeout(matchId, 'local');
    expect(res.success).toBe(false);
    expect(res.error).toContain('El partido ya finalizó');

    const match = await db.matches.get(matchId);
    expect(match?.localTimeouts).toBe(1);
  });

  describe('C-04: Real Production Quarter and Overtime Transitions (useTraditionalLogic)', () => {
    it('Q1 -> Q2 via advanceTraditionalQuarter(): advances quarter, resets timer, and CONSERVES timeouts', async () => {
      const matchId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 },
        },
        currentQuarter: 1,
        timerSecondsRemaining: 42,
        timerLastStart: new Date(Date.now() - 5000),
        localScore: 18,
        visitorScore: 16,
        localFouls: 2,
        visitorFouls: 3,
        localTimeouts: 0,
        visitorTimeouts: 0,
      })) as number;

      // Consume 2 local timeouts and 1 visitor timeout during Q1
      await TimeoutService.requestTimeout(matchId, 'local');
      await TimeoutService.requestTimeout(matchId, 'local');
      await TimeoutService.requestTimeout(matchId, 'visitor');

      // Invoke REAL production transition Q1 -> Q2
      const advanced = await advanceTraditionalQuarter(matchId);
      expect(advanced).toBe(true);

      const matchAfterQ1 = await db.matches.get(matchId);
      expect(matchAfterQ1?.currentQuarter).toBe(2);
      expect(matchAfterQ1?.timerSecondsRemaining).toBe(10 * 60); // Reset to 600s
      expect(matchAfterQ1?.timerLastStart).toBeUndefined(); // Timer paused on quarter change
      // Timeouts MUST be conserved between Q1 and Q2 (same first half)
      expect(matchAfterQ1?.localTimeouts).toBe(2);
      expect(matchAfterQ1?.visitorTimeouts).toBe(1);

      // Local can only consume 1 more in Q2 before reaching limit 3
      const thirdLocal = await TimeoutService.requestTimeout(matchId, 'local');
      expect(thirdLocal.success).toBe(true);
      const fourthLocal = await TimeoutService.requestTimeout(matchId, 'local');
      expect(fourthLocal.success).toBe(false);
    });

    it('Q2 -> Q3 (Halftime) via advanceTraditionalQuarter(): advances to Q3, resets timer, and RESETS timeouts to 0', async () => {
      const matchId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 },
        },
        currentQuarter: 2,
        timerSecondsRemaining: 0,
        timerLastStart: undefined,
        localScore: 40,
        visitorScore: 38,
        localFouls: 4,
        visitorFouls: 4,
        localTimeouts: 3, // Exhausted in 1st half
        visitorTimeouts: 2,
      })) as number;

      // Confirm local is exhausted at end of Q2
      const rejectedInQ2 = await TimeoutService.requestTimeout(matchId, 'local');
      expect(rejectedInQ2.success).toBe(false);

      // Invoke REAL production transition Q2 -> Q3 (new half)
      const advanced = await advanceTraditionalQuarter(matchId);
      expect(advanced).toBe(true);

      const matchInQ3 = await db.matches.get(matchId);
      expect(matchInQ3?.currentQuarter).toBe(3);
      expect(matchInQ3?.timerSecondsRemaining).toBe(600);
      expect(matchInQ3?.timerLastStart).toBeUndefined();
      // Timeouts reset to 0 at start of 2nd half (Q3)
      expect(matchInQ3?.localTimeouts).toBe(0);
      expect(matchInQ3?.visitorTimeouts).toBe(0);

      // Now local can consume timeouts again in Q3
      const allowedInQ3 = await TimeoutService.requestTimeout(matchId, 'local');
      expect(allowedInQ3.success).toBe(true);

      const matchAfterTimeout = await db.matches.get(matchId);
      expect(matchAfterTimeout?.localTimeouts).toBe(1);
    });

    it('Q3 -> Q4 via advanceTraditionalQuarter(): advances to Q4, CONSERVES 2nd-half timeouts, and blocks advancing past Q4', async () => {
      const matchId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 12, timeoutsPerTeam: 2 },
        },
        currentQuarter: 3,
        timerSecondsRemaining: 15,
        localScore: 60,
        visitorScore: 59,
        localFouls: 3,
        visitorFouls: 2,
        localTimeouts: 1,
        visitorTimeouts: 2,
      })) as number;

      // Real transition Q3 -> Q4
      const advancedToQ4 = await advanceTraditionalQuarter(matchId);
      expect(advancedToQ4).toBe(true);

      const matchInQ4 = await db.matches.get(matchId);
      expect(matchInQ4?.currentQuarter).toBe(4);
      expect(matchInQ4?.timerSecondsRemaining).toBe(12 * 60);
      // Conserved from Q3 into Q4!
      expect(matchInQ4?.localTimeouts).toBe(1);
      expect(matchInQ4?.visitorTimeouts).toBe(2);

      // Visitor is still exhausted in Q4
      const visitorAttempt = await TimeoutService.requestTimeout(matchId, 'visitor');
      expect(visitorAttempt.success).toBe(false);
      expect((await db.matches.get(matchId))?.visitorTimeouts).toBe(2);

      // Calling advanceTraditionalQuarter at Q4 (totalQuarters = 4) must not advance further
      const advancePastQ4 = await advanceTraditionalQuarter(matchId);
      expect(advancePastQ4).toBe(false);
      expect((await db.matches.get(matchId))?.currentQuarter).toBe(4);
    });

    it('Start of Overtime via startTraditionalOvertime(): advances to OT1 (Q5) and OT2 (Q6), sets OT timer, and RESETS timeouts', async () => {
      const matchId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 2 },
        },
        currentQuarter: 4,
        timerSecondsRemaining: 0,
        timerLastStart: new Date(Date.now() - 1000),
        localScore: 75,
        visitorScore: 75,
        localFouls: 5,
        visitorFouls: 5,
        localTimeouts: 2, // Exhausted in Q4
        visitorTimeouts: 2, // Exhausted in Q4
      })) as number;

      // Start OT1 (5 minutes) via real production function
      const startedOT1 = await startTraditionalOvertime(matchId, 5);
      expect(startedOT1).toBe(true);

      const matchOT1 = await db.matches.get(matchId);
      expect(matchOT1?.currentQuarter).toBe(5);
      expect(matchOT1?.timerSecondsRemaining).toBe(5 * 60);
      expect(matchOT1?.timerLastStart).toBeUndefined();
      expect(matchOT1?.localTimeouts).toBe(0);
      expect(matchOT1?.visitorTimeouts).toBe(0);

      // Consume 1 timeout in OT1
      const ot1Timeout = await TimeoutService.requestTimeout(matchId, 'local');
      expect(ot1Timeout.success).toBe(true);
      expect((await db.matches.get(matchId))?.localTimeouts).toBe(1);

      // Start OT2 (3 minutes) via real production function
      const startedOT2 = await startTraditionalOvertime(matchId, 3);
      expect(startedOT2).toBe(true);

      const matchOT2 = await db.matches.get(matchId);
      expect(matchOT2?.currentQuarter).toBe(6);
      expect(matchOT2?.timerSecondsRemaining).toBe(3 * 60);
      expect(matchOT2?.localTimeouts).toBe(0);
      expect(matchOT2?.visitorTimeouts).toBe(0);
    });

    it('Persisted reload: state of quarter, timer, and timeouts survives reopening IndexedDB instance', async () => {
      const matchId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 2 },
        },
        currentQuarter: 1,
        timerSecondsRemaining: 120,
        localScore: 22,
        visitorScore: 19,
        localFouls: 1,
        visitorFouls: 2,
        localTimeouts: 0,
        visitorTimeouts: 0,
      })) as number;

      // Consume 2 local timeouts in Q1 and advance to Q2
      await TimeoutService.requestTimeout(matchId, 'local');
      await TimeoutService.requestTimeout(matchId, 'local');
      await advanceTraditionalQuarter(matchId);

      // Simulate page reload by opening a separate BasketControlDB connection to the same DB
      const reloadedDb = new BasketControlDB(db.name);
      await reloadedDb.open();
      try {
        const persistedMatch = await reloadedDb.matches.get(matchId);
        expect(persistedMatch).toBeDefined();
        expect(persistedMatch?.currentQuarter).toBe(2);
        expect(persistedMatch?.timerSecondsRemaining).toBe(600);
        expect(persistedMatch?.localTimeouts).toBe(2);
        expect(persistedMatch?.visitorTimeouts).toBe(0);

        // Attempt to consume a 3rd timeout after reload -> still rejected and stays at 2
        const afterReloadAttempt = await TimeoutService.requestTimeout(matchId, 'local');
        expect(afterReloadAttempt.success).toBe(false);

        const rechecked = await reloadedDb.matches.get(matchId);
        expect(rechecked?.localTimeouts).toBe(2);
      } finally {
        reloadedDb.close();
      }
    });
  });
});
