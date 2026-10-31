// src/hooks/useMatchTimer.ts (VERSIÓN CORREGIDA F2B R1.1)
import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../db/db';
import type { Match } from '../db/models/Match';
import { unlockAudioContext, playBuzzer } from '../utils/soundEffects';

interface UseMatchTimerReturn {
  timeLeft: number;
  isRunning: boolean;
  toggleTimer: () => Promise<void>;
  pauseTimer: () => Promise<void>;
  resetTimer: () => Promise<void>;
  adjustTime: (deltaSeconds: number) => Promise<void>;
  keepTimerRunningOnUnmount: () => void;
}

/**
 * Pausa el cronómetro de un partido de forma transaccional e idempotente (R1.2-B).
 * Si el reloj ya está pausado (`timerLastStart === undefined`), no realiza ningún descuento
 * ni arranca accidentalmente el cronómetro.
 */
export async function pauseMatchTimerIdempotent(
  matchId: number,
  nowMs = Date.now()
): Promise<boolean> {
  try {
    if (!db.isOpen()) return false;
    return await db.transaction('rw', db.matches, async () => {
      const match = await db.matches.get(matchId);
      if (!match || !match.timerLastStart) {
        return false;
      }

      const elapsed = Math.max(0, (nowMs - match.timerLastStart.getTime()) / 1000);
      await db.matches.update(matchId, {
        timerLastStart: undefined,
        timerSecondsRemaining: Math.max(0, (match.timerSecondsRemaining || 0) - elapsed)
      });
      return true;
    });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'DatabaseClosedError') {
      return false;
    }
    if (err instanceof Error && err.message.includes('Database has been closed')) {
      return false;
    }
    throw err;
  }
}

/** Mapa para coordinar pausas de desmontaje y tolerar remounts de React.StrictMode (C-10) */
const pendingUnmountPauses = new Map<number, ReturnType<typeof setTimeout>>();

export function cancelPendingUnmountPause(matchId: number) {
  const timer = pendingUnmountPauses.get(matchId);
  if (timer) {
    clearTimeout(timer);
    pendingUnmountPauses.delete(matchId);
  }
}

/** Cancela y limpia todas las pausas de desmontaje pendientes (útil para aislamiento de pruebas) */
export function clearAllPendingUnmountPauses() {
  pendingUnmountPauses.forEach(timer => clearTimeout(timer));
  pendingUnmountPauses.clear();
}

/**
 * Hook personalizado para manejar el timer de un partido
 */
