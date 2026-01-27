// src/hooks/useMatchTimer.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../db/db';
import type { Match } from '../db/models';

interface UseMatchTimerReturn {
  timeLeft: number;
  isRunning: boolean;
  toggleTimer: () => Promise<void>;
  resetTimer: () => Promise<void>;
  keepTimerRunningOnUnmount: () => void;
}

/**
 * Hook personalizado para manejar el timer de un partido
 * Resuelve race conditions y garantiza consistencia
 */
export function useMatchTimer(match: Match | undefined): UseMatchTimerReturn {
  const [tick, setTick] = useState(0);

  const shouldPauseOnUnmount = useRef(true);
  
  const getEffectiveTimeLeft = useCallback((): number => {
    if (!match) return 0;
    
    const { timerSecondsRemaining, timerLastStart } = match;
    
    if (timerLastStart) {
      const elapsed = (Date.now() - timerLastStart.getTime()) / 1000;
      return Math.max(0, timerSecondsRemaining - elapsed);
    }
    
    return timerSecondsRemaining;
  }, [match]);
  
  const timeLeft = getEffectiveTimeLeft();
  const isRunning = !!match?.timerLastStart;
  
  // ✅ Efecto del timer con cleanup garantizado
  useEffect(() => {
    if (!isRunning || timeLeft <= 0) return;
    
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    
    // Limpieza automática al desmontar o cambiar deps
    return () => clearInterval(interval);
  }, [isRunning, timeLeft]);
  
  // ✅ Auto-pause cuando llega a 0
  useEffect(() => {
    if (timeLeft <= 0 && isRunning && match) {
      pauseTimer(match.id!);
    }
  }, [timeLeft, isRunning, match]);
  
  // ✅ Pausar timer al desmontar componente (cleanup)
  useEffect(() => {
    return () => {
      if (match?.timerLastStart && shouldPauseOnUnmount.current) {
        pauseTimer(match.id!);
      }
    };
  }, [match?.id, match?.timerLastStart]);
  
  const toggleTimer = useCallback(async () => {
    if (!match) return;
    
    const { id, timerLastStart, timerSecondsRemaining } = match;
    
    if (timerLastStart) {
      // Pausar
      await pauseTimer(id!);
    } else {
      // Iniciar (solo si hay tiempo restante)
      if (timerSecondsRemaining > 0) {
        await db.matches.update(id!, {
          timerLastStart: new Date(),
          status: 'playing'
        });
      }
    }
  }, [match]);
  
  const resetTimer = useCallback(async () => {
    if (!match) return;
    
    await db.matches.update(match.id!, {
      timerSecondsRemaining: match.quarterDuration * 60,
      timerLastStart: undefined
    });
  }, [match]);

  const keepTimerRunningOnUnmount = useCallback(() => {
    shouldPauseOnUnmount.current = false;
  }, []);
  
  return {
    timeLeft,
    isRunning,
    toggleTimer,
    resetTimer,
    keepTimerRunningOnUnmount
  };
}

// Helper para pausar (usado internamente)
async function pauseTimer(matchId: number): Promise<void> {
  const match = await db.matches.get(matchId);
  if (!match || !match.timerLastStart) return;
  
  const elapsed = (Date.now() - match.timerLastStart.getTime()) / 1000;
  
  await db.matches.update(matchId, {
    timerLastStart: undefined,
    timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining - elapsed)
  });
}