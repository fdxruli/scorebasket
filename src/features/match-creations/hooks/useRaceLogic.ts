import { useState, useCallback, useMemo } from 'react';
import type { Match } from '../../../db/models/Match';
import type { GameResult } from '../../../db/models/MatchConfig';
import { db } from '../../../db/db';
import { calculateRaceWinner, resolveRaceGameResult } from '../../../utils/raceLogicHelpers';

interface UseRaceLogicProps {
  match?: Match | null;
}

const getRaceWinnerTeamId = (match: Match, targetScore: number): number | null => {
  const localScore = match.localScore || 0;
  const visitorScore = match.visitorScore || 0;
  const winByTwo = match.config?.race?.winByTwo ?? false;

  const winnerSide = calculateRaceWinner(localScore, visitorScore, targetScore, winByTwo);
  if (winnerSide === 'local') return match.localTeamId;
  if (winnerSide === 'visitor') return match.visitorTeamId;
  return null;
};

const buildGameResult = (
  match: Match,
  gameNumber: number,
  winner: 'local' | 'visitor' | 'tie'
): GameResult => ({
  gameNumber,
  localScore: match.localScore || 0,
  visitorScore: match.visitorScore || 0,
  winner,
  finishedAt: new Date()
});

const appendGameResultOnce = (history: GameResult[], entry: GameResult): GameResult[] => {
  const alreadyExists = history.some(item => item.gameNumber === entry.gameNumber);
  return alreadyExists ? history : [...history, entry];
};

export const useRaceLogic = ({ match }: UseRaceLogicProps) => {
  const targetScore = match?.config?.race?.targetScore || 21;
  const hasRematches = match?.config?.race?.hasRematches || false;
  const winByTwo = match?.config?.race?.winByTwo ?? false;
  const scoringSystem = match?.config?.race?.scoringSystem || 'standard';

  // 1. Derivar el ganador reglamentario directamente de los datos visibles.
  const winnerTeamId = useMemo(() => {
    if (!match) return null;
    return getRaceWinnerTeamId(match, targetScore);
  }, [match, targetScore]);

  // 2. Control de visibilidad del modal: puramente derivado, sin efectos ni setState en useEffect
  const [dismissedWinnerId, setDismissedWinnerId] = useState<number | null>(null);

  const showMatchEndModal = Boolean(
    match &&
    match.status !== 'finished' &&
    winnerTeamId &&
    winnerTeamId !== dismissedWinnerId
  );

  const setShowMatchEndModal = useCallback((show: boolean) => {
    if (!show) {
      setDismissedWinnerId(winnerTeamId);
    } else {
      setDismissedWinnerId(null);
    }
  }, [winnerTeamId]);

  // Acción 1: Finalizar Partido
  const endMatch = useCallback(async () => {
    if (!match?.id) return;

    await db.transaction('rw', db.matches, async () => {
      const currentMatch = await db.matches.get(match.id!);
      if (!currentMatch) return;

      const currentTargetScore = currentMatch.config?.race?.targetScore || targetScore;
      const currentWinByTwo = currentMatch.config?.race?.winByTwo ?? winByTwo;
      const currentGameNumber = currentMatch.config?.race?.currentGame || 1;
      const currentHistory = currentMatch.gameHistory || [];

      const localScore = currentMatch.localScore || 0;
      const visitorScore = currentMatch.visitorScore || 0;

      let gameHistory = currentHistory;
      const alreadyRecorded = currentHistory.some(g => g.gameNumber === currentGameNumber);

      if (!alreadyRecorded) {
        // Resolver el resultado del juego actual:
        // Si no llegó a la meta, se trata como cierre anticipado con ventaja o empate.
        const gameOutcome = resolveRaceGameResult(
          localScore,
          visitorScore,
          currentTargetScore,
          currentWinByTwo,
          true // isFinishedOrClosed
        );

        if (gameOutcome !== 'unresolved') {
          // Si es 0-0 y ya había juegos previos, no agregar un juego vacío fantasma
          const isUntouchedAfterRematch = localScore === 0 && visitorScore === 0 && currentHistory.length > 0;
          if (!isUntouchedAfterRematch) {
            gameHistory = appendGameResultOnce(
              currentHistory,
              buildGameResult(currentMatch, currentGameNumber, gameOutcome)
            );
          }
        }
      }

      const updates: Partial<Match> = {
        status: 'finished',
        finishedAt: new Date(),
        gameHistory
      };

      await db.matches.update(currentMatch.id!, updates);
    });
  }, [match, targetScore, winByTwo]);

  // Acción 2: Revancha / Dar Vuelta
  const handleRematch = useCallback(async () => {
    if (!match?.id) return;

    await db.transaction('rw', db.matches, async () => {
      const currentMatch = await db.matches.get(match.id!);
      if (!currentMatch) return;

      const currentTargetScore = currentMatch.config?.race?.targetScore || targetScore;
      const currentWinnerTeamId = getRaceWinnerTeamId(currentMatch, currentTargetScore);
      if (!currentWinnerTeamId) return;

      const currentGameNumber = currentMatch.config?.race?.currentGame || 1;
      const currentHistory = currentMatch.gameHistory || [];
      const winnerSide = currentWinnerTeamId === currentMatch.localTeamId ? 'local' : 'visitor';
      const gameHistory = appendGameResultOnce(
        currentHistory,
        buildGameResult(currentMatch, currentGameNumber, winnerSide)
      );

      await db.matches.update(currentMatch.id!, {
        localScore: 0, // Reiniciar scores cierra el modal automáticamente (winnerTeamId será null)
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory,
        config: {
          ...currentMatch.config,
          race: {
            ...currentMatch.config.race!,
            currentGame: currentGameNumber + 1
          }
        }
      });
    });
  }, [match, targetScore]);

  return {
    targetScore,
    hasRematches,
    winByTwo,
    scoringSystem,
    showMatchEndModal,
    setShowMatchEndModal,
    endMatch,
    handleRematch,
    winnerTeamId,
    localProgress: Math.min(100, (((match?.localScore || 0) / targetScore) * 100)),
    visitorProgress: Math.min(100, (((match?.visitorScore || 0) / targetScore) * 100)),
  };
};
