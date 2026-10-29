// src/utils/raceLogicHelpers.ts
import type { Match, GameResult } from '../db/models';

export type RaceGameWinner = 'local' | 'visitor' | 'tie' | 'unresolved';

/**
 * Determina si algún equipo ha alcanzado la meta reglamentaria de puntos.
 * Respeta la regla de ganar por 2 (winByTwo) si está activada.
 */
export function calculateRaceWinner(
  localScore: number,
  visitorScore: number,
  targetScore: number,
  winByTwo = false
): 'local' | 'visitor' | null {
  const localReached = localScore >= targetScore;
  const visitorReached = visitorScore >= targetScore;

  if (localReached && (!winByTwo || localScore - visitorScore >= 2)) {
    return 'local';
  }

  if (visitorReached && (!winByTwo || visitorScore - localScore >= 2)) {
    return 'visitor';
  }

  return null;
}

/**
 * Resuelve el resultado de un juego individual de Race:
 * - Si se alcanzó la meta reglamentaria -> 'local' o 'visitor'
 * - Si es cierre anticipado (isEarlyClose = true) o partido finalizado:
 *   - Si localScore > visitorScore -> 'local'
 *   - Si visitorScore > localScore -> 'visitor'
 *   - Si localScore === visitorScore -> 'tie'
 * - Si el juego continúa en curso sin meta alcanzada -> 'unresolved'
 */
export function resolveRaceGameResult(
  localScore: number,
  visitorScore: number,
  targetScore: number,
  winByTwo = false,
  isFinishedOrClosed = false
): RaceGameWinner {
  const winner = calculateRaceWinner(localScore, visitorScore, targetScore, winByTwo);
  if (winner) return winner;

  if (isFinishedOrClosed) {
    if (localScore > visitorScore) return 'local';
    if (visitorScore > localScore) return 'visitor';
    return 'tie';
  }

  return 'unresolved';
}

export interface RaceDisplaySummary {
  isMultiGame: boolean;
  localDisplayScore: number;
  visitorDisplayScore: number;
  localWon: boolean;
  visitorWon: boolean;
  isTie: boolean;
  localGamesWon: number;
  visitorGamesWon: number;
  tiesCount: number;
  effectiveHistory: GameResult[];
}

/**
 * Calcula la representación coherente para tarjetas de historial, reportes y vistas de Race.
 * Reglas de integridad:
 * 1. 1 solo juego finalizado = Muestra Puntuación en Puntos (ej: 21 - 18, o 10 - 10 si empató).
 * 2. 2 o más juegos (revanchas) = Muestra Juegos Ganados (ej: 2 - 1, o 1 - 1).
 * 3. Las revanchas empatadas ('tie') NO suman una victoria ni a local ni a visitante.
 * 4. NUNCA inventa un ganador provisional para un juego aún en curso.
 * 5. Si los marcadores son iguales, localWon y visitorWon son falsos, y isTie es verdadero.
 */
export function getRaceDisplaySummary(match: Match): RaceDisplaySummary {
  const history = [...(match.gameHistory || [])];
  const isFinished = match.status === 'finished';

  const localGamesWon = history.filter(g => g.winner === 'local').length;
  const visitorGamesWon = history.filter(g => g.winner === 'visitor').length;
  const tiesCount = history.filter(g => g.winner === 'tie').length;

  const isMultiGame = history.length > 1;

  let localDisplayScore = 0;
  let visitorDisplayScore = 0;

  if (isMultiGame) {
    localDisplayScore = localGamesWon;
    visitorDisplayScore = visitorGamesWon;
  } else if (history.length === 1) {
    localDisplayScore = history[0].localScore;
    visitorDisplayScore = history[0].visitorScore;
  } else {
    // 0 juegos en historial (juego único en curso o finalizado sin historial previo)
    localDisplayScore = match.localScore || 0;
    visitorDisplayScore = match.visitorScore || 0;
  }

  const isTie = localDisplayScore === visitorDisplayScore;
  // Solo se declara ganador definitivo si el partido está finalizado o si hay diferencia en multi-juegos
  const localWon = isFinished
    ? localDisplayScore > visitorDisplayScore
    : isMultiGame && localDisplayScore > visitorDisplayScore;
  const visitorWon = isFinished
    ? visitorDisplayScore > localDisplayScore
    : isMultiGame && visitorDisplayScore > localDisplayScore;

  return {
    isMultiGame,
    localDisplayScore,
    visitorDisplayScore,
    localWon,
    visitorWon,
    isTie,
    localGamesWon,
    visitorGamesWon,
    tiesCount,
    effectiveHistory: history
  };
}
