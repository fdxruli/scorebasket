import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Match } from '../../../db/models/Match';
import type { GameResult } from '../../../db/models/MatchConfig';
import { db } from '../../../db/db';

interface UseSeriesLogicProps {
  match: Match;
}

const getSetWinnerTeamId = (match: Match, pointsPerSet: number): number | null => {
  const localScore = match.localScore || 0;
  const visitorScore = match.visitorScore || 0;
  const winByTwo = match.config.bestOf?.winByTwo ?? false;

  if (localScore >= pointsPerSet && (!winByTwo || localScore - visitorScore >= 2)) {
    return match.localTeamId;
  }
  if (visitorScore >= pointsPerSet && (!winByTwo || visitorScore - localScore >= 2)) {
    return match.visitorTeamId;
  }
  return null;
};

const buildSetResult = (match: Match, setNumber: number, winnerTeamId: number): GameResult => ({
  gameNumber: setNumber,
  localScore: match.localScore || 0,
  visitorScore: match.visitorScore || 0,
  winner: winnerTeamId === match.localTeamId ? 'local' : 'visitor',
  finishedAt: new Date()
});

const appendGameResultOnce = (history: GameResult[], entry: GameResult): GameResult[] => {
  const filtered = history.filter(item => item.gameNumber !== entry.gameNumber);
  return [...filtered, entry];
};

