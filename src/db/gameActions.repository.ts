// src/db/gameActions.repository.ts
import { db } from './db';
import type { Score, Match } from './models';

export interface DeleteActionResult {
  success: boolean;
  deleted: boolean;
  error?: string;
  previousScore?: { local: number; visitor: number };
  newScore?: { local: number; visitor: number };
  previousFouls?: { local: number; visitor: number };
  newFouls?: { local: number; visitor: number };
}

export function getCurrentActionPeriod(match: Match): number {
  const mode = match.config?.mode || 'traditional';

  if (mode === 'race') {
    return match.config?.race?.currentGame || 1;
  }

  if (mode === 'best-of-series') {
    return match.currentQuarter || match.config?.bestOf?.currentGame || 1;
  }

  return match.currentQuarter || 1;
}

const getLatestByCreatedAt = <T extends { createdAt: Date }>(items: T[]): T | undefined => {
  return [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
};

export const GameActionsRepository = {
  /**
   * Eliminación atómica e idempotente de una anotación o falta.
   * Garantiza que la acción exista antes de descontar del marcador y que no se apliquen
   * descuentos duplicados si se llama dos veces para la misma acción.
   */
  async deleteActionSafely(params: {
    matchId: number;
    actionId: number;
    type: 'score' | 'foul';
  }): Promise<DeleteActionResult> {
    const { matchId, actionId, type } = params;

    return db.transaction('rw', db.matches, db.scores, db.fouls, async () => {
      // 1. Consultar el partido actual
      const match = await db.matches.get(matchId);
      if (!match) {
        throw new Error('El partido no existe');
      }

      // 2. Consultar la acción por su identificador y tipo
      const action = type === 'score'
        ? await db.scores.get(actionId)
        : await db.fouls.get(actionId);

      // 6. Verificar que la acción todavía existe
      // Si ya no existe (ej. llamada duplicada o concurrente), retornar sin modificar nada
      if (!action) {
        return {
          success: false,
          deleted: false,
          error: 'La acción no existe o ya fue eliminada previamente.'
        };
      }

      // 3. Validar que la acción pertenece al partido solicitado
      if (action.matchId !== matchId) {
        throw new Error('La acción no pertenece al partido solicitado.');
      }

      // 4. Validar que pertenece a uno de los equipos del partido
      if (action.teamId !== match.localTeamId && action.teamId !== match.visitorTeamId) {
        throw new Error('El equipo de la acción no corresponde a este partido.');
      }

      // 5. Comprobar que se permite corregir ese periodo según la modalidad
      const mode = match.config?.mode || 'traditional';
      const currentPeriod = getCurrentActionPeriod(match);

      if ((mode === 'race' || mode === 'best-of-series') && action.quarter !== currentPeriod) {
        throw new Error('No se pueden eliminar acciones de juegos o sets anteriores ya cerrados.');
      }

      const isLocal = action.teamId === match.localTeamId;

      // 7. Eliminar el registro
      // 8. Actualizar el marcador o contador correspondiente (sin permitir negativos)
      if (type === 'score') {
        const scoreItem = action as Score;
        await db.scores.delete(actionId);

        const currentLocal = match.localScore || 0;
        const currentVisitor = match.visitorScore || 0;
        const points = scoreItem.points || 0;

        const newLocal = isLocal ? Math.max(0, currentLocal - points) : currentLocal;
        const newVisitor = !isLocal ? Math.max(0, currentVisitor - points) : currentVisitor;

        await db.matches.update(matchId, {
          localScore: newLocal,
          visitorScore: newVisitor
        });

        return {
          success: true,
          deleted: true,
          previousScore: { local: currentLocal, visitor: currentVisitor },
          newScore: { local: newLocal, visitor: newVisitor }
        };
      } else {
        await db.fouls.delete(actionId);

        const currentLocalFouls = match.localFouls || 0;
        const currentVisitorFouls = match.visitorFouls || 0;

        const newLocalFouls = isLocal ? Math.max(0, currentLocalFouls - 1) : currentLocalFouls;
        const newVisitorFouls = !isLocal ? Math.max(0, currentVisitorFouls - 1) : currentVisitorFouls;

        await db.matches.update(matchId, {
          localFouls: newLocalFouls,
          visitorFouls: newVisitorFouls
        });

        return {
          success: true,
          deleted: true,
          previousFouls: { local: currentLocalFouls, visitor: currentVisitorFouls },
          newFouls: { local: newLocalFouls, visitor: newVisitorFouls }
        };
      }
    });
  },

  /**
   * Deshace la última acción registrada en el periodo/juego/set actual
   * usando la misma transacción y validaciones de integridad atómica.
   */
  async undoLastAction(matchId: number): Promise<DeleteActionResult> {
    return db.transaction('rw', db.matches, db.scores, db.fouls, async () => {
      const currentMatch = await db.matches.get(matchId);
      if (!currentMatch) {
        throw new Error('El partido no existe');
      }

      if (currentMatch.status === 'finished') {
        throw new Error('El partido ya finalizó');
      }

      const currentPeriod = getCurrentActionPeriod(currentMatch);

      const [scores, fouls] = await Promise.all([
        db.scores.where('matchId').equals(matchId).toArray(),
        db.fouls.where('matchId').equals(matchId).toArray()
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
        return this.deleteActionSafely({
          matchId,
          actionId: lastScore.id!,
          type: 'score'
        });
      }

      if (lastFoul) {
        return this.deleteActionSafely({
          matchId,
          actionId: lastFoul.id!,
          type: 'foul'
        });
      }

      throw new Error('No hay acciones para deshacer en este periodo.');
    });
  }
};
