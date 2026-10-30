// src/db/series.service.ts
import { db } from './db';
import type { GameResult } from './models';
import { isFinitePositiveInteger, validateGameHistoryContinuity, ScoreIntegrityService } from './scoreIntegrity.service';
import { calculateSetWinner, calculateSetsToWin, countSeriesWinsFromHistory } from '../utils/seriesLogicHelpers';

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

function isTestEnvironment(): boolean {
  const env = (globalThis as unknown as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
  return env === 'test';
}

export class SeriesService {
  /** @internal Hook exclusivo para pruebas automatizadas de rollback transaccional */
  private static _testPostWriteHook: (() => void | Promise<void>) | null = null;

  /**
   * Configura un hook de fallo post-escritura exclusivamente para pruebas unitarias de rollback.
   * Lanza error si se intenta invocar fuera del entorno de pruebas (NODE_ENV === 'test').
   */
  static __setTestPostWriteHook(hook: (() => void | Promise<void>) | null): void {
    if (!isTestEnvironment()) {
      throw new Error('Mecanismo de prueba restringido exclusivamente al entorno de pruebas (NODE_ENV=test).');
    }
    SeriesService._testPostWriteHook = hook;
  }

  /**
   * Confirma de forma atómica e idempotente el cierre de un set en una serie Best-of-Series.
   * Realiza lectura fresca desde IndexedDB dentro de una transacción, verifica el contrato de
   * integridad de anotaciones reales (C-01), la validez de la idempotencia (C-04) y realiza
   * verificación posterior de invariantes con rollback automático ante fallo (C-03).
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

      // 3. C-04: Idempotencia estricta con validación de historial
      const existingEntries = history.filter(g => g.gameNumber === setNumber);
      if (existingEntries.length > 1) {
        return {
          status: 'rejected',
          reason: `Historial corrupto: existen múltiples entradas duplicadas para el set #${setNumber}.`,
        };
      }

      if (existingEntries.length === 1) {
        const existingEntry = existingEntries[0];
        const existingWinnerSide = existingEntry.winner;
        const existingWinnerTeamId = existingWinnerSide === 'local' ? match.localTeamId : match.visitorTeamId;

        // Comprobación de contradicciones con expectativas
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

        // C-04: Verificar que el historial preexistente no tenga huecos ni corrupción
        const effectivePeriodForHistoryCheck = match.status === 'finished' ? setNumber : (match.currentQuarter || setNumber);
        const historyContinuity = validateGameHistoryContinuity({
          mode: 'best-of-series',
          effectivePeriod: effectivePeriodForHistoryCheck,
          history,
          bestOfWins: bestOfConfig.wins,
          isFinished: match.status === 'finished',
          matchScore: { local: match.localScore ?? 0, visitor: match.visitorScore ?? 0 },
        });

        if (!historyContinuity.isValid) {
          return {
            status: 'rejected',
            reason: `Rechazo por corrupción preexistente en el historial: ${historyContinuity.reason}`,
          };
        }

        // C-04: Contrastar victorias acumuladas con el historial
        const countedWins = countSeriesWinsFromHistory(history);
        const storedWins = bestOfConfig.wins || { local: 0, visitor: 0 };
        if (storedWins.local !== countedWins.local || storedWins.visitor !== countedWins.visitor) {
          return {
            status: 'rejected',
            reason: `Incoherencia en Best-of-Series: victorias acumuladas (L:${storedWins.local}, V:${storedWins.visitor}) no coinciden con los ganadores del historial (L:${countedWins.local}, V:${countedWins.visitor}).`,
          };
        }

        // Respuesta idempotente pura sin mutar ningún dato
        const seriesFinished = match.status === 'finished' || storedWins.local >= setsToWin || storedWins.visitor >= setsToWin;
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

      // 10. C-01: Verificación real de las anotaciones (scores) del set
      const matchScores = await db.scores.where('matchId').equals(matchId).toArray();
      const integrity = ScoreIntegrityService.verifyScoreIntegrity(match, matchScores);

      if (integrity.status === 'INCONSISTENT') {
        return {
          status: 'rejected',
          reason: `Discrepancia detectada en el marcador del set #${activeSetNumber}: ${integrity.reason || 'el marcador no coincide con la suma de anotaciones'}.`,
        };
      }

      if (integrity.status === 'UNVERIFIED' || !integrity.isCompleteHistory) {
        return {
          status: 'rejected',
          reason: `Integridad de eventos no verificable en el set #${activeSetNumber}: ${integrity.reason || 'procedencia de eventos no acreditada o historial incompleto'}.`,
        };
      }

      // 11. Validar marcador del set y ganador reglamentario
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

      // 12. Calcular nuevo estado
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

      // 13. Actualización atómica en la base de datos
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

      // 14. C-03 / C-06: Inyección de fallo post-escritura estrictamente restringida a entorno de pruebas
      if (isTestEnvironment() && SeriesService._testPostWriteHook) {
        await SeriesService._testPostWriteHook();
        throw new Error('Inyección de fallo post-escritura para prueba de rollback transaccional.');
      }

      // 15. C-03: Verificación exhaustiva post-escritura de invariantes dentro de la transacción
      const verifiedMatch = await db.matches.get(matchId);
      if (!verifiedMatch) {
        throw new Error('Fallo transaccional: no se pudo leer el partido actualizado.');
      }

      if (verifiedMatch.gameHistory?.length !== updatedHistory.length) {
        throw new Error('Fallo transaccional: el historial no se guardó correctamente.');
      }

      // Comprobar inmutabilidad de resultados históricos previos
      for (let i = 0; i < history.length; i++) {
        const prev = history[i];
        const post = verifiedMatch.gameHistory?.[i];
        if (
          !post ||
          post.gameNumber !== prev.gameNumber ||
          post.localScore !== prev.localScore ||
          post.visitorScore !== prev.visitorScore ||
          post.winner !== prev.winner
        ) {
          throw new Error(`Fallo post-escritura: el resultado histórico del set #${prev.gameNumber} fue alterado.`);
        }
      }

      // Comprobar concordancia de victorias acumuladas con el historial
      const postCountedWins = countSeriesWinsFromHistory(verifiedMatch.gameHistory);
      if (
        verifiedMatch.config.bestOf?.wins.local !== postCountedWins.local ||
        verifiedMatch.config.bestOf?.wins.visitor !== postCountedWins.visitor
      ) {
        throw new Error('Fallo post-escritura: victorias acumuladas no concuerdan con el historial.');
      }

      // Comprobar estado final o avance de periodos
      if (seriesFinished) {
        if (verifiedMatch.status !== 'finished' || !(verifiedMatch.finishedAt instanceof Date)) {
          throw new Error('Fallo post-escritura: el estado de finalización no se persistió correctamente.');
        }
        if (verifiedMatch.localScore !== localScore || verifiedMatch.visitorScore !== visitorScore) {
          throw new Error('Fallo post-escritura: el marcador final persistido difiere del set decisivo.');
        }

        const postScores = await db.scores.where('matchId').equals(matchId).toArray();
        const postIntegrity = ScoreIntegrityService.verifyScoreIntegrity(verifiedMatch, postScores);
        if (postIntegrity.status !== 'CONSISTENT') {
          throw new Error(`Fallo post-escritura: el partido finalizado no cumple el contrato de integridad (${postIntegrity.reason}).`);
        }
      } else {
        if (
          verifiedMatch.currentQuarter !== setNumber + 1 ||
          verifiedMatch.config.bestOf?.currentGame !== setNumber + 1
        ) {
          throw new Error('Fallo post-escritura: los periodos actuales no avanzaron correctamente.');
        }
        if (
          verifiedMatch.localScore !== 0 ||
          verifiedMatch.visitorScore !== 0 ||
          verifiedMatch.localFouls !== 0 ||
          verifiedMatch.visitorFouls !== 0
        ) {
          throw new Error('Fallo post-escritura: los marcadores del nuevo set no se reiniciaron.');
        }
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
   * Finaliza anticipadamente una serie Best-of-Series de forma atómica y protegida (C-02).
   * La decisión humana sobre si contabilizar el set en disputa se recibe explícitamente desde la UI
   * y se revalida de forma transaccional contrastando anotaciones reales y continuidad previa.
   */
  static async finishSeriesEarly(params: EarlyFinishSeriesParams): Promise<FinishSeriesResult> {
    const { matchId, countCurrentSet } = params;

    if (!isFinitePositiveInteger(matchId)) {
      return { status: 'rejected', reason: 'Identificador de partido inválido.' };
    }

    return await db.transaction('rw', [db.matches, db.scores], async () => {
      const match = await db.matches.get(matchId);
      if (!match) {
        return { status: 'rejected', reason: 'Partido no encontrado.' };
      }

      if (match.status === 'finished') {
        return { status: 'already_finished' };
      }

      if (match.status !== 'playing' && match.status !== 'paused' && match.status !== 'created') {
        return { status: 'rejected', reason: `Estado de partido no apto para finalización: "${match.status}".` };
      }

      if (match.config?.mode !== 'best-of-series' || !match.config.bestOf) {
        return { status: 'rejected', reason: 'El partido no está configurado en modalidad Best-of-Series.' };
      }

      const bestOfConfig = match.config.bestOf;
      const currentQuarter = match.currentQuarter;
      const currentGame = bestOfConfig.currentGame;

      if (!isFinitePositiveInteger(currentQuarter) || !isFinitePositiveInteger(currentGame) || currentQuarter !== currentGame) {
        return {
          status: 'rejected',
          reason: `Contradicción en Best-of-Series: currentQuarter (${currentQuarter}) no coincide con config.bestOf.currentGame (${currentGame}).`,
        };
      }

      const history = match.gameHistory || [];

      // Validar continuidad del historial previo
      const continuityResult = validateGameHistoryContinuity({
        mode: 'best-of-series',
        effectivePeriod: currentQuarter,
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

      // Validar concordancia de victorias acumuladas
      const countedWins = countSeriesWinsFromHistory(history);
      const storedWins = bestOfConfig.wins || { local: 0, visitor: 0 };
      if (storedWins.local !== countedWins.local || storedWins.visitor !== countedWins.visitor) {
        return {
          status: 'rejected',
          reason: `Incoherencia en Best-of-Series: victorias acumuladas (L:${storedWins.local}, V:${storedWins.visitor}) no coinciden con el historial (L:${countedWins.local}, V:${countedWins.visitor}).`,
        };
      }

      // Comprobar ausencia de duplicados
      if (history.some(g => g.gameNumber === currentQuarter)) {
        return { status: 'rejected', reason: `El set #${currentQuarter} ya figura en el historial.` };
      }

      // C-01 / C-02: Comprobar evidencia de eventos reales del set actual
      const matchScores = await db.scores.where('matchId').equals(matchId).toArray();
      const integrity = ScoreIntegrityService.verifyScoreIntegrity(match, matchScores);

      if (integrity.status === 'INCONSISTENT') {
        return {
          status: 'rejected',
          reason: `Discrepancia detectada en el marcador del set #${currentQuarter}: ${integrity.reason || 'el marcador no coincide con la suma de anotaciones'}.`,
        };
      }

      if (integrity.status === 'UNVERIFIED' || !integrity.isCompleteHistory) {
        return {
          status: 'rejected',
          reason: `Integridad de eventos no verificable en el set #${currentQuarter}: ${integrity.reason || 'procedencia de eventos no acreditada o historial incompleto'}.`,
        };
      }

      const localScore = match.localScore ?? 0;
      const visitorScore = match.visitorScore ?? 0;
      let winsLocal = storedWins.local;
      let winsVisitor = storedWins.visitor;
      const updatedHistory = [...history];

      if (countCurrentSet) {
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

      // C-03 / C-06: Inyección de fallo post-escritura estrictamente restringida a entorno de pruebas
      if (isTestEnvironment() && SeriesService._testPostWriteHook) {
        await SeriesService._testPostWriteHook();
        throw new Error('Inyección de fallo post-escritura para prueba de rollback transaccional.');
      }

      // C-03: Verificación post-escritura
      const verifiedMatch = await db.matches.get(matchId);
      if (!verifiedMatch) {
        throw new Error('Fallo transaccional: no se pudo leer el partido actualizado.');
      }
      if (verifiedMatch.status !== 'finished' || !(verifiedMatch.finishedAt instanceof Date)) {
        throw new Error('Fallo post-escritura: el estado finished no se persistió.');
      }

      const postContinuity = validateGameHistoryContinuity({
        mode: 'best-of-series',
        effectivePeriod: currentQuarter,
        history: verifiedMatch.gameHistory,
        bestOfWins: verifiedMatch.config.bestOf?.wins,
        isFinished: true,
        matchScore: { local: verifiedMatch.localScore, visitor: verifiedMatch.visitorScore },
      });

      if (!postContinuity.isValid) {
        throw new Error(`Fallo post-escritura en continuidad de historial: ${postContinuity.reason}`);
      }

      const postScores = await db.scores.where('matchId').equals(matchId).toArray();
      const postIntegrity = ScoreIntegrityService.verifyScoreIntegrity(verifiedMatch, postScores);
      if (postIntegrity.status !== 'CONSISTENT') {
        throw new Error(`Fallo post-escritura: el partido finalizado no cumple el contrato de integridad (${postIntegrity.reason}).`);
      }

      return {
        status: 'finished',
        seriesFinished: true,
        finalWins,
      };
    });
  }
}
