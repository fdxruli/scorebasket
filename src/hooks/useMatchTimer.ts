// src/hooks/useMatchTimer.ts (VERSIÓN CORREGIDA)
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
 * 
 * CORRECCIÓN APLICADA:
 * - Eliminadas dependencias del efecto de cleanup para evitar reconstrucciones
 * - El flag shouldPauseOnUnmount ahora se verifica en el momento del desmontaje,
 *   no en el momento de la creación del efecto
 */
export function useMatchTimer(match: Match | undefined, enableAutoPause = true): UseMatchTimerReturn {
  const [, setTick] = useState(0);
  const shouldPauseOnUnmount = useRef(true);
  const matchIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    matchIdRef.current = match?.id;
  }, [match?.id]);

  useEffect(()=> {
    shouldPauseOnUnmount.current = enableAutoPause;
  }, [enableAutoPause]);
  
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
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning, timeLeft]);
  
  // ✅ Auto-pause cuando llega a 0
  useEffect(() => {
    if (timeLeft <= 0 && isRunning && match?.id) {
      pauseTimer(match.id);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
  }, [timeLeft, isRunning, match]);
  
  // 🔧 CORRECCIÓN DEL BUG: Efecto sin dependencias
  // Solo se ejecuta al montar/desmontar, no se reconstruye
  useEffect(() => {
    return () => {
      // Usamos los REFS para leer el valor actual al momento de desmontar
      // sin importar si 'match' era undefined al principio.
      if (matchIdRef.current && shouldPauseOnUnmount.current) {
        pauseTimer(matchIdRef.current);
      }
    };
  }, []); // ✅ Array vacío - evita reconstrucciones del efecto
  
  const toggleTimer = useCallback(async () => {
    if (!match) return;
    
    const { id } = match;
    
    // 🔧 MEJORA: Usar transacción para evitar race conditions
    await db.transaction('rw', db.matches, async () => {
      const currentMatch = await db.matches.get(id!);
      if (!currentMatch) return;
      
      if (currentMatch.timerLastStart) {
        // Pausar
        const elapsed = (Date.now() - currentMatch.timerLastStart.getTime()) / 1000;
        await db.matches.update(id!, {
          timerLastStart: undefined,
          timerSecondsRemaining: Math.max(0, currentMatch.timerSecondsRemaining - elapsed)
        });
      } else {
        // Iniciar (solo si hay tiempo restante)
        if (currentMatch.timerSecondsRemaining > 0) {
          await db.matches.update(id!, {
            timerLastStart: new Date(),
            status: 'playing'
          });
        }
      }
    });
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