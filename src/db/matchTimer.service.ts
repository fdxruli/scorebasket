// src/db/matchTimer.service.ts
import { db } from './db';
import type { Match } from './models/Match';
import { timerAuthorityCoordinator } from '../services/timerAuthority.coordinator';

export type TimerOperationStatus =
  | 'applied'
  | 'already_applied'
  | 'rejected'
  | 'not_owner'
  | 'finished'
  | 'stale_operation'
  | 'unavailable';

export interface TimerOperationResult {
  status: TimerOperationStatus;
  matchId: number;
  timerSecondsRemaining: number;
  isRunning: boolean;
  reason?: string;
  expired?: boolean;
  epoch?: number;
}

export interface TimerSnapshot {
  matchId: number;
  timerSecondsRemaining: number;
  isRunning: boolean;
  effectiveTimeLeft: number;
  status: Match['status'];
  currentQuarter?: number;
  timerLastStart?: Date;
}

export interface TimerServiceOptions {
  /** Marca de tiempo absoluta en ms para determinismo en pruebas y reconciliación */
  nowMs?: number;
  /** Identificador de pestaña que ejecuta la operación (para control de autoridad) */
  tabId?: string;
  /** Época de autoridad con la que se emitió la operación (fencing token) */
  epoch?: number;
  /** Periodo o cuarto esperado; si la BD cambió de periodo, se rechaza para evitar stale writes */
  expectedQuarter?: number;
  /** Permite a pruebas simular el reloj monotónico (performance.now) */
  simulatedPerfNowMs?: number;
}

/**
 * Almacenamiento en memoria para medición monotónica basada en performance.now()
 * durante la misma sesión de la pestaña propietaria (Precisión Temporal / C-20).
 */
const sessionMonotonicStarts = new Map<number, { perfStart: number; wallStartMs: number }>();

function calculateMonotonicElapsed(
  matchId: number,
  lastStartMs: number,
  nowMs: number,
  options?: TimerServiceOptions
): {
  elapsedSeconds: number;
  isClockShiftDetected: boolean;
  clockShiftSeverity: 'none' | 'backward' | 'forward_jump';
} {
  if (nowMs < lastStartMs) {
    return {
      elapsedSeconds: 0,
      isClockShiftDetected: true,
      clockShiftSeverity: 'backward'
    };
  }

  const wallElapsed = (nowMs - lastStartMs) / 1000;
  const localSession = sessionMonotonicStarts.get(matchId);

  // Verificación monotónica si se simula explícitamente o si estamos en runtime real sin nowMs artificial
  if (localSession && localSession.wallStartMs === lastStartMs) {
    let perfElapsed: number | null = null;

    if (options?.simulatedPerfNowMs !== undefined) {
      perfElapsed = Math.max(0, (options.simulatedPerfNowMs - localSession.perfStart) / 1000);
    } else if (options?.nowMs === undefined && typeof performance !== 'undefined' && typeof performance.now === 'function') {
      perfElapsed = Math.max(0, (performance.now() - localSession.perfStart) / 1000);
    }

    if (perfElapsed !== null) {
      if (Math.abs(wallElapsed - perfElapsed) > 10) {
        return {
          elapsedSeconds: perfElapsed,
          isClockShiftDetected: true,
          clockShiftSeverity: wallElapsed > perfElapsed ? 'forward_jump' : 'backward'
        };
      }
      return {
        elapsedSeconds: perfElapsed,
        isClockShiftDetected: false,
        clockShiftSeverity: 'none'
      };
    }
  }

  // Medición estándar entre sesiones o pruebas deterministas
  const isSuspiciousJump = wallElapsed > 86400; // > 24 horas
  return {
    elapsedSeconds: wallElapsed,
    isClockShiftDetected: isSuspiciousJump,
    clockShiftSeverity: isSuspiciousJump ? 'forward_jump' : 'none'
  };
}

/**
 * Servicio Central de Autoridad y Dominio del Cronómetro (Fase 2C).
 */
