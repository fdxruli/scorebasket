// src/test/sb02-integrity-contract.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db';
import { GameActionsRepository } from '../db/gameActions.repository';
import { ScoreIntegrityService } from '../db/scoreIntegrity.service';
import type { Score } from '../db/models';

describe('R1.4: Contrato de Integridad y Protección de Anotaciones (15 Escenarios Obligatorios)', () => {
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

  // 1. Traditional consistente: eliminación válida
  it('1. Traditional consistente: eliminación válida descuenta y preserva consistencia', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      currentQuarter: 1,
      localScore: 10,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
    })) as number;

    // Cuatro canastas que suman exactamente 10 puntos (3 + 3 + 2 + 2)
    await db.scores.bulkAdd([
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 4000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 3000) },
      { matchId, teamId: localTeamId, points: 2, quarter: 1, createdAt: new Date(Date.now() - 2000) },
    ] as Score[]);

    const scoreId = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1,
      createdAt: new Date(Date.now() - 1000),
    })) as number;

    const result = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: scoreId,
      type: 'score',
    });

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
    expect(result.newScore?.local).toBe(8);

    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localScore).toBe(8);

    const remainingScores = await db.scores.where('matchId').equals(matchId).toArray();
    const sumRemaining = remainingScores.reduce((acc, s) => acc + s.points, 0);
    expect(sumRemaining).toBe(8);

    const integrityAfter = ScoreIntegrityService.verifyScoreIntegrity(matchAfter!, remainingScores);
    expect(integrityAfter.status).toBe('CONSISTENT');
  });

  // 2. Traditional con marcador 10 y eventos que suman 6: rechazo íntegro
  it('2. Traditional con marcador 10 y eventos que suman 6: rechazo íntegro sin mutar marcador', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      currentQuarter: 1,
      localScore: 10, // Marcador = 10
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
    })) as number;

    // Eventos suman solo 6 (3 + 3)
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

    await expect(
      GameActionsRepository.deleteActionSafely({
        matchId,
        actionId: score1,
        type: 'score',
      })
    ).rejects.toThrow('Discrepancia detectada en el marcador');

    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localScore).toBe(10);
    const scoreStillThere = await db.scores.get(score1);
    expect(scoreStillThere).toBeDefined();
  });

  // 3. Race con juego 1 terminado y juego 2 activo: eliminación exclusivamente del juego 2
  it('3. Race con juego 1 terminado y juego 2 activo: eliminación exclusivamente del juego 2', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'race',
        race: { targetScore: 21, currentGame: 2, hasRematches: true },
      },
      localScore: 5, // Puntos de juego 2
      visitorScore: 2,
      localFouls: 0,
      visitorFouls: 0,
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date(Date.now() - 60000) },
      ],
    })) as number;

    // Scores juego 1 (21 pts)
    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 1,
      createdAt: new Date(Date.now() - 80000),
    });

    // Scores juego 2 (5 pts: 3 + 2)
    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 2,
      createdAt: new Date(Date.now() - 5000),
    });

    const scoreJuego2 = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 2,
      createdAt: new Date(Date.now() - 2000),
    })) as number;

    await db.scores.add({
      matchId,
      teamId: visitorTeamId,
      points: 2,
      quarter: 2,
      createdAt: new Date(Date.now() - 1000),
    });

    const result = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: scoreJuego2,
      type: 'score',
    });

    expect(result.success).toBe(true);
    expect(result.newScore?.local).toBe(3);

    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localScore).toBe(3);
    expect(matchAfter?.gameHistory).toHaveLength(1);
    expect(matchAfter?.gameHistory?.[0].localScore).toBe(21); // Historial de juego 1 no se tocó
  });

  // 4. Race con marcador 3 y eventos actuales que suman 3, más 21 puntos del juego anterior: no sumar los 21 históricos
  it('4. Race con marcador 3 y eventos actuales que suman 3, más 21 históricos: no sumar históricos', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'race',
        race: { targetScore: 21, currentGame: 2, hasRematches: true },
      },
      localScore: 3,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date(Date.now() - 100000) },
      ],
    })) as number;

    // 21 pts del juego 1 en bd
    await db.scores.bulkAdd([
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 120000) },
      { matchId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 110000) },
    ] as Score[]);

    // 3 pts del juego 2 en bd (2 + 1)
    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 2,
      createdAt: new Date(Date.now() - 3000),
    });

    const score1Pt = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 1,
      quarter: 2,
      createdAt: new Date(Date.now() - 1000),
    })) as number;

    const allScores = await db.scores.where('matchId').equals(matchId).toArray();
    const integrity = ScoreIntegrityService.verifyScoreIntegrity(
      (await db.matches.get(matchId))!,
      allScores
    );

    expect(integrity.status).toBe('CONSISTENT');
    expect(integrity.computedScore?.local).toBe(3); // NO sumó los 21 del juego 1

    const result = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: score1Pt,
      type: 'score',
    });

    expect(result.success).toBe(true);
    expect(result.newScore?.local).toBe(2);

    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localScore).toBe(2);
  });

  // 5. Race con discrepancia previa: rechazo sin alterar resultados
  it('5. Race con discrepancia previa: rechazo sin alterar resultados', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'race',
        race: { targetScore: 21, currentGame: 2, hasRematches: true },
      },
      localScore: 7, // Discrepancia: almacenado 7
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: new Date() },
      ],
    })) as number;

    // Pero en juego 2 solo hay 4 puntos (2 + 2)
    const scoreA = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 2,
      createdAt: new Date(Date.now() - 2000),
    })) as number;

    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 2,
      createdAt: new Date(Date.now() - 1000),
    });

    await expect(
      GameActionsRepository.deleteActionSafely({
        matchId,
        actionId: scoreA,
        type: 'score',
      })
    ).rejects.toThrow('Discrepancia detectada en el marcador');

    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localScore).toBe(7);
  });

  // 6. Best-of-Series: aislamiento entre sets
  it('6. Best-of-Series: aislamiento entre sets', async () => {
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
          currentGame: 2,
          wins: { local: 1, visitor: 0 },
        },
      },
      currentQuarter: 2,
      localScore: 5,
      visitorScore: 4,
      localFouls: 0,
      visitorFouls: 0,
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 17, winner: 'local', finishedAt: new Date(Date.now() - 50000) },
      ],
    })) as number;

    // Set 1 (cerrado)
    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 1,
      createdAt: new Date(Date.now() - 60000),
    });

    // Set 2 (activo: local 3 + 2 = 5, visita 2 + 2 = 4)
    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 2,
      createdAt: new Date(Date.now() - 3000),
    });
    const set2ScoreLocal = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 2,
      createdAt: new Date(Date.now() - 2000),
    })) as number;
    await db.scores.add({
      matchId,
      teamId: visitorTeamId,
      points: 2,
      quarter: 2,
      createdAt: new Date(Date.now() - 1500),
    });
    await db.scores.add({
      matchId,
      teamId: visitorTeamId,
      points: 2,
      quarter: 2,
      createdAt: new Date(Date.now() - 1000),
    });

    const result = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: set2ScoreLocal,
      type: 'score',
    });

    expect(result.success).toBe(true);
    expect(result.newScore?.local).toBe(3);

    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localScore).toBe(3);
    expect(matchAfter?.config?.bestOf?.wins?.local).toBe(1); // Victorias de serie intactas
  });

  // 7. Set actual ya registrado en "gameHistory": rechazo
  it('7. Set actual ya registrado en gameHistory: rechazo', async () => {
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
          currentGame: 2,
          wins: { local: 2, visitor: 0 },
        },
      },
      currentQuarter: 2,
      localScore: 21,
      visitorScore: 18,
      localFouls: 0,
      visitorFouls: 0,
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 16, winner: 'local', finishedAt: new Date(Date.now() - 60000) },
        { gameNumber: 2, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date(Date.now() - 10000) },
      ],
    })) as number;

    const set2Score = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 2,
      createdAt: new Date(Date.now() - 15000),
    })) as number;

    await expect(
      GameActionsRepository.deleteActionSafely({
        matchId,
        actionId: set2Score,
        type: 'score',
      })
    ).rejects.toThrow('No se pueden eliminar acciones de un juego o set ya registrado y cerrado');
  });

  // 8. Partido Race finalizado y registrado: rechazo de corrección que alteraría el resultado
  it('8. Partido Race finalizado y registrado: rechazo de corrección que alteraría el resultado', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'finished', // Partido finalizado oficialmente
      createdAt: new Date(),
      config: {
        mode: 'race',
        race: { targetScore: 21, currentGame: 1, hasRematches: false },
      },
      localScore: 21,
      visitorScore: 19,
      localFouls: 0,
      visitorFouls: 0,
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: new Date() },
      ],
    })) as number;

    const lastScore = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1,
      createdAt: new Date(),
    })) as number;

    await expect(
      GameActionsRepository.deleteActionSafely({
        matchId,
        actionId: lastScore,
        type: 'score',
      })
    ).rejects.toThrow('No se pueden eliminar acciones de un partido finalizado en esta modalidad deportiva.');
  });

  // 9. Eliminación repetida: ningún segundo descuento (idempotencia)
  it('9. Eliminación repetida: ningún segundo descuento', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      currentQuarter: 1,
      localScore: 3,
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

    // Primer llamado: exitoso
    const firstRes = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: scoreId,
      type: 'score',
    });
    expect(firstRes.success).toBe(true);
    expect(firstRes.deleted).toBe(true);

    const match1 = await db.matches.get(matchId);
    expect(match1?.localScore).toBe(0);

    // Segundo llamado con el mismo actionId: respuesta controlada sin volver a descontar
    const secondRes = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: scoreId,
      type: 'score',
    });
    expect(secondRes.success).toBe(false);
    expect(secondRes.deleted).toBe(false);
    expect(secondRes.error).toContain('La acción no existe o ya fue eliminada');

    const match2 = await db.matches.get(matchId);
    expect(match2?.localScore).toBe(0); // NO bajó a -3
  });

  // 10. Concurrencia de dos eliminaciones
  it('10. Concurrencia de dos eliminaciones: exactamente una descuenta', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      currentQuarter: 1,
      localScore: 5,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
    })) as number;

    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1,
      createdAt: new Date(Date.now() - 2000),
    });

    const targetScoreId = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 1,
      createdAt: new Date(Date.now() - 1000),
    })) as number;

    const [res1, res2] = await Promise.all([
      GameActionsRepository.deleteActionSafely({ matchId, actionId: targetScoreId, type: 'score' }),
      GameActionsRepository.deleteActionSafely({ matchId, actionId: targetScoreId, type: 'score' }),
    ]);

    const deletedCount = [res1.deleted, res2.deleted].filter(Boolean).length;
    expect(deletedCount).toBe(1);

    const match = await db.matches.get(matchId);
    expect(match?.localScore).toBe(2); // Descontó exactamente 3, no 6
  });

  // 11. Subdesbordamiento del marcador: rechazo
  it('11. Subdesbordamiento del marcador: rechazo sin truncamiento artificial', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      currentQuarter: 1,
      localScore: 2, // Marcador menor que la canasta de 3 pts
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
    })) as number;

    const score3Pts = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 3,
      quarter: 1,
      createdAt: new Date(),
    })) as number;

    await expect(
      GameActionsRepository.deleteActionSafely({
        matchId,
        actionId: score3Pts,
        type: 'score',
      })
    ).rejects.toThrow('Subdesbordamiento de marcador detectado');

    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localScore).toBe(2);
  });

  // 12. Historial incompleto: estado "UNVERIFIED", sin reparación automática
  it('12. Historial incompleto: estado UNVERIFIED, sin reparación automática', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      currentQuarter: 1,
      localScore: 25, // Marcador positivo
      visitorScore: 20,
      localFouls: 0,
      visitorFouls: 0,
    })) as number;

    // BD sin jugadas registradas (0 scores)
    const match = (await db.matches.get(matchId))!;
    const scores = await db.scores.where('matchId').equals(matchId).toArray();

    const integrity = ScoreIntegrityService.verifyScoreIntegrity(match, scores);
    expect(integrity.status).toBe('UNVERIFIED');
    expect(integrity.isCompleteHistory).toBe(false);

    // Comprobar que verifyScoreIntegrity no hizo ninguna reparación automática ni mutación en matches
    const matchUnchanged = await db.matches.get(matchId);
    expect(matchUnchanged?.localScore).toBe(25);
    expect(matchUnchanged?.visitorScore).toBe(20);
  });

  // 13. Fallo transaccional: rollback completo
  it('13. Fallo transaccional: rollback completo', async () => {
    const matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: { mode: 'traditional' },
      currentQuarter: 1,
      localScore: 10,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
    })) as number;

    const score1 = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1,
      createdAt: new Date(),
    })) as number;

    // Discrepancia intencional (10 vs 2) provocará aborto y rollback
    await expect(
      GameActionsRepository.deleteActionSafely({
        matchId,
        actionId: score1,
        type: 'score',
      })
    ).rejects.toThrow();

    // Comprobar que score1 NO fue eliminado
    const scoreInDb = await db.scores.get(score1);
    expect(scoreInDb).toBeDefined();

    // Comprobar que match.localScore NO fue modificado
    const match = await db.matches.get(matchId);
    expect(match?.localScore).toBe(10);
  });

  // 14. Preservación de ganadores y victorias acumuladas
  it('14. Preservación de ganadores y victorias acumuladas', async () => {
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
          currentGame: 2,
          wins: { local: 1, visitor: 0 },
        },
      },
      currentQuarter: 2,
      localScore: 2,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
      ],
    })) as number;

    const s = (await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 2,
      createdAt: new Date(),
    })) as number;

    await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: s,
      type: 'score',
    });

    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localScore).toBe(0);
    // Victorias y ganador de juego 1 permanecen exactamente iguales
    expect(matchAfter?.config.bestOf?.wins?.local).toBe(1);
    expect(matchAfter?.config.bestOf?.wins?.visitor).toBe(0);
    expect(matchAfter?.gameHistory?.[0].winner).toBe('local');
  });

  // 15. Faltas: comprobar semántica por modalidad y evitar confusión entre total histórico y periodo
  it('15. Faltas: semántica por modalidad respetada y contador consistente', async () => {
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
      localFouls: 3, // 3 faltas acumuladas
      visitorFouls: 0,
    })) as number;

    // 1 falta en Q1 y 2 en Q2
    await db.fouls.add({
      matchId,
      teamId: localTeamId,
      quarter: 1,
      createdAt: new Date(Date.now() - 30000),
    });
    await db.fouls.add({
      matchId,
      teamId: localTeamId,
      quarter: 2,
      createdAt: new Date(Date.now() - 10000),
    });
    const foulQ2 = (await db.fouls.add({
      matchId,
      teamId: localTeamId,
      quarter: 2,
      createdAt: new Date(Date.now() - 5000),
    })) as number;

    const result = await GameActionsRepository.deleteActionSafely({
      matchId,
      actionId: foulQ2,
      type: 'foul',
    });

    expect(result.success).toBe(true);
    expect(result.newFouls?.local).toBe(2);

    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localFouls).toBe(2); // Total acumulado en matches bajó de 3 a 2

    // Comprobar que en bd quedan 2 faltas: 1 de Q1 y 1 de Q2
    const remainingFouls = await db.fouls.where('matchId').equals(matchId).toArray();
    expect(remainingFouls).toHaveLength(2);
    expect(remainingFouls.filter(f => f.quarter === 2)).toHaveLength(1);
    expect(remainingFouls.filter(f => f.quarter === 1)).toHaveLength(1);
  });
});
