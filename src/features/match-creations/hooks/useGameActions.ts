// src/features/match-creations/hooks/useGameActions.ts

import { useCallback, useRef, useState } from 'react';
import { db } from '../../../db/db';
import { useLiveMatch } from '../components/context/LiveMatchContext';
import { GameActionsRepository, type DeleteActionResult } from '../../../db/gameActions.repository';
import { MatchTimerService } from '../../../db/matchTimer.service';
import { timerAuthorityCoordinator } from '../../../services/timerAuthority.coordinator';
import { triggerHaptic } from '../../../utils/haptics';
import { unlockAudioContext, playScorePop, playWhistle } from '../../../utils/soundEffects';
import type { Score, Foul } from '../../../db/models';
import type { Match } from '../../../db/models/Match';

export type { DeleteActionResult };

type TeamSide = 'local' | 'visitor';
type ScorePoints = 1 | 2 | 3;

export type ExecutableGameAction =
  | { type: 'score'; points: 1 | 2 | 3 }
  | { type: 'foul' };

export interface ActionExecutionOptions {
  expectedPeriod?: number;
  notifyError?: boolean;
}

export interface ActionExecutionResult {
  success: boolean;
  error?: string;
  inFlight?: boolean;
}

const getMode = (match: Match) => match.config?.mode || 'traditional';

const getCurrentActionPeriod = (match: Match): number => {
  const mode = getMode(match);

  if (mode === 'race') {
    return match.config?.race?.currentGame || 1;
  }

  if (mode === 'best-of-series') {
    return match.currentQuarter || match.config?.bestOf?.currentGame || 1;
  }

  return match.currentQuarter || 1;
};

const getTeamSide = (match: Match, teamId: number): TeamSide => {
  if (teamId === match.localTeamId) return 'local';
  if (teamId === match.visitorTeamId) return 'visitor';
  throw new Error('El equipo no corresponde a este partido');
};

const normalizePoints = (points: number): ScorePoints => {
  if (points !== 1 && points !== 2 && points !== 3) {
    throw new Error('Los puntos solo pueden ser 1, 2 o 3');
  }

  return points;
};

const validateMatchIsActive = (match: Match) => {
  if (match.status === 'finished') {
    throw new Error('El partido ya finalizó');
  }
};

const validateScoreWindow = (match: Match) => {
  const mode = getMode(match);
  const localScore = match.localScore || 0;
  const visitorScore = match.visitorScore || 0;

  if (mode === 'race') {
    const targetScore = match.config?.race?.targetScore || 21;
    const winByTwo = match.config?.race?.winByTwo ?? false;
    const localHasWon = localScore >= targetScore && (!winByTwo || localScore - visitorScore >= 2);
    const visitorHasWon = visitorScore >= targetScore && (!winByTwo || visitorScore - localScore >= 2);

    if (localHasWon || visitorHasWon) {
      throw new Error('Este juego ya tiene ganador. Finaliza o da la vuelta antes de registrar más puntos.');
    }
  }

  if (mode === 'best-of-series') {
    const targetScore = match.config?.bestOf?.targetScorePerGame || 21;
    const winByTwo = match.config?.bestOf?.winByTwo ?? false;
    const localHasWon = localScore >= targetScore && (!winByTwo || localScore - visitorScore >= 2);
    const visitorHasWon = visitorScore >= targetScore && (!winByTwo || visitorScore - localScore >= 2);

    if (localHasWon || visitorHasWon) {
      throw new Error('Este set ya terminó. Confirma el set antes de registrar más puntos.');
    }

    const totalGames = match.config?.bestOf?.totalGames || 3;
    const setsToWin = Math.floor(totalGames / 2) + 1;
    const currentWins = match.config?.bestOf?.wins || { local: 0, visitor: 0 };
    if (currentWins.local >= setsToWin || currentWins.visitor >= setsToWin) {
      throw new Error('La serie ya fue decidida previamente; no se permiten anotaciones adicionales.');
    }
  }
};

const notifyActionError = (error: unknown, fallbackMessage: string) => {
  console.error(error);

  const message = error instanceof Error ? error.message : fallbackMessage;

  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(message);
  }
};

