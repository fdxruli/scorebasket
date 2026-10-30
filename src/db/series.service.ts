// src/db/series.service.ts
import { db } from './db';
import type { GameResult } from './models';
import { isFinitePositiveInteger, validateGameHistoryContinuity } from './scoreIntegrity.service';
import { calculateSetWinner, calculateSetsToWin } from '../utils/seriesLogicHelpers';

export type ConfirmSetStatus = 'confirmed' | 'already_confirmed' | 'rejected';

export type ConfirmSetResult =
  | {
      status: 'confirmed';
      setNumber: number;
      seriesFinished: boolean;
      winnerTeamId: number;
      newWins: { local: number; visitor: number };
    }
  | {
      status: 'already_confirmed';
      setNumber: number;
      seriesFinished: boolean;
    }
  | {
      status: 'rejected';
      reason: string;
    };

export interface ConfirmSetParams {
  matchId: number;
  setNumber: number;
  expectedWinnerId?: number;
  expectedScore?: { local: number; visitor: number };
}

export type FinishSeriesResult =
  | {
      status: 'finished';
      seriesFinished: boolean;
      finalWins: { local: number; visitor: number };
    }
  | {
      status: 'already_finished';
    }
  | {
      status: 'rejected';
      reason: string;
    };

export interface EarlyFinishSeriesParams {
  matchId: number;
  countCurrentSet: boolean;
}

