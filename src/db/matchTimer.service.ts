// src/db/matchTimer.service.ts
import { db } from './db';
import type { Match } from './models/Match';
import { timerAuthorityCoordinator, type TimerAuthorityCoordinator } from '../services/timerAuthority.coordinator';

export type TimerOperationStatus =
  | 'applied'
  | 'already_applied'
  | 'rejected'
  | 'not_owner'
  | 'finished'
  | 'stale_operation'
  | 'unavailable';

export type TimePrecisionSource = 'monotonic_session' | 'wall_clock_recovered' | 'anomalous_clamp';
export type TimeConfidence = 'high' | 'approximate' | 'uncertain';

export interface TimerOperationResult {
  status: TimerOperationStatus;
  matchId: number;
  timerSecondsRemaining: number;
  isRunning: boolean;
  reason?: string;
  expired?: boolean;
  epoch?: number;
  precisionSource?: TimePrecisionSource;
  confidence?: TimeConfidence;
}

export interface TimerSnapshot {
  matchId: number;
  timerSecondsRemaining: number;
  isRunning: boolean;
  effectiveTimeLeft: number;
  status: Match['status'];
  currentQuarter?: number;
  timerLastStart?: Date;
  precisionSource?: TimePrecisionSource;
  confidence?: TimeConfidence;
  isClockShiftDetected?: boolean;
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
  /** Instancia de coordinador de autoridad que ejecuta la operación (por defecto singleton) */
  coordinator?: TimerAuthorityCoordinator;
}

export interface TransactionalAuthorityVerification {
  authorized: boolean;
  status: 'applied' | 'not_owner' | 'stale_operation' | 'finished' | 'rejected';
  reason?: string;
  callerEpoch: number;
  callerTabId: string;
}

/**
 * Almacenamiento en memoria para medición monotónica basada en performance.now()
 * durante la misma sesión de la pestaña propietaria (Precisión Temporal / C-20 / C-24).
 */
const sessionMonotonicStarts = new Map<number, { perfStart: number; wallStartMs: number }>();

export interface MonotonicElapsedResult {
  elapsedSeconds: number;
  source: TimePrecisionSource;
  isClockShiftDetected: boolean;
  clockShiftSeverity: 'none' | 'backward' | 'forward_jump';
  confidence: TimeConfidence;
}

function calculateMonotonicElapsed(
  matchId: number,
  lastStartMs: number,
  nowMs: number,
  options?: TimerServiceOptions
): MonotonicElapsedResult {
  if (nowMs < lastStartMs) {
    return {
      elapsedSeconds: 0,
      source: 'anomalous_clamp',
      isClockShiftDetected: true,
      clockShiftSeverity: 'backward',
      confidence: 'uncertain'
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
      const isShift = Math.abs(wallElapsed - perfElapsed) > 10;
      return {
        elapsedSeconds: perfElapsed,
        source: 'monotonic_session',
        isClockShiftDetected: isShift,
        clockShiftSeverity: isShift ? (wallElapsed > perfElapsed ? 'forward_jump' : 'backward') : 'none',
        confidence: 'high'
      };
    }
  }

  // Medición estándar entre sesiones o pruebas deterministas
  const isSuspiciousJump = wallElapsed > 86400; // > 24 horas
  return {
    elapsedSeconds: wallElapsed,
    source: isSuspiciousJump ? 'anomalous_clamp' : 'wall_clock_recovered',
    isClockShiftDetected: isSuspiciousJump,
    clockShiftSeverity: isSuspiciousJump ? 'forward_jump' : 'none',
    confidence: isSuspiciousJump ? 'uncertain' : 'approximate'
  };
}

/**
 * Servicio Central de Autoridad y Dominio del Cronómetro (Fase 2C).
 */