export const useGameActions = () => {
  const { match, localTeam, visitorTeam } = useLiveMatch();
  const inFlightRef = useRef(false);
  const [isActionPending, setIsActionPending] = useState(false);
  const [undoNotice, setUndoNotice] = useState<string | null>(null);

  // Helper para identificar si el equipo es local desde el render actual.
  // Las escrituras usan el partido fresco dentro de cada transacción.
  const isLocal = useCallback((teamId: number) => {
    return match?.localTeamId === teamId;
  }, [match]);

  /**
   * Acción: Agregar Puntos
   */
  const addScore = useCallback(async (
    teamId: number,
    points: number,
    playerId?: number,
    options?: ActionExecutionOptions
  ): Promise<ActionExecutionResult> => {
    if (inFlightRef.current) {
      return {
        success: false,
        inFlight: true,
        error: 'Ya hay una acción en proceso.'
      };
    }

    if (!match?.id) {
      return { success: false, error: 'Partido no disponible' };
    }

    inFlightRef.current = true;
    setIsActionPending(true);

    try {
      const normalizedPoints = normalizePoints(points);
      const renderPeriod = match ? getCurrentActionPeriod(match) : undefined;
      const expectedPeriod = options?.expectedPeriod ?? renderPeriod;

      const isAssistantActive = Boolean(match.possessionAssistant?.enabled);
      if (isAssistantActive && (normalizedPoints === 2 || normalizedPoints === 3)) {
        const auth = timerAuthorityCoordinator.getAuthorityState(match.id);
        const result = await MatchTimerService.recordFieldGoalWithAssistant(
          match.id,
          { scoringTeamId: teamId, points: normalizedPoints, playerId },
          {
            epoch: auth.epoch,
            tabId: auth.tabId,
            expectedQuarter: expectedPeriod
          }
        );

        if (result.status !== 'applied') {
          throw new Error(result.reason || 'No se pudieron registrar los puntos con el asistente de posesión.');
        }

        unlockAudioContext();
        playScorePop(normalizedPoints);
        triggerHaptic('score', match.possessionAssistant?.hapticsEnabled !== false);
        return { success: true };
      }

      await db.transaction('rw', db.matches, db.scores, async () => {
        const currentMatch = await db.matches.get(match.id!);
        if (!currentMatch) throw new Error('El partido no existe');

        validateMatchIsActive(currentMatch);

        const currentPeriod = getCurrentActionPeriod(currentMatch);

        if (expectedPeriod !== undefined) {
          if (expectedPeriod !== currentPeriod) {
            throw new Error(`El periodo o set ya cambió (esperado: #${expectedPeriod}, vigente: #${currentPeriod}). No se pueden registrar puntos en un periodo anterior.`);
          }
          if (currentMatch.gameHistory?.some(g => g.gameNumber === expectedPeriod)) {
            throw new Error(`El periodo o set #${expectedPeriod} ya fue cerrado en el historial.`);
          }
        }

        validateScoreWindow(currentMatch);

        const side = getTeamSide(currentMatch, teamId);

        const newScore: Omit<Score, 'id'> = {
          matchId: currentMatch.id!,
          teamId,
          playerId,
          points: normalizedPoints,
          quarter: currentPeriod,
          createdAt: new Date(),
        };

        await db.scores.add(newScore as Score);

        const updateData: Partial<Match> = side === 'local'
          ? { localScore: (currentMatch.localScore || 0) + normalizedPoints }
          : { visitorScore: (currentMatch.visitorScore || 0) + normalizedPoints };

        if (currentMatch.status === 'created') {
          updateData.status = 'playing';
        }

        await db.matches.update(currentMatch.id!, updateData);
      });

      unlockAudioContext();
      playScorePop(normalizedPoints);
      return { success: true };
    } catch (error) {
      if (options?.notifyError !== false) {
        notifyActionError(error, 'No se pudieron registrar los puntos.');
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'No se pudieron registrar los puntos.'
      };
    } finally {
      inFlightRef.current = false;
      setIsActionPending(false);
    }
  }, [match]);

  /**
   * Acción: Agregar Falta
   */
  const addFoul = useCallback(async (
    teamId: number,
    playerId?: number,
    options?: ActionExecutionOptions
  ): Promise<ActionExecutionResult> => {
    if (inFlightRef.current) {
      return {
        success: false,
        inFlight: true,
        error: 'Ya hay una acción en proceso.'
      };
    }

    if (!match?.id) {
      return { success: false, error: 'Partido no disponible' };
    }

    inFlightRef.current = true;
    setIsActionPending(true);

    try {
      const renderPeriod = match ? getCurrentActionPeriod(match) : undefined;
      const expectedPeriod = options?.expectedPeriod ?? renderPeriod;

      await db.transaction('rw', db.matches, db.fouls, async () => {
        const currentMatch = await db.matches.get(match.id!);
        if (!currentMatch) throw new Error('El partido no existe');

        validateMatchIsActive(currentMatch);

        const currentPeriod = getCurrentActionPeriod(currentMatch);

        if (expectedPeriod !== undefined) {
          if (expectedPeriod !== currentPeriod) {
            throw new Error(`El periodo o set ya cambió (esperado: #${expectedPeriod}, vigente: #${currentPeriod}). No se pueden registrar faltas en un periodo anterior.`);
          }
          if (currentMatch.gameHistory?.some(g => g.gameNumber === expectedPeriod)) {
            throw new Error(`El periodo o set #${expectedPeriod} ya fue cerrado en el historial.`);
          }
        }

        const side = getTeamSide(currentMatch, teamId);

        const newFoul: Omit<Foul, 'id'> = {
          matchId: currentMatch.id!,
          teamId,
          playerId,
          quarter: currentPeriod,
          createdAt: new Date(),
        };

        await db.fouls.add(newFoul as Foul);

        const updateData: Partial<Match> = side === 'local'
          ? { localFouls: (currentMatch.localFouls || 0) + 1 }
          : { visitorFouls: (currentMatch.visitorFouls || 0) + 1 };

        if (currentMatch.status === 'created') {
          updateData.status = 'playing';
        }

        await db.matches.update(currentMatch.id!, updateData);
      });

      unlockAudioContext();
      playWhistle();
      return { success: true };
    } catch (error) {
      if (options?.notifyError !== false) {
        notifyActionError(error, 'No se pudo registrar la falta.');
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'No se pudo registrar la falta.'
      };
    } finally {
      inFlightRef.current = false;
      setIsActionPending(false);
    }
  }, [match]);

  /**
   * Ejecutor compartido para puntos o faltas en cualquier modalidad (Traditional, Race, Series).
   */
  const executeGameAction = useCallback(async (
    teamId: number,
    action: ExecutableGameAction,
    playerId?: number,
    options?: ActionExecutionOptions
  ): Promise<ActionExecutionResult> => {
    if (action.type === 'score') {
      return addScore(teamId, action.points, playerId, options);
    }
    return addFoul(teamId, playerId, options);
  }, [addScore, addFoul]);

  /**
   * Acción: Deshacer (Undo)
   *
   * Importante: en Race y Series solo deshace acciones del juego/set actual.
   * Centralizado a través de GameActionsRepository.undoLastAction con transacciones seguras.
   * Acepta options?: ActionExecutionOptions o llamadas directas de eventos UI (onClick={undoLastAction}).
   */
  const undoLastAction = useCallback(async (options?: ActionExecutionOptions | unknown): Promise<DeleteActionResult> => {
    if (inFlightRef.current) {
      return {
        success: false,
        deleted: false,
        error: 'Ya hay una acción en proceso.'
      };
    }

    if (!match?.id) {
      return { success: false, deleted: false, error: 'Partido no disponible' };
    }

    const parsedOptions = (
      options &&
      typeof options === 'object' &&
      !('nativeEvent' in options) &&
      ('expectedPeriod' in options || 'notifyError' in options)
    )
      ? (options as ActionExecutionOptions)
      : undefined;

    inFlightRef.current = true;
    setIsActionPending(true);

    try {
      const renderPeriod = match ? getCurrentActionPeriod(match) : undefined;
      const expectedPeriod = parsedOptions?.expectedPeriod ?? renderPeriod;
      const result = await GameActionsRepository.undoLastAction(match.id, expectedPeriod);
      if (!result.success) {
        throw new Error(result.error || 'No se pudo deshacer la última acción.');
      }
      if (result.notice) {
        setUndoNotice(result.notice);
      }
      return result;
    } catch (error) {
      if (parsedOptions?.notifyError !== false) {
        notifyActionError(error, 'No se pudo deshacer la última acción.');
      }
      return {
        success: false,
        deleted: false,
        error: error instanceof Error ? error.message : 'No se pudo deshacer la última acción.'
      };
    } finally {
      inFlightRef.current = false;
      setIsActionPending(false);
    }
  }, [match]);

  return {
    addScore,
    addFoul,
    executeGameAction,
    undoLastAction,
    isActionPending,
    isLocal,
    localTeam,
    visitorTeam,
    undoNotice,
    clearUndoNotice: () => setUndoNotice(null)
  };
};
