// src/utils/raceLogicHelpers.ts
import type { Match, GameResult, Score } from '../db/models';

export type RaceGameWinner = 'local' | 'visitor' | 'tie' | 'unresolved';

export type RaceMatchStatusSummary = 'in_progress' | 'local_win' | 'visitor_win' | 'tie';

/**
 * Estructura de presentación separada de GameResult (C-03).
 * Permite proyectar tanto juegos válidamente cerrados ('completed')
 * como el juego actualmente en curso ('in_progress') sin contaminar gameHistory,
 * sin convertir 'unresolved' en 'tie' y sin fabricar finishedAt.
 */
export interface RaceProjectedGame {
  gameNumber: number;
  localScore: number;
  visitorScore: number;
  state: 'completed' | 'in_progress';
  winner: RaceGameWinner;
  finishedAt?: Date;
}

export interface RaceReportPeriodRow {
  period: number;
  label: string;
  local: number;
  visitor: number;
  state: 'completed' | 'in_progress';
  winner: RaceGameWinner;
  finishedAt?: Date;
}

export interface RaceReportProjection {
  summary: RaceDisplaySummary;
  mainLocalScore: number;
  mainVisitorScore: number;
  localTotalCell: number;
  visitorTotalCell: number;
  totalHeader: 'Total' | 'Ganados';
  scoreUnitLabel: 'FINAL' | 'JUEGOS' | 'EN CURSO';
  isRaceWithGames: boolean;
  isFinished: boolean;
  localWon: boolean;
  visitorWon: boolean;
  isTie: boolean;
  status: RaceMatchStatusSummary;
  periodStats: RaceReportPeriodRow[];
  completedGames: GameResult[];
  activeGame: RaceProjectedGame | null;
  projectedGames: RaceProjectedGame[];
}

export interface RaceDisplaySummary {
  status: RaceMatchStatusSummary;
  isFinished: boolean;
  isMultiGame: boolean;
  localDisplayScore: number;
  visitorDisplayScore: number;
  localWon: boolean;
  visitorWon: boolean;
  isTie: boolean;
  localGamesWon: number;
  visitorGamesWon: number;
  tiesCount: number;
  completedGamesCount: number;
  /** Juegos válidamente cerrados (nunca incluye juegos en curso ni entradas ficticias) */
  completedGames: GameResult[];
  /** Alias compatible que contiene únicamente juegos válidamente cerrados */
  effectiveHistory: GameResult[];
  /** Juego actualmente en curso (si el partido no ha terminado), sin finishedAt y con winner: 'unresolved' */
  activeGame: RaceProjectedGame | null;
  /** Filas de presentación (juegos cerrados + juego en curso debidamente etiquetado si aplica) */
  projectedGames: RaceProjectedGame[];
}

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
 * - Si es cierre anticipado (isFinishedOrClosed = true) o partido finalizado:
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

/**
 * Calcula la representación coherente para tarjetas de historial, reportes y vistas de Race (C-03).
 * Reglas de integridad:
 * 1. Diferencia estrictamente entre:
 *    - Juego en progreso ('in_progress', winner: 'unresolved', finishedAt: undefined)
 *    - Juego cerrado con victoria ('completed', winner: 'local' | 'visitor')
 *    - Juego cerrado con empate ('completed', winner: 'tie')
 * 2. NUNCA convierte 'unresolved' en 'tie'.
 * 3. NUNCA genera un 'finishedAt' ficticio en tiempo de renderizado.
 * 4. NUNCA agrega un juego en curso a 'completedGames' / 'effectiveHistory'.
 * 5. Los recuentos (localGamesWon, visitorGamesWon, tiesCount, completedGamesCount)
 *    incluyen SOLAMENTE resultados válidamente cerrados.
 */
