import { useState, useEffect, useCallback } from 'react';
import type { Match } from '../../../db/models/Match';
import { db } from '../../../db/db';

interface UseRaceLogicProps {
  match: Match;
}

export const useRaceLogic = ({ match }: UseRaceLogicProps) => {
  const targetScore = match.config.race?.targetScore || 21;

  const [showMatchEndModal, setShowMatchEndModal] = useState(false);
  const [winnerTeamId, setWinnerTeamId] = useState<number | null>(null);

  // Efecto: Verificar victoria
  useEffect(() => {
    if (match.status === 'finished') return;

    if ((match.localScore || 0) >= targetScore) {
      setWinnerTeamId(match.localTeamId);
      setShowMatchEndModal(true);
    } else if ((match.visitorScore || 0) >= targetScore) {
      setWinnerTeamId(match.visitorTeamId);
      setShowMatchEndModal(true);
    }
  }, [match.localScore, match.visitorScore, targetScore, match.status, match.localTeamId, match.visitorTeamId]);

  // Acción: Finalizar Partido
  const endMatch = useCallback(async () => {
    await db.matches.update(match.id!, {
      status: 'finished',
      finishedAt: new Date(),
      // winnerTeamId se guarda aunque no esté en la interfaz estricta,
      // Dexie lo permite. Si TS se queja, agrega 'as any' o actualiza el modelo.
      winnerTeamId: winnerTeamId || undefined
    } as any);
    
    setShowMatchEndModal(false);
  }, [match.id, winnerTeamId]);

  return {
    targetScore,
    showMatchEndModal,
    setShowMatchEndModal,
    endMatch,
    winnerTeamId,
    localProgress: Math.min(100, ((match.localScore || 0) / targetScore) * 100),
    visitorProgress: Math.min(100, ((match.visitorScore || 0) / targetScore) * 100),
  };
};