// src/features/match-creations/hooks/useGameActions.ts

import { useCallback } from 'react';
import { db } from '../../../db/db';
// CORRECCIÓN 1: Ajuste de ruta considerando la carpeta actual 'componets'
import { useLiveMatch } from '../componets/context/LiveMatchContext'; 
// CORRECCIÓN 2: Importación limpia desde el índice de modelos
import type { Score, Foul } from '../../../db/models'; 

export const useGameActions = () => {
  const { match, localTeam, visitorTeam } = useLiveMatch();

  // Helper para identificar si el equipo es local
  const isLocal = useCallback((teamId: number) => {
    return match?.localTeamId === teamId;
  }, [match]);

  /**
   * Acción: Agregar Puntos
   */
  const addScore = useCallback(async (teamId: number, points: number, playerId?: number) => {
    if (!match) return;

    const isLocalTeam = isLocal(teamId);
    
    // Eliminamos el try/catch interno para que el error suba al componente 
    // y puedas usar tu ErrorToast.tsx allí.
    await db.transaction('rw', db.matches, db.scores, async () => {
        
      const newScore: Omit<Score, 'id'> = {
        matchId: match.id!,
        teamId,
        playerId,
        points: points as 1 | 2 | 3,
        quarter: match.currentQuarter || 1,
        // CORRECCIÓN 3: Usar 'createdAt' en lugar de 'timestamp' según tu modelo
        createdAt: new Date(), 
      };

      await db.scores.add(newScore as Score);

      // Actualizar marcador en el objeto Match (para reactividad inmediata)
      const updateData = isLocalTeam
        ? { localScore: (match.localScore || 0) + points }
        : { visitorScore: (match.visitorScore || 0) + points };

      await db.matches.update(match.id!, updateData);
    });
  }, [match, isLocal]);

  /**
   * Acción: Agregar Falta
   */
  const addFoul = useCallback(async (teamId: number, playerId?: number) => {
    if (!match) return;

    const isLocalTeam = isLocal(teamId);

    await db.transaction('rw', db.matches, db.fouls, async () => {
      const newFoul: Omit<Foul, 'id'> = {
        matchId: match.id!,
        teamId,
        playerId,
        quarter: match.currentQuarter || 1,
        createdAt: new Date(),
      };

      await db.fouls.add(newFoul as Foul);

      // Actualizar contador de faltas en Match
      const updateData = isLocalTeam
        ? { localFouls: (match.localFouls || 0) + 1 }
        : { visitorFouls: (match.visitorFouls || 0) + 1 };
        
      await db.matches.update(match.id!, updateData);
    });
  }, [match, isLocal]);

  /**
   * Acción: Deshacer (Undo)
   */
  const undoLastAction = useCallback(async () => {
    if (!match) return;

    await db.transaction('rw', db.matches, db.scores, db.fouls, async () => {
      // Buscar la última anotación
      const lastScore = await db.scores
        .where('matchId').equals(match.id!)
        .reverse()
        .sortBy('createdAt')
        .then(r => r[0]);

      // Buscar la última falta
      const lastFoul = await db.fouls
        .where('matchId').equals(match.id!)
        .reverse()
        .sortBy('createdAt')
        .then(r => r[0]);

      if (!lastScore && !lastFoul) {
        throw new Error("No hay acciones para deshacer");
      }

      // Comparar fechas para ver cuál fue la última
      const lastScoreTime = lastScore?.createdAt.getTime() || 0;
      const lastFoulTime = lastFoul?.createdAt.getTime() || 0;

      if (lastScoreTime > lastFoulTime) {
        // Deshacer Puntos
        if (lastScore) {
          await db.scores.delete(lastScore.id!);
          
          const isLocalTeam = isLocal(lastScore.teamId);
          const currentTotal = isLocalTeam ? match.localScore : match.visitorScore;
          
          const updateData = isLocalTeam
            ? { localScore: Math.max(0, currentTotal - lastScore.points) }
            : { visitorScore: Math.max(0, (match.visitorScore || 0) - lastScore.points) };
            
          await db.matches.update(match.id!, updateData);
        }
      } else {
        // Deshacer Falta
        if (lastFoul) {
          await db.fouls.delete(lastFoul.id!);

          const isLocalTeam = isLocal(lastFoul.teamId);
          const currentTotal = isLocalTeam ? match.localFouls : match.visitorFouls;

          const updateData = isLocalTeam
            ? { localFouls: Math.max(0, currentTotal - 1) }
            : { visitorFouls: Math.max(0, (match.visitorFouls || 0) - 1) };

          await db.matches.update(match.id!, updateData);
        }
      }
    });
  }, [match, isLocal]);

  return {
    addScore,
    addFoul,
    undoLastAction,
    isLocal,
    localTeam,
    visitorTeam
  };
};