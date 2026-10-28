import { useState, useEffect, useCallback, useRef } from 'react';
import { useMatchTimer } from '../../../hooks/useMatchTimer';
import type { Match } from '../../../db/models/Match';
import { db } from '../../../db/db';

interface UseTraditionalLogicProps {
  match: Match;
}

export const useTraditionalLogic = ({ match }: UseTraditionalLogicProps) => {
  // 1. Extraer configuración con fallbacks seguros para partidos legacy
  const quartersConfig = match.config?.traditional?.totalQuarters || match.totalQuarters || 4;
  const minutesPerQuarter = match.config?.traditional?.minutesPerQuarter || match.quarterDuration || 10;
  
  // 2. Estado local para modales
  const [showQuarterEndModal, setShowQuarterEndModal] = useState(false);
  const [showMatchEndModal, setShowMatchEndModal] = useState(false);
  const zeroHandledQuarterRef = useRef<number | null>(null);

  // 3. Timer Hook: Pasamos el OBJETO match, no los segundos.
  // El hook se encarga de calcular el tiempo restante basado en la BD.
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

  // 4. Efecto: Detectar cuando el reloj llega a cero
  useEffect(() => {
    const currentQ = match.currentQuarter || 1;

    if (timeLeft > 0) {
      zeroHandledQuarterRef.current = null;
      return;
    }

    // Si el tiempo se acabó, no está corriendo y el partido no ha terminado...
    if (timeLeft <= 0 && !isRunning && match.status !== 'finished') {
      if (zeroHandledQuarterRef.current !== currentQ && !showQuarterEndModal && !showMatchEndModal) {
        zeroHandledQuarterRef.current = currentQ;
        handleTimerZero();
      }
    }
  }, [timeLeft, isRunning, match.status, match.currentQuarter, showQuarterEndModal, showMatchEndModal, handleTimerZero]);

  // 5. Acción: Siguiente Cuarto
  const nextQuarter = useCallback(async () => {
    const currentQ = match.currentQuarter || 1;
    
    if (currentQ < quartersConfig) {
      await db.matches.update(match.id!, {
        currentQuarter: currentQ + 1,
        timerSecondsRemaining: minutesPerQuarter * 60, // Reiniciar tiempo en BD
        timerLastStart: undefined // Asegurar que inicie pausado
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
      timerLastStart: undefined // Inicia pausado
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