export function useMatchTimer(match: Match | undefined, enableAutoPause = true): UseMatchTimerReturn {
  const [, setTick] = useState(0);
  const shouldPauseOnUnmount = useRef(true);
  const matchIdRef = useRef<number | undefined>(undefined);
  const prevMatchIdRef = useRef<number | undefined>(match?.id);

  // Coordinación de cambio de partido y cancelación de pausas en remounts (C-10)
  useEffect(() => {
    const currentId = match?.id;

    // Si cambió de partido (ej. Match 1 -> Match 2), pausamos inmediatamente el anterior si correspondía
    if (prevMatchIdRef.current && currentId && prevMatchIdRef.current !== currentId) {
      cancelPendingUnmountPause(prevMatchIdRef.current);
      if (shouldPauseOnUnmount.current) {
        pauseMatchTimerIdempotent(prevMatchIdRef.current);
      }
    }

    prevMatchIdRef.current = currentId;
    matchIdRef.current = currentId;

    // Si el partido entrante tenía una pausa de desmontaje programada (ej. por remount de StrictMode),
    // la cancelamos de inmediato para preservar la continuidad del cronómetro
    if (currentId) {
      cancelPendingUnmountPause(currentId);
    }
  }, [match?.id]);

  useEffect(() => {
    shouldPauseOnUnmount.current = enableAutoPause;
  }, [enableAutoPause]);

  const getEffectiveTimeLeft = useCallback((): number => {
    // 1. Si no hay match, retornamos 0
    if (!match) return 0;

    const { timerSecondsRemaining, timerLastStart } = match;

    // 2. Aseguramos un valor numérico base para evitar NaN
    //    Usamos (timerSecondsRemaining || 0) o (timerSecondsRemaining ?? 0)
    const baseSeconds = timerSecondsRemaining ?? 0;

    if (timerLastStart) {
      // Calculamos tiempo transcurrido
      const elapsed = (Date.now() - timerLastStart.getTime()) / 1000;
      // Restamos del base asegurado
      return Math.max(0, baseSeconds - elapsed);
    }

    // Si está pausado, devolvemos el valor base
    return baseSeconds;
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
      pauseMatchTimerIdempotent(match.id);
      if (enableAutoPause) {
        playBuzzer();
      }
    }
  }, [timeLeft, isRunning, match, enableAutoPause]);

  // Limpieza al desmontar: diferida por 25ms para permitir que un remount inmediato
  // de React.StrictMode cancele la pausa y no detenga accidentalmente el reloj (C-10).
  // En un desmontaje real (navegación away), el timeout expira y pausa el partido normalmente.
  useEffect(() => {
    return () => {
      const id = matchIdRef.current;
      if (id && shouldPauseOnUnmount.current) {
        cancelPendingUnmountPause(id);
        const timer = setTimeout(() => {
          pendingUnmountPauses.delete(id);
          pauseMatchTimerIdempotent(id).catch(() => {});
        }, 25);
        pendingUnmountPauses.set(id, timer);
      }
    };
  }, []);

  const toggleTimer = useCallback(async () => {
    if (!match) return;

    // Desbloquear canal de audio en gesto directo del usuario
    unlockAudioContext();

    const { id } = match;

    await db.transaction('rw', db.matches, async () => {
      const currentMatch = await db.matches.get(id!);
      if (!currentMatch) return;

      if (currentMatch.timerLastStart) {
        // Pausar
        const elapsed = Math.max(0, (Date.now() - currentMatch.timerLastStart.getTime()) / 1000);
        await db.matches.update(id!, {
          timerLastStart: undefined,
          // CORRECCIÓN 1: Añadir ( ... || 0) para evitar error con undefined
          timerSecondsRemaining: Math.max(0, (currentMatch.timerSecondsRemaining || 0) - elapsed)
        });
      } else {
        // Iniciar (solo si hay tiempo restante)
        // CORRECCIÓN 2: Añadir ( ... || 0)
        if ((currentMatch.timerSecondsRemaining || 0) > 0) {
          await db.matches.update(id!, {
            timerLastStart: new Date(),
            status: 'playing'
          });
        }
      }
    });
  }, [match]);

  const pauseTimer = useCallback(async () => {
    if (!match?.id) return;
    cancelPendingUnmountPause(match.id);
    await pauseMatchTimerIdempotent(match.id);
  }, [match]);

  const resetTimer = useCallback(async () => {
    if (!match) return;

    // 1. Buscamos la duración en la nueva config (prioridad)
    // 2. Si no existe, buscamos en el campo deprecated
    // 3. Si todo falla, usamos 0 para evitar NaN
    const durationInMinutes = 
      match.config?.traditional?.minutesPerQuarter ?? 
      match.quarterDuration ?? 
      0;

    await db.matches.update(match.id!, {
      timerSecondsRemaining: durationInMinutes * 60,
      timerLastStart: undefined
    });
  }, [match]);

  const adjustTime = useCallback(async (deltaSeconds: number) => {
    if (!match?.id || match.timerLastStart) return;

    await db.transaction('rw', db.matches, async () => {
      const currentMatch = await db.matches.get(match.id!);
      if (!currentMatch || currentMatch.timerLastStart) return;

      const currentSeconds = Math.ceil(currentMatch.timerSecondsRemaining ?? 0);
      const nextSeconds = Math.max(0, currentSeconds + deltaSeconds);

      await db.matches.update(match.id!, {
        timerSecondsRemaining: nextSeconds,
        timerLastStart: undefined
      });
    });
  }, [match]);

  const keepTimerRunningOnUnmount = useCallback(() => {
    shouldPauseOnUnmount.current = false;
  }, []);

  return {
    timeLeft,
    isRunning,
    toggleTimer,
    pauseTimer,
    resetTimer,
    adjustTime,
    keepTimerRunningOnUnmount
  };
}
