import { useState, useEffect, useCallback, useRef } from 'react';
import { useMatchTimer } from '../../../hooks/useMatchTimer';
import type { Match } from '../../../db/models/Match';
import { db } from '../../../db/db';

interface UseTraditionalLogicProps {
  match: Match;
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
  const quartersConfig = match.config?.traditional?.totalQuarters || match.totalQuarters || 4;

  // 2. Estado local para modales
  const [showQuarterEndModal, setShowQuarterEndModal] = useState(false);
  const [showMatchEndModal, setShowMatchEndModal] = useState(false);
  const zeroHandledQuarterRef = useRef<number | null>(null);

  // 3. Timer Hook: Pasamos el OBJETO match, no los segundos.
  // El hook se encarga de calcular el tiempo restante basado en la BD y sonar la chicharra en 00:00.
  const { timeLeft, isRunning, toggleTimer, resetTimer, adjustTime } = useMatchTimer(match);

  // Helper para formato de tiempo (MM:SS)
  const formatTime = (seconds: number) => {
    const s = Math.ceil(seconds);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const handleTimerZero = useCallback(() => {
    const currentQ = match.currentQuarter || 1;

    // Si estamos en el último cuarto (o más), es fin de partido.
    if (currentQ >= quartersConfig) {
      setShowMatchEndModal(true);
    } else {
      setShowQuarterEndModal(true);
    }
  }, [match.currentQuarter, quartersConfig]);

  // 4. Efecto: Detectar cuando el reloj llega a cero (diferido si hay un modal de acción en curso)
  useEffect(() => {
    const currentQ = match.currentQuarter || 1;

    if (timeLeft > 0) {
      zeroHandledQuarterRef.current = null;
      return;
    }

    // Si el tiempo se acabó, no está corriendo y el partido no ha terminado...
    if (timeLeft <= 0 && !isRunning && match.status !== 'finished') {
      // Si el usuario tiene abierto PlayerSelectModal, LivePlayersModal o LiveMatchHistoryModal,
      // NO abrimos el modal de fin de periodo todavía; esperamos a que termine su acción.
      if (isActionModalOpen) {
        return;
      }

      if (zeroHandledQuarterRef.current !== currentQ && !showQuarterEndModal && !showMatchEndModal) {
        zeroHandledQuarterRef.current = currentQ;
        const timerId = window.setTimeout(() => {
          handleTimerZero();
        }, 0);
        return () => window.clearTimeout(timerId);
      }
    }
  }, [
    timeLeft,
    isRunning,
    match.status,
    match.currentQuarter,
    showQuarterEndModal,
    showMatchEndModal,
    handleTimerZero,
    isActionModalOpen
  ]);

  // 5. Acción: Siguiente Cuarto (invoca la función real de dominio advanceTraditionalQuarter)
  const nextQuarter = useCallback(async () => {
    if (!match.id) return;
    const advanced = await advanceTraditionalQuarter(match.id);
    if (advanced) {
      setShowQuarterEndModal(false);
    }
  }, [match.id]);

  // 6. Acción: Finalizar Partido
  const endMatch = useCallback(async () => {
    await db.matches.update(match.id!, {
      status: 'finished',
      finishedAt: new Date(),
      timerLastStart: undefined
    });
    setShowMatchEndModal(false);
    setShowQuarterEndModal(false);
  }, [match.id]);

  // 7. Acción: Iniciar Tiempo Extra (OT) (invoca la función real de dominio startTraditionalOvertime)
  const startOvertime = useCallback(async (overtimeMinutes = 5) => {
    if (!match.id) return;
    const started = await startTraditionalOvertime(match.id, overtimeMinutes);
    if (started) {
      setShowMatchEndModal(false);
      setShowQuarterEndModal(false);
    }
  }, [match.id]);

  const isTied = (match.localScore || 0) === (match.visitorScore || 0);

  return {
    timerDisplay: formatTime(timeLeft),
    timeLeft,
    isTimerRunning: isRunning,
    toggleTimer,
    resetCurrentQuarter: resetTimer,
    adjustTime,

    currentQuarter: match.currentQuarter || 1,
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
