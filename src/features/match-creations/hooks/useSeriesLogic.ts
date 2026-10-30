// src/features/match-creations/hooks/useSeriesLogic.ts
import { useState, useCallback, useMemo, useRef } from 'react';
import type { Match } from '../../../db/models/Match';
import { SeriesService } from '../../../db/series.service';
import {
  getSetWinnerTeamId,
  calculateSetsToWin,
} from '../../../utils/seriesLogicHelpers';

interface UseSeriesLogicProps {
  match: Match;
}

export const useSeriesLogic = ({ match }: UseSeriesLogicProps) => {
  // Configuración
  const maxSets = match.config.bestOf?.totalGames || 3;
  const pointsPerSet = match.config.bestOf?.targetScorePerGame || 21;
  const winByTwo = match.config.bestOf?.winByTwo ?? false;
  const scoringSystem = match.config.bestOf?.scoringSystem || 'standard';

  // Estado actual de la serie desde la BD
  const localSetsWon = match.config.bestOf?.wins?.local || 0;
  const visitorSetsWon = match.config.bestOf?.wins?.visitor || 0;
  const setsToWin = calculateSetsToWin(maxSets);

  // Protección inmediata de doble clic (sin depender de renders asíncronos)
  const isSubmittingRef = useRef<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dismissedSeriesModal, setDismissedSeriesModal] = useState<boolean>(false);

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  // Ganador reglamentario derivado de forma reactiva de los puntos visibles
  const detectedSetWinnerId = useMemo(() => {
    return getSetWinnerTeamId(match, pointsPerSet);
  }, [match, pointsPerSet]);

  const isSeriesOver =
    match.status === 'finished' ||
    localSetsWon >= setsToWin ||
    visitorSetsWon >= setsToWin;

  // Derivación directa y pura de la visibilidad de los modales (sin setState en useEffect)
  const showSetEndModal = !isSeriesOver && detectedSetWinnerId !== null;
  const showSeriesEndModal = isSeriesOver && !dismissedSeriesModal;
  const setWinnerId = detectedSetWinnerId;

  // 1. Confirmar Fin de Set mediante servicio de dominio
  const confirmSetEnd = useCallback(async () => {
    if (!match?.id || isSubmittingRef.current) return;

    const winnerId = detectedSetWinnerId;
    if (!winnerId) return;

    const currentSetNum = match.currentQuarter || match.config.bestOf?.currentGame || 1;

    isSubmittingRef.current = true;
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const result = await SeriesService.confirmSet({
        matchId: match.id,
        setNumber: currentSetNum,
        expectedWinnerId: winnerId,
        expectedScore: {
          local: match.localScore || 0,
          visitor: match.visitorScore || 0,
        },
      });

      if (result.status === 'rejected') {
        console.error('Error al confirmar set:', result.reason);
        setErrorMessage(result.reason);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Excepción al confirmar set:', err);
      setErrorMessage(msg);
    } finally {
      isSubmittingRef.current = false;
      setIsProcessing(false);
    }
  }, [
    match?.id,
    match?.currentQuarter,
    match?.config.bestOf?.currentGame,
    match?.localScore,
    match?.visitorScore,
    detectedSetWinnerId,
  ]);

  // 2. Finalizar la Serie (cierre anticipado o confirmación final)
  const endSeries = useCallback(
    async (options?: { countCurrentSet?: boolean }) => {
      if (!match?.id || isSubmittingRef.current) return;

      isSubmittingRef.current = true;
      setIsProcessing(true);
      setErrorMessage(null);

      try {
        if (match.status === 'finished') {
          return;
        }

        const countCurrentSet = options?.countCurrentSet ?? false;
        const result = await SeriesService.finishSeriesEarly({
          matchId: match.id,
          countCurrentSet,
        });

        if (result.status === 'rejected') {
          console.error('Error al finalizar serie:', result.reason);
          setErrorMessage(result.reason);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Excepción al finalizar serie:', err);
        setErrorMessage(msg);
      } finally {
        isSubmittingRef.current = false;
        setIsProcessing(false);
      }
    },
    [match?.id, match?.status]
  );

  return {
    currentSet: match.currentQuarter || match.config.bestOf?.currentGame || 1,
    localSetsWon,
    visitorSetsWon,
    setsToWin,
    maxSets,
    pointsPerSet,
    winByTwo,
    scoringSystem,

    showSetEndModal,
    showSeriesEndModal,
    dismissSeriesEndModal: () => setDismissedSeriesModal(true),
    confirmSetEnd,
    endSeries,
    setWinnerId,
    isProcessing,
    errorMessage,
    clearError,
  };
};
