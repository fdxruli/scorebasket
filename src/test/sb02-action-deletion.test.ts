// src/test/sb02-action-deletion.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db';
import { GameActionsRepository } from '../db/gameActions.repository';

describe('SB-02: Eliminación Atómica e Idempotente de Jugadas', () => {
  let localTeamId: number;
  let visitorTeamId: number;
  let matchId: number;

  beforeEach(async () => {
    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();

    localTeamId = (await db.teams.add({
      name: 'Local Team',
      createdAt: new Date(),
      isArchived: false
    })) as number;

    visitorTeamId = (await db.teams.add({
      name: 'Visitor Team',
      createdAt: new Date(),
      isArchived: false
    })) as number;

    matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      eventsProvenance: 'live_session',
      config: { mode: 'traditional' },
      currentQuarter: 1,
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0
    })) as number;
  });

  it('Eliminar una anotación de 1 punto descuenta correctamente del marcador', async () => {
    const scoreId = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 1,
      quarter: 1,
      createdAt: new Date()
    })) as number;

    await db.matches.update(matchId, { localScore: 1 });

    const result = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: scoreId,
      type: 'score'
    });

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
    expect(result.newScore?.local).toBe(0);

    const match = await db.matches.get(matchId);
    expect(match?.localScore).toBe(0);

    const scoreInDb = await db.scores.get(scoreId);
    expect(scoreInDb).toBeUndefined();
  });

  it('Eliminar una anotación de 2 puntos descuenta exactamente 2 puntos', async () => {
    await db.scores.bulkAdd([
      { matchId, teamId: visitorTeamId, points: 2, quarter: 1, createdAt: new Date(Date.now() - 4000) },
      { matchId, teamId: visitorTeamId, points: 2, quarter: 1, createdAt: new Date(Date.now() - 3000) },
      { matchId, teamId: visitorTeamId, points: 2, quarter: 1, createdAt: new Date(Date.now() - 2000) },
      { matchId, teamId: visitorTeamId, points: 2, quarter: 1, createdAt: new Date(Date.now() - 1000) },
    ]);

    const scoreId = (await db.scores.add({
      matchId,
      teamId: visitorTeamId,
      points: 2,
      quarter: 1,
      createdAt: new Date()
    })) as number;

    await db.matches.update(matchId, { visitorScore: 10 });

    const result = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: scoreId,
      type: 'score'
    });

    expect(result.success).toBe(true);
    expect(result.newScore?.visitor).toBe(8);

    const match = await db.matches.get(matchId);
    expect(match?.visitorScore).toBe(8);
  });

  it('Eliminar una anotación de 3 puntos descuenta exactamente 3 puntos', async () => {
    await db.scores.bulkAdd([
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 4000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 3000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 2000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 1000) },
    ]);

    const scoreId = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 1,
      createdAt: new Date()
    })) as number;

    await db.matches.update(matchId, { localScore: 15 });

    const result = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: scoreId,
      type: 'score'
    });

    expect(result.success).toBe(true);
    expect(result.newScore?.local).toBe(12);

    const match = await db.matches.get(matchId);
    expect(match?.localScore).toBe(12);
  });

  it('Eliminar una falta descuenta del contador correspondiente', async () => {
    const foulId = (await db.fouls.add({
      matchId,
      teamId: localTeamId,
      quarter: 1,
      createdAt: new Date()
    })) as number;

    await db.matches.update(matchId, { localFouls: 3 });

    const result = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: foulId,
      type: 'foul'
    });

    expect(result.success).toBe(true);
    expect(result.newFouls?.local).toBe(2);

    const match = await db.matches.get(matchId);
    expect(match?.localFouls).toBe(2);
  });

  it('Idempotencia: eliminar dos veces la misma anotación NO descuenta puntos dos veces', async () => {
    await db.scores.bulkAdd([
      { matchId, teamId: localTeamId, points: 2, quarter: 1, createdAt: new Date(Date.now() - 4000) },
      { matchId, teamId: localTeamId, points: 2, quarter: 1, createdAt: new Date(Date.now() - 3000) },
      { matchId, teamId: localTeamId, points: 2, quarter: 1, createdAt: new Date(Date.now() - 2000) },
      { matchId, teamId: localTeamId, points: 2, quarter: 1, createdAt: new Date(Date.now() - 1000) },
    ]);

    const scoreId = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1,
      createdAt: new Date()
    })) as number;

    await db.matches.update(matchId, { localScore: 10 });

    // Primera eliminación: exitosa
    const firstRes = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: scoreId,
      type: 'score'
    });
    expect(firstRes.success).toBe(true);
    expect(firstRes.deleted).toBe(true);

    const matchAfterFirst = await db.matches.get(matchId);
    expect(matchAfterFirst?.localScore).toBe(8);

    // Segunda eliminación: idempotente, controlada, no vuelve a restar puntos
    const secondRes = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: scoreId,
      type: 'score'
    });
    expect(secondRes.success).toBe(false);
    expect(secondRes.deleted).toBe(false);
    expect(secondRes.error).toContain('La acción no existe o ya fue eliminada');

    const matchAfterSecond = await db.matches.get(matchId);
    expect(matchAfterSecond?.localScore).toBe(8); // Se mantuvo en 8, NO bajó a 6
  });

  it('Idempotencia: eliminar dos veces la misma falta NO descuenta faltas dos veces', async () => {
    const foulId = (await db.fouls.add({
      matchId,
      teamId: visitorTeamId,
      quarter: 1,
      createdAt: new Date()
    })) as number;

    await db.matches.update(matchId, { visitorFouls: 4 });

    const firstRes = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: foulId,
      type: 'foul'
    });
    expect(firstRes.success).toBe(true);

    const secondRes = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: foulId,
      type: 'foul'
    });
    expect(secondRes.success).toBe(false);

    const match = await db.matches.get(matchId);
    expect(match?.visitorFouls).toBe(3); // Se mantuvo en 3, no bajó a 2
  });

  it('Dos solicitudes concurrentes sobre la misma acción solo descuentan una vez', async () => {
    await db.scores.bulkAdd([
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 5000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 4000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 3000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 2000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 1500) },
      { matchId, teamId: localTeamId, points: 2, quarter: 1, createdAt: new Date(Date.now() - 1000) },
    ]);

    const scoreId = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 1,
      createdAt: new Date()
    })) as number;

    await db.matches.update(matchId, { localScore: 20 });

    const [res1, res2] = await Promise.all([
      GameActionsRepository.deleteActionSafely({ matchId, actionId: scoreId, type: 'score' }),
      GameActionsRepository.deleteActionSafely({ matchId, actionId: scoreId, type: 'score' })
    ]);

    // Exactamente una debe haber tenido éxito y la otra debe haber sido rechazada de forma controlada
    const deletedCount = [res1.deleted, res2.deleted].filter(Boolean).length;
    expect(deletedCount).toBe(1);

    const match = await db.matches.get(matchId);
    expect(match?.localScore).toBe(17); // Descontó exactamente 3, no 6
  });

  it('Intentar eliminar una acción inexistente produce respuesta controlada sin alterar marcador', async () => {
    await db.matches.update(matchId, { localScore: 50 });

    const result = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: 99999,
      type: 'score'
    });

    expect(result.success).toBe(false);
    expect(result.deleted).toBe(false);

    const match = await db.matches.get(matchId);
    expect(match?.localScore).toBe(50);
  });

  it('Intentar eliminar una acción de otro partido es rechazado y no modifica nada', async () => {
    const otherMatchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      localScore: 30,
      visitorScore: 25,
      localFouls: 0,
      visitorFouls: 0
    })) as number;

    const scoreInOtherMatch = (await db.scores.add({
      matchId: otherMatchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1,
      createdAt: new Date()
    })) as number;

    await expect(
      GameActionsRepository.deleteActionSafely({
        matchId: matchId, // ID diferente al de la jugada
        actionId: scoreInOtherMatch,
        type: 'score'
      })
    ).rejects.toThrow('La acción no pertenece al partido solicitado');

    const otherMatch = await db.matches.get(otherMatchId);
    expect(otherMatch?.localScore).toBe(30);

    const scoreStillExists = await db.scores.get(scoreInOtherMatch);
    expect(scoreStillExists).toBeDefined();
  });

  it('Race / Series: rechazar eliminación de jugadas de periodos/sets anteriores ya cerrados', async () => {
    const raceMatchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'race',
        race: {
          targetScore: 21,
          currentGame: 2, // Estamos en el juego 2
          hasRematches: true
        }
      },
      localScore: 5,
      visitorScore: 4,
      localFouls: 0,
      visitorFouls: 0
    })) as number;

    // Jugada del juego 1 (cerrado)
    const oldScoreId = (await db.scores.add({
      matchId: raceMatchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1, // Juego 1
      createdAt: new Date(Date.now() - 60000)
    })) as number;

    await expect(
      GameActionsRepository.deleteActionSafely({
        matchId: raceMatchId,
        actionId: oldScoreId,
        type: 'score'
      })
    ).rejects.toThrow('No se pueden eliminar acciones de juegos o sets anteriores');

    const match = await db.matches.get(raceMatchId);
    expect(match?.localScore).toBe(5); // No descontó del juego actual
  });

  it('undoLastAction deshace de forma atómica y segura la última acción del periodo actual', async () => {
    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1,
      createdAt: new Date(Date.now() - 5000)
    });

    const latestScoreId = (await db.scores.add({
      matchId,
      teamId: visitorTeamId,
      points: 3,
      quarter: 1,
      createdAt: new Date(Date.now())
    })) as number;

    await db.matches.update(matchId, { localScore: 2, visitorScore: 3 });

    const result = await GameActionsRepository.undoLastAction(matchId);
    expect(result.success).toBe(true);

    const match = await db.matches.get(matchId);
    expect(match?.visitorScore).toBe(0);
    expect(match?.localScore).toBe(2);

    const deleted = await db.scores.get(latestScoreId);
    expect(deleted).toBeUndefined();
  });

  it('Comparación estricta de marcador con registros después de operaciones', async () => {
    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 1,
      createdAt: new Date(Date.now() - 3000)
    });

    const s2 = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1,
      createdAt: new Date(Date.now() - 2000)
    })) as number;

    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 1,
      quarter: 1,
      createdAt: new Date(Date.now() - 1000)
    });

    await db.matches.update(matchId, { localScore: 6 });

    // Eliminar la segunda jugada (2 pts)
    await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: s2,
      type: 'score'
    });

    const remainingScores = await db.scores.where('matchId').equals(matchId).toArray();
    const sumPoints = remainingScores.reduce((acc, s) => acc + s.points, 0);

    const match = await db.matches.get(matchId);
    expect(match?.localScore).toBe(sumPoints); // Marcador coincide exactamente con las jugadas en BD (4 pts)
  });
});
