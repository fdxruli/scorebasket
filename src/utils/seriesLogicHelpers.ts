// src/utils/seriesLogicHelpers.ts
import type { Match, GameResult } from '../db/models';

export type SeriesSetWinnerSide = 'local' | 'visitor';

/**
 * Determina el ganador reglamentario de un set en Best-of-Series.
 * Valida puntuaciones enteras finitas no negativas y respeta winByTwo.
 */
export function calculateSetWinner(
  localScore: number,
  visitorScore: number,
  pointsPerSet: number,
  winByTwo = false
): SeriesSetWinnerSide | null {
  if (
    !Number.isInteger(localScore) ||
    localScore < 0 ||
    !Number.isInteger(visitorScore) ||
    visitorScore < 0 ||
    !Number.isInteger(pointsPerSet) ||
    pointsPerSet <= 0
  ) {
    return null;
  }

  const localReached = localScore >= pointsPerSet;
  const visitorReached = visitorScore >= pointsPerSet;

  if (localReached && (!winByTwo || localScore - visitorScore >= 2) && localScore > visitorScore) {
    return 'local';
  }

  if (visitorReached && (!winByTwo || visitorScore - localScore >= 2) && visitorScore > localScore) {
    return 'visitor';
  }

  return null;
}

/**
 * Obtiene el teamId ganador del set actual de un partido, o null si ningún equipo ha ganado reglamentariamente.
 */
export function getSetWinnerTeamId(match: Match, pointsPerSet: number): number | null {
  const localScore = match.localScore ?? 0;
  const visitorScore = match.visitorScore ?? 0;
  const winByTwo = match.config.bestOf?.winByTwo ?? false;

  const winnerSide = calculateSetWinner(localScore, visitorScore, pointsPerSet, winByTwo);
  if (winnerSide === 'local') return match.localTeamId;
  if (winnerSide === 'visitor') return match.visitorTeamId;
  return null;
}

/**
 * Construye un registro inmutable de GameResult para un set terminado.
 */
export function buildSetResult(
  setNumber: number,
  localScore: number,
  visitorScore: number,
  winner: SeriesSetWinnerSide,
  finishedAt: Date = new Date()
): GameResult {
  return {
    gameNumber: setNumber,
    localScore,
    visitorScore,
    winner,
    finishedAt,
  };
}

/**
 * Cuenta las victorias acumuladas a partir del historial persistido.
 */
export function countSeriesWinsFromHistory(history?: GameResult[]): { local: number; visitor: number } {
  if (!history || history.length === 0) {
    return { local: 0, visitor: 0 };
  }
  let local = 0;
  let visitor = 0;
  for (const g of history) {
    if (g.winner === 'local') local++;
    if (g.winner === 'visitor') visitor++;
  }
  return { local, visitor };
}

/**
 * Determina cuántas victorias son necesarias para ganar la serie.
 */
export function calculateSetsToWin(totalGames: number): number {
  if (!Number.isInteger(totalGames) || totalGames <= 0) return 1;
  return Math.ceil(totalGames / 2);
}

/**
 * Determina si la serie ya tiene un ganador definitivo.
 */
export function isSeriesDecided(localWins: number, visitorWins: number, totalGames: number): boolean {
  const setsToWin = calculateSetsToWin(totalGames);
  return localWins >= setsToWin || visitorWins >= setsToWin;
}
