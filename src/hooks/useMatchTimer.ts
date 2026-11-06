// src/hooks/useMatchTimer.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../db/db';
import type { Match } from '../db/models/Match';
import { unlockAudioContext, playBuzzer } from '../utils/soundEffects';
import { triggerHaptic } from '../utils/haptics';
import { MatchTimerService, type TimerOperationResult, type TimerServiceOptions, type TimeConfidence } from '../db/matchTimer.service';
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
  confidence: TimeConfidence;
  isClockShiftDetected: boolean;
  resolveRecovery: (validatedSeconds?: number) => Promise<void>;
  timerRecoveryState: 'normal' | 'recovery_required';

  // Reloj de posesión opcional (DEPORT-04)
  shotClockTimeLeft: number;
  isShotClockRunning: boolean;
  isShotClockExpired: boolean;
  isShotClockEnabled: boolean;
  resetShotClock: (seconds: 24 | 14) => Promise<void>;
  setShotClockEnabled: (enabled: boolean) => Promise<void>;

  // Asistente automático de posesión y reloj (ASIST-01)
  isPossessionAssistantEnabled: boolean;
  possessionAssistantHaptics: boolean;
  setPossessionAssistantEnabled: (enabled: boolean, hapticsEnabled?: boolean) => Promise<void>;
  applyPossessionTurnover: () => Promise<void>;
  setPossession: (possession: 'local' | 'visitor' | null) => Promise<void>;
}

/**
 * Pausa el cronómetro de un partido de forma transaccional e idempotente (R1.2-B, C-11, C-12).
 * Respeta el contrato de autoridad: pestañas observadoras no pueden escribir a la base de datos.
 */
