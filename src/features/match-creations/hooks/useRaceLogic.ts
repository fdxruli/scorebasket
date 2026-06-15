import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Match } from '../../../db/models/Match';
import type { GameResult } from '../../../db/models/MatchConfig';
import { db } from '../../../db/db';

interface UseRaceLogicProps {
  match: Match;
}

const getRaceWinnerTeamId = (match: Match, targetScore: number): number | null => {
  const localScore = match.localScore || 0;
  const visitorScore = match.visitorScore || 0;

  if (localScore >= targetScore) return match.localTeamId;
  if (visitorScore >= targetScore) return match.visitorTeamId;
  return null;
};

const buildGameResult = (match: Match, gameNumber: number, winnerTeamId: number): GameResult => ({
  gameNumber,
  localScore: match.localScore || 0,
  visitorScore: match.visitorScore || 0,
  winner: winnerTeamId === match.localTeamId ? 'local' : 'visitor',
  finishedAt: new Date()
});

const appendGameResultOnce = (history: GameResult[], entry: GameResult): GameResult[] => {
  const alreadyExists = history.some(item => item.gameNumber === entry.gameNumber);
  return alreadyExists ? history : [...history, entry];
};

export const useRaceLogic = ({ match }: UseRaceLogicProps) => {
  const targetScore = match.config.race?.targetScore || 21;
  const hasRematches = match.config.race?.hasRematches || false;

  const [showMatchEndModal, setShowMatchEndModal] = useState(false);

  // 1. Derivar el ganador directamente de los datos visibles.
  const winnerTeamId = useMemo(() => {
    return getRaceWinnerTeamId(match, targetScore);
  }, [match, targetScore]);

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
    
    await db.transaction('rw', db.matches, async () => {
      const currentMatch = await db.matches.get(match.id!);
      if (!currentMatch) return;

      const currentTargetScore = currentMatch.config?.race?.targetScore || targetScore;
      const currentWinnerTeamId = getRaceWinnerTeamId(currentMatch, currentTargetScore);
      const currentGameNumber = currentMatch.config?.race?.currentGame || 1;
      const currentHistory = currentMatch.gameHistory || [];

      const gameHistory = currentWinnerTeamId
        ? appendGameResultOnce(
            currentHistory,
            buildGameResult(currentMatch, currentGameNumber, currentWinnerTeamId)
          )
        : currentHistory;

      await db.matches.update(currentMatch.id!, {
        status: 'finished',
        finishedAt: new Date(),
        winnerTeamId: currentWinnerTeamId || undefined,
        gameHistory
      } as any);
    });
    // Nota: No cerramos el modal aquí; el useEffect lo hará al detectar el cambio de status,
    // y el componente Engine redirigirá al usuario.
  }, [match.id, targetScore]);

  // Acción 2: Revancha / Dar Vuelta
  const handleRematch = useCallback(async () => {
    if (!match.id) return;

    await db.transaction('rw', db.matches, async () => {
      const currentMatch = await db.matches.get(match.id!);
      if (!currentMatch) return;

      const currentTargetScore = currentMatch.config?.race?.targetScore || targetScore;
      const currentWinnerTeamId = getRaceWinnerTeamId(currentMatch, currentTargetScore);
      if (!currentWinnerTeamId) return;

      const currentGameNumber = currentMatch.config?.race?.currentGame || 1;
      const currentHistory = currentMatch.gameHistory || [];
      const gameHistory = appendGameResultOnce(
        currentHistory,
        buildGameResult(currentMatch, currentGameNumber, currentWinnerTeamId)
      );

      await db.matches.update(currentMatch.id!, {
        localScore: 0, // Reiniciar scores cierra el modal automáticamente (winnerTeamId será null)
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        'config.race.currentGame': currentGameNumber + 1,
        gameHistory
      } as any);
    });
  }, [match.id, targetScore]);

  return {
    targetScore,
    hasRematches,
    showMatchEndModal,
    setShowMatchEndModal,
    endMatch,
    handleRematch,
    winnerTeamId,
    localProgress: Math.min(100, ((match.localScore || 0) / targetScore) * 100),
    visitorProgress: Math.min(100, ((match.visitorScore || 0) / targetScore) * 100),
  };
};