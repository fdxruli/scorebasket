// src/db/scoreIntegrity.service.ts

import type { Match, Score, GameResult } from './models';

export type ScoreIntegrityStatus = 'CONSISTENT' | 'INCONSISTENT' | 'UNVERIFIED';

export interface ScoreIntegrityResult {
  status: ScoreIntegrityStatus;
  mode: 'traditional' | 'race' | 'best-of-series';
  effectivePeriod?: number;
  storedScore: { local: number; visitor: number };
  computedScore?: { local: number; visitor: number };
  discrepancy?: { local: number; visitor: number };
  reason?: string;
  isCompleteHistory: boolean;
}

export interface PeriodResolutionResult {
  period: number;
  isAmbiguous: boolean;
  reason?: string;
}

export interface HistoryValidationResult {
  isValid: boolean;
  reason?: string;
}

/**
 * Validador de periodos como enteros positivos finitos (>= 1) (R1.5.1 / C-03).
 */
export function isFinitePositiveInteger(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && Number.isInteger(val) && val >= 1;
}

/**
 * Valida la identidad, continuidad e integridad del historial de juegos/sets (R1.5 / R1.5.1).
 * - Identificadores enteros, positivos y únicos.
 * - En periodo 1: cualquier entrada no vacía en gameHistory invalida el historial (C-02).
 * - Todos los periodos anteriores (1 .. effectivePeriod - 1) presentes exactamente una vez (sin huecos).
 * - Periodo actual no cerrado.
 * - Sin entradas futuras (gameNumber > effectivePeriod).
 * - Resultados bien formados (puntuaciones enteras >= 0, ganador válido y concordante con los puntos).
 * - En Best-of-Series: contrastar victorias acumuladas con los ganadores registrados y rechazar empates.
 * - No reescribir resultados históricos; ante ambigüedad devolver isValid: false.
 */
