// src/db/gameActions.repository.ts
import { db } from './db';
import type { Score, Match } from './models';
import { ScoreIntegrityService } from './scoreIntegrity.service';

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
  const periodRes = ScoreIntegrityService.resolveEffectivePeriod(match);
  return periodRes.period;
}

const getLatestByCreatedAt = <T extends { createdAt: Date }>(items: T[]): T | undefined => {
  return [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
};

export const GameActionsRepository = {
  /**
   * Eliminación atómica, idempotente y con validación de contrato de integridad (SB-02 / R1.4).
   * 1. Abre transacción de escritura en matches, scores y fouls.
   * 2. Verifica la existencia del partido y la acción solicitada (idempotente si ya fue borrada).
   * 3. Valida pertenencia al partido y equipos involucrados.
   * 4. Resuelve periodo vigente según modalidad y rechaza periodos cerrados o registrados en gameHistory.
   * 5. Evalúa el contrato de integridad del marcador: rechaza discrepancias preexistentes e historiales no acreditables.
   * 6. Rechaza subdesbordamientos (marcador inferior a la anotación).
   * 7. Borra la acción y descuenta del marcador de forma atómica y consistente.
   */
  async deleteActionSafely(params: {
    matchId: number;
    actionId: number;
    type: 'score' | 'foul';
    _faultInjection?: 'post-delete';
  }): Promise<DeleteActionResult> {
    const { matchId, actionId, type, _faultInjection } = params;

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

      // Si ya no existe (ej. llamada duplicada o concurrente), retornar sin modificar nada (idempotente)
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

      // 5. Resolver modalidad y periodo efectivo
      const mode = match.config?.mode || 'traditional';
      const periodRes = ScoreIntegrityService.resolveEffectivePeriod(match);
      if (periodRes.isAmbiguous) {
        throw new Error(`Periodo no verificable: ${periodRes.reason}`);
      }
      const currentPeriod = periodRes.period;

      // 6. Rechazar periodos cerrados en Race y Best-of-Series
      if ((mode === 'race' || mode === 'best-of-series') && action.quarter !== currentPeriod) {
        throw new Error('No se pueden eliminar acciones de juegos o sets anteriores ya cerrados.');
      }

      // Rechazar modificaciones de Race / Series si el partido ya finalizó
      if ((mode === 'race' || mode === 'best-of-series') && match.status === 'finished') {
        throw new Error('No se pueden eliminar acciones de un partido finalizado en esta modalidad deportiva.');
      }

      // 7. Verificar si el juego o set está registrado en gameHistory
      if (match.gameHistory?.some(g => g.gameNumber === action.quarter)) {
        throw new Error('No se pueden eliminar acciones de un juego o set ya registrado y cerrado en el historial.');
      }

      const isLocal = action.teamId === match.localTeamId;

      // 8, 9, 10, 11, 12, 13: Integridad, actualización y verificación posterior
      if (type === 'score') {
        const scoreItem = action as Score;
        const currentLocal = match.localScore ?? 0;
        const currentVisitor = match.visitorScore ?? 0;
        const points = scoreItem.points || 0;

        // Detección de subdesbordamiento: no permitir que el marcador sea menor que los puntos
        const relevantStoredScore = isLocal ? currentLocal : currentVisitor;
        if (relevantStoredScore < points) {
          throw new Error('Subdesbordamiento de marcador detectado: los puntos almacenados son inferiores a la anotación a eliminar.');
        }

        // 8. Comprobar integridad del marcador antes de modificarlo
        const matchScores = await db.scores.where('matchId').equals(matchId).toArray();
        const integrity = ScoreIntegrityService.verifyScoreIntegrity(match, matchScores);

        // 9. Rechazar operaciones que partan de una discrepancia comprobada
        if (integrity.status === 'INCONSISTENT') {
          throw new Error(`Discrepancia detectada en el marcador: la eliminación de anotaciones está bloqueada para preservar la integridad (${integrity.reason ?? 'marcador desincronizado'}).`);
        }

        // 10. No modificar el marcador ni la anotación si la integridad no puede acreditarse
        if (integrity.status === 'UNVERIFIED') {
          throw new Error(`Historial no verificable: la eliminación está bloqueada porque no se pudo acreditar la integridad (${integrity.reason ?? 'estado no verificable'}).`);
        }

        // 11. Borrar la anotación y actualizar el marcador atómicamente
        await db.scores.delete(actionId);

        const newLocal = isLocal ? currentLocal - points : currentLocal;
        const newVisitor = !isLocal ? currentVisitor - points : currentVisitor;

        // 12. Verificar que el estado resultante conserva la no-negatividad
        if (newLocal < 0 || newVisitor < 0) {
          throw new Error('Invariante violado: el marcador resultante contiene valores negativos.');
        }

        await db.matches.update(matchId, {
          localScore: newLocal,
          visitorScore: newVisitor
        });

        // 13. Fallo controlado para pruebas de rollback transaccional (R1.5)
        if (_faultInjection === 'post-delete') {
          throw new Error('Fallo transaccional deliberado provocado después de la escritura parcial.');
        }

        // 14. Verificación de consistencia posterior dentro de la misma transacción antes de confirmar
        const updatedMatch = await db.matches.get(matchId);
        if (!updatedMatch) {
          throw new Error('El partido no existe tras la actualización.');
        }
        const remainingScores = await db.scores.where('matchId').equals(matchId).toArray();
        const postIntegrity = ScoreIntegrityService.verifyScoreIntegrity(updatedMatch, remainingScores);

        if (postIntegrity.status !== 'CONSISTENT') {
          throw new Error(`Inconsistencia posterior detectada: la eliminación produce un estado inválido (${postIntegrity.reason ?? 'marcador no consistente'}).`);
        }

        return {
          success: true,
          deleted: true,
          previousScore: { local: currentLocal, visitor: currentVisitor },
          newScore: { local: newLocal, visitor: newVisitor }
        };
      } else {
        // Manejo de Faltas
        const currentLocalFouls = match.localFouls ?? 0;
        const currentVisitorFouls = match.visitorFouls ?? 0;

        const relevantFouls = isLocal ? currentLocalFouls : currentVisitorFouls;
        if (relevantFouls < 1) {
          throw new Error('Subdesbordamiento de faltas detectado: el contador actual es inferior a 1.');
        }

        await db.fouls.delete(actionId);

        const newLocalFouls = isLocal ? currentLocalFouls - 1 : currentLocalFouls;
        const newVisitorFouls = !isLocal ? currentVisitorFouls - 1 : currentVisitorFouls;

        if (newLocalFouls < 0 || newVisitorFouls < 0) {
          throw new Error('Invariante violado: el contador de faltas resultante es negativo.');
        }

        await db.matches.update(matchId, {
          localFouls: newLocalFouls,
          visitorFouls: newVisitorFouls
        });

        if (_faultInjection === 'post-delete') {
          throw new Error('Fallo transaccional deliberado provocado después de la escritura parcial de falta.');
        }

        const updatedMatch = await db.matches.get(matchId);
        if (!updatedMatch) {
          throw new Error('El partido no existe tras la actualización de faltas.');
        }
        if (updatedMatch.localFouls < 0 || updatedMatch.visitorFouls < 0) {
          throw new Error('Inconsistencia posterior detectada en contador de faltas.');
        }

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
