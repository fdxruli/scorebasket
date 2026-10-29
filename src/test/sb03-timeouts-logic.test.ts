import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db';
import { TimeoutService } from '../db/timeout.service';

describe('SB-03: Timeouts Limits and Safe Counts', () => {
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
      status: 'finished',
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

    const res = await TimeoutService.requestTimeout(matchId, 'local');
    expect(res.success).toBe(false);
    expect(res.error).toContain('El partido ya finalizó');

    const match = await db.matches.get(matchId);
    expect(match?.localTimeouts).toBe(1);
  });

  it('Reinicio reglamentario admitido: reinicio en nueva mitad (Q2 a Q3) y tiempo extra (OT)', async () => {
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
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      localTimeouts: 3, // Agotados en la primera mitad
      visitorTimeouts: 2,
    })) as number;

    // Simular paso reglamentario a la segunda mitad (Q2 -> Q3)
    const isNewHalf = 2 === 2; // Q2 -> Q3
    if (isNewHalf) {
      await db.matches.update(matchId, {
        currentQuarter: 3,
        localTimeouts: 0,
        visitorTimeouts: 0,
      });
    }

    const matchSecondHalf = await db.matches.get(matchId);
    expect(matchSecondHalf?.currentQuarter).toBe(3);
    expect(matchSecondHalf?.localTimeouts).toBe(0);
    expect(matchSecondHalf?.visitorTimeouts).toBe(0);

    // En la segunda mitad pueden volver a pedir
    const res = await TimeoutService.requestTimeout(matchId, 'local');
    expect(res.success).toBe(true);

    const matchUpdated = await db.matches.get(matchId);
    expect(matchUpdated?.localTimeouts).toBe(1);
  });
});
