import { useState, useEffect, useCallback, useRef } from 'react';
import { useMatchTimer } from '../../../hooks/useMatchTimer';
import type { Match } from '../../../db/models/Match';
import { db } from '../../../db/db';

interface UseTraditionalLogicProps {
  match: Match;
  /** Cuando hay un modal de acción/jugadores/historial abierto, diferimos el modal de fin de cuarto/partido */
  isActionModalOpen?: boolean;
}

export const useTraditionalLogic = ({ match, isActionModalOpen = false }: UseTraditionalLogicProps) => {
  // 1. Extraer configuración con fallbacks seguros para partidos legacy
  const quartersConfig = match.config?.traditional?.totalQuarters || match.totalQuarters || 4;
  const minutesPerQuarter = match.config?.traditional?.minutesPerQuarter || match.quarterDuration || 10;

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
        handleTimerZero();
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

  // 5. Acción: Siguiente Cuarto
  const nextQuarter = useCallback(async () => {
    const currentQ = match.currentQuarter || 1;

    if (currentQ < quartersConfig) {
      const nextQ = currentQ + 1;
      const isNewHalf = currentQ === 2 && nextQ === 3;

      await db.matches.update(match.id!, {
        currentQuarter: nextQ,
        timerSecondsRemaining: minutesPerQuarter * 60, // Reiniciar tiempo en BD
        timerLastStart: undefined, // Asegurar que inicie pausado
        ...(isNewHalf ? { localTimeouts: 0, visitorTimeouts: 0 } : {})
      });
      setShowQuarterEndModal(false);
    }
  }, [match, quartersConfig, minutesPerQuarter]);

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

  // 7. Acción: Iniciar Tiempo Extra (OT). Cada OT es un periodo adicional (quartersConfig + n).
  const startOvertime = useCallback(async (overtimeMinutes = 5) => {
    await db.matches.update(match.id!, {
      currentQuarter: (match.currentQuarter || quartersConfig) + 1,
      timerSecondsRemaining: overtimeMinutes * 60,
      timerLastStart: undefined, // Inicia pausado
      localTimeouts: 0,
      visitorTimeouts: 0
    });
    setShowMatchEndModal(false);
    setShowQuarterEndModal(false);
  }, [match.id, match.currentQuarter, quartersConfig]);

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