export class SeriesService {
  /**
   * Confirma de forma atómica e idempotente el cierre de un set en una serie Best-of-Series.
   * Realiza lectura fresca desde IndexedDB dentro de una transacción.
   */
  static async confirmSet(params: ConfirmSetParams): Promise<ConfirmSetResult> {
    const { matchId, setNumber, expectedWinnerId, expectedScore } = params;

    if (!isFinitePositiveInteger(matchId)) {
      return { status: 'rejected', reason: 'Identificador de partido inválido.' };
    }

    if (!isFinitePositiveInteger(setNumber)) {
      return { status: 'rejected', reason: `Número de set inválido: ${setNumber}` };
    }

    return await db.transaction('rw', [db.matches, db.scores], async () => {
      // 1. Lectura fresca desde IndexedDB
      const match = await db.matches.get(matchId);
      if (!match) {
        return { status: 'rejected', reason: 'Partido no encontrado.' };
      }

      // 2. Validar modalidad Best-of-Series y configuración
      if (match.config?.mode !== 'best-of-series' || !match.config.bestOf) {
        return { status: 'rejected', reason: 'El partido no está configurado en modalidad Best-of-Series.' };
      }

      const bestOfConfig = match.config.bestOf;
      const totalGames = bestOfConfig.totalGames;
      const targetScorePerGame = bestOfConfig.targetScorePerGame;
      const winByTwo = bestOfConfig.winByTwo ?? false;

      if (!isFinitePositiveInteger(totalGames) || !isFinitePositiveInteger(targetScorePerGame)) {
        return { status: 'rejected', reason: 'Configuración de la serie malformada o incompleta.' };
      }

      const setsToWin = calculateSetsToWin(totalGames);
      const history = match.gameHistory || [];

      // 3. Verificar si el set ya fue confirmado previamente (idempotencia y detección de contradicciones)
      const existingEntry = history.find(g => g.gameNumber === setNumber);
      if (existingEntry) {
        const existingWinnerSide = existingEntry.winner;
        const existingWinnerTeamId = existingWinnerSide === 'local' ? match.localTeamId : match.visitorTeamId;

        // Comprobación de contradicciones
        if (expectedWinnerId !== undefined && existingWinnerTeamId !== expectedWinnerId) {
          return {
            status: 'rejected',
            reason: `Conflicto de resultado histórico: el set #${setNumber} ya fue registrado con ganador "${existingWinnerSide}".`,
          };
        }

        if (
          expectedScore !== undefined &&
          (existingEntry.localScore !== expectedScore.local || existingEntry.visitorScore !== expectedScore.visitor)
        ) {
          return {
            status: 'rejected',
            reason: `Conflicto de resultado histórico: el set #${setNumber} ya fue registrado con marcador (${existingEntry.localScore}-${existingEntry.visitorScore}).`,
          };
        }

        // Respuesta idempotente pura sin mutar ningún dato
        const currentWins = bestOfConfig.wins || { local: 0, visitor: 0 };
        const seriesFinished = match.status === 'finished' || currentWins.local >= setsToWin || currentWins.visitor >= setsToWin;
        return {
          status: 'already_confirmed',
          setNumber,
          seriesFinished,
        };
      }

      // 4. Si el partido ya está finalizado y el set no figuraba en el historial: rechazar
      if (match.status === 'finished') {
        return { status: 'rejected', reason: 'No se pueden registrar nuevos sets en un partido ya finalizado.' };
      }

      // 5. Validar estado activo
      if (match.status !== 'playing' && match.status !== 'created' && match.status !== 'paused') {
        return { status: 'rejected', reason: `Estado de partido no apto para confirmación: "${match.status}".` };
      }

      // 6. Resolver y validar coherencia de periodos actuales
      const currentQuarter = match.currentQuarter;
      const currentGame = bestOfConfig.currentGame;

      if (!isFinitePositiveInteger(currentQuarter) || !isFinitePositiveInteger(currentGame)) {
        return { status: 'rejected', reason: 'Identificadores de set actual no válidos o indefinidos.' };
      }

      if (currentQuarter !== currentGame) {
        return {
          status: 'rejected',
          reason: `Contradicción en Best-of-Series: currentQuarter (${currentQuarter}) no coincide con config.bestOf.currentGame (${currentGame}).`,
        };
      }

      const activeSetNumber = currentQuarter;

      // 7. Contrastar setNumber esperado con el vigente
      if (setNumber < activeSetNumber) {
        return {
          status: 'rejected',
          reason: `Confirmación atrasada rechazada: el set #${setNumber} es anterior al set vigente #${activeSetNumber}.`,
        };
      }

      if (setNumber > activeSetNumber) {
        return {
          status: 'rejected',
          reason: `Confirmación futura rechazada: el set #${setNumber} es posterior al set vigente #${activeSetNumber}.`,
        };
      }

      // 8. Validar continuidad del historial hasta activeSetNumber - 1
      const continuityResult = validateGameHistoryContinuity({
        mode: 'best-of-series',
        effectivePeriod: activeSetNumber,
        history,
        bestOfWins: bestOfConfig.wins,
        isFinished: false,
      });

      if (!continuityResult.isValid) {
        return {
          status: 'rejected',
          reason: `Violación de integridad histórica previa: ${continuityResult.reason}`,
        };
      }

      // 9. Comprobar si la serie ya estaba decidida previamente
      const currentStoredWins = bestOfConfig.wins || { local: 0, visitor: 0 };
      if (currentStoredWins.local >= setsToWin || currentStoredWins.visitor >= setsToWin) {
        return {
          status: 'rejected',
          reason: 'La serie ya fue decidida previamente; no se permiten sets adicionales.',
        };
      }

      // 10. Validar marcador del set y ganador reglamentario
      const localScore = match.localScore ?? 0;
      const visitorScore = match.visitorScore ?? 0;

      if (
        !Number.isInteger(localScore) ||
        localScore < 0 ||
        !Number.isInteger(visitorScore) ||
        visitorScore < 0
      ) {
        return { status: 'rejected', reason: 'Puntuaciones del set malformadas o negativas.' };
      }

      if (
        expectedScore !== undefined &&
        (localScore !== expectedScore.local || visitorScore !== expectedScore.visitor)
      ) {
        return {
          status: 'rejected',
          reason: `El marcador actual (${localScore}-${visitorScore}) difiere del marcador esperado (${expectedScore.local}-${expectedScore.visitor}).`,
        };
      }

      const winnerSide = calculateSetWinner(localScore, visitorScore, targetScorePerGame, winByTwo);
      if (!winnerSide) {
        return {
          status: 'rejected',
          reason: `El set no tiene un ganador reglamentario (${localScore}-${visitorScore}, objetivo: ${targetScorePerGame}${winByTwo ? ', win by 2' : ''}).`,
        };
      }

      const winnerTeamId = winnerSide === 'local' ? match.localTeamId : match.visitorTeamId;
      if (expectedWinnerId !== undefined && expectedWinnerId !== winnerTeamId) {
        return {
          status: 'rejected',
          reason: 'El ganador reglamentario del set no coincide con el ganador esperado.',
        };
      }

      // 11. Calcular nuevo estado
      const newLocalWins = currentStoredWins.local + (winnerSide === 'local' ? 1 : 0);
      const newVisitorWins = currentStoredWins.visitor + (winnerSide === 'visitor' ? 1 : 0);
      const newWins = { local: newLocalWins, visitor: newVisitorWins };

      const newEntry: GameResult = {
        gameNumber: setNumber,
        localScore,
        visitorScore,
        winner: winnerSide,
        finishedAt: new Date(),
      };

      const updatedHistory = [...history, newEntry];
      const seriesFinished = newLocalWins >= setsToWin || newVisitorWins >= setsToWin;

      // 12. Actualización atómica en la base de datos
      if (seriesFinished) {
        await db.matches.update(matchId, {
          status: 'finished',
          finishedAt: new Date(),
          gameHistory: updatedHistory,
          config: {
            ...match.config,
            bestOf: {
              ...bestOfConfig,
              wins: newWins,
            },
          },
        });
      } else {
        await db.matches.update(matchId, {
          currentQuarter: setNumber + 1,
          localScore: 0,
          visitorScore: 0,
          localFouls: 0,
          visitorFouls: 0,
          gameHistory: updatedHistory,
          config: {
            ...match.config,
            bestOf: {
              ...bestOfConfig,
              currentGame: setNumber + 1,
              wins: newWins,
            },
          },
        });
      }

      // 13. Comprobación del estado resultante antes de confirmar la transacción
      const verifiedMatch = await db.matches.get(matchId);
      if (!verifiedMatch) {
        throw new Error('Fallo transaccional: no se pudo leer el partido actualizado.');
      }
      if (verifiedMatch.gameHistory?.length !== updatedHistory.length) {
        throw new Error('Fallo transaccional: el historial no se guardó correctamente.');
      }
      if (seriesFinished && verifiedMatch.status !== 'finished') {
        throw new Error('Fallo transaccional: el estado de finalización no se persistió.');
      }

      return {
        status: 'confirmed',
        setNumber,
        seriesFinished,
        winnerTeamId,
        newWins,
      };
    });
  }