export function getRaceDisplaySummary(match: Match, scores?: Score[]): RaceDisplaySummary {
  const persistedHistory = [...(match.gameHistory || [])].sort(
    (a, b) => a.gameNumber - b.gameNumber
  );
  const isFinished = match.status === 'finished';
  const targetScore = match.config?.race?.targetScore || 21;
  const winByTwo = match.config?.race?.winByTwo ?? false;

  const maxHistoryGameNum =
    persistedHistory.length > 0
      ? Math.max(...persistedHistory.map(g => g.gameNumber))
      : 0;
  const currentRaceGame =
    match.config?.race?.currentGame || Math.max(1, maxHistoryGameNum + 1);

  const safeScores = scores || [];
  const scoreTableLocal = safeScores
    .filter(s => s.teamId === match.localTeamId && s.quarter === currentRaceGame)
    .reduce((acc, s) => acc + s.points, 0);
  const scoreTableVisitor = safeScores
    .filter(s => s.teamId === match.visitorTeamId && s.quarter === currentRaceGame)
    .reduce((acc, s) => acc + s.points, 0);

  const currentLocalScore = match.localScore ?? scoreTableLocal ?? 0;
  const currentVisitorScore = match.visitorScore ?? scoreTableVisitor ?? 0;

  const completedGames: GameResult[] = [...persistedHistory];
  const isCurrentInHistory = completedGames.some(g => g.gameNumber === currentRaceGame);

  let activeGame: RaceProjectedGame | null = null;

  if (!isCurrentInHistory) {
    if (isFinished) {
      // El partido está finalizado: si era juego único sin historial previo, o el último juego tuvo puntos
      // y quedó cerrado al finalizar el partido, es un juego válidamente cerrado.
      if (
        completedGames.length === 0 ||
        currentLocalScore > 0 ||
        currentVisitorScore > 0
      ) {
        const closedOutcome = resolveRaceGameResult(
          currentLocalScore,
          currentVisitorScore,
          targetScore,
          winByTwo,
          true
        );
        const validWinner: 'local' | 'visitor' | 'tie' =
          closedOutcome === 'local' || closedOutcome === 'visitor'
            ? closedOutcome
            : 'tie';

        const closedEntry: GameResult = {
          gameNumber: currentRaceGame,
          localScore: currentLocalScore,
          visitorScore: currentVisitorScore,
          winner: validWinner,
          ...(match.finishedAt ? { finishedAt: match.finishedAt } : {})
        };
        completedGames.push(closedEntry);
      }
    } else {
      // El partido sigue activo (no terminado): el juego actual está en progreso.
      // Nunca se convierte en 'tie', nunca recibe 'finishedAt', ni entra en completedGames.
      activeGame = {
        gameNumber: currentRaceGame,
        localScore: currentLocalScore,
        visitorScore: currentVisitorScore,
        state: 'in_progress',
        winner: 'unresolved',
        finishedAt: undefined
      };
    }
  }

  completedGames.sort((a, b) => a.gameNumber - b.gameNumber);

  // Recuentos basados EXCLUSIVAMENTE en juegos válidamente cerrados
  const localGamesWon = completedGames.filter(g => g.winner === 'local').length;
  const visitorGamesWon = completedGames.filter(g => g.winner === 'visitor').length;
  const tiesCount = completedGames.filter(g => g.winner === 'tie').length;
  const completedGamesCount = completedGames.length;

  // Estructura de presentación que separa claramente 'completed' de 'in_progress'
  const projectedGames: RaceProjectedGame[] = completedGames.map(g => ({
    gameNumber: g.gameNumber,
    localScore: g.localScore,
    visitorScore: g.visitorScore,
    state: 'completed' as const,
    winner: g.winner,
    ...(g.finishedAt ? { finishedAt: g.finishedAt } : {})
  }));

  if (activeGame) {
    projectedGames.push(activeGame);
  }

  // Es multi-juego si hay 2+ juegos cerrados, o al menos 1 juego cerrado y una revancha activa en curso
  const isMultiGame =
    completedGamesCount > 1 || (completedGamesCount === 1 && activeGame !== null);

  let localDisplayScore = 0;
  let visitorDisplayScore = 0;

  if (isMultiGame) {
    localDisplayScore = localGamesWon;
    visitorDisplayScore = visitorGamesWon;
  } else if (completedGamesCount === 1) {
    localDisplayScore = completedGames[0].localScore;
    visitorDisplayScore = completedGames[0].visitorScore;
  } else {
    localDisplayScore = currentLocalScore;
    visitorDisplayScore = currentVisitorScore;
  }

  // Estado global del partido
  let status: RaceMatchStatusSummary = 'in_progress';
  let localWon = false;
  let visitorWon = false;
  let isTie = false;

  if (isFinished) {
    if (isMultiGame) {
      if (localGamesWon > visitorGamesWon) {
        status = 'local_win';
        localWon = true;
      } else if (visitorGamesWon > localGamesWon) {
        status = 'visitor_win';
        visitorWon = true;
      } else {
        status = 'tie';
        isTie = true;
      }
    } else if (completedGamesCount === 1) {
      const onlyGame = completedGames[0];
      if (onlyGame.winner === 'local') {
        status = 'local_win';
        localWon = true;
      } else if (onlyGame.winner === 'visitor') {
        status = 'visitor_win';
        visitorWon = true;
      } else {
        status = 'tie';
        isTie = true;
      }
    } else {
      // Fallback defensivo si un partido terminó sin entradas
      if (localDisplayScore > visitorDisplayScore) {
        status = 'local_win';
        localWon = true;
      } else if (visitorDisplayScore > localDisplayScore) {
        status = 'visitor_win';
        visitorWon = true;
      } else {
        status = 'tie';
        isTie = true;
      }
    }
  } else {
    // Mientras el partido sigue en curso, no hay ganador definitivo ni empate cerrado del partido
    status = 'in_progress';
    localWon = false;
    visitorWon = false;
    isTie = false;
  }

  return {
    status,
    isFinished,
    isMultiGame,
    localDisplayScore,
    visitorDisplayScore,
    localWon,
    visitorWon,
    isTie,
    localGamesWon,
    visitorGamesWon,
    tiesCount,
    completedGamesCount,
    completedGames,
    effectiveHistory: completedGames,
    activeGame,
    projectedGames
  };
}

