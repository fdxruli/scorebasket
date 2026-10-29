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

  // =========================================================================
  // MINI-FASE R1.5: Certificación del Contrato de Integridad (10 Escenarios)
  // =========================================================================

  describe('R1.5: Certificación y Blindaje del Contrato de Integridad', () => {
    // 1. Race juego 3 con historial "[1, 1]"
    it('1. Race juego 3 con historial "[1, 1]": detecta identificadores duplicados y devuelve UNVERIFIED', async () => {
      const matchId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        config: {
          mode: 'race',
          race: { targetScore: 21, currentGame: 3, hasRematches: true },
        },
        localScore: 5,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 10, winner: 'local', finishedAt: new Date() },
          { gameNumber: 1, localScore: 21, visitorScore: 12, winner: 'local', finishedAt: new Date() }, // Duplicado!
        ],
      })) as number;

      const scoreId = (await db.scores.add({
        matchId,
        teamId: localTeamId,
        points: 2,
        quarter: 3,
        createdAt: new Date(),
      })) as number;

      const match = (await db.matches.get(matchId))!;
      const scores = await db.scores.where('matchId').equals(matchId).toArray();

      const integrity = ScoreIntegrityService.verifyScoreIntegrity(match, scores);
      expect(integrity.status).toBe('UNVERIFIED');
      expect(integrity.isCompleteHistory).toBe(false);
      expect(integrity.reason).toMatch(/duplicado/i);

      // Bloquea deleteActionSafely para proteger la integridad
      await expect(
        GameActionsRepository.deleteActionSafely({
          matchId,
          actionId: scoreId,
          type: 'score',
        })
      ).rejects.toThrow(/Historial no verificable/i);

      // Comprobar que no se alteró la BD
      const matchAfter = await db.matches.get(matchId);
      expect(matchAfter?.localScore).toBe(5);
      const scoreAfter = await db.scores.get(scoreId);
      expect(scoreAfter).toBeDefined();
    });

    // 2. Race juego 3 con historial "[1]"
    it('2. Race juego 3 con historial "[1]": detecta hueco de juego 2 y devuelve UNVERIFIED', async () => {
      const matchId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        config: {
          mode: 'race',
          race: { targetScore: 21, currentGame: 3, hasRematches: true },
        },
        localScore: 5,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 10, winner: 'local', finishedAt: new Date() },
          // Juego 2 ausente (hueco)
        ],
      })) as number;

      const scoreId = (await db.scores.add({
        matchId,
        teamId: localTeamId,
        points: 2,
        quarter: 3,
        createdAt: new Date(),
      })) as number;

      const match = (await db.matches.get(matchId))!;
      const scores = await db.scores.where('matchId').equals(matchId).toArray();

      const integrity = ScoreIntegrityService.verifyScoreIntegrity(match, scores);
      expect(integrity.status).toBe('UNVERIFIED');
      expect(integrity.isCompleteHistory).toBe(false);
      expect(integrity.reason).toMatch(/Hueco detectado/i);

      await expect(
        GameActionsRepository.deleteActionSafely({
          matchId,
          actionId: scoreId,
          type: 'score',
        })
      ).rejects.toThrow(/Historial no verificable/i);
    });

    // 3. Race juego 3 con historial "[1, 2]"
    it('3. Race juego 3 con historial "[1, 2]": continuidad válida permite eliminar jugadas del juego 3', async () => {
      const matchId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
        config: {
          mode: 'race',
          race: { targetScore: 21, currentGame: 3, hasRematches: true },
        },
        localScore: 5,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 10, winner: 'local', finishedAt: new Date() },
          { gameNumber: 2, localScore: 18, visitorScore: 21, winner: 'visitor', finishedAt: new Date() },
        ],
      })) as number;

      await db.scores.add({
        matchId,
        teamId: localTeamId,
        points: 3,
        quarter: 3,
        createdAt: new Date(Date.now() - 2000),
      });

      const scoreId = (await db.scores.add({
        matchId,
        teamId: localTeamId,
        points: 2,
        quarter: 3,
        createdAt: new Date(Date.now() - 1000),
      })) as number;

      const matchBefore = (await db.matches.get(matchId))!;
      const scoresBefore = await db.scores.where('matchId').equals(matchId).toArray();

      const integrityBefore = ScoreIntegrityService.verifyScoreIntegrity(matchBefore, scoresBefore);
      expect(integrityBefore.status).toBe('CONSISTENT');
      expect(integrityBefore.isCompleteHistory).toBe(true);

      const deleteResult = await GameActionsRepository.deleteActionSafely({
        matchId,
        actionId: scoreId,
        type: 'score',
      });

      expect(deleteResult.success).toBe(true);
      expect(deleteResult.deleted).toBe(true);
      expect(deleteResult.newScore?.local).toBe(3);

      const matchAfter = (await db.matches.get(matchId))!;
      expect(matchAfter.localScore).toBe(3);

      const scoresAfter = await db.scores.where('matchId').equals(matchId).toArray();
      const integrityAfter = ScoreIntegrityService.verifyScoreIntegrity(matchAfter, scoresAfter);
      expect(integrityAfter.status).toBe('CONSISTENT');
      expect(integrityAfter.isCompleteHistory).toBe(true);
    });

    // 4. Race con identificadores no enteros o futuros
    it('4. Race con identificadores no enteros o futuros: rechaza corrupción y devuelve UNVERIFIED', async () => {
      // Caso 4a: Identificador no entero (1.5)
      const matchNonIntegerId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        config: {
          mode: 'race',
          race: { targetScore: 21, currentGame: 2, hasRematches: true },
        },
        localScore: 2,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: [
          { gameNumber: 1.5 as unknown as number, localScore: 21, visitorScore: 10, winner: 'local', finishedAt: new Date() },
        ],
      })) as number;

      const scoreNonInteger = (await db.scores.add({
        matchId: matchNonIntegerId,
        teamId: localTeamId,
        points: 2,
        quarter: 2,
        createdAt: new Date(),
      })) as number;

      const matchNI = (await db.matches.get(matchNonIntegerId))!;
      const scoresNI = await db.scores.where('matchId').equals(matchNonIntegerId).toArray();
      const integrityNI = ScoreIntegrityService.verifyScoreIntegrity(matchNI, scoresNI);
      expect(integrityNI.status).toBe('UNVERIFIED');
      expect(integrityNI.reason).toMatch(/no es un entero positivo/i);

      await expect(
        GameActionsRepository.deleteActionSafely({
          matchId: matchNonIntegerId,
          actionId: scoreNonInteger,
          type: 'score',
        })
      ).rejects.toThrow(/Historial no verificable/i);

      // Caso 4b: Entrada futura (juego 4 en historial cuando el actual es 2)
      const matchFutureId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        config: {
          mode: 'race',
          race: { targetScore: 21, currentGame: 2, hasRematches: true },
        },
        localScore: 2,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 10, winner: 'local', finishedAt: new Date() },
          { gameNumber: 4, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() }, // Futuro!
        ],
      })) as number;

      const scoreFuture = (await db.scores.add({
        matchId: matchFutureId,
        teamId: localTeamId,
        points: 2,
        quarter: 2,
        createdAt: new Date(),
      })) as number;

      const matchFut = (await db.matches.get(matchFutureId))!;
      const scoresFut = await db.scores.where('matchId').equals(matchFutureId).toArray();
      const integrityFut = ScoreIntegrityService.verifyScoreIntegrity(matchFut, scoresFut);
      expect(integrityFut.status).toBe('UNVERIFIED');
      expect(integrityFut.reason).toMatch(/Entrada futura/i);

      await expect(
        GameActionsRepository.deleteActionSafely({
          matchId: matchFutureId,
          actionId: scoreFuture,
          type: 'score',
        })
      ).rejects.toThrow(/Historial no verificable/i);
    });

    // 5. Best-of-Series con duplicados
    it('5. Best-of-Series con duplicados: detecta sets duplicados en gameHistory y devuelve UNVERIFIED', async () => {
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
            currentGame: 3,
            wins: { local: 2, visitor: 0 },
          },
        },
        currentQuarter: 3,
        localScore: 3,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
          { gameNumber: 1, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: new Date() }, // Duplicado!
        ],
      })) as number;

      const scoreId = (await db.scores.add({
        matchId,
        teamId: localTeamId,
        points: 3,
        quarter: 3,
        createdAt: new Date(),
      })) as number;

      const match = (await db.matches.get(matchId))!;
      const scores = await db.scores.where('matchId').equals(matchId).toArray();
      const integrity = ScoreIntegrityService.verifyScoreIntegrity(match, scores);

      expect(integrity.status).toBe('UNVERIFIED');
      expect(integrity.isCompleteHistory).toBe(false);
      expect(integrity.reason).toMatch(/duplicado/i);

      await expect(
        GameActionsRepository.deleteActionSafely({
          matchId,
          actionId: scoreId,
          type: 'score',
        })
      ).rejects.toThrow(/Historial no verificable/i);
    });

    // 6. Best-of-Series con victorias contradictorias
    it('6. Best-of-Series con victorias contradictorias: detecta discrepancia entre wins y ganadores registrados', async () => {
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
            currentGame: 3,
            wins: { local: 1, visitor: 1 }, // Contradice historial: 2 victorias locales
          },
        },
        currentQuarter: 3,
        localScore: 2,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: new Date() },
          { gameNumber: 2, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: new Date() }, // Ganador local
        ],
      })) as number;

      const scoreId = (await db.scores.add({
        matchId,
        teamId: localTeamId,
        points: 2,
        quarter: 3,
        createdAt: new Date(),
      })) as number;

      const match = (await db.matches.get(matchId))!;
      const scores = await db.scores.where('matchId').equals(matchId).toArray();
      const integrity = ScoreIntegrityService.verifyScoreIntegrity(match, scores);

      expect(integrity.status).toBe('UNVERIFIED');
      expect(integrity.isCompleteHistory).toBe(false);
      expect(integrity.reason).toMatch(/Incoherencia en Best-of-Series: victorias acumuladas/i);

      await expect(
        GameActionsRepository.deleteActionSafely({
          matchId,
          actionId: scoreId,
          type: 'score',
        })
      ).rejects.toThrow(/Historial no verificable/i);
    });

    // 7. Igualdad numérica sin evidencia suficiente de completitud
    it('7. Igualdad numérica sin evidencia suficiente de completitud: separa consistencia de completitud histórica', async () => {
      // 7a: Procedencia explícitamente no verificada
      const matchUnverifiedId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        eventsProvenance: 'unverified',
        config: { mode: 'traditional' },
        currentQuarter: 1,
        localScore: 6, // Marcador = 6
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
      })) as number;

      // Eventos suman exactamente 6 (3 + 3)
      await db.scores.bulkAdd([
        { matchId: matchUnverifiedId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 2000) },
        { matchId: matchUnverifiedId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 1000) },
      ] as Score[]);

      const matchUV = (await db.matches.get(matchUnverifiedId))!;
      const scoresUV = await db.scores.where('matchId').equals(matchUnverifiedId).toArray();
      const integrityUV = ScoreIntegrityService.verifyScoreIntegrity(matchUV, scoresUV);

      // A pesar de la igualdad numérica, procedencia no acreditada produce UNVERIFIED e isCompleteHistory: false
      expect(integrityUV.status).toBe('UNVERIFIED');
      expect(integrityUV.isCompleteHistory).toBe(false);
      expect(integrityUV.reason).toMatch(/procedencia de eventos no acreditada/i);

      // 7b: Registro histórico legado sin procedencia explícita pero con igualdad numérica
      const matchLegacyId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        // eventsProvenance no definido (registro preexistente)
        config: { mode: 'traditional' },
        currentQuarter: 1,
        localScore: 6,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
      })) as number;

      await db.scores.bulkAdd([
        { matchId: matchLegacyId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 2000) },
        { matchId: matchLegacyId, teamId: localTeamId, points: 3, quarter: 1, createdAt: new Date(Date.now() - 1000) },
      ] as Score[]);

      const matchLeg = (await db.matches.get(matchLegacyId))!;
      const scoresLeg = await db.scores.where('matchId').equals(matchLegacyId).toArray();
      const integrityLeg = ScoreIntegrityService.verifyScoreIntegrity(matchLeg, scoresLeg);

      // El marcador es consistente aritméticamente, PERO NO afirma completitud histórica certificada
      expect(integrityLeg.status).toBe('CONSISTENT');
      expect(integrityLeg.isCompleteHistory).toBe(false); // NO se asume completitud solo porque las sumas coinciden
    });

    // 8. Partido nuevo con historial verificable y Deshacer funcional
    it('8. Partido nuevo con historial verificable y Deshacer funcional: flujo completo trazable', async () => {
      // Simular la creación real mediante NewMatch con eventsProvenance: 'live_session'
      const matchId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'created',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
        config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
        currentQuarter: 1,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
      })) as number;

      // Anotación 1: Triple (+3)
      await db.transaction('rw', db.matches, db.scores, async () => {
        await db.scores.add({
          matchId,
          teamId: localTeamId,
          points: 3,
          quarter: 1,
          createdAt: new Date(Date.now() - 2000),
        } as Score);
        await db.matches.update(matchId, { localScore: 3, status: 'playing' });
      });

      // Anotación 2: Doble (+2)
      await db.transaction('rw', db.matches, db.scores, async () => {
        await db.scores.add({
          matchId,
          teamId: localTeamId,
          points: 2,
          quarter: 1,
          createdAt: new Date(Date.now() - 1000),
        } as Score);
        await db.matches.update(matchId, { localScore: 5 });
      });

      const matchWith5 = (await db.matches.get(matchId))!;
      const scoresWith5 = await db.scores.where('matchId').equals(matchId).toArray();
      const integrityBeforeUndo = ScoreIntegrityService.verifyScoreIntegrity(matchWith5, scoresWith5);

      expect(integrityBeforeUndo.status).toBe('CONSISTENT');
      expect(integrityBeforeUndo.isCompleteHistory).toBe(true);

      // Deshacer la última jugada (el doble de 2 puntos)
      const undoResult = await GameActionsRepository.undoLastAction(matchId);
      expect(undoResult.success).toBe(true);
      expect(undoResult.deleted).toBe(true);
      expect(undoResult.newScore?.local).toBe(3);

      const matchAfterUndo = (await db.matches.get(matchId))!;
      expect(matchAfterUndo.localScore).toBe(3);

      const remainingScores = await db.scores.where('matchId').equals(matchId).toArray();
      expect(remainingScores).toHaveLength(1);
      expect(remainingScores[0].points).toBe(3);

      const integrityAfterUndo = ScoreIntegrityService.verifyScoreIntegrity(matchAfterUndo, remainingScores);
      expect(integrityAfterUndo.status).toBe('CONSISTENT');
      expect(integrityAfterUndo.isCompleteHistory).toBe(true);
    });

    // 9. Rollback ante fallo posterior al borrado de una anotación
    it('9. Rollback ante fallo posterior al borrado de una anotación: IndexedDB revierte tanto evento como marcador', async () => {
      const matchId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
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
        points: 3,
        quarter: 1,
        createdAt: new Date(Date.now() - 2000),
      });

      const scoreToDelete = (await db.scores.add({
        matchId,
        teamId: localTeamId,
        points: 2,
        quarter: 1,
        createdAt: new Date(Date.now() - 1000),
      })) as number;

      // Invocar fallo transaccional deliberado después de la escritura parcial (_faultInjection)
      await expect(
        GameActionsRepository.deleteActionSafely({
          matchId,
          actionId: scoreToDelete,
          type: 'score',
          _faultInjection: 'post-delete',
        })
      ).rejects.toThrow(/Fallo transaccional deliberado/i);

      // Verificación estricta de rollback en IndexedDB:
      // 1. La anotación NO debe haber sido eliminada de db.scores
      const scoreInDb = await db.scores.get(scoreToDelete);
      expect(scoreInDb).toBeDefined();
      expect(scoreInDb?.points).toBe(2);

      // 2. El marcador en db.matches NO debe haber sido descontado
      const matchInDb = await db.matches.get(matchId);
      expect(matchInDb?.localScore).toBe(5);

      // 3. El total de anotaciones en BD sigue sumando 5 puntos
      const allScores = await db.scores.where('matchId').equals(matchId).toArray();
      const totalPoints = allScores.reduce((sum, s) => sum + s.points, 0);
      expect(totalPoints).toBe(5);
    });

    // 10. Preservación de resultados y ganadores históricos
    it('10. Preservación de resultados y ganadores históricos: inmutabilidad de juegos y sets cerrados', async () => {
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
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
        ],
      })) as number;

      // Anotación del juego 1 (cerrado)
      const closedScoreId = (await db.scores.add({
        matchId,
        teamId: localTeamId,
        points: 3,
        quarter: 1,
        createdAt: new Date(Date.now() - 50000),
      })) as number;

      // Intentar eliminar la anotación del juego 1 debe ser categóricamente rechazado
      await expect(
        GameActionsRepository.deleteActionSafely({
          matchId,
          actionId: closedScoreId,
          type: 'score',
        })
      ).rejects.toThrow(/No se pueden eliminar acciones de juegos o sets anteriores ya cerrados/i);

      // Confirmar que gameHistory, ganadores y marcadores cerrados permanecen 100% inmutables
      const matchAfter = (await db.matches.get(matchId))!;
      expect(matchAfter.gameHistory).toHaveLength(1);
      expect(matchAfter.gameHistory![0].gameNumber).toBe(1);
      expect(matchAfter.gameHistory![0].winner).toBe('local');
      expect(matchAfter.gameHistory![0].localScore).toBe(21);
      expect(matchAfter.gameHistory![0].visitorScore).toBe(15);

      // Marcador del juego actual no fue alterado
      expect(matchAfter.localScore).toBe(4);
    });
  });
});
