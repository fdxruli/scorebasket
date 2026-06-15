// src/features/match-creations/hooks/useGameActions.ts

import { useCallback } from 'react';
import { db } from '../../../db/db';
import { useLiveMatch } from '../componets/context/LiveMatchContext';
import type { Score, Foul } from '../../../db/models';
import type { Match } from '../../../db/models/Match';

type TeamSide = 'local' | 'visitor';
type ScorePoints = 1 | 2 | 3;

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

const validateTraditionalClock = (match: Match) => {
  const mode = getMode(match);
  if (mode !== 'traditional') return;

  if (!match.timerLastStart || (match.timerSecondsRemaining ?? 0) <= 0) {
    throw new Error('Debes iniciar o reanudar el reloj antes de registrar esta acción.');
  }
};

const validateScoreWindow = (match: Match) => {
  const mode = getMode(match);

  if (mode === 'race') {
    const targetScore = match.config?.race?.targetScore || 21;
    if ((match.localScore || 0) >= targetScore || (match.visitorScore || 0) >= targetScore) {
      throw new Error('Este juego ya tiene ganador. Finaliza o da la vuelta antes de registrar más puntos.');
    }
  }

  if (mode === 'best-of-series') {
    const targetScore = match.config?.bestOf?.targetScorePerGame || 21;
    if ((match.localScore || 0) >= targetScore || (match.visitorScore || 0) >= targetScore) {
      throw new Error('Este set ya terminó. Confirma el set antes de registrar más puntos.');
    }
  }
};

const getLatestByCreatedAt = <T extends { createdAt: Date }>(items: T[]): T | undefined => {
  return [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
};

export const useGameActions = () => {
  const { match, localTeam, visitorTeam } = useLiveMatch();

  // Helper para identificar si el equipo es local desde el render actual.
  // Las escrituras usan el partido fresco dentro de cada transacción.
  const isLocal = useCallback((teamId: number) => {
    return match?.localTeamId === teamId;
  }, [match]);

  /**
   * Acción: Agregar Puntos
   */
  const addScore = useCallback(async (teamId: number, points: number, playerId?: number) => {
    if (!match?.id) return;

    const normalizedPoints = normalizePoints(points);

    await db.transaction('rw', db.matches, db.scores, async () => {
      const currentMatch = await db.matches.get(match.id!);
      if (!currentMatch) throw new Error('El partido no existe');

      validateMatchIsActive(currentMatch);
      validateTraditionalClock(currentMatch);
      validateScoreWindow(currentMatch);

      const side = getTeamSide(currentMatch, teamId);
      const currentPeriod = getCurrentActionPeriod(currentMatch);

      const newScore: Omit<Score, 'id'> = {
        matchId: currentMatch.id!,
        teamId,
        playerId,
        points: normalizedPoints,
        quarter: currentPeriod,
        createdAt: new Date(),
      };

      await db.scores.add(newScore as Score);

      const updateData = side === 'local'
        ? { localScore: (currentMatch.localScore || 0) + normalizedPoints }
        : { visitorScore: (currentMatch.visitorScore || 0) + normalizedPoints };

      await db.matches.update(currentMatch.id!, updateData);
    });
  }, [match?.id]);

  /**
   * Acción: Agregar Falta
   */
  const addFoul = useCallback(async (teamId: number, playerId?: number) => {
    if (!match?.id) return;

    await db.transaction('rw', db.matches, db.fouls, async () => {
      const currentMatch = await db.matches.get(match.id!);
      if (!currentMatch) throw new Error('El partido no existe');

      validateMatchIsActive(currentMatch);
      validateTraditionalClock(currentMatch);

      const side = getTeamSide(currentMatch, teamId);
      const currentPeriod = getCurrentActionPeriod(currentMatch);

      const newFoul: Omit<Foul, 'id'> = {
        matchId: currentMatch.id!,
        teamId,
        playerId,
        quarter: currentPeriod,
        createdAt: new Date(),
      };

      await db.fouls.add(newFoul as Foul);

      const updateData = side === 'local'
        ? { localFouls: (currentMatch.localFouls || 0) + 1 }
        : { visitorFouls: (currentMatch.visitorFouls || 0) + 1 };
        
      await db.matches.update(currentMatch.id!, updateData);
    });
  }, [match?.id]);

  /**
   * Acción: Deshacer (Undo)
   *
   * Importante: en Race y Series solo deshace acciones del juego/set actual.
   * Así evitamos borrar acciones de juegos o sets ya cerrados y descontarlas del marcador actual.
   */
  const undoLastAction = useCallback(async () => {
    if (!match?.id) return;

    await db.transaction('rw', db.matches, db.scores, db.fouls, async () => {
      const currentMatch = await db.matches.get(match.id!);
      if (!currentMatch) throw new Error('El partido no existe');

      validateMatchIsActive(currentMatch);

      const currentPeriod = getCurrentActionPeriod(currentMatch);

      const [scores, fouls] = await Promise.all([
        db.scores.where('matchId').equals(currentMatch.id!).toArray(),
        db.fouls.where('matchId').equals(currentMatch.id!).toArray()
      ]);

      const lastScore = getLatestByCreatedAt(
        scores.filter(score => score.quarter === currentPeriod)
      );

      const lastFoul = getLatestByCreatedAt(
        fouls.filter(foul => foul.quarter === currentPeriod)
      );

      if (!lastScore && !lastFoul) {
        throw new Error('No hay acciones para deshacer en este periodo.');
      }

      const lastScoreTime = lastScore?.createdAt.getTime() || 0;
      const lastFoulTime = lastFoul?.createdAt.getTime() || 0;

      if (lastScore && lastScoreTime >= lastFoulTime) {
        await db.scores.delete(lastScore.id!);

        const side = getTeamSide(currentMatch, lastScore.teamId);
        const updateData = side === 'local'
          ? { localScore: Math.max(0, (currentMatch.localScore || 0) - lastScore.points) }
          : { visitorScore: Math.max(0, (currentMatch.visitorScore || 0) - lastScore.points) };
          
        await db.matches.update(currentMatch.id!, updateData);
        return;
      }

      if (lastFoul) {
        await db.fouls.delete(lastFoul.id!);

        const side = getTeamSide(currentMatch, lastFoul.teamId);
        const updateData = side === 'local'
          ? { localFouls: Math.max(0, (currentMatch.localFouls || 0) - 1) }
          : { visitorFouls: Math.max(0, (currentMatch.visitorFouls || 0) - 1) };

        await db.matches.update(currentMatch.id!, updateData);
      }
    });
  }, [match?.id]);

  return {
    addScore,
    addFoul,
    undoLastAction,
    isLocal,
    localTeam,
    visitorTeam
  };
};