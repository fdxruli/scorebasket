// src/db/scoreIntegrity.service.ts

import type { Match, Score } from './models';

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

export const ScoreIntegrityService = {
  /**
   * Resuelve el periodo vigente para registro o verificación de jugadas.
   * En Best-of-Series valida la coherencia entre currentQuarter y config.bestOf.currentGame.
   * Si son contradictorios, marca el resultado como ambiguo (isAmbiguous = true).
   */
  resolveEffectivePeriod(match: Match): PeriodResolutionResult {
    const mode = match.config?.mode || 'traditional';

    if (mode === 'race') {
      const currentGame = match.config?.race?.currentGame;
      if (typeof currentGame !== 'number' || currentGame < 1) {
        return {
          period: 1,
          isAmbiguous: true,
          reason: 'Configuración de Race inválida: currentGame debe ser un entero >= 1.',
        };
      }
      return { period: currentGame, isAmbiguous: false };
    }

    if (mode === 'best-of-series') {
      const q = match.currentQuarter;
      const bg = match.config?.bestOf?.currentGame;

      if (q !== undefined && bg !== undefined && q !== bg) {
        return {
          period: q,
          isAmbiguous: true,
          reason: `Contradicción en Best-of-Series: currentQuarter (${q}) no coincide con config.bestOf.currentGame (${bg}).`,
        };
      }

      const resolved = q ?? bg;
      if (typeof resolved !== 'number' || resolved < 1) {
        return {
          period: 1,
          isAmbiguous: true,
          reason: 'No fue posible identificar inequívocamente el set actual en Best-of-Series.',
        };
      }

      return { period: resolved, isAmbiguous: false };
    }

    // Traditional
    return {
      period: match.currentQuarter || 1,
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

      return {
        status: isConsistent ? 'CONSISTENT' : 'INCONSISTENT',
        mode,
        effectivePeriod,
        storedScore,
        computedScore,
        discrepancy,
        reason: isConsistent ? undefined : 'Discrepancia entre marcador almacenado y suma de anotaciones.',
        isCompleteHistory: true,
      };
    }

    // --- MODALIDAD: RACE ---
    if (mode === 'race') {
      const history = match.gameHistory || [];

      // Continuidad de historial en revanchas:
      // Si estamos en el juego N > 1, gameHistory debe contener los juegos anteriores [1 .. N-1].
      if (effectivePeriod > 1 && history.length < effectivePeriod - 1) {
        return {
          status: 'UNVERIFIED',
          mode,
          effectivePeriod,
          storedScore,
          reason: `Historial incompleto en Race: se disputa el juego #${effectivePeriod} pero solo hay ${history.length} juegos cerrados en gameHistory.`,
          isCompleteHistory: false,
        };
      }

      // El juego actual no debe estar registrado ya como cerrado
      if (history.some(g => g.gameNumber === effectivePeriod)) {
        return {
          status: 'UNVERIFIED',
          mode,
          effectivePeriod,
          storedScore,
          reason: `El juego #${effectivePeriod} ya figura cerrado en gameHistory.`,
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

      return {
        status: isConsistent ? 'CONSISTENT' : 'INCONSISTENT',
        mode,
        effectivePeriod,
        storedScore,
        computedScore,
        discrepancy,
        reason: isConsistent ? undefined : 'Discrepancia entre marcador del juego actual y jugadas del periodo.',
        isCompleteHistory: true,
      };
    }

    // --- MODALIDAD: BEST-OF-SERIES ---
    if (mode === 'best-of-series') {
      const history = match.gameHistory || [];

      // Continuidad de sets en la serie:
      if (effectivePeriod > 1 && history.length < effectivePeriod - 1) {
        return {
          status: 'UNVERIFIED',
          mode,
          effectivePeriod,
          storedScore,
          reason: `Historial incompleto en Best-of-Series: se disputa el set #${effectivePeriod} pero solo hay ${history.length} sets cerrados en gameHistory.`,
          isCompleteHistory: false,
        };
      }

      // Coherencia entre victorias acumuladas de la serie y tamaño del historial
      const winsLocal = match.config?.bestOf?.wins?.local ?? 0;
      const winsVisitor = match.config?.bestOf?.wins?.visitor ?? 0;
      if (history.length > 0 && winsLocal + winsVisitor !== history.length) {
        return {
          status: 'UNVERIFIED',
          mode,
          effectivePeriod,
          storedScore,
          reason: `Inconsistencia en Best-of-Series: la suma de victorias (${winsLocal + winsVisitor}) difiere de sets en historial (${history.length}).`,
          isCompleteHistory: false,
        };
      }

      // El set actual no debe estar registrado ya como cerrado
      if (history.some(g => g.gameNumber === effectivePeriod)) {
        return {
          status: 'UNVERIFIED',
          mode,
          effectivePeriod,
          storedScore,
          reason: `El set #${effectivePeriod} ya figura cerrado en gameHistory.`,
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

      return {
        status: isConsistent ? 'CONSISTENT' : 'INCONSISTENT',
        mode,
        effectivePeriod,
        storedScore,
        computedScore,
        discrepancy,
        reason: isConsistent ? undefined : 'Discrepancia entre marcador del set actual y jugadas del periodo.',
        isCompleteHistory: true,
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