export function validateGameHistoryContinuity(params: {
  mode: 'race' | 'best-of-series';
  effectivePeriod: number;
  history?: GameResult[];
  bestOfWins?: { local: number; visitor: number };
}): HistoryValidationResult {
  const { mode, effectivePeriod, history, bestOfWins } = params;

  // Si estamos en el primer periodo (1), el historial debe estar vacío o no definido (C-02 / R1.5.1)
  // Cualquier entrada (números negativos, cero, fraccionarios, futuros o malformados) invalida el historial
  if (effectivePeriod === 1) {
    if (history && history.length > 0) {
      return {
        isValid: false,
        reason: `Historial anómalo: se disputa el periodo #1 pero gameHistory contiene ${history.length} entrada(s). En el periodo 1 el historial debe estar vacío.`,
      };
    }
    return { isValid: true };
  }

  // Si effectivePeriod > 1, history debe existir y contener entradas previas
  if (!history || history.length === 0) {
    return {
      isValid: false,
      reason: `Historial incompleto: se disputa el periodo #${effectivePeriod} pero no existen juegos previos registrados en gameHistory.`,
    };
  }

  const seenNumbers = new Set<number>();
  let recordedLocalWins = 0;
  let recordedVisitorWins = 0;

  for (const g of history) {
    // 1. Identificador entero y positivo finito
    if (!isFinitePositiveInteger(g.gameNumber)) {
      return {
        isValid: false,
        reason: `Identificador de juego inválido en gameHistory: "${g.gameNumber}" no es un entero positivo.`,
      };
    }

    // 2. Resultados malformados: puntuaciones
    if (
      typeof g.localScore !== 'number' ||
      !Number.isFinite(g.localScore) ||
      !Number.isInteger(g.localScore) ||
      g.localScore < 0 ||
      typeof g.visitorScore !== 'number' ||
      !Number.isFinite(g.visitorScore) ||
      !Number.isInteger(g.visitorScore) ||
      g.visitorScore < 0
    ) {
      return {
        isValid: false,
        reason: `Resultado malformado en juego #${g.gameNumber}: puntuaciones deben ser enteros no negativos.`,
      };
    }

    // 3. Resultados malformados: ganador
    if (!['local', 'visitor', 'tie'].includes(g.winner)) {
      return {
        isValid: false,
        reason: `Resultado malformado en juego #${g.gameNumber}: ganador inválido "${g.winner}".`,
      };
    }

    // En Best-of-Series los sets no pueden terminar en empate
    if (mode === 'best-of-series' && g.winner === 'tie') {
      return {
        isValid: false,
        reason: `Resultado inválido en Best-of-Series: el set #${g.gameNumber} está registrado como empate, lo cual no está permitido en series.`,
      };
    }

    // Coherencia deportiva entre puntos y ganador
    if (g.winner === 'local' && g.localScore <= g.visitorScore) {
      return {
        isValid: false,
        reason: `Resultado contradictorio en juego #${g.gameNumber}: ganador local pero marcador (${g.localScore}-${g.visitorScore}) no refleja victoria local.`,
      };
    }
    if (g.winner === 'visitor' && g.visitorScore <= g.localScore) {
      return {
        isValid: false,
        reason: `Resultado contradictorio en juego #${g.gameNumber}: ganador visitante pero marcador (${g.localScore}-${g.visitorScore}) no refleja victoria visitante.`,
      };
    }
    if (g.winner === 'tie' && g.localScore !== g.visitorScore) {
      return {
        isValid: false,
        reason: `Resultado contradictorio en juego #${g.gameNumber}: registrado como empate pero marcador (${g.localScore}-${g.visitorScore}) difiere.`,
      };
    }

    if (g.winner === 'local') recordedLocalWins++;
    if (g.winner === 'visitor') recordedVisitorWins++;

    // 4. Periodo actual cerrado
    if (g.gameNumber === effectivePeriod) {
      return {
        isValid: false,
        reason: `El periodo #${effectivePeriod} ya figura cerrado en gameHistory.`,
      };
    }

    // 5. Entradas futuras
    if (g.gameNumber > effectivePeriod) {
      return {
        isValid: false,
        reason: `Entrada futura detectada en gameHistory: el juego #${g.gameNumber} es posterior al periodo actual #${effectivePeriod}.`,
      };
    }

    // 6. Duplicados
    if (seenNumbers.has(g.gameNumber)) {
      return {
        isValid: false,
        reason: `Identificador duplicado en gameHistory: el juego #${g.gameNumber} aparece más de una vez.`,
      };
    }
    seenNumbers.add(g.gameNumber);
  }

  // 7. Huecos: verificar que cada periodo previo [1 .. effectivePeriod - 1] esté presente
  for (let k = 1; k < effectivePeriod; k++) {
    if (!seenNumbers.has(k)) {
      return {
        isValid: false,
        reason: `Hueco detectado en gameHistory: falta el periodo previo #${k} para el periodo actual #${effectivePeriod}.`,
      };
    }
  }

  // 8. Best-of-Series: contrastar victorias acumuladas con los ganadores registrados
  if (mode === 'best-of-series') {
    const storedLocalWins = bestOfWins?.local ?? 0;
    const storedVisitorWins = bestOfWins?.visitor ?? 0;
    if (storedLocalWins !== recordedLocalWins || storedVisitorWins !== recordedVisitorWins) {
      return {
        isValid: false,
        reason: `Incoherencia en Best-of-Series: victorias acumuladas (L:${storedLocalWins}, V:${storedVisitorWins}) no coinciden con los ganadores registrados en el historial (L:${recordedLocalWins}, V:${recordedVisitorWins}).`,
      };
    }
  }

  return { isValid: true };
}

/**
 * Evalúa si existe evidencia verificable de procedencia y completitud del flujo de eventos (R1.5).
 * No asume completitud simplemente por coincidencia numérica.
 */
function hasVerifiableEventEvidence(params: {
  match: Match;
  scores: Score[];
  relevantQuarter?: number;
}): boolean {
  const { match, scores, relevantQuarter } = params;

  // 1. Procedencia explícitamente acreditada (creado y registrado mediante rutas de sesión en vivo)
  if (match.eventsProvenance !== 'live_session') {
    return false;
  }

  // 2. Validación de eventos del periodo o partido:
  const relevantScores = relevantQuarter !== undefined
    ? scores.filter(s => s.matchId === match.id && s.quarter === relevantQuarter)
    : scores.filter(s => s.matchId === match.id);

  for (const s of relevantScores) {
    if (![1, 2, 3].includes(s.points)) {
      return false;
    }
    if (s.matchId !== match.id) return false;
    if (s.teamId !== match.localTeamId && s.teamId !== match.visitorTeamId) return false;
    if (!(s.createdAt instanceof Date) || isNaN(s.createdAt.getTime())) return false;
  }

  return true;
}