export const useSeriesLogic = ({ match }: UseSeriesLogicProps) => {
  // Configuración
  const maxSets = match.config.bestOf?.totalGames || 3; 
  const pointsPerSet = match.config.bestOf?.targetScorePerGame || 21;
  const winByTwo = match.config.bestOf?.winByTwo ?? false;
  const scoringSystem = match.config.bestOf?.scoringSystem || 'standard';
  
  // Estado actual de la serie desde la BD
  const localSetsWon = match.config.bestOf?.wins?.local || 0;
  const visitorSetsWon = match.config.bestOf?.wins?.visitor || 0;
  
  const setsToWin = Math.ceil(maxSets / 2);

  const [showSetEndModal, setShowSetEndModal] = useState(false);
  const [showSeriesEndModal, setShowSeriesEndModal] = useState(false);
  const [setWinnerId, setSetWinnerId] = useState<number | null>(null);

  const detectedSetWinnerId = useMemo(() => {
    return getSetWinnerTeamId(match, pointsPerSet);
  }, [match, pointsPerSet]);

  // 1. Detectar victoria de SET de forma reactiva (permite Deshacer último punto)
  useEffect(() => {
    if (match.status === 'finished') {
      setShowSetEndModal(false);
      setShowSeriesEndModal(false);
      return;
    }

    // Si la serie ya alcanzó setsToWin, mantener el modal de fin de serie
    if (localSetsWon >= setsToWin || visitorSetsWon >= setsToWin) {
      setShowSetEndModal(false);
      if (!showSeriesEndModal) setShowSeriesEndModal(true);
      return;
    }

    if (detectedSetWinnerId) {
      setSetWinnerId(detectedSetWinnerId);
      if (!showSetEndModal) setShowSetEndModal(true);
    } else {
      if (showSetEndModal) setShowSetEndModal(false);
      if (setWinnerId !== null) setSetWinnerId(null);
    }
  }, [
    match.status,
    detectedSetWinnerId,
    localSetsWon,
    visitorSetsWon,
    setsToWin,
    showSetEndModal,
    showSeriesEndModal,
    setWinnerId
  ]);

  // 2. Confirmar Fin de Set
  const confirmSetEnd = useCallback(async () => {
    if (!match?.id || !setWinnerId) return;

    const currentSetNum = match.currentQuarter || match.config.bestOf?.currentGame || 1;
    const isLocalWinner = setWinnerId === match.localTeamId;
    
    const newLocalSets = localSetsWon + (isLocalWinner ? 1 : 0);
    const newVisitorSets = visitorSetsWon + (isLocalWinner ? 0 : 1);

    const currentHistory = match.gameHistory || [];
    const updatedHistory = appendGameResultOnce(
      currentHistory,
      buildSetResult(match, currentSetNum, setWinnerId)
    );

    // Verificar si alguien ganó la SERIE
    if (newLocalSets >= setsToWin || newVisitorSets >= setsToWin) {
      setShowSetEndModal(false);
      setShowSeriesEndModal(true);
      
      await db.matches.update(match.id!, {
        'config.bestOf.wins.local': newLocalSets,
        'config.bestOf.wins.visitor': newVisitorSets,
        gameHistory: updatedHistory
      } as any);
      return;
    }

    // Si NO terminó la serie, preparamos el siguiente set
    await db.transaction('rw', db.matches, db.scores, async () => {
      await db.matches.update(match.id!, {
        'config.bestOf.wins.local': newLocalSets,
        'config.bestOf.wins.visitor': newVisitorSets,
        'config.bestOf.currentGame': currentSetNum + 1,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        currentQuarter: currentSetNum + 1,
        gameHistory: updatedHistory
      } as any);
    });

    setShowSetEndModal(false);
  }, [match, setWinnerId, localSetsWon, visitorSetsWon, setsToWin]);

  // 3. Finalizar la Serie (normal o cierre anticipado)
  const endSeries = useCallback(async () => {
    if (!match.id) return;

    await db.transaction('rw', db.matches, async () => {
      const currentMatch = await db.matches.get(match.id!);
      if (!currentMatch) return;

      const currentSetNum = currentMatch.currentQuarter || currentMatch.config.bestOf?.currentGame || 1;
      const currentHistory = currentMatch.gameHistory || [];
      let winsLocal = currentMatch.config.bestOf?.wins?.local || 0;
      let winsVisitor = currentMatch.config.bestOf?.wins?.visitor || 0;
      let updatedHistory = currentHistory;

      const localScore = currentMatch.localScore || 0;
      const visitorScore = currentMatch.visitorScore || 0;
      const setAlreadyRecorded = currentHistory.some(g => g.gameNumber === currentSetNum);
      const seriesAlreadyDecided = winsLocal >= setsToWin || winsVisitor >= setsToWin;

      // Si es cierre anticipado y el set en curso tiene ventaja no contabilizada
      if (!seriesAlreadyDecided && !setAlreadyRecorded && localScore !== visitorScore) {
        const shouldCountSet =
          (winsLocal === 0 && winsVisitor === 0) ||
          window.confirm('El set actual tiene ventaja en puntos. ¿Deseas contabilizar este set a favor del equipo en ventaja antes de cerrar la serie?');

        if (shouldCountSet) {
          const isLocalLeading = localScore > visitorScore;
          const winnerId = isLocalLeading ? currentMatch.localTeamId : currentMatch.visitorTeamId;
          winsLocal += isLocalLeading ? 1 : 0;
          winsVisitor += isLocalLeading ? 0 : 1;
          updatedHistory = appendGameResultOnce(
            currentHistory,
            buildSetResult(currentMatch, currentSetNum, winnerId)
          );
        }
      }

      await db.matches.update(currentMatch.id!, {
        status: 'finished',
        finishedAt: new Date(),
        'config.bestOf.wins.local': winsLocal,
        'config.bestOf.wins.visitor': winsVisitor,
        gameHistory: updatedHistory
      } as any);
    });
    
    setShowSeriesEndModal(false);
  }, [match.id, setsToWin]);

  return {
    currentSet: match.currentQuarter || 1,
    localSetsWon,
    visitorSetsWon,
    setsToWin,
    maxSets,
    pointsPerSet,
    winByTwo,
    scoringSystem,
    
    showSetEndModal,
    showSeriesEndModal,
    confirmSetEnd,
    endSeries,
    setWinnerId
  };
};