export const MatchTimerService = {
  /**
   * Obtiene una instantánea determinista del estado actual del cronómetro.
   */
  async getSnapshot(matchId: number, nowMs = Date.now()): Promise<TimerSnapshot | null> {
    const match = await db.matches.get(matchId);
    if (!match) return null;

    const baseRemaining = Math.max(0, match.timerSecondsRemaining ?? 0);
    const isRunning = Boolean(match.timerLastStart);
    let effective = baseRemaining;

    if (isRunning && match.timerLastStart) {
      const isCustomNow = Math.abs(nowMs - Date.now()) > 1000;
      const { elapsedSeconds } = calculateMonotonicElapsed(
        matchId,
        match.timerLastStart.getTime(),
        nowMs,
        isCustomNow ? { nowMs } : undefined
      );
      effective = Math.max(0, baseRemaining - elapsedSeconds);
    }

    return {
      matchId,
      timerSecondsRemaining: baseRemaining,
      isRunning,
      effectiveTimeLeft: effective,
      status: match.status,
      currentQuarter: match.currentQuarter,
      timerLastStart: match.timerLastStart
    };
  },

  /**
   * Valida la autoridad del invocador antes de procesar una operación (comprobación previa).
   */
  _validateAuthority(
    matchId: number,
    options?: TimerServiceOptions
  ): { valid: boolean; reason?: string; epoch: number; tabId: string } {
    const authState = timerAuthorityCoordinator.getAuthorityState(matchId);
    const tabId = options?.tabId ?? authState.tabId;
    const epoch = options?.epoch ?? authState.epoch;

    const isCurrentTab = tabId === authState.tabId;
    if (!authState.hasAuthority || !isCurrentTab) {
      return {
        valid: false,
        reason: 'Esta pestaña no posee la autoridad del cronómetro para este partido.',
        epoch,
        tabId
      };
    }

    if (options?.epoch !== undefined && options.epoch !== authState.epoch) {
      return {
        valid: false,
        reason: `Operación atrasada (fencing epoch ${options.epoch} !== actual ${authState.epoch}).`,
        epoch,
        tabId
      };
    }

    return { valid: true, epoch, tabId };
  },

  /**
   * Inicia el cronómetro del partido de forma atómica y transaccional con fencing (C-11).
   */
  async start(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    const matchBefore = await db.matches.get(matchId);
    if (!matchBefore) {
      return {
        status: 'rejected',
        matchId,
        timerSecondsRemaining: 0,
        isRunning: false,
        reason: 'El partido no existe.'
      };
    }

    if (matchBefore.status === 'finished') {
      return {
        status: 'finished',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: false,
        reason: 'El partido ya ha finalizado. No se puede reactivar el cronómetro.'
      };
    }

    const authorityCheck = this._validateAuthority(matchId, options);
    if (!authorityCheck.valid) {
      return {
        status: 'not_owner',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: Boolean(matchBefore.timerLastStart),
        reason: authorityCheck.reason
      };
    }

    const nowMs = options?.nowMs ?? Date.now();

    const opPromise = db.transaction('rw', db.matches, async (): Promise<TimerOperationResult> => {
      const match = await db.matches.get(matchId);
      if (!match) {
        return {
          status: 'rejected',
          matchId,
          timerSecondsRemaining: 0,
          isRunning: false,
          reason: 'El partido no existe.'
        };
      }

      if (match.status === 'finished') {
        return {
          status: 'finished',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: false,
          reason: 'El partido ya ha finalizado. No se puede reactivar el cronómetro.'
        };
      }

      // Validar periodo esperado (INV-T10)
      if (options?.expectedQuarter !== undefined && match.currentQuarter !== options.expectedQuarter) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: `Periodo no coincide (esperado: ${options.expectedQuarter}, actual: ${match.currentQuarter}).`
        };
      }

      // Re-verificación de autoridad y fencing dentro del commit boundary (C-11 / C-19)
      const currentAuth = timerAuthorityCoordinator.getAuthorityState(matchId);
      const callerEpoch = options?.epoch ?? currentAuth.epoch;
      const callerTabId = options?.tabId ?? currentAuth.tabId;

      if (!currentAuth.hasAuthority) {
        return {
          status: 'not_owner',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: 'Esta pestaña no posee la autoridad del cronómetro para este partido.'
        };
      }
      if (options?.epoch !== undefined && options.epoch !== currentAuth.epoch) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: `Operación atrasada localmente (fencing epoch ${options.epoch} !== actual ${currentAuth.epoch}).`
        };
      }
      const persistedEpoch = match.timerEpoch ?? 0;
      if (callerEpoch < persistedEpoch) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: `Operación atrasada respecto a la base de datos (epoch ${callerEpoch} < persistido ${persistedEpoch}).`
        };
      }

      // Si ya está corriendo, idempotencia estricta: NO sobreescribir timerLastStart (TC-04)
      if (match.timerLastStart) {
        return {
          status: 'already_applied',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: true,
          epoch: callerEpoch
        };
      }

      const remaining = Math.max(0, match.timerSecondsRemaining ?? 0);
      if (remaining <= 0) {
        return {
          status: 'rejected',
          matchId,
          timerSecondsRemaining: 0,
          isRunning: false,
          reason: 'No se puede iniciar el cronómetro con 00:00 restantes en el periodo.'
        };
      }

      const startDate = new Date(nowMs);
      await db.matches.update(matchId, {
        timerLastStart: startDate,
        status: 'playing',
        timerEpoch: callerEpoch,
        timerOwnerTabId: callerTabId
      });

      // Medición monotónica de hardware en la sesión actual
      sessionMonotonicStarts.set(matchId, {
        perfStart:
          options?.simulatedPerfNowMs ??
          (typeof performance !== 'undefined' ? performance.now() : 0),
        wallStartMs: nowMs
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: remaining,
        isRunning: true,
        epoch: callerEpoch
      };
    });

    return await timerAuthorityCoordinator.trackOperation(matchId, opPromise);
  },

  /**
   * Pausa el cronómetro de forma atómica, idempotente y monotónica con fencing (C-11).
   */
  async pause(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    const matchBefore = await db.matches.get(matchId);
    if (!matchBefore) {
      return {
        status: 'rejected',
        matchId,
        timerSecondsRemaining: 0,
        isRunning: false,
        reason: 'El partido no existe.'
      };
    }

    if (matchBefore.status === 'finished') {
      return {
        status: 'finished',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: false,
        reason: 'El partido ya ha finalizado. No se puede pausar un partido concluido.'
      };
    }

    const authorityCheck = this._validateAuthority(matchId, options);
    if (!authorityCheck.valid) {
      return {
        status: 'not_owner',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: Boolean(matchBefore.timerLastStart),
        reason: authorityCheck.reason
      };
    }

    const nowMs = options?.nowMs ?? Date.now();

    const opPromise = db.transaction('rw', db.matches, async (): Promise<TimerOperationResult> => {
      const match = await db.matches.get(matchId);
      if (!match) {
        return {
          status: 'rejected',
          matchId,
          timerSecondsRemaining: 0,
          isRunning: false,
          reason: 'El partido no existe.'
        };
      }

      if (match.status === 'finished') {
        return {
          status: 'finished',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: false,
          reason: 'El partido ya ha finalizado.'
        };
      }

      if (options?.expectedQuarter !== undefined && match.currentQuarter !== options.expectedQuarter) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: `Periodo no coincide (esperado: ${options.expectedQuarter}, actual: ${match.currentQuarter}).`
        };
      }

      // Re-verificación de autoridad y fencing dentro de la transacción (C-11 / C-19)
      const currentAuth = timerAuthorityCoordinator.getAuthorityState(matchId);
      const callerEpoch = options?.epoch ?? currentAuth.epoch;
      const callerTabId = options?.tabId ?? currentAuth.tabId;

      if (!currentAuth.hasAuthority) {
        return {
          status: 'not_owner',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: 'Esta pestaña no posee la autoridad del cronómetro para este partido.'
        };
      }
      if (options?.epoch !== undefined && options.epoch !== currentAuth.epoch) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: `Operación atrasada localmente (fencing epoch ${options.epoch} !== actual ${currentAuth.epoch}).`
        };
      }
      const persistedEpoch = match.timerEpoch ?? 0;
      if (callerEpoch < persistedEpoch) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: `Operación atrasada respecto a la base de datos (epoch ${callerEpoch} < persistido ${persistedEpoch}).`
        };
      }

      const currentRemaining = Math.max(0, match.timerSecondsRemaining ?? 0);

      // Si ya está pausado, retorno idempotente sin alteraciones (INV-T02)
      if (!match.timerLastStart) {
        return {
          status: 'already_applied',
          matchId,
          timerSecondsRemaining: currentRemaining,
          isRunning: false,
          epoch: callerEpoch
        };
      }

      // Cálculo monotónico con protección contra retrocesos y saltos sospechosos (INV-T08 / Precisión Temporal)
      const lastStartMs = match.timerLastStart.getTime();
      const { elapsedSeconds } = calculateMonotonicElapsed(matchId, lastStartMs, nowMs, options);
      const newRemaining = Math.max(0, currentRemaining - elapsedSeconds);
      sessionMonotonicStarts.delete(matchId);

      await db.matches.update(matchId, {
        timerLastStart: undefined,
        timerSecondsRemaining: newRemaining,
        timerEpoch: callerEpoch,
        timerOwnerTabId: callerTabId
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: newRemaining,
        isRunning: false,
        epoch: callerEpoch
      };
    });

    return await timerAuthorityCoordinator.trackOperation(matchId, opPromise);
  },

  /**
   * Alterna entre iniciar y pausar de forma transaccional y atómica.
   */
  async toggle(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    const snapshot = await this.getSnapshot(matchId);
    if (!snapshot) {
      return {
        status: 'rejected',
        matchId,
        timerSecondsRemaining: 0,
        isRunning: false,
        reason: 'El partido no existe.'
      };
    }

    if (snapshot.status === 'finished') {
      return {
        status: 'finished',
        matchId,
        timerSecondsRemaining: snapshot.timerSecondsRemaining,
        isRunning: false,
        reason: 'El partido ya ha finalizado. toggleTimer no puede volver a activarlo.'
      };
    }

    if (snapshot.isRunning) {
      return await this.pause(matchId, options);
    } else {
      return await this.start(matchId, options);
    }
  },

  /**
   * Reinicia el cronómetro a la duración oficial del cuarto/periodo (pausado).
   */
  async reset(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    const matchBefore = await db.matches.get(matchId);
    if (!matchBefore) {
      return {
        status: 'rejected',
        matchId,
        timerSecondsRemaining: 0,
        isRunning: false,
        reason: 'El partido no existe.'
      };
    }

    if (matchBefore.status === 'finished') {
      return {
        status: 'finished',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: false,
        reason: 'No se puede reiniciar el reloj de un partido finalizado.'
      };
    }

    const authorityCheck = this._validateAuthority(matchId, options);
    if (!authorityCheck.valid) {
      return {
        status: 'not_owner',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: Boolean(matchBefore.timerLastStart),
        reason: authorityCheck.reason
      };
    }

    const opPromise = db.transaction('rw', db.matches, async (): Promise<TimerOperationResult> => {
      const match = await db.matches.get(matchId);
      if (!match) {
        return {
          status: 'rejected',
          matchId,
          timerSecondsRemaining: 0,
          isRunning: false,
          reason: 'El partido no existe.'
        };
      }

      if (match.status === 'finished') {
        return {
          status: 'finished',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: false,
          reason: 'No se puede reiniciar el reloj de un partido finalizado.'
        };
      }

      if (options?.expectedQuarter !== undefined && match.currentQuarter !== options.expectedQuarter) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: `Periodo no coincide (esperado: ${options.expectedQuarter}, actual: ${match.currentQuarter}).`
        };
      }

      const currentAuth = timerAuthorityCoordinator.getAuthorityState(matchId);
      const callerEpoch = options?.epoch ?? currentAuth.epoch;
      const callerTabId = options?.tabId ?? currentAuth.tabId;

      if (!currentAuth.hasAuthority) {
        return {
          status: 'not_owner',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: 'Esta pestaña no posee la autoridad del cronómetro para este partido.'
        };
      }
      if (options?.epoch !== undefined && options.epoch !== currentAuth.epoch) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: `Operación atrasada localmente (fencing epoch ${options.epoch} !== actual ${currentAuth.epoch}).`
        };
      }
      const persistedEpoch = match.timerEpoch ?? 0;
      if (callerEpoch < persistedEpoch) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: `Operación atrasada respecto a la base de datos (epoch ${callerEpoch} < persistido ${persistedEpoch}).`
        };
      }

      const durationMinutes =
        match.config?.traditional?.minutesPerQuarter ??
        match.quarterDuration ??
        10;
      const targetSeconds = durationMinutes * 60;

      await db.matches.update(matchId, {
        timerSecondsRemaining: targetSeconds,
        timerLastStart: undefined,
        timerEpoch: callerEpoch,
        timerOwnerTabId: callerTabId
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: targetSeconds,
        isRunning: false,
        epoch: callerEpoch
      };
    });

    return await timerAuthorityCoordinator.trackOperation(matchId, opPromise);
  },

  /**
   * Ajusta manualmente el tiempo restante (en segundos delta).
   * Solo está permitido cuando el reloj está pausado (INV-T09) y con autoridad válida.
   */
  async adjust(matchId: number, deltaSeconds: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    const matchBefore = await db.matches.get(matchId);
    if (!matchBefore) {
      return {
        status: 'rejected',
        matchId,
        timerSecondsRemaining: 0,
        isRunning: false,
        reason: 'El partido no existe.'
      };
    }

    if (matchBefore.status === 'finished') {
      return {
        status: 'finished',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: false,
        reason: 'No se puede ajustar el reloj de un partido finalizado.'
      };
    }

    if (matchBefore.timerLastStart) {
      return {
        status: 'rejected',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: true,
        reason: 'No se puede ajustar el reloj mientras está en marcha. Debe pausarse primero.'
      };
    }

    const authorityCheck = this._validateAuthority(matchId, options);
    if (!authorityCheck.valid) {
      return {
        status: 'not_owner',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: false,
        reason: authorityCheck.reason
      };
    }

    const opPromise = db.transaction('rw', db.matches, async (): Promise<TimerOperationResult> => {
      const match = await db.matches.get(matchId);
      if (!match) {
        return {
          status: 'rejected',
          matchId,
          timerSecondsRemaining: 0,
          isRunning: false,
          reason: 'El partido no existe.'
        };
      }

      if (match.status === 'finished') {
        return {
          status: 'finished',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: false,
          reason: 'No se puede ajustar el reloj de un partido finalizado.'
        };
      }

      if (match.timerLastStart) {
        return {
          status: 'rejected',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: true,
          reason: 'No se puede ajustar el reloj mientras está en marcha. Debe pausarse primero.'
        };
      }

      if (options?.expectedQuarter !== undefined && match.currentQuarter !== options.expectedQuarter) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: false,
          reason: `Periodo no coincide (esperado: ${options.expectedQuarter}, actual: ${match.currentQuarter}).`
        };
      }

      const currentAuth = timerAuthorityCoordinator.getAuthorityState(matchId);
      const callerEpoch = options?.epoch ?? currentAuth.epoch;
      const callerTabId = options?.tabId ?? currentAuth.tabId;

      if (!currentAuth.hasAuthority) {
        return {
          status: 'not_owner',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: false,
          reason: 'Esta pestaña no posee la autoridad del cronómetro para este partido.'
        };
      }
      if (options?.epoch !== undefined && options.epoch !== currentAuth.epoch) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: false,
          reason: `Operación atrasada localmente (fencing epoch ${options.epoch} !== actual ${currentAuth.epoch}).`
        };
      }
      const persistedEpoch = match.timerEpoch ?? 0;
      if (callerEpoch < persistedEpoch) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: false,
          reason: `Operación atrasada respecto a la base de datos (epoch ${callerEpoch} < persistido ${persistedEpoch}).`
        };
      }

      const currentSecs = Math.ceil(match.timerSecondsRemaining ?? 0);
      const nextSecs = Math.max(0, currentSecs + deltaSeconds);

      await db.matches.update(matchId, {
        timerSecondsRemaining: nextSecs,
        timerLastStart: undefined,
        timerEpoch: callerEpoch,
        timerOwnerTabId: callerTabId
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: nextSecs,
        isRunning: false,
        epoch: callerEpoch
      };
    });

    return await timerAuthorityCoordinator.trackOperation(matchId, opPromise);
  },

  /**
   * Reconcilia el cronómetro tras suspensión de PWA, cambio de visibilidad,
   * bloqueo de pantalla o descarte de proceso.
   * - Propietario: calcula y persiste en IndexedDB si expiró (C-12).
   * - Observador: calcula puramente en memoria sin realizar escrituras en BD (C-12).
   */
  async reconcile(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    const nowMs = options?.nowMs ?? Date.now();

    const opPromise = db.transaction('rw', db.matches, async (): Promise<TimerOperationResult> => {
      const match = await db.matches.get(matchId);
      if (!match) {
        return {
          status: 'rejected',
          matchId,
          timerSecondsRemaining: 0,
          isRunning: false,
          reason: 'El partido no existe.'
        };
      }

      const baseRemaining = Math.max(0, match.timerSecondsRemaining ?? 0);

      if (!match.timerLastStart) {
        return {
          status: 'already_applied',
          matchId,
          timerSecondsRemaining: baseRemaining,
          isRunning: false,
          expired: baseRemaining <= 0
        };
      }

      const lastStartMs = match.timerLastStart.getTime();
      const { elapsedSeconds } = calculateMonotonicElapsed(matchId, lastStartMs, nowMs, options);
      const newRemaining = Math.max(0, baseRemaining - elapsedSeconds);

      // C-12: Comprobar si quien reconcilia tiene autoridad de escritura en BD
      const currentAuth = timerAuthorityCoordinator.getAuthorityState(matchId);
      const isOwner =
        currentAuth.hasAuthority &&
        (options?.epoch === undefined || options.epoch === currentAuth.epoch);

      if (!isOwner) {
        // Pestaña observadora: cálculo de solo lectura, NUNCA escribe en BD (C-12)
        return {
          status: 'already_applied',
          matchId,
          timerSecondsRemaining: Math.max(0, newRemaining),
          isRunning: newRemaining > 0,
          expired: newRemaining <= 0,
          reason: 'Reconciliación en modo observador (solo lectura, sin mutación en BD).'
        };
      }

      if (newRemaining <= 0) {
        // Expiró durante la suspensión o ejecución: persistir fin de cuarto
        sessionMonotonicStarts.delete(matchId);
        await db.matches.update(matchId, {
          timerLastStart: undefined,
          timerSecondsRemaining: 0,
          timerEpoch: currentAuth.epoch,
          timerOwnerTabId: currentAuth.tabId
        });

        return {
          status: 'applied',
          matchId,
          timerSecondsRemaining: 0,
          isRunning: false,
          expired: true,
          epoch: currentAuth.epoch
        };
      } else {
        // Sigue corriendo: actualizamos el tiempo restante en memoria sin pausar
        return {
          status: 'applied',
          matchId,
          timerSecondsRemaining: newRemaining,
          isRunning: true,
          expired: false,
          epoch: currentAuth.epoch
        };
      }
    });

    return await timerAuthorityCoordinator.trackOperation(matchId, opPromise);
  },

  /**
   * Avanza al siguiente cuarto reglamentario con verificación transaccional de autoridad (C-13).
   */
  async advanceQuarter(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    const matchBefore = await db.matches.get(matchId);
    if (!matchBefore) {
      return {
        status: 'rejected',
        matchId,
        timerSecondsRemaining: 0,
        isRunning: false,
        reason: 'El partido no existe.'
      };
    }

    if (matchBefore.status === 'finished') {
      return {
        status: 'finished',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: false,
        reason: 'El partido ya ha finalizado. No se puede avanzar de cuarto.'
      };
    }

    const authorityCheck = this._validateAuthority(matchId, options);
    if (!authorityCheck.valid) {
      return {
        status: 'not_owner',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: Boolean(matchBefore.timerLastStart),
        reason: authorityCheck.reason
      };
    }

    const opPromise = db.transaction('rw', db.matches, async (): Promise<TimerOperationResult> => {
      const match = await db.matches.get(matchId);
      if (!match) {
        return { status: 'rejected', matchId, timerSecondsRemaining: 0, isRunning: false, reason: 'El partido no existe.' };
      }
      if (match.status === 'finished') {
        return { status: 'finished', matchId, timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0), isRunning: false, reason: 'El partido ya ha finalizado.' };
      }

      if (options?.expectedQuarter !== undefined && match.currentQuarter !== options.expectedQuarter) {
        return { status: 'stale_operation', matchId, timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0), isRunning: false, reason: `Periodo no coincide.` };
      }

      const currentAuth = timerAuthorityCoordinator.getAuthorityState(matchId);
      const callerEpoch = options?.epoch ?? currentAuth.epoch;
      const callerTabId = options?.tabId ?? currentAuth.tabId;

      if (!currentAuth.hasAuthority) {
        return { status: 'not_owner', matchId, timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0), isRunning: false, reason: 'No posee autoridad.' };
      }
      if (options?.epoch !== undefined && options.epoch !== currentAuth.epoch) {
        return { status: 'stale_operation', matchId, timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0), isRunning: false, reason: 'Epoch atrasado.' };
      }
      const persistedEpoch = match.timerEpoch ?? 0;
      if (callerEpoch < persistedEpoch) {
        return { status: 'stale_operation', matchId, timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0), isRunning: false, reason: 'Epoch menor que base de datos.' };
      }

      const quartersConfig = match.config?.traditional?.totalQuarters || match.totalQuarters || 4;
      const minutesPerQuarter = match.config?.traditional?.minutesPerQuarter || match.quarterDuration || 10;
      const currentQ = match.currentQuarter || 1;

      if (currentQ >= quartersConfig) {
        return { status: 'rejected', matchId, timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0), isRunning: false, reason: 'Ya se alcanzó el último cuarto reglamentario.' };
      }

      const nextQ = currentQ + 1;
      const isNewHalf = currentQ === 2 && nextQ === 3;
      const targetSeconds = minutesPerQuarter * 60;

      sessionMonotonicStarts.delete(matchId);

      await db.matches.update(matchId, {
        currentQuarter: nextQ,
        timerSecondsRemaining: targetSeconds,
        timerLastStart: undefined,
        timerEpoch: callerEpoch,
        timerOwnerTabId: callerTabId,
        ...(isNewHalf ? { localTimeouts: 0, visitorTimeouts: 0 } : {})
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: targetSeconds,
        isRunning: false,
        epoch: callerEpoch
      };
    });

    return await timerAuthorityCoordinator.trackOperation(matchId, opPromise);
  },

  /**
   * Inicia tiempo extra (OT) de forma transaccional con verificación de autoridad (C-13).
   */
  async startOvertime(matchId: number, overtimeMinutes = 5, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    const matchBefore = await db.matches.get(matchId);
    if (!matchBefore) {
      return { status: 'rejected', matchId, timerSecondsRemaining: 0, isRunning: false, reason: 'El partido no existe.' };
    }
    if (matchBefore.status === 'finished') {
      return { status: 'finished', matchId, timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0), isRunning: false, reason: 'El partido ya ha finalizado.' };
    }

    const authorityCheck = this._validateAuthority(matchId, options);
    if (!authorityCheck.valid) {
      return { status: 'not_owner', matchId, timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0), isRunning: false, reason: authorityCheck.reason };
    }

    const opPromise = db.transaction('rw', db.matches, async (): Promise<TimerOperationResult> => {
      const match = await db.matches.get(matchId);
      if (!match) return { status: 'rejected', matchId, timerSecondsRemaining: 0, isRunning: false, reason: 'El partido no existe.' };
      if (match.status === 'finished') return { status: 'finished', matchId, timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0), isRunning: false, reason: 'El partido ya ha finalizado.' };

      const currentAuth = timerAuthorityCoordinator.getAuthorityState(matchId);
      const callerEpoch = options?.epoch ?? currentAuth.epoch;
      const callerTabId = options?.tabId ?? currentAuth.tabId;

      if (!currentAuth.hasAuthority) {
        return { status: 'not_owner', matchId, timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0), isRunning: false, reason: 'No posee autoridad.' };
      }
      if (options?.epoch !== undefined && options.epoch !== currentAuth.epoch) {
        return { status: 'stale_operation', matchId, timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0), isRunning: false, reason: 'Epoch atrasado.' };
      }
      const persistedEpoch = match.timerEpoch ?? 0;
      if (callerEpoch < persistedEpoch) {
        return { status: 'stale_operation', matchId, timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0), isRunning: false, reason: 'Epoch menor que base de datos.' };
      }

      const quartersConfig = match.config?.traditional?.totalQuarters || match.totalQuarters || 4;
      const nextQ = (match.currentQuarter || quartersConfig) + 1;
      const targetSeconds = overtimeMinutes * 60;

      sessionMonotonicStarts.delete(matchId);

      await db.matches.update(matchId, {
        currentQuarter: nextQ,
        timerSecondsRemaining: targetSeconds,
        timerLastStart: undefined,
        timerEpoch: callerEpoch,
        timerOwnerTabId: callerTabId,
        localTimeouts: 0,
        visitorTimeouts: 0
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: targetSeconds,
        isRunning: false,
        epoch: callerEpoch
      };
    });

    return await timerAuthorityCoordinator.trackOperation(matchId, opPromise);
  },

  /**
   * Finaliza el partido de forma atómica y transaccional con verificación de autoridad y fencing (C-19).
   */
  async endMatch(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    const matchBefore = await db.matches.get(matchId);
    if (!matchBefore) {
      return {
        status: 'rejected',
        matchId,
        timerSecondsRemaining: 0,
        isRunning: false,
        reason: 'El partido no existe.'
      };
    }

    if (matchBefore.status === 'finished') {
      return {
        status: 'already_applied',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: false,
        reason: 'El partido ya ha finalizado.'
      };
    }

    const authorityCheck = this._validateAuthority(matchId, options);
    if (!authorityCheck.valid) {
      return {
        status: 'not_owner',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: Boolean(matchBefore.timerLastStart),
        reason: authorityCheck.reason
      };
    }

    const nowMs = options?.nowMs ?? Date.now();

    const opPromise = db.transaction('rw', db.matches, async (): Promise<TimerOperationResult> => {
      const match = await db.matches.get(matchId);
      if (!match) {
        return {
          status: 'rejected',
          matchId,
          timerSecondsRemaining: 0,
          isRunning: false,
          reason: 'El partido no existe.'
        };
      }

      if (match.status === 'finished') {
        return {
          status: 'already_applied',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: false,
          reason: 'El partido ya ha finalizado.'
        };
      }

      if (options?.expectedQuarter !== undefined && match.currentQuarter !== options.expectedQuarter) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: `Periodo no coincide (esperado: ${options.expectedQuarter}, actual: ${match.currentQuarter}).`
        };
      }

      const currentAuth = timerAuthorityCoordinator.getAuthorityState(matchId);
      const callerEpoch = options?.epoch ?? currentAuth.epoch;
      const callerTabId = options?.tabId ?? currentAuth.tabId;

      if (!currentAuth.hasAuthority) {
        return {
          status: 'not_owner',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: 'Esta pestaña no posee la autoridad del cronómetro para este partido.'
        };
      }
      if (options?.epoch !== undefined && options.epoch !== currentAuth.epoch) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: `Operación atrasada localmente (fencing epoch ${options.epoch} !== actual ${currentAuth.epoch}).`
        };
      }
      const persistedEpoch = match.timerEpoch ?? 0;
      if (callerEpoch < persistedEpoch) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match.timerLastStart),
          reason: `Operación atrasada respecto a la base de datos (epoch ${callerEpoch} < persistido ${persistedEpoch}).`
        };
      }

      const baseRemaining = Math.max(0, match.timerSecondsRemaining ?? 0);
      let effectiveRemaining = baseRemaining;
      if (match.timerLastStart) {
        const { elapsedSeconds } = calculateMonotonicElapsed(
          matchId,
          match.timerLastStart.getTime(),
          nowMs,
          options
        );
        effectiveRemaining = Math.max(0, baseRemaining - elapsedSeconds);
      }

      sessionMonotonicStarts.delete(matchId);

      const nextEpoch = Math.max(callerEpoch, persistedEpoch) + 1;

      await db.matches.update(matchId, {
        status: 'finished',
        finishedAt: new Date(nowMs),
        timerSecondsRemaining: effectiveRemaining,
        timerLastStart: undefined,
        timerEpoch: nextEpoch,
        timerOwnerTabId: callerTabId,
        timerLeaseExpiresAt: 0
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: effectiveRemaining,
        isRunning: false,
        epoch: nextEpoch
      };
    });

    return await timerAuthorityCoordinator.trackOperation(matchId, opPromise);
  }
};