export const MatchTimerService = {
  /**
   * Obtiene una instantánea determinista del estado actual del cronómetro.
   */
  async getSnapshot(
    matchId: number,
    nowMsOrOptions: number | TimerServiceOptions = Date.now()
  ): Promise<TimerSnapshot | null> {
    const nowMs = typeof nowMsOrOptions === 'number'
      ? nowMsOrOptions
      : (nowMsOrOptions?.nowMs ?? Date.now());
    const options = typeof nowMsOrOptions === 'object' ? nowMsOrOptions : undefined;

    const match = await db.matches.get(matchId);
    if (!match) return null;

    const baseRemaining = Math.max(0, match.timerSecondsRemaining ?? 0);
    const isRunning = Boolean(match.timerLastStart);
    let effective = baseRemaining;
    let precisionSource: TimePrecisionSource = 'wall_clock_recovered';
    let confidence: TimeConfidence = 'approximate';
    let isClockShiftDetected = false;

    if (isRunning && match.timerLastStart) {
      const isCustomNow = Math.abs(nowMs - Date.now()) > 1000;
      const res = calculateMonotonicElapsed(
        matchId,
        match.timerLastStart.getTime(),
        nowMs,
        options ?? (isCustomNow ? { nowMs } : undefined)
      );
      effective = Math.max(0, baseRemaining - res.elapsedSeconds);
      precisionSource = res.source;
      confidence = res.confidence;
      isClockShiftDetected = res.isClockShiftDetected;
    }

    return {
      matchId,
      timerSecondsRemaining: baseRemaining,
      isRunning,
      effectiveTimeLeft: effective,
      status: match.status,
      currentQuarter: match.currentQuarter,
      timerLastStart: match.timerLastStart,
      precisionSource,
      confidence,
      isClockShiftDetected
    };
  },

  /**
   * Valida la autoridad del invocador antes de procesar una operación (comprobación previa fuera de transacción).
   */
  _validateAuthority(
    matchId: number,
    options?: TimerServiceOptions
  ): { valid: boolean; reason?: string; epoch: number; tabId: string } {
    const coord = options?.coordinator ?? timerAuthorityCoordinator;
    const authState = coord.getAuthorityState(matchId);
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
   * Contrato Unificado de Autorización Transaccional (Fase 2C R1.3 - C-21 a C-24).
   * Ejecutado estrictamente dentro del commit boundary de IndexedDB.
   * Valida exhaustivamente:
   * 1. Existencia del partido en IndexedDB
   * 2. Estado no finalizado del partido
   * 3. Coincidencia de cuarto/periodo esperado (INV-T10)
   * 4. Autoridad activa en el coordinador local
   * 5. Identidad de la pestaña invocadora (tabId)
   * 6. Fencing local de epoch
   * 7. Fencing transaccional contra timerEpoch persistido en BD
   * 8. Propietario persistido en BD (timerOwnerTabId) (C-22)
   * 9. Vigencia del lease persistido en BD (timerLeaseExpiresAt) (C-22)
   */
  _verifyTransactionalAuthority(
    match: Match | undefined,
    matchId: number,
    options?: TimerServiceOptions,
    nowMs = Date.now()
  ): TransactionalAuthorityVerification {
    if (!match) {
      return {
        authorized: false,
        status: 'rejected',
        reason: 'El partido no existe.',
        callerEpoch: 0,
        callerTabId: ''
      };
    }

    if (match.status === 'finished') {
      return {
        authorized: false,
        status: 'finished',
        reason: 'El partido ya ha finalizado. No se puede modificar el cronómetro.',
        callerEpoch: match.timerEpoch ?? 0,
        callerTabId: match.timerOwnerTabId ?? ''
      };
    }

    if (options?.expectedQuarter !== undefined && match.currentQuarter !== options.expectedQuarter) {
      return {
        authorized: false,
        status: 'stale_operation',
        reason: `Periodo no coincide (esperado: ${options.expectedQuarter}, actual: ${match.currentQuarter}).`,
        callerEpoch: options.epoch ?? match.timerEpoch ?? 0,
        callerTabId: options.tabId ?? ''
      };
    }

    const coord = options?.coordinator ?? timerAuthorityCoordinator;
    const currentAuth = coord.getAuthorityState(matchId);
    const callerEpoch = options?.epoch ?? currentAuth.epoch;
    const callerTabId = options?.tabId ?? currentAuth.tabId;

    if (!currentAuth.hasAuthority) {
      return {
        authorized: false,
        status: 'not_owner',
        reason: 'Esta pestaña no posee la autoridad del cronómetro para este partido.',
        callerEpoch,
        callerTabId
      };
    }

    if (callerTabId !== currentAuth.tabId) {
      return {
        authorized: false,
        status: 'not_owner',
        reason: `Identidad de pestaña no coincide con la autoridad activa (llamador: ${callerTabId}, activo: ${currentAuth.tabId}).`,
        callerEpoch,
        callerTabId
      };
    }

    if (options?.epoch !== undefined && options.epoch !== currentAuth.epoch) {
      return {
        authorized: false,
        status: 'stale_operation',
        reason: `Operación atrasada localmente (fencing epoch ${options.epoch} !== actual ${currentAuth.epoch}).`,
        callerEpoch,
        callerTabId
      };
    }

    const persistedEpoch = match.timerEpoch ?? 0;
    if (callerEpoch < persistedEpoch) {
      return {
        authorized: false,
        status: 'stale_operation',
        reason: `Operación atrasada respecto a la base de datos (epoch ${callerEpoch} < persistido ${persistedEpoch}).`,
        callerEpoch,
        callerTabId
      };
    }

    // C-22: Verificar propietario persistido en BD si está definido
    if (match.timerOwnerTabId && match.timerOwnerTabId !== callerTabId) {
      return {
        authorized: false,
        status: 'not_owner',
        reason: `El partido pertenece a otra pestaña en IndexedDB (propietario: ${match.timerOwnerTabId}, llamador: ${callerTabId}).`,
        callerEpoch,
        callerTabId
      };
    }

    // C-22: En modo fallback (o sin Web Lock nativo activo), verificar vigencia del lease persistido en BD
    if (!coord.hasActiveLock(matchId)) {
      if (match.timerLeaseExpiresAt !== undefined && match.timerLeaseExpiresAt !== null && match.timerLeaseExpiresAt > 0) {
        if (match.timerLeaseExpiresAt < nowMs) {
          return {
            authorized: false,
            status: 'not_owner',
            reason: `El lease de autoridad ha expirado en IndexedDB (expiró en ${match.timerLeaseExpiresAt}, actual: ${nowMs}).`,
            callerEpoch,
            callerTabId
          };
        }
      }
    }

    return {
      authorized: true,
      status: 'applied',
      callerEpoch,
      callerTabId
    };
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
      const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
      if (!authCheck.authorized) {
        return {
          status: authCheck.status,
          matchId,
          timerSecondsRemaining: Math.max(0, match?.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match?.timerLastStart),
          reason: authCheck.reason,
          epoch: authCheck.callerEpoch
        };
      }

      // Si ya está corriendo, idempotencia estricta: NO sobreescribir timerLastStart (TC-04)
      if (match!.timerLastStart) {
        return {
          status: 'already_applied',
          matchId,
          timerSecondsRemaining: Math.max(0, match!.timerSecondsRemaining ?? 0),
          isRunning: true,
          epoch: authCheck.callerEpoch
        };
      }

      const remaining = Math.max(0, match!.timerSecondsRemaining ?? 0);
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
        timerEpoch: authCheck.callerEpoch,
        timerOwnerTabId: authCheck.callerTabId
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
        epoch: authCheck.callerEpoch
      };
    });

    return await (options?.coordinator ?? timerAuthorityCoordinator).trackOperation(matchId, opPromise);
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
      const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
      if (!authCheck.authorized) {
        return {
          status: authCheck.status,
          matchId,
          timerSecondsRemaining: Math.max(0, match?.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match?.timerLastStart),
          reason: authCheck.reason,
          epoch: authCheck.callerEpoch
        };
      }

      const currentRemaining = Math.max(0, match!.timerSecondsRemaining ?? 0);

      // Si ya está pausado, retorno idempotente sin alteraciones (INV-T02)
      if (!match!.timerLastStart) {
        return {
          status: 'already_applied',
          matchId,
          timerSecondsRemaining: currentRemaining,
          isRunning: false,
          epoch: authCheck.callerEpoch
        };
      }

      // Cálculo monotónico con protección contra retrocesos y saltos sospechosos (INV-T08 / Precisión Temporal)
      const lastStartMs = match!.timerLastStart.getTime();
      const { elapsedSeconds, source, confidence } = calculateMonotonicElapsed(matchId, lastStartMs, nowMs, options);
      const newRemaining = Math.max(0, currentRemaining - elapsedSeconds);
      sessionMonotonicStarts.delete(matchId);

      await db.matches.update(matchId, {
        timerLastStart: undefined,
        timerSecondsRemaining: newRemaining,
        timerEpoch: authCheck.callerEpoch,
        timerOwnerTabId: authCheck.callerTabId
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: newRemaining,
        isRunning: false,
        epoch: authCheck.callerEpoch,
        precisionSource: source,
        confidence
      };
    });

    return await (options?.coordinator ?? timerAuthorityCoordinator).trackOperation(matchId, opPromise);
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

    const nowMs = options?.nowMs ?? Date.now();

    const opPromise = db.transaction('rw', db.matches, async (): Promise<TimerOperationResult> => {
      const match = await db.matches.get(matchId);
      const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
      if (!authCheck.authorized) {
        return {
          status: authCheck.status,
          matchId,
          timerSecondsRemaining: Math.max(0, match?.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match?.timerLastStart),
          reason: authCheck.reason,
          epoch: authCheck.callerEpoch
        };
      }

      const durationMinutes =
        match!.config?.traditional?.minutesPerQuarter ??
        match!.quarterDuration ??
        10;
      const targetSeconds = durationMinutes * 60;

      await db.matches.update(matchId, {
        timerSecondsRemaining: targetSeconds,
        timerLastStart: undefined,
        timerEpoch: authCheck.callerEpoch,
        timerOwnerTabId: authCheck.callerTabId
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: targetSeconds,
        isRunning: false,
        epoch: authCheck.callerEpoch
      };
    });

    return await (options?.coordinator ?? timerAuthorityCoordinator).trackOperation(matchId, opPromise);
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

    const nowMs = options?.nowMs ?? Date.now();

    const opPromise = db.transaction('rw', db.matches, async (): Promise<TimerOperationResult> => {
      const match = await db.matches.get(matchId);
      const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
      if (!authCheck.authorized) {
        return {
          status: authCheck.status,
          matchId,
          timerSecondsRemaining: Math.max(0, match?.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match?.timerLastStart),
          reason: authCheck.reason,
          epoch: authCheck.callerEpoch
        };
      }

      if (match!.timerLastStart) {
        return {
          status: 'rejected',
          matchId,
          timerSecondsRemaining: Math.max(0, match!.timerSecondsRemaining ?? 0),
          isRunning: true,
          reason: 'No se puede ajustar el reloj mientras está en marcha. Debe pausarse primero.'
        };
      }

      const currentSecs = Math.ceil(match!.timerSecondsRemaining ?? 0);
      const nextSecs = Math.max(0, currentSecs + deltaSeconds);

      await db.matches.update(matchId, {
        timerSecondsRemaining: nextSecs,
        timerLastStart: undefined,
        timerEpoch: authCheck.callerEpoch,
        timerOwnerTabId: authCheck.callerTabId
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: nextSecs,
        isRunning: false,
        epoch: authCheck.callerEpoch
      };
    });

    return await (options?.coordinator ?? timerAuthorityCoordinator).trackOperation(matchId, opPromise);
  },

  /**
   * Reconcilia el cronómetro tras suspensión de PWA, cambio de visibilidad,
   * bloqueo de pantalla o descarte de proceso.
   * - Propietario: calcula y persiste en IndexedDB si expiró con verificación transaccional estricta (C-12 / C-21 / C-22).
   * - Observador / Lease expirado: calcula puramente en memoria sin realizar escrituras en BD (C-12 / C-21 / C-22).
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

      if (options?.expectedQuarter !== undefined && match.currentQuarter !== options.expectedQuarter) {
        return {
          status: 'stale_operation',
          matchId,
          timerSecondsRemaining: baseRemaining,
          isRunning: Boolean(match.timerLastStart),
          reason: `Periodo no coincide (esperado: ${options.expectedQuarter}, actual: ${match.currentQuarter}).`
        };
      }

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
      const { elapsedSeconds, source, confidence } = calculateMonotonicElapsed(matchId, lastStartMs, nowMs, options);
      const newRemaining = Math.max(0, baseRemaining - elapsedSeconds);

      if (newRemaining <= 0) {
        // Expiró durante la suspensión o ejecución: para persistir el fin de periodo en BD,
        // se exige la validación transaccional completa (C-21 / C-22).
        const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
        if (!authCheck.authorized) {
          // Pestaña sin autoridad o lease expirado: cálculo de solo lectura en memoria, NUNCA escribe en BD (C-12 / C-21)
          return {
            status: authCheck.status === 'not_owner' ? 'already_applied' : authCheck.status,
            matchId,
            timerSecondsRemaining: 0,
            isRunning: false,
            expired: true,
            precisionSource: source,
            confidence,
            reason: authCheck.status === 'not_owner'
              ? 'Reconciliación en modo observador (solo lectura, sin mutación en BD).'
              : authCheck.reason
          };
        }

        sessionMonotonicStarts.delete(matchId);
        await db.matches.update(matchId, {
          timerLastStart: undefined,
          timerSecondsRemaining: 0,
          timerEpoch: authCheck.callerEpoch,
          timerOwnerTabId: authCheck.callerTabId
        });

        return {
          status: 'applied',
          matchId,
          timerSecondsRemaining: 0,
          isRunning: false,
          expired: true,
          epoch: authCheck.callerEpoch,
          precisionSource: source,
          confidence
        };
      } else {
        // Sigue corriendo: cálculo en memoria sin pausar el reloj en BD
        const coord = options?.coordinator ?? timerAuthorityCoordinator;
        const currentAuth = coord.getAuthorityState(matchId);
        const isOwner = currentAuth.hasAuthority && (options?.epoch === undefined || options.epoch === currentAuth.epoch);
        return {
          status: isOwner ? 'applied' : 'already_applied',
          matchId,
          timerSecondsRemaining: newRemaining,
          isRunning: true,
          expired: false,
          epoch: currentAuth.epoch,
          precisionSource: source,
          confidence,
          reason: isOwner ? undefined : 'Reconciliación en modo observador (solo lectura, sin mutación en BD).'
        };
      }
    });

    return await (options?.coordinator ?? timerAuthorityCoordinator).trackOperation(matchId, opPromise);
  },

  /**
   * Avanza al siguiente cuarto reglamentario con verificación transaccional de autoridad (C-13 / C-22).
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

    const nowMs = options?.nowMs ?? Date.now();

    const opPromise = db.transaction('rw', db.matches, async (): Promise<TimerOperationResult> => {
      const match = await db.matches.get(matchId);
      const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
      if (!authCheck.authorized) {
        return {
          status: authCheck.status,
          matchId,
          timerSecondsRemaining: Math.max(0, match?.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match?.timerLastStart),
          reason: authCheck.reason,
          epoch: authCheck.callerEpoch
        };
      }

      const quartersConfig = match!.config?.traditional?.totalQuarters || match!.totalQuarters || 4;
      const minutesPerQuarter = match!.config?.traditional?.minutesPerQuarter || match!.quarterDuration || 10;
      const currentQ = match!.currentQuarter || 1;

      if (currentQ >= quartersConfig) {
        return {
          status: 'rejected',
          matchId,
          timerSecondsRemaining: Math.max(0, match!.timerSecondsRemaining ?? 0),
          isRunning: false,
          reason: 'Ya se alcanzó el último cuarto reglamentario.'
        };
      }

      const nextQ = currentQ + 1;
      const isNewHalf = currentQ === 2 && nextQ === 3;
      const targetSeconds = minutesPerQuarter * 60;

      sessionMonotonicStarts.delete(matchId);

      await db.matches.update(matchId, {
        currentQuarter: nextQ,
        timerSecondsRemaining: targetSeconds,
        timerLastStart: undefined,
        timerEpoch: authCheck.callerEpoch,
        timerOwnerTabId: authCheck.callerTabId,
        ...(isNewHalf ? { localTimeouts: 0, visitorTimeouts: 0 } : {})
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: targetSeconds,
        isRunning: false,
        epoch: authCheck.callerEpoch
      };
    });

    return await (options?.coordinator ?? timerAuthorityCoordinator).trackOperation(matchId, opPromise);
  },

  /**
   * Inicia tiempo extra (OT) de forma transaccional con verificación de autoridad (C-13 / C-22).
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

    const nowMs = options?.nowMs ?? Date.now();

    const opPromise = db.transaction('rw', db.matches, async (): Promise<TimerOperationResult> => {
      const match = await db.matches.get(matchId);
      const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
      if (!authCheck.authorized) {
        return {
          status: authCheck.status,
          matchId,
          timerSecondsRemaining: Math.max(0, match?.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match?.timerLastStart),
          reason: authCheck.reason,
          epoch: authCheck.callerEpoch
        };
      }

      const quartersConfig = match!.config?.traditional?.totalQuarters || match!.totalQuarters || 4;
      const nextQ = (match!.currentQuarter || quartersConfig) + 1;
      const targetSeconds = overtimeMinutes * 60;

      sessionMonotonicStarts.delete(matchId);

      await db.matches.update(matchId, {
        currentQuarter: nextQ,
        timerSecondsRemaining: targetSeconds,
        timerLastStart: undefined,
        timerEpoch: authCheck.callerEpoch,
        timerOwnerTabId: authCheck.callerTabId,
        localTimeouts: 0,
        visitorTimeouts: 0
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: targetSeconds,
        isRunning: false,
        epoch: authCheck.callerEpoch
      };
    });

    return await (options?.coordinator ?? timerAuthorityCoordinator).trackOperation(matchId, opPromise);
  },

  /**
   * Finaliza el partido de forma atómica y transaccional con verificación de autoridad y fencing (C-19 / C-22).
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
      if (match?.status === 'finished') {
        return {
          status: 'already_applied',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: false,
          epoch: match.timerEpoch
        };
      }

      const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
      if (!authCheck.authorized) {
        return {
          status: authCheck.status,
          matchId,
          timerSecondsRemaining: Math.max(0, match?.timerSecondsRemaining ?? 0),
          isRunning: Boolean(match?.timerLastStart),
          reason: authCheck.reason,
          epoch: authCheck.callerEpoch
        };
      }

      const baseRemaining = Math.max(0, match!.timerSecondsRemaining ?? 0);
      let effectiveRemaining = baseRemaining;
      if (match!.timerLastStart) {
        const { elapsedSeconds } = calculateMonotonicElapsed(
          matchId,
          match!.timerLastStart.getTime(),
          nowMs,
          options
        );
        effectiveRemaining = Math.max(0, baseRemaining - elapsedSeconds);
      }

      sessionMonotonicStarts.delete(matchId);

      const nextEpoch = authCheck.callerEpoch + 1;

      await db.matches.update(matchId, {
        status: 'finished',
        finishedAt: new Date(nowMs),
        timerSecondsRemaining: effectiveRemaining,
        timerLastStart: undefined,
        timerEpoch: nextEpoch,
        timerOwnerTabId: authCheck.callerTabId,
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

    return await (options?.coordinator ?? timerAuthorityCoordinator).trackOperation(matchId, opPromise);
  }
};