export const ScoreIntegrityService = {
  /**
   * Resuelve el periodo vigente para registro o verificación de jugadas (R1.5 / R1.5.1).
   * Valida que los números de periodo sean enteros positivos y finitos (C-03).
   * En Best-of-Series valida la coherencia entre currentQuarter y config.bestOf.currentGame.
   * Si son contradictorios o no válidos, marca el resultado como ambiguo (isAmbiguous = true).
   */
  resolveEffectivePeriod(match: Match): PeriodResolutionResult {
    const mode = match.config?.mode || 'traditional';

    if (mode === 'race') {
      const currentGame = match.config?.race?.currentGame;
      if (!isFinitePositiveInteger(currentGame)) {
        return {
          period: 1,
          isAmbiguous: true,
          reason: `Configuración de Race inválida: currentGame debe ser un entero positivo finito (recibido: ${currentGame}).`,
        };
      }
      return { period: currentGame, isAmbiguous: false };
    }

    if (mode === 'best-of-series') {
      const q = match.currentQuarter;
      const bg = match.config?.bestOf?.currentGame;

      if (q === undefined && bg === undefined) {
        return {
          period: 1,
          isAmbiguous: true,
          reason: 'No fue posible identificar el set actual en Best-of-Series: ni currentQuarter ni config.bestOf.currentGame están definidos.',
        };
      }

      if (q !== undefined && !isFinitePositiveInteger(q)) {
        return {
          period: 1,
          isAmbiguous: true,
          reason: `Configuración de Best-of-Series inválida: currentQuarter debe ser un entero positivo finito (recibido: ${q}).`,
        };
      }

      if (bg !== undefined && !isFinitePositiveInteger(bg)) {
        return {
          period: 1,
          isAmbiguous: true,
          reason: `Configuración de Best-of-Series inválida: config.bestOf.currentGame debe ser un entero positivo finito (recibido: ${bg}).`,
        };
      }

      if (q !== undefined && bg !== undefined && q !== bg) {
        return {
          period: q,
          isAmbiguous: true,
          reason: `Contradicción en Best-of-Series: currentQuarter (${q}) no coincide con config.bestOf.currentGame (${bg}).`,
        };
      }

      const resolved = q ?? bg;
      if (!isFinitePositiveInteger(resolved)) {
        return {
          period: 1,
          isAmbiguous: true,
          reason: 'No fue posible identificar inequívocamente el set actual en Best-of-Series.',
        };
      }

      return { period: resolved, isAmbiguous: false };
    }

    // Traditional
    const q = match.currentQuarter;
    if (q !== undefined && !isFinitePositiveInteger(q)) {
      return {
        period: 1,
        isAmbiguous: true,
        reason: `Configuración de Traditional inválida: currentQuarter debe ser un entero positivo finito (recibido: ${q}).`,
      };
    }

    return {
      period: q ?? 1,
      isAmbiguous: false,
    };
  },

  /**
   * Evalúa la integridad del marcador activo contrastando el estado en `matches`
   * con las anotaciones en `scores` según las reglas de cada modalidad deportiva.
   * Función pura sin efectos secundarios.
   */
  verifyScoreIntegrity(match: Match, scores: Score[]): ScoreIntegrityResult {
    const mode = match.config?.mode || 'traditional';
    const storedScore = {
      local: match.localScore ?? 0,
      visitor: match.visitorScore ?? 0,
    };

    // Validación básica de no-negatividad
    if (storedScore.local < 0 || storedScore.visitor < 0) {
      return {
        status: 'INCONSISTENT',
        mode,
        storedScore,
        reason: 'El marcador almacenado contiene valores negativos anómalos.',
        isCompleteHistory: false,
      };
    }

    const periodRes = this.resolveEffectivePeriod(match);
    if (periodRes.isAmbiguous) {
      return {
        status: 'UNVERIFIED',
        mode,
        effectivePeriod: periodRes.period,
        storedScore,
        reason: periodRes.reason,
        isCompleteHistory: false,
      };
    }

    const effectivePeriod = periodRes.period;

    // Validación de procedencia explícitamente no acreditada (R1.5)
    if (match.eventsProvenance === 'unverified') {
      return {
        status: 'UNVERIFIED',
        mode,
        effectivePeriod,
        storedScore,
        reason: 'Historial no verificable: procedencia de eventos no acreditada.',
        isCompleteHistory: false,
      };
    }

    // --- MODALIDAD: TRADITIONAL ---
    if (mode === 'traditional') {
      const matchScores = scores.filter(s => s.matchId === match.id);

      // Comprobación de evidencia de historial completo:
      // Si el marcador almacenado es positivo pero no existen registros de anotación en BD para ese equipo,
      // el historial de jugadas está incompleto (datos migrados/importados sin detalle).
      const hasLocalRecords = matchScores.some(s => s.teamId === match.localTeamId);
      const hasVisitorRecords = matchScores.some(s => s.teamId === match.visitorTeamId);

      if (storedScore.local > 0 && !hasLocalRecords) {
        return {
          status: 'UNVERIFIED',
          mode,
          effectivePeriod,
          storedScore,
          reason: 'Historial incompleto: marcador local positivo sin jugadas registradas en BD.',
          isCompleteHistory: false,
        };
      }

      if (storedScore.visitor > 0 && !hasVisitorRecords) {
        return {
          status: 'UNVERIFIED',
          mode,
          effectivePeriod,
          storedScore,
          reason: 'Historial incompleto: marcador visitante positivo sin jugadas registradas en BD.',
          isCompleteHistory: false,
        };
      }

      const computedLocal = matchScores
        .filter(s => s.teamId === match.localTeamId)
        .reduce((sum, s) => sum + s.points, 0);

      const computedVisitor = matchScores
        .filter(s => s.teamId === match.visitorTeamId)
        .reduce((sum, s) => sum + s.points, 0);

      const computedScore = { local: computedLocal, visitor: computedVisitor };
      const discrepancy = {
        local: storedScore.local - computedLocal,
        visitor: storedScore.visitor - computedVisitor,
      };

      const isConsistent = discrepancy.local === 0 && discrepancy.visitor === 0;
      const isCompleteHistory = isConsistent && hasVerifiableEventEvidence({ match, scores });

      return {
        status: isConsistent ? 'CONSISTENT' : 'INCONSISTENT',
        mode,
        effectivePeriod,
        storedScore,
        computedScore,
        discrepancy,
        reason: isConsistent
          ? (!isCompleteHistory ? 'Marcador consistente aritméticamente pero procedencia de eventos no acreditada.' : undefined)
          : 'Discrepancia entre marcador almacenado y suma de anotaciones.',
        isCompleteHistory,
      };
    }

    // --- MODALIDAD: RACE ---
    if (mode === 'race') {
      // Validación estricta de continuidad e identidad de juegos (R1.5)
      const continuityResult = validateGameHistoryContinuity({
        mode: 'race',
        effectivePeriod,
        history: match.gameHistory,
      });

      if (!continuityResult.isValid) {
        return {
          status: 'UNVERIFIED',
          mode,
          effectivePeriod,
          storedScore,
          reason: continuityResult.reason,
          isCompleteHistory: false,
        };
      }

      // En Race evaluamos EXCLUSIVAMENTE las anotaciones del juego actual
      const currentGameScores = scores.filter(
        s => s.matchId === match.id && s.quarter === effectivePeriod
      );

      const hasLocalRecords = currentGameScores.some(s => s.teamId === match.localTeamId);
      const hasVisitorRecords = currentGameScores.some(s => s.teamId === match.visitorTeamId);

      if (storedScore.local > 0 && !hasLocalRecords) {
        return {
          status: 'UNVERIFIED',
          mode,
          effectivePeriod,
          storedScore,
          reason: `Historial incompleto en Race: juego #${effectivePeriod} tiene puntuación local sin jugadas registradas.`,
          isCompleteHistory: false,
        };
      }

      if (storedScore.visitor > 0 && !hasVisitorRecords) {
        return {
          status: 'UNVERIFIED',
          mode,
          effectivePeriod,
          storedScore,
          reason: `Historial incompleto en Race: juego #${effectivePeriod} tiene puntuación visitante sin jugadas registradas.`,
          isCompleteHistory: false,
        };
      }

      const computedLocal = currentGameScores
        .filter(s => s.teamId === match.localTeamId)
        .reduce((sum, s) => sum + s.points, 0);

      const computedVisitor = currentGameScores
        .filter(s => s.teamId === match.visitorTeamId)
        .reduce((sum, s) => sum + s.points, 0);

      const computedScore = { local: computedLocal, visitor: computedVisitor };
      const discrepancy = {
        local: storedScore.local - computedLocal,
        visitor: storedScore.visitor - computedVisitor,
      };

      const isConsistent = discrepancy.local === 0 && discrepancy.visitor === 0;
      const isCompleteHistory = isConsistent && hasVerifiableEventEvidence({
        match,
        scores,
        relevantQuarter: effectivePeriod,
      });

      return {
        status: isConsistent ? 'CONSISTENT' : 'INCONSISTENT',
        mode,
        effectivePeriod,
        storedScore,
        computedScore,
        discrepancy,
        reason: isConsistent
          ? (!isCompleteHistory ? 'Marcador del juego actual consistente aritméticamente pero procedencia de eventos no acreditada.' : undefined)
          : 'Discrepancia entre marcador del juego actual y jugadas del periodo.',
        isCompleteHistory,
      };
    }

    // --- MODALIDAD: BEST-OF-SERIES ---
    if (mode === 'best-of-series') {
      // Validación estricta de continuidad e identidad de sets y victorias (R1.5)
      const continuityResult = validateGameHistoryContinuity({
        mode: 'best-of-series',
        effectivePeriod,
        history: match.gameHistory,
        bestOfWins: match.config?.bestOf?.wins,
      });

      if (!continuityResult.isValid) {
        return {
          status: 'UNVERIFIED',
          mode,
          effectivePeriod,
          storedScore,
          reason: continuityResult.reason,
          isCompleteHistory: false,
        };
      }

      // En Best-of-Series evaluamos EXCLUSIVAMENTE las anotaciones del set actual
      const currentSetScores = scores.filter(
        s => s.matchId === match.id && s.quarter === effectivePeriod
      );

      const hasLocalRecords = currentSetScores.some(s => s.teamId === match.localTeamId);
      const hasVisitorRecords = currentSetScores.some(s => s.teamId === match.visitorTeamId);

      if (storedScore.local > 0 && !hasLocalRecords) {
        return {
          status: 'UNVERIFIED',
          mode,
          effectivePeriod,
          storedScore,
          reason: `Historial incompleto en Best-of-Series: set #${effectivePeriod} tiene puntuación local sin jugadas registradas.`,
          isCompleteHistory: false,
        };
      }

      if (storedScore.visitor > 0 && !hasVisitorRecords) {
        return {
          status: 'UNVERIFIED',
          mode,
          effectivePeriod,
          storedScore,
          reason: `Historial incompleto en Best-of-Series: set #${effectivePeriod} tiene puntuación visitante sin jugadas registradas.`,
          isCompleteHistory: false,
        };
      }

      const computedLocal = currentSetScores
        .filter(s => s.teamId === match.localTeamId)
        .reduce((sum, s) => sum + s.points, 0);

      const computedVisitor = currentSetScores
        .filter(s => s.teamId === match.visitorTeamId)
        .reduce((sum, s) => sum + s.points, 0);

      const computedScore = { local: computedLocal, visitor: computedVisitor };
      const discrepancy = {
        local: storedScore.local - computedLocal,
        visitor: storedScore.visitor - computedVisitor,
      };

      const isConsistent = discrepancy.local === 0 && discrepancy.visitor === 0;
      const isCompleteHistory = isConsistent && hasVerifiableEventEvidence({
        match,
        scores,
        relevantQuarter: effectivePeriod,
      });

      return {
        status: isConsistent ? 'CONSISTENT' : 'INCONSISTENT',
        mode,
        effectivePeriod,
        storedScore,
        computedScore,
        discrepancy,
        reason: isConsistent
          ? (!isCompleteHistory ? 'Marcador del set actual consistente aritméticamente pero procedencia de eventos no acreditada.' : undefined)
          : 'Discrepancia entre marcador del set actual y jugadas del periodo.',
        isCompleteHistory,
      };
    }

    return {
      status: 'UNVERIFIED',
      mode,
      storedScore,
      reason: 'Modalidad de juego no soportada o desconocida.',
      isCompleteHistory: false,
    };
  },
};
