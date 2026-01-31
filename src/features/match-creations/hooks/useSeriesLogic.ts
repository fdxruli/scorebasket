import { useState, useEffect, useCallback } from 'react';
import type { Match } from '../../../db/models/Match';
import { db } from '../../../db/db';

interface UseSeriesLogicProps {
  match: Match;
}

export const useSeriesLogic = ({ match }: UseSeriesLogicProps) => {
  // Configuración
  const maxSets = match.config.bestOf?.totalGames || 3; 
  const pointsPerSet = match.config.bestOf?.targetScorePerGame || 21;
  
  // Estado actual de la serie desde la BD
  const localSetsWon = match.config.bestOf?.wins?.local || 0;
  const visitorSetsWon = match.config.bestOf?.wins?.visitor || 0;
  
  const setsToWin = Math.ceil(maxSets / 2);

  const [showSetEndModal, setShowSetEndModal] = useState(false);
  const [showSeriesEndModal, setShowSeriesEndModal] = useState(false);
  const [setWinnerId, setSetWinnerId] = useState<number | null>(null);

  // 1. Detectar victoria de SET
  useEffect(() => {
    if (match.status === 'finished') return;

    if ((match.localScore || 0) >= pointsPerSet) {
      handleSetWin(match.localTeamId);
    } else if ((match.visitorScore || 0) >= pointsPerSet) {
      handleSetWin(match.visitorTeamId);
    }
  }, [match.localScore, match.visitorScore, pointsPerSet, match.status, match.localTeamId, match.visitorTeamId]);

  const handleSetWin = (winnerId: number) => {
    if (showSetEndModal || showSeriesEndModal) return;
    setSetWinnerId(winnerId);
    setShowSetEndModal(true);
  };

  // 2. Confirmar Fin de Set
  const confirmSetEnd = useCallback(async () => {
    if (!match || !setWinnerId) return;

    const isLocalWinner = setWinnerId === match.localTeamId;
    
    const newLocalSets = localSetsWon + (isLocalWinner ? 1 : 0);
    const newVisitorSets = visitorSetsWon + (isLocalWinner ? 0 : 1);

    // Verificar si alguien ganó la SERIE
    if (newLocalSets >= setsToWin || newVisitorSets >= setsToWin) {
      setShowSetEndModal(false);
      setShowSeriesEndModal(true);
      
      // Actualizamos solo los contadores finales
      // SOLUCIÓN: Usamos 'as any' para permitir las claves con notación de punto
      await db.matches.update(match.id!, {
        'config.bestOf.wins.local': newLocalSets,
        'config.bestOf.wins.visitor': newVisitorSets,
      } as any);
      return;
    }

    // Si NO terminó la serie, preparamos el siguiente set
    await db.transaction('rw', db.matches, db.scores, async () => {
      await db.matches.update(match.id!, {
        // Actualizamos wins
        'config.bestOf.wins.local': newLocalSets,
        'config.bestOf.wins.visitor': newVisitorSets,
        // Reseteamos puntos para el nuevo set
        localScore: 0,
        visitorScore: 0,
        // Usamos quarter como contador de set actual
        currentQuarter: (match.currentQuarter || 1) + 1
      } as any);
    });

    setShowSetEndModal(false);
  }, [match, setWinnerId, localSetsWon, visitorSetsWon, setsToWin]);

  // 3. Finalizar la Serie
  const endSeries = useCallback(async () => {
    await db.matches.update(match.id!, {
      status: 'finished',
      finishedAt: new Date(),
    } as any); // Agregamos 'as any' por seguridad si hay campos opcionales
    
    setShowSeriesEndModal(false);
  }, [match.id]);

  return {
    currentSet: match.currentQuarter || 1,
    localSetsWon,
    visitorSetsWon,
    setsToWin,
    pointsPerSet,
    
    showSetEndModal,
    showSeriesEndModal,
    confirmSetEnd,
    endSeries,
    setWinnerId
  };
};