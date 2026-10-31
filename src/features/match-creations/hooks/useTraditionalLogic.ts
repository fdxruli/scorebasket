import { useState, useCallback } from 'react';
import { useMatchTimer } from '../../../hooks/useMatchTimer';
import type { Match } from '../../../db/models/Match';
import { db } from '../../../db/db';

interface UseTraditionalLogicProps {
  match?: Match | null;
  /** Cuando hay un modal de acción/jugadores/historial abierto, diferimos el modal de fin de cuarto/partido */
  isActionModalOpen?: boolean;
}

/**
 * Avanza al siguiente cuarto reglamentario en modo Traditional (C-04).
 * - Incrementa currentQuarter si aún no se alcanzó totalQuarters.
 * - Reinicia timerSecondsRemaining a minutesPerQuarter * 60 y pausa el reloj (timerLastStart = undefined).
 * - Reinicia tiempos fuera (localTimeouts = 0, visitorTimeouts = 0) ÚNICAMENTE en el cambio de mitad (Q2 -> Q3).
 * - Conserva tiempos fuera en transiciones dentro de la misma mitad (ej. Q1 -> Q2, Q3 -> Q4).
 */
export async function advanceTraditionalQuarter(matchId: number): Promise<boolean> {
  return db.transaction('rw', db.matches, async () => {
    const currentMatch = await db.matches.get(matchId);
    if (!currentMatch || currentMatch.status === 'finished') {
      return false;
    }

    const quartersConfig =
      currentMatch.config?.traditional?.totalQuarters || currentMatch.totalQuarters || 4;
    const minutesPerQuarter =
      currentMatch.config?.traditional?.minutesPerQuarter || currentMatch.quarterDuration || 10;
    const currentQ = currentMatch.currentQuarter || 1;

    if (currentQ >= quartersConfig) {
      return false;
    }

    const nextQ = currentQ + 1;
    const isNewHalf = currentQ === 2 && nextQ === 3;

    await db.matches.update(matchId, {
      currentQuarter: nextQ,
      timerSecondsRemaining: minutesPerQuarter * 60, // Reiniciar tiempo en BD
      timerLastStart: undefined, // Asegurar que inicie pausado
      ...(isNewHalf ? { localTimeouts: 0, visitorTimeouts: 0 } : {})
    });

    return true;
  });
}

/**
 * Inicia un periodo de Tiempo Extra (OT) en modo Traditional (C-04).
 * - Avanza currentQuarter al siguiente periodo (quartersConfig + n).
 * - Establece timerSecondsRemaining a overtimeMinutes * 60 e inicia pausado.
 * - Reinicia los contadores de tiempos fuera (localTimeouts = 0, visitorTimeouts = 0).
 */
export async function startTraditionalOvertime(
  matchId: number,
  overtimeMinutes = 5
): Promise<boolean> {
  return db.transaction('rw', db.matches, async () => {
    const currentMatch = await db.matches.get(matchId);
    if (!currentMatch || currentMatch.status === 'finished') {
      return false;
    }

    const quartersConfig =
      currentMatch.config?.traditional?.totalQuarters || currentMatch.totalQuarters || 4;
    const nextQ = (currentMatch.currentQuarter || quartersConfig) + 1;

    await db.matches.update(matchId, {
      currentQuarter: nextQ,
      timerSecondsRemaining: overtimeMinutes * 60,
      timerLastStart: undefined, // Inicia pausado
      localTimeouts: 0,
      visitorTimeouts: 0
    });

    return true;
  });
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

  // 5. Acción: Siguiente Cuarto (invoca la función real de dominio advanceTraditionalQuarter)
  const nextQuarter = useCallback(async () => {
    if (!match?.id) return;
    const advanced = await advanceTraditionalQuarter(match.id);
    if (advanced) {
      setDismissedQuarter(null);
      setManualMatchEndModal(false);
    }
  }, [match]);

  // 6. Acción: Finalizar Partido
  const endMatch = useCallback(async () => {
    if (!match?.id) return;
    await db.matches.update(match.id, {
      status: 'finished',
      finishedAt: new Date(),
      timerLastStart: undefined
    });
    setManualMatchEndModal(false);
    setDismissedQuarter(null);
  }, [match]);

  // 7. Acción: Iniciar Tiempo Extra (OT) (invoca la función real de dominio startTraditionalOvertime)
  const startOvertime = useCallback(async (overtimeMinutes = 5) => {
    if (!match?.id) return;
    const started = await startTraditionalOvertime(match.id, overtimeMinutes);
    if (started) {
      setManualMatchEndModal(false);
      setDismissedQuarter(null);
    }
  }, [match]);

  const isTied = (match?.localScore || 0) === (match?.visitorScore || 0);

  return {
    timerDisplay: formatTime(timeLeft),
    timeLeft,
    isTimerRunning: isRunning,
    hasAuthority,
    isOwner,
    ownerTabId,
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