  /**
   * Finaliza anticipadamente una serie Best-of-Series de forma atómica.
   * La decisión humana sobre si contabilizar el set en disputa se recibe explícitamente desde la UI
   * y se revalida de forma transaccional.
   */
  static async finishSeriesEarly(params: EarlyFinishSeriesParams): Promise<FinishSeriesResult> {
    const { matchId, countCurrentSet } = params;

    if (!isFinitePositiveInteger(matchId)) {
      return { status: 'rejected', reason: 'Identificador de partido inválido.' };
    }

    return await db.transaction('rw', [db.matches], async () => {
      const match = await db.matches.get(matchId);
      if (!match) {
        return { status: 'rejected', reason: 'Partido no encontrado.' };
      }

      if (match.status === 'finished') {
        return { status: 'already_finished' };
      }

      if (match.config?.mode !== 'best-of-series' || !match.config.bestOf) {
        return { status: 'rejected', reason: 'El partido no está configurado en modalidad Best-of-Series.' };
      }

      const bestOfConfig = match.config.bestOf;
      const currentQuarter = match.currentQuarter || bestOfConfig.currentGame || 1;
      const history = match.gameHistory || [];
      let winsLocal = bestOfConfig.wins?.local ?? 0;
      let winsVisitor = bestOfConfig.wins?.visitor ?? 0;
      const updatedHistory = [...history];

      const localScore = match.localScore ?? 0;
      const visitorScore = match.visitorScore ?? 0;

      const alreadyRecorded = history.some(g => g.gameNumber === currentQuarter);

      if (countCurrentSet) {
        if (alreadyRecorded) {
          return { status: 'rejected', reason: `El set #${currentQuarter} ya figura en el historial.` };
        }
        if (localScore === visitorScore) {
          return { status: 'rejected', reason: 'No se puede contabilizar un set empatado como victoria en series.' };
        }
        const isLocalLeading = localScore > visitorScore;
        const winnerSide: 'local' | 'visitor' = isLocalLeading ? 'local' : 'visitor';
        winsLocal += isLocalLeading ? 1 : 0;
        winsVisitor += isLocalLeading ? 0 : 1;

        updatedHistory.push({
          gameNumber: currentQuarter,
          localScore,
          visitorScore,
          winner: winnerSide,
          finishedAt: new Date(),
        });
      }

      const finalWins = { local: winsLocal, visitor: winsVisitor };

      await db.matches.update(matchId, {
        status: 'finished',
        finishedAt: new Date(),
        gameHistory: updatedHistory,
        config: {
          ...match.config,
          bestOf: {
            ...bestOfConfig,
            wins: finalWins,
          },
        },
      });

      return {
        status: 'finished',
        seriesFinished: true,
        finalWins,
      };
    });
  }
}