/**
 * Construye de forma centralizada la proyección de reporte/tarjeta para un partido Race (C-03).
 * Garantiza resultados 100% consistentes entre MatchHistoryModal y shareCardGenerator,
 * sin duplicar reglas ni introducir entradas ficticias.
 */
export function buildRaceReportProjection(
  match: Match,
  scores?: Score[]
): RaceReportProjection {
  const summary = getRaceDisplaySummary(match, scores);

  // Las columnas de la tabla oficial de parciales incluyen únicamente juegos válidamente cerrados
  const periodStats: RaceReportPeriodRow[] = summary.completedGames.map(g => ({
    period: g.gameNumber,
    label: `Juego ${g.gameNumber}`,
    local: g.localScore,
    visitor: g.visitorScore,
    state: 'completed' as const,
    winner: g.winner,
    ...(g.finishedAt ? { finishedAt: g.finishedAt } : {})
  }));

  const totalHeader: 'Total' | 'Ganados' = summary.isMultiGame ? 'Ganados' : 'Total';
  const scoreUnitLabel: 'FINAL' | 'JUEGOS' | 'EN CURSO' = summary.isMultiGame
    ? 'JUEGOS'
    : summary.isFinished
      ? 'FINAL'
      : 'EN CURSO';

  return {
    summary,
    mainLocalScore: summary.localDisplayScore,
    mainVisitorScore: summary.visitorDisplayScore,
    localTotalCell: summary.localDisplayScore,
    visitorTotalCell: summary.visitorDisplayScore,
    totalHeader,
    scoreUnitLabel,
    isRaceWithGames: summary.isMultiGame,
    isFinished: summary.isFinished,
    localWon: summary.localWon,
    visitorWon: summary.visitorWon,
    isTie: summary.isTie,
    status: summary.status,
    periodStats,
    completedGames: summary.completedGames,
    activeGame: summary.activeGame,
    projectedGames: summary.projectedGames
  };
}
