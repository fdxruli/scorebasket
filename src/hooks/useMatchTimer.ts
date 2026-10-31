// src/hooks/useMatchTimer.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../db/db';
import type { Match } from '../db/models/Match';
import { unlockAudioContext, playBuzzer } from '../utils/soundEffects';
import { MatchTimerService, type TimerOperationResult } from '../db/matchTimer.service';
import { timerAuthorityCoordinator, type AuthorityState } from '../services/timerAuthority.coordinator';

export interface UseMatchTimerReturn {
  timeLeft: number;
  isRunning: boolean;
  hasAuthority: boolean;
  isOwner: boolean;
  ownerTabId: string | null;
  epoch: number;
  requestAuthorityTransfer: () => Promise<boolean>;
  lastOperationResult: TimerOperationResult | null;
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
 *
 * Mantiene compatibilidad estricta con versiones anteriores delegando en MatchTimerService.
 */
export async function pauseMatchTimerIdempotent(
  matchId: number,
  nowMs = Date.now()
): Promise<boolean> {
  try {
    if (!db.isOpen()) return false;
    const result = await MatchTimerService.pause(matchId, {
      nowMs,
      skipAuthorityCheck: true
    });
    // Devuelve true solo si la pausa fue aplicada (el reloj estaba corriendo);
    // si ya estaba pausado (already_applied) o rechazado, devuelve false.
    return result.status === 'applied';
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
 * Hook personalizado para manejar el cronómetro de un partido con autoridad entre pestañas (Fase 2C).
 */
export function useMatchTimer(match: Match | undefined, enableAutoPause = true): UseMatchTimerReturn {
  const [, setTick] = useState(0);
  const shouldPauseOnUnmount = useRef(true);
  const matchIdRef = useRef<number | undefined>(undefined);
  const prevMatchIdRef = useRef<number | undefined>(match?.id);
  const buzzerPlayedRef = useRef<number | null>(null);
  const [lastOperationResult, setLastOperationResult] = useState<TimerOperationResult | null>(null);

  const [authorityState, setAuthorityState] = useState<AuthorityState>(() =>
    match?.id
      ? timerAuthorityCoordinator.getAuthorityState(match.id)
      : {
          matchId: 0,
          hasAuthority: false,
          isOwner: false,
          ownerTabId: null,
          epoch: 0,
          tabId: timerAuthorityCoordinator.getTabId()
        }
  );

  // 1. Coordinación de cambio de partido y cancelación de pausas en remounts (C-10)
  useEffect(() => {
    const currentId = match?.id;

    // Si cambió de partido (ej. Match 1 -> Match 2), pausamos y liberamos autoridad del anterior
    if (prevMatchIdRef.current && currentId && prevMatchIdRef.current !== currentId) {
      cancelPendingUnmountPause(prevMatchIdRef.current);
      if (shouldPauseOnUnmount.current) {
        pauseMatchTimerIdempotent(prevMatchIdRef.current);
      }
      timerAuthorityCoordinator.releaseAuthority(prevMatchIdRef.current);
    }

    prevMatchIdRef.current = currentId;
    matchIdRef.current = currentId;

    if (currentId) {
      cancelPendingUnmountPause(currentId);
    }
  }, [match]);

  useEffect(() => {
    shouldPauseOnUnmount.current = enableAutoPause;
  }, [enableAutoPause]);

  // 2. Coordinación de Autoridad entre pestañas (Web Locks + BroadcastChannel)
  useEffect(() => {
    const matchId = match?.id;
    if (!matchId) return;

    let isSubscribed = true;

    // Si el hook está en modo activo (motor de juego principal), intenta adquirir autoridad
    if (enableAutoPause) {
      timerAuthorityCoordinator.acquireAuthority(matchId).then(() => {
        if (isSubscribed) {
          setAuthorityState(timerAuthorityCoordinator.getAuthorityState(matchId));
        }
      });
    }

    const unsubscribe = timerAuthorityCoordinator.subscribe(matchId, (state) => {
      if (isSubscribed) {
        setAuthorityState(state);
      }
    });

    return () => {
      isSubscribed = false;
      unsubscribe();
    };
  }, [match?.id, enableAutoPause]);

  // 3. Ciclo de Vida PWA y Reconciliación (visibilitychange, pageshow, pagehide)
  useEffect(() => {
    const matchId = match?.id;
    if (!matchId || !enableAutoPause) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Reconciliar tiempo transcurrido durante la suspensión de la pantalla o segundo plano
        MatchTimerService.reconcile(matchId).then((res) => {
          if (res.expired && buzzerPlayedRef.current !== match?.currentQuarter) {
            buzzerPlayedRef.current = match?.currentQuarter ?? null;
            playBuzzer();
          }
        }).catch(() => {});
      }
    };

    const handlePageShow = () => {
      MatchTimerService.reconcile(matchId).catch(() => {});
    };

    const handlePageHide = () => {
      // Si la pestaña se cierra o navega fuera, intentar pausa segura e inmediata si somos dueños
      if (shouldPauseOnUnmount.current && timerAuthorityCoordinator.getAuthorityState(matchId).isOwner) {
        pauseMatchTimerIdempotent(matchId).catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [match?.id, match?.currentQuarter, enableAutoPause]);

  // 4. Cálculo monotónico y reactivo del tiempo restante (INV-T01, INV-T08)
  const getEffectiveTimeLeft = useCallback((): number => {
    if (!match) return 0;

    const { timerSecondsRemaining, timerLastStart } = match;
    const baseSeconds = timerSecondsRemaining ?? 0;

    if (timerLastStart) {
      const nowMs = Date.now();
      const lastStartMs = timerLastStart.getTime();
      let elapsed = 0;

      if (nowMs >= lastStartMs) {
        elapsed = (nowMs - lastStartMs) / 1000;
      } else {
        // Protección contra reloj del sistema retrocedido
        elapsed = 0;
      }

      return Math.max(0, baseSeconds - elapsed);
    }

    return Math.max(0, baseSeconds);
  }, [match]);

  const timeLeft = getEffectiveTimeLeft();
  const isRunning = Boolean(match?.timerLastStart);

  // Reiniciar registro de chicharra cuando el tiempo vuelve a ser > 0 o cambia de periodo
  useEffect(() => {
    if (timeLeft > 0) {
      buzzerPlayedRef.current = null;
    }
  }, [timeLeft, match?.currentQuarter]);

  // 5. Intervalo reactivo garantizado
  useEffect(() => {
    if (!isRunning || timeLeft <= 0) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning, timeLeft]);

  // 6. Auto-pause y chicharra única cuando llega a 00:00
  useEffect(() => {
    if (timeLeft <= 0 && isRunning && match?.id) {
      pauseMatchTimerIdempotent(match.id);
      if (enableAutoPause && buzzerPlayedRef.current !== match.currentQuarter) {
        buzzerPlayedRef.current = match.currentQuarter ?? 0;
        playBuzzer();
      }
    }
  }, [timeLeft, isRunning, match?.id, match?.currentQuarter, enableAutoPause]);

  // 7. Limpieza al desmontar: diferida por 25ms para tolerar StrictMode remounts (C-10)
  useEffect(() => {
    return () => {
      const id = matchIdRef.current;
      if (id && shouldPauseOnUnmount.current) {
        cancelPendingUnmountPause(id);
        const timer = setTimeout(() => {
          pendingUnmountPauses.delete(id);
          pauseMatchTimerIdempotent(id).catch(() => {});
          timerAuthorityCoordinator.releaseAuthority(id);
        }, 25);
        pendingUnmountPauses.set(id, timer);
      }
    };
  }, []);

  // 8. Operaciones del cronómetro con verificación de autoridad y fencing epoch
  const toggleTimer = useCallback(async () => {
    if (!match?.id) return;
    unlockAudioContext();

    const result = await MatchTimerService.toggle(match.id, {
      epoch: authorityState.epoch,
      expectedQuarter: match.currentQuarter
    });
    setLastOperationResult(result);
  }, [match, authorityState.epoch]);

  const pauseTimer = useCallback(async () => {
    if (!match?.id) return;
    cancelPendingUnmountPause(match.id);

    const result = await MatchTimerService.pause(match.id, {
      epoch: authorityState.epoch,
      expectedQuarter: match.currentQuarter
    });
    setLastOperationResult(result);
  }, [match, authorityState.epoch]);

  const resetTimer = useCallback(async () => {
    if (!match?.id) return;

    const result = await MatchTimerService.reset(match.id, {
      epoch: authorityState.epoch,
      expectedQuarter: match.currentQuarter
    });
    setLastOperationResult(result);
  }, [match, authorityState.epoch]);

  const adjustTime = useCallback(async (deltaSeconds: number) => {
    if (!match?.id) return;

    const result = await MatchTimerService.adjust(match.id, deltaSeconds, {
      epoch: authorityState.epoch,
      expectedQuarter: match.currentQuarter
    });
    setLastOperationResult(result);
  }, [match, authorityState.epoch]);

  const requestAuthorityTransfer = useCallback(async (): Promise<boolean> => {
    if (!match?.id) return false;
    const acquired = await timerAuthorityCoordinator.requestTransfer(match.id);
    setAuthorityState(timerAuthorityCoordinator.getAuthorityState(match.id));
    return acquired;
  }, [match]);

  const keepTimerRunningOnUnmount = useCallback(() => {
    shouldPauseOnUnmount.current = false;
  }, []);

  return {
    timeLeft,
    isRunning,
    hasAuthority: authorityState.hasAuthority,
    isOwner: authorityState.isOwner,
    ownerTabId: authorityState.ownerTabId,
    epoch: authorityState.epoch,
    requestAuthorityTransfer,
    lastOperationResult,
    toggleTimer,
    pauseTimer,
    resetTimer,
    adjustTime,
    keepTimerRunningOnUnmount
  };
}
