import { useState, useCallback } from 'react';
import { useMatchTimer } from '../../../hooks/useMatchTimer';
import type { Match } from '../../../db/models/Match';
import { MatchTimerService, type TimerServiceOptions } from '../../../db/matchTimer.service';

interface UseTraditionalLogicProps {
  match?: Match | null;
  /** Cuando hay un modal de acción/jugadores/historial abierto, diferimos el modal de fin de cuarto/partido */
  isActionModalOpen?: boolean;
}

/**
 * Avanza al siguiente cuarto reglamentario en modo Traditional (C-04, C-13).
 * Delega en MatchTimerService.advanceQuarter para garantizar la misma autoridad transaccional y fencing.
 */
export async function advanceTraditionalQuarter(
  matchId: number,
  options?: TimerServiceOptions
): Promise<boolean> {
  const res = await MatchTimerService.advanceQuarter(matchId, options);
  return res.status === 'applied';
}

/**
 * Inicia un periodo de Tiempo Extra (OT) en modo Traditional (C-04, C-13).
 * Delega en MatchTimerService.startOvertime para garantizar la misma autoridad transaccional y fencing.
 */
export async function startTraditionalOvertime(
  matchId: number,
  overtimeMinutes = 5,
  options?: TimerServiceOptions
): Promise<boolean> {
  const res = await MatchTimerService.startOvertime(matchId, overtimeMinutes, options);
  return res.status === 'applied';
}

export const useTraditionalLogic = ({ match, isActionModalOpen = false }: UseTraditionalLogicProps) => {
  // 1. Extraer configuración con fallbacks seguros para partidos legacy
  const quartersConfig = match?.config?.traditional?.totalQuarters || match?.totalQuarters || 4;
  const currentQuarter = match?.currentQuarter || 1;
  const isFinalPeriod = currentQuarter >= quartersConfig;

  // 2. Control de estado y modales: derivado y rastreo de periodo descartado (C-09)
  const [dismissedQuarter, setDismissedQuarter] = useState<number | null>(null);
  const [manualMatchEndModal, setManualMatchEndModal] = useState(false);

  // Limpieza de estado local al cambiar el partido durante el render (You Might Not Need an Effect)
  const [prevMatchId, setPrevMatchId] = useState<number | undefined>(match?.id);
  if (match?.id !== prevMatchId) {
    setPrevMatchId(match?.id);
    setDismissedQuarter(null);
    setManualMatchEndModal(false);
  }

  // Limpieza de estado local al cambiar el cuarto durante el render
  const [prevQuarter, setPrevQuarter] = useState<number | undefined>(match?.currentQuarter);
  if (match?.currentQuarter !== prevQuarter) {
    setPrevQuarter(match?.currentQuarter);
    setDismissedQuarter(null);
    setManualMatchEndModal(false);
  }

  // 3. Timer Hook: Pasamos el OBJETO match, no los segundos.
  // El hook se encarga de calcular el tiempo restante basado en la BD y sonar la chicharra en 00:00.
  const {
    timeLeft,
    isRunning,
    hasAuthority,
    isOwner,
    ownerTabId,
    epoch,
    requestAuthorityTransfer,
    lastOperationResult,
    toggleTimer,
    resetTimer,
    adjustTime
  } = useMatchTimer(match ?? undefined);

  // Si el reloj vuelve a tener tiempo (> 0), se resetea cualquier descarte previo para permitir
  // que el modal vuelva a presentarse cuando el reloj expire en este periodo
  if (dismissedQuarter !== null && timeLeft > 0) {
    setDismissedQuarter(null);
  }

  // Helper para formato de tiempo (MM:SS)
  const formatTime = (seconds: number) => {
    const s = Math.ceil(seconds);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  // 4. Derivación puramente reactiva de la presentación de modales (C-09):
  // El aviso de expiración ocurre si el reloj llegó a 0, está detenido y el partido no ha finalizado
  const isPeriodExpired = Boolean(
    match &&
    match.status !== 'finished' &&
    timeLeft <= 0 &&
    !isRunning
  );

  const isDismissed = dismissedQuarter === currentQuarter;
  const isBlocked = isActionModalOpen;

  // Modal de fin de cuarto:
  // Visible si el periodo expiró, no es el último cuarto, no ha sido descartado para este cuarto y no hay modal de acción bloqueando
  const showQuarterEndModal = Boolean(
    isPeriodExpired &&
    !isFinalPeriod &&
    !isDismissed &&
    !isBlocked
  );

  // Modal de fin de partido:
  // Visible si el periodo expiró en último cuarto/OT (no descartado y no bloqueado) O si fue solicitado manualmente (y no bloqueado)
  const showMatchEndModal = Boolean(
    (isPeriodExpired && isFinalPeriod && !isDismissed && !isBlocked) ||
    (manualMatchEndModal && !isBlocked)
  );

  const setShowQuarterEndModal = useCallback((show: boolean) => {
    if (!show) {
      setDismissedQuarter(currentQuarter);
    } else {
      setDismissedQuarter(null);
    }
  }, [currentQuarter]);

  const setShowMatchEndModal = useCallback((show: boolean) => {
    if (show) {
      setManualMatchEndModal(true);
      setDismissedQuarter(null);
    } else {
      setManualMatchEndModal(false);
      setDismissedQuarter(currentQuarter);
    }
  }, [currentQuarter]);

  // 5. Acción: Siguiente Cuarto con autoridad (C-13)
  const nextQuarter = useCallback(async () => {
    if (!match?.id || !hasAuthority) return;
    const advanced = await advanceTraditionalQuarter(match.id, {
      epoch,
      expectedQuarter: currentQuarter
    });
    if (advanced) {
      setDismissedQuarter(null);
      setManualMatchEndModal(false);
    }
  }, [match, hasAuthority, epoch, currentQuarter]);

  // 6. Acción: Finalizar Partido con autoridad y fencing transaccional (C-13, C-19)
  const endMatch = useCallback(async () => {
    if (!match?.id || !hasAuthority) return;
    const res = await MatchTimerService.endMatch(match.id, {
      epoch,
      expectedQuarter: currentQuarter
    });
    if (res.status === 'applied' || res.status === 'already_applied') {
      setManualMatchEndModal(false);
      setDismissedQuarter(null);
    }
  }, [match, hasAuthority, epoch, currentQuarter]);

  // 7. Acción: Iniciar Tiempo Extra (OT) con autoridad (C-13)
  const startOvertime = useCallback(async (overtimeMinutes = 5) => {
    if (!match?.id || !hasAuthority) return;
    const started = await startTraditionalOvertime(match.id, overtimeMinutes, {
      epoch,
      expectedQuarter: currentQuarter
    });
    if (started) {
      setManualMatchEndModal(false);
      setDismissedQuarter(null);
    }
  }, [match, hasAuthority, epoch, currentQuarter]);

  const isTied = (match?.localScore || 0) === (match?.visitorScore || 0);

  return {
    timerDisplay: formatTime(timeLeft),
    timeLeft,
    isTimerRunning: isRunning,
    hasAuthority,
    isOwner,
    ownerTabId,
    epoch,
    requestAuthorityTransfer,
    lastOperationResult,
    toggleTimer,
    resetCurrentQuarter: resetTimer,
    adjustTime,

    currentQuarter,
    totalQuarters: quartersConfig,
    nextQuarter,
    endMatch,
    startOvertime,
    isTied,

    showQuarterEndModal,
    setShowQuarterEndModal,
    showMatchEndModal,
    setShowMatchEndModal
  };
};
