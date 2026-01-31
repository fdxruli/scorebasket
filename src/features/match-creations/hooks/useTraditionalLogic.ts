import { useState, useEffect, useCallback } from 'react';
import { useMatchTimer } from '../../../hooks/useMatchTimer';
import type { Match } from '../../../db/models/Match';
import { db } from '../../../db/db';

interface UseTraditionalLogicProps {
  match: Match;
}

export const useTraditionalLogic = ({ match }: UseTraditionalLogicProps) => {
  // 1. Extraer configuración (con fallback seguros)
  const quartersConfig = match.config.traditional?.totalQuarters || 4;
  const minutesPerQuarter = match.config.traditional?.minutesPerQuarter || 10;
  
  // 2. Estado local para modales
  const [showQuarterEndModal, setShowQuarterEndModal] = useState(false);
  const [showMatchEndModal, setShowMatchEndModal] = useState(false);

  // 3. Timer Hook: Pasamos el OBJETO match, no los segundos.
  // El hook se encarga de calcular el tiempo restante basado en la BD.
  const { timeLeft, isRunning, toggleTimer, resetTimer } = useMatchTimer(match);

  // Helper para formato de tiempo (MM:SS)
  const formatTime = (seconds: number) => {
    const s = Math.ceil(seconds);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  // 4. Efecto: Detectar cuando el reloj llega a cero
  useEffect(() => {
    // Si el tiempo se acabó, no está corriendo y el partido no ha terminado...
    if (timeLeft <= 0 && !isRunning && match.status !== 'finished') {
       // Evitar abrir el modal si ya está abierto
       if (!showQuarterEndModal && !showMatchEndModal) {
          handleTimerZero();
       }
    }
  }, [timeLeft, isRunning, match.status, showQuarterEndModal, showMatchEndModal]);

  const handleTimerZero = useCallback(() => {
    const currentQ = match.currentQuarter || 1;
    // Si estamos en el último cuarto (o más), es fin de partido
    if (currentQ >= quartersConfig) {
      setShowMatchEndModal(true);
    } else {
      setShowQuarterEndModal(true);
    }
  }, [match.currentQuarter, quartersConfig]);

  // 5. Acción: Siguiente Cuarto
  const nextQuarter = useCallback(async () => {
    // Eliminado try/catch para que el error suba al componente (Engine)
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
       finishedAt: new Date()
     });
     setShowMatchEndModal(false);
  }, [match.id]);

  return {
    timerDisplay: formatTime(timeLeft),
    timeLeft,
    isTimerRunning: isRunning,
    toggleTimer,
    resetCurrentQuarter: resetTimer,
    
    currentQuarter: match.currentQuarter || 1,
    totalQuarters: quartersConfig,
    nextQuarter,
    endMatch,
    
    showQuarterEndModal,
    setShowQuarterEndModal,
    showMatchEndModal,
    setShowMatchEndModal
  };
};