export async function pauseMatchTimerIdempotent(
  matchId: number,
  nowMs = Date.now(),
  options?: TimerServiceOptions
): Promise<boolean> {
  try {
    if (!db.isOpen()) return false;
    const authState = timerAuthorityCoordinator.getAuthorityState(matchId);

    // C-12 / C-19: Si no tiene autoridad, no debe mutar IndexedDB
    if (!authState.hasAuthority) {
      return false;
    }

    const result = await MatchTimerService.pause(matchId, {
      nowMs,
      epoch: options?.epoch ?? authState.epoch,
      expectedQuarter: options?.expectedQuarter,
      tabId: options?.tabId ?? authState.tabId
    });

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
  const [currentNowMs, setCurrentNowMs] = useState(() => Date.now());
  const shouldPauseOnUnmount = useRef(true);
  const matchIdRef = useRef<number | undefined>(undefined);
  const prevMatchIdRef = useRef<number | undefined>(match?.id);
  const buzzerPlayedRef = useRef<number | null>(null);
  const shotClockBuzzerPlayedRef = useRef<boolean>(false);
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

  // 1. Coordinación de cambio de partido y cancelación de pausas en remounts (C-10, C-12)
  useEffect(() => {
    const currentId = match?.id;

    // Si cambió de partido (ej. Match 1 -> Match 2), pausamos y liberamos autoridad del anterior si éramos dueños
    if (prevMatchIdRef.current && currentId && prevMatchIdRef.current !== currentId) {
      const prevId = prevMatchIdRef.current;
      cancelPendingUnmountPause(prevId);
      (async () => {
        await timerAuthorityCoordinator.waitForAcquisition(prevId);
        const prevAuth = timerAuthorityCoordinator.getAuthorityState(prevId);
        if (shouldPauseOnUnmount.current && prevAuth.hasAuthority) {
          try {
            await pauseMatchTimerIdempotent(prevId);
          } catch {
            // ignore
          }
        }
        await timerAuthorityCoordinator.releaseAuthority(prevId);
      })();
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
          if (res.expired && res.confidence !== 'uncertain' && buzzerPlayedRef.current !== match?.currentQuarter) {
            buzzerPlayedRef.current = match?.currentQuarter ?? null;
            playBuzzer();
          }
          if (res.shotClockExpired && !shotClockBuzzerPlayedRef.current) {
            shotClockBuzzerPlayedRef.current = true;
            playBuzzer();
          }
        }).catch(() => {});
      }
    };

    const handlePageShow = () => {
      MatchTimerService.reconcile(matchId).catch(() => {});
    };

    const handlePageHide = () => {
      // Si la pestaña se cierra o navega fuera, intentar pausa segura si somos dueños (C-12)
      if (shouldPauseOnUnmount.current && timerAuthorityCoordinator.getAuthorityState(matchId).hasAuthority) {
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

  // 4. Proyección temporal unificada y reactiva compartida con el dominio (C-26)
  const projection = MatchTimerService.projectTime(match, currentNowMs);
  const timeLeft = projection.timeLeft;
  const isRunning = projection.isRunning;
  const isClockShiftDetected = projection.isClockShiftDetected;
  const confidence = projection.confidence;

  // Proyección temporal del reloj de posesión (DEPORT-04)
  const shotClockProj = MatchTimerService.projectShotClock(match, currentNowMs);
  const shotClockTimeLeft = shotClockProj.timeLeft;
  const isShotClockRunning = shotClockProj.isRunning;
  const isShotClockExpired = shotClockProj.expired;
  const isShotClockEnabled = shotClockProj.enabled;

  // Reiniciar registro de chicharra cuando el tiempo vuelve a ser > 0 o cambia de periodo
  useEffect(() => {
    if (timeLeft > 0) {
      buzzerPlayedRef.current = null;
    }
  }, [timeLeft, match?.currentQuarter]);

  useEffect(() => {
    if (shotClockTimeLeft > 0) {
      shotClockBuzzerPlayedRef.current = false;
    }
  }, [shotClockTimeLeft, match?.currentQuarter]);

  // 5. Intervalo reactivo garantizado sincronizado con el reloj del sistema (C-31)
  useEffect(() => {
    const isAnyClockRunning = isRunning || isShotClockRunning;
    if (!isAnyClockRunning || (timeLeft <= 0 && shotClockTimeLeft <= 0)) return;
    const interval = setInterval(() => setCurrentNowMs(Date.now()), 500);
    return () => clearInterval(interval);
  }, [isRunning, timeLeft, isShotClockRunning, shotClockTimeLeft, match?.timerLastStart, match?.shotClock?.lastStart]);

  // 6. Auto-pause y chicharra única cuando llega a 00:00 legítimamente (C-12, C-26)
  useEffect(() => {
    if (projection.expired && projection.confidence !== 'uncertain' && isRunning && match?.id) {
      if (authorityState.hasAuthority) {
        MatchTimerService.pause(match.id, {
          epoch: authorityState.epoch,
          expectedQuarter: match.currentQuarter,
          tabId: authorityState.tabId
        }).catch(() => {});
      }
      if (enableAutoPause && buzzerPlayedRef.current !== match.currentQuarter) {
        buzzerPlayedRef.current = match.currentQuarter ?? 0;
        playBuzzer();
      }
    }
  }, [
    projection.expired,
    projection.confidence,
    isRunning,
    match?.id,
    match?.currentQuarter,
    enableAutoPause,
    authorityState.hasAuthority,
    authorityState.epoch,
    authorityState.tabId
  ]);

  // 6b. Auto-expiración y chicharra única para reloj de posesión en 00 (DEPORT-04)
  useEffect(() => {
    if (
      isShotClockEnabled &&
      shotClockProj.expired &&
      isShotClockRunning &&
      match?.id &&
      !shotClockBuzzerPlayedRef.current
    ) {
      shotClockBuzzerPlayedRef.current = true;
      if (enableAutoPause) {
        playBuzzer();
      }
      if (authorityState.hasAuthority) {
        if (match?.possessionAssistant?.enabled) {
          triggerHaptic('shot_clock_expired', match.possessionAssistant.hapticsEnabled !== false);
        }
        MatchTimerService.expireShotClock(match.id, {
          epoch: authorityState.epoch,
          expectedQuarter: match.currentQuarter,
          tabId: authorityState.tabId
        }).catch(() => {});
      }
    }
  }, [
    isShotClockEnabled,
    shotClockProj.expired,
    isShotClockRunning,
    match?.id,
    match?.currentQuarter,
    match?.possessionAssistant?.enabled,
    match?.possessionAssistant?.hapticsEnabled,
    enableAutoPause,
    authorityState.hasAuthority,
    authorityState.epoch,
    authorityState.tabId
  ]);

  // 7. Limpieza al desmontar: diferida por 25ms para tolerar StrictMode remounts (C-10, C-12)
  useEffect(() => {
    return () => {
      const id = matchIdRef.current;
      if (id && shouldPauseOnUnmount.current) {
        cancelPendingUnmountPause(id);
        const timer = setTimeout(async () => {
          pendingUnmountPauses.delete(id);
          await timerAuthorityCoordinator.waitForAcquisition(id);
          const currentAuth = timerAuthorityCoordinator.getAuthorityState(id);
          if (currentAuth.hasAuthority) {
            try {
              await pauseMatchTimerIdempotent(id);
            } catch {
              // ignore
            }
          }
          await timerAuthorityCoordinator.releaseAuthority(id);
        }, 25);
        pendingUnmountPauses.set(id, timer);
      }
    };
  }, []);

  // 8. Operaciones del cronómetro con verificación de autoridad y fencing epoch
  const getActiveAuth = useCallback((matchId: number) => {
    const current = timerAuthorityCoordinator.getAuthorityState(matchId);
    return {
      epoch: current.hasAuthority ? current.epoch : authorityState.epoch,
      tabId: current.tabId
    };
  }, [authorityState.epoch]);

  const toggleTimer = useCallback(async () => {
    if (!match?.id) return;
    unlockAudioContext();

    const auth = getActiveAuth(match.id);
    const result = await MatchTimerService.toggle(match.id, {
      epoch: auth.epoch,
      expectedQuarter: match.currentQuarter,
      tabId: auth.tabId
    });
    setLastOperationResult(result);
  }, [match, getActiveAuth]);

  const pauseTimer = useCallback(async () => {
    if (!match?.id) return;
    cancelPendingUnmountPause(match.id);

    const auth = getActiveAuth(match.id);
    const result = await MatchTimerService.pause(match.id, {
      epoch: auth.epoch,
      expectedQuarter: match.currentQuarter,
      tabId: auth.tabId
    });
    setLastOperationResult(result);
  }, [match, getActiveAuth]);

  const resetTimer = useCallback(async () => {
    if (!match?.id) return;

    const auth = getActiveAuth(match.id);
    const result = await MatchTimerService.reset(match.id, {
      epoch: auth.epoch,
      expectedQuarter: match.currentQuarter,
      tabId: auth.tabId
    });
    setLastOperationResult(result);
  }, [match, getActiveAuth]);

  const adjustTime = useCallback(async (deltaSeconds: number) => {
    if (!match?.id) return;

    const auth = getActiveAuth(match.id);
    const result = await MatchTimerService.adjust(match.id, deltaSeconds, {
      epoch: auth.epoch,
      expectedQuarter: match.currentQuarter,
      tabId: auth.tabId
    });
    setLastOperationResult(result);
  }, [match, getActiveAuth]);

  const requestAuthorityTransfer = useCallback(async (): Promise<boolean> => {
    if (!match?.id) return false;
    const acquired = await timerAuthorityCoordinator.requestTransfer(match.id);
    setAuthorityState(timerAuthorityCoordinator.getAuthorityState(match.id));
    return acquired;
  }, [match]);

  const keepTimerRunningOnUnmount = useCallback(() => {
    shouldPauseOnUnmount.current = false;
  }, []);

  const timerRecoveryState = match?.timerRecoveryState ?? (confidence === 'uncertain' ? 'recovery_required' : 'normal');

  const resolveRecovery = useCallback(async (validatedSeconds?: number) => {
    if (!match?.id) return;
    const target = validatedSeconds ?? timeLeft;
    const auth = getActiveAuth(match.id);
    const result = await MatchTimerService.resolveRecovery(match.id, target, {
      epoch: auth.epoch,
      expectedQuarter: match.currentQuarter,
      tabId: auth.tabId
    });
    setLastOperationResult(result);
  }, [match, timeLeft, getActiveAuth]);

  const resetShotClock = useCallback(async (seconds: 24 | 14) => {
    if (!match?.id) return;
    unlockAudioContext();
    shotClockBuzzerPlayedRef.current = false;
    const auth = getActiveAuth(match.id);
    const result = await MatchTimerService.resetShotClock(match.id, seconds, {
      epoch: auth.epoch,
      expectedQuarter: match.currentQuarter,
      tabId: auth.tabId
    });
    setLastOperationResult(result as unknown as TimerOperationResult);
  }, [match, getActiveAuth]);

  const setShotClockEnabled = useCallback(async (enabled: boolean) => {
    if (!match?.id) return;
    unlockAudioContext();
    const auth = getActiveAuth(match.id);
    const result = await MatchTimerService.setShotClockEnabled(match.id, enabled, {
      epoch: auth.epoch,
      expectedQuarter: match.currentQuarter,
      tabId: auth.tabId
    });
    setLastOperationResult(result as unknown as TimerOperationResult);
  }, [match, getActiveAuth]);

  const isPossessionAssistantEnabled = Boolean(match?.possessionAssistant?.enabled);
  const possessionAssistantHaptics = match?.possessionAssistant?.hapticsEnabled !== false;

  const setPossessionAssistantEnabled = useCallback(async (enabled: boolean, hapticsEnabled: boolean = true) => {
    if (!match?.id) return;
    unlockAudioContext();
    const auth = getActiveAuth(match.id);
    const result = await MatchTimerService.setPossessionAssistantEnabled(match.id, enabled, hapticsEnabled, {
      epoch: auth.epoch,
      expectedQuarter: match.currentQuarter,
      tabId: auth.tabId
    });
    setLastOperationResult(result as unknown as TimerOperationResult);
  }, [match, getActiveAuth]);

  const applyPossessionTurnover = useCallback(async () => {
    if (!match?.id) return;
    unlockAudioContext();
    shotClockBuzzerPlayedRef.current = false;
    const auth = getActiveAuth(match.id);
    const result = await MatchTimerService.applyPossessionTurnover(match.id, {
      epoch: auth.epoch,
      expectedQuarter: match.currentQuarter,
      tabId: auth.tabId
    });
    if (result.status === 'applied') {
      triggerHaptic('turnover', match.possessionAssistant?.hapticsEnabled !== false);
    }
    setLastOperationResult(result as unknown as TimerOperationResult);
  }, [match, getActiveAuth]);

  const setPossession = useCallback(async (possession: 'local' | 'visitor' | null) => {
    if (!match?.id) return;
    const auth = getActiveAuth(match.id);
    const result = await MatchTimerService.setPossession(match.id, possession, {
      epoch: auth.epoch,
      expectedQuarter: match.currentQuarter,
      tabId: auth.tabId
    });
    setLastOperationResult(result as unknown as TimerOperationResult);
  }, [match, getActiveAuth]);

  return {
    timeLeft,
    isRunning,
    hasAuthority: authorityState.hasAuthority || (match?.id ? timerAuthorityCoordinator.getAuthorityState(match.id).hasAuthority : false),
    isOwner: authorityState.isOwner || (match?.id ? timerAuthorityCoordinator.getAuthorityState(match.id).isOwner : false),
    ownerTabId: authorityState.ownerTabId ?? (match?.id ? timerAuthorityCoordinator.getAuthorityState(match.id).ownerTabId : null),
    epoch: authorityState.epoch || (match?.id ? timerAuthorityCoordinator.getAuthorityState(match.id).epoch : 0),
    requestAuthorityTransfer,
    lastOperationResult,
    toggleTimer,
    pauseTimer,
    resetTimer,
    adjustTime,
    keepTimerRunningOnUnmount,
    confidence,
    isClockShiftDetected,
    resolveRecovery,
    timerRecoveryState,
    shotClockTimeLeft,
    isShotClockRunning,
    isShotClockExpired,
    isShotClockEnabled,
    resetShotClock,
    setShotClockEnabled,
    isPossessionAssistantEnabled,
    possessionAssistantHaptics,
    setPossessionAssistantEnabled,
    applyPossessionTurnover,
    setPossession
  };
}
