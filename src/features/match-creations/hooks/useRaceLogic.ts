import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Match } from '../../../db/models/Match';
import { db } from '../../../db/db';

interface UseRaceLogicProps {
  match: Match;
}

export const useRaceLogic = ({ match }: UseRaceLogicProps) => {
  const targetScore = match.config.race?.targetScore || 21;
  const hasRematches = match.config.race?.hasRematches || false;

  const [showMatchEndModal, setShowMatchEndModal] = useState(false);

  // 1. MEJORA: Derivar el ganador directamente de los datos, sin useEffect ni useState extra.
  // Esto evita re-renderizados innecesarios y condiciones de carrera (race conditions).
  const winnerTeamId = useMemo(() => {
    const localScore = match.localScore || 0;
    const visitorScore = match.visitorScore || 0;
    
    if (localScore >= targetScore) return match.localTeamId;
    if (visitorScore >= targetScore) return match.visitorTeamId;
    return null;
  }, [match.localScore, match.visitorScore, targetScore, match.localTeamId, match.visitorTeamId]);

  // 2. EFECTO UNIFICADO: Controla la visibilidad del modal
  useEffect(() => {
    // Si el partido ya terminó (status 'finished'), el modal debe estar CERRADO.
    if (match.status === 'finished') {
      setShowMatchEndModal(false);
      return;
    }

    // Si hay un ganador (y el partido sigue activo), ABRIR modal.
    if (winnerTeamId) {
      if (!showMatchEndModal) setShowMatchEndModal(true);
    } else {
      // Si NO hay ganador (ej: se dio vuelta a los scores), CERRAR modal.
      if (showMatchEndModal) setShowMatchEndModal(false);
    }
  }, [match.status, winnerTeamId, showMatchEndModal]);

  // Acción 1: Finalizar Partido
  const endMatch = useCallback(async () => {
    if (!match.id) return;
    
    await db.matches.update(match.id, {
      status: 'finished',
      finishedAt: new Date(),
      winnerTeamId: winnerTeamId || undefined
    } as any);
    // Nota: No cerramos el modal aquí; el useEffect lo hará al detectar el cambio de status,
    // y el componente Engine redirigirá al usuario.
  }, [match.id, winnerTeamId]);

  // Acción 2: Revancha / Dar Vuelta
  const handleRematch = useCallback(async () => {
    if (!match.id || !winnerTeamId) return;

    const currentGameNumber = match.config.race?.currentGame || 1;
    const newHistoryEntry = {
      gameNumber: currentGameNumber,
      localScore: match.localScore,
      visitorScore: match.visitorScore,
      winner: winnerTeamId === match.localTeamId ? 'local' : 'visitor',
      finishedAt: new Date()
    };

    const currentHistory = match.gameHistory || [];

    await db.transaction('rw', db.matches, async () => {
      await db.matches.update(match.id!, {
        localScore: 0, // Reiniciar scores cierra el modal automáticamente (winnerTeamId será null)
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        'config.race.currentGame': currentGameNumber + 1,
        gameHistory: [...currentHistory, newHistoryEntry]
      } as any);
    });
  }, [match, winnerTeamId]);

  return {
    targetScore,
    hasRematches,
    showMatchEndModal,
    setShowMatchEndModal,
    endMatch,
    handleRematch,
    winnerTeamId, // Retornamos el valor derivado
    localProgress: Math.min(100, ((match.localScore || 0) / targetScore) * 100),
    visitorProgress: Math.min(100, ((match.visitorScore || 0) / targetScore) * 100),
  };
};