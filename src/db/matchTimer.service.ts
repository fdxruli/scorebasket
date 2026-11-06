// src/db/matchTimer.service.ts
import { db } from './db';
import type { Match } from './models/Match';
import type { Score } from './models';
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
  shotClockExpired?: boolean;
}

export interface ShotClockProjection {
  enabled: boolean;
  timeLeft: number;
  isRunning: boolean;
  expired: boolean;
}

export interface ShotClockOperationResult {
  status: TimerOperationStatus;
  matchId: number;
  shotClockSecondsRemaining: number;
  isRunning: boolean;
  reason?: string;
  epoch?: number;
}

export interface AssistantFieldGoalResult {
  status: TimerOperationStatus;
  matchId: number;
  newScore?: { local: number; visitor: number };
  nextPossession?: 'local' | 'visitor';
  shotClockSecondsRemaining: number;
  epoch?: number;
  reason?: string;
}

export interface AssistantTurnoverResult {
  status: TimerOperationStatus;
  matchId: number;
  nextPossession?: 'local' | 'visitor';
  shotClockSecondsRemaining: number;
  isRunning: boolean;
  epoch?: number;
  reason?: string;
}

export interface AssistantConfigResult {
  status: TimerOperationStatus;
  matchId: number;
  enabled: boolean;
  hapticsEnabled?: boolean;
  reason?: string;
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
  /** Marca de tiempo explícita en ms para verificar la vigencia del lease en tiempo real (C-30) */
  leaseNowMs?: number;
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

export interface TimerProjection {
  timeLeft: number;
  isRunning: boolean;
  expired: boolean;
  isClockShiftDetected: boolean;
  clockShiftSeverity: 'none' | 'backward' | 'forward_jump';
  confidence: TimeConfidence;
  precisionSource: TimePrecisionSource;
}

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
  const localSession = sessionMonotonicStarts.get(matchId);

  // Verificación monotónica prioritaria: si hay sesión activa local (o simulatedPerfNowMs),
  // la medición por hardware (performance.now) es la fuente fidedigna y no retrocede (C-31)
  if (localSession && localSession.wallStartMs === lastStartMs) {
    let perfElapsed: number | null = null;

    if (options?.simulatedPerfNowMs !== undefined) {
      perfElapsed = Math.max(0, (options.simulatedPerfNowMs - localSession.perfStart) / 1000);
    } else if (options?.nowMs === undefined && typeof performance !== 'undefined' && typeof performance.now === 'function') {
      perfElapsed = Math.max(0, (performance.now() - localSession.perfStart) / 1000);
    }

    if (perfElapsed !== null) {
      const wallElapsed = (nowMs - lastStartMs) / 1000;
      const isShift = Math.abs(wallElapsed - perfElapsed) > 10 || nowMs < lastStartMs;
      return {
        elapsedSeconds: perfElapsed,
        source: 'monotonic_session',
        isClockShiftDetected: isShift,
        clockShiftSeverity: isShift ? (nowMs < lastStartMs || wallElapsed < perfElapsed ? 'backward' : 'forward_jump') : 'none',
        confidence: 'high'
      };
    }
  }

  // En ausencia de referencia monotónica fiable:
  // Si el reloj retrocede respecto al último inicio, acotamos a 0 y marcamos incertidumbre (C-25 / C-31)
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

  // Medición estándar entre sesiones o pruebas deterministas
  const isSuspiciousJump = wallElapsed > 86400; // > 24 horas
  if (isSuspiciousJump) {
    return {
      elapsedSeconds: 0,
      source: 'anomalous_clamp',
      isClockShiftDetected: true,
      clockShiftSeverity: 'forward_jump',
      confidence: 'uncertain'
    };
  }

  return {
    elapsedSeconds: wallElapsed,
    source: 'wall_clock_recovered',
    isClockShiftDetected: false,
    clockShiftSeverity: 'none',
    confidence: 'approximate'
  };
}

/**
 * Almacenamiento en memoria para medición monotónica de posesión (shot clock) (DEPORT-04).
 */
const sessionShotClockMonotonicStarts = new Map<number, { perfStart: number; wallStartMs: number }>();

export function formatShotClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return s.toString().padStart(2, '0');
}

function calculateShotClockMonotonicElapsed(
  matchId: number,
  lastStartMs: number,
  nowMs: number,
  options?: TimerServiceOptions
): MonotonicElapsedResult {
  const localSession = sessionShotClockMonotonicStarts.get(matchId);

  if (localSession && localSession.wallStartMs === lastStartMs) {
    let perfElapsed: number | null = null;

    if (options?.simulatedPerfNowMs !== undefined) {
      perfElapsed = Math.max(0, (options.simulatedPerfNowMs - localSession.perfStart) / 1000);
    } else if (options?.nowMs === undefined && typeof performance !== 'undefined' && typeof performance.now === 'function') {
      perfElapsed = Math.max(0, (performance.now() - localSession.perfStart) / 1000);
    }

    if (perfElapsed !== null) {
      const wallElapsed = (nowMs - lastStartMs) / 1000;
      const isShift = Math.abs(wallElapsed - perfElapsed) > 10 || nowMs < lastStartMs;
      return {
        elapsedSeconds: perfElapsed,
        source: 'monotonic_session',
        isClockShiftDetected: isShift,
        clockShiftSeverity: isShift ? (nowMs < lastStartMs || wallElapsed < perfElapsed ? 'backward' : 'forward_jump') : 'none',
        confidence: 'high'
      };
    }
  }

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
  const isSuspiciousJump = wallElapsed > 86400;
  if (isSuspiciousJump) {
    return {
      elapsedSeconds: 0,
      source: 'anomalous_clamp',
      isClockShiftDetected: true,
      clockShiftSeverity: 'forward_jump',
      confidence: 'uncertain'
    };
  }

  return {
    elapsedSeconds: wallElapsed,
    source: 'wall_clock_recovered',
    isClockShiftDetected: false,
    clockShiftSeverity: 'none',
    confidence: 'approximate'
  };
}

/**
 * Servicio Central de Autoridad y Dominio del Cronómetro (Fase 2C).
 */
export const MatchTimerService = {
  /**
   * Proyección temporal pura compartida entre la UI y el dominio (C-26).
   * Unifica el cálculo de tiempo restante, expiración, detección de desfase y confianza.
   */
  projectTime(
    match: Match | undefined,
    nowMs: number = Date.now(),
    options?: TimerServiceOptions
  ): TimerProjection {
    if (!match) {
      return {
        timeLeft: 0,
        isRunning: false,
        expired: false,
        isClockShiftDetected: false,
        clockShiftSeverity: 'none',
        confidence: 'approximate',
        precisionSource: 'wall_clock_recovered'
      };
    }

    const baseRemaining = Math.max(0, match.timerSecondsRemaining ?? 0);
    const isRunning = Boolean(match.timerLastStart);
    const isRecoveryRequired = match.timerRecoveryState === 'recovery_required';

    if (!isRunning || !match.timerLastStart) {
      return {
        timeLeft: baseRemaining,
        isRunning: false,
        expired: match.status !== 'finished' && baseRemaining <= 0,
        isClockShiftDetected: isRecoveryRequired,
        clockShiftSeverity: isRecoveryRequired ? 'forward_jump' : 'none',
        confidence: isRecoveryRequired ? 'uncertain' : 'high',
        precisionSource: 'wall_clock_recovered'
      };
    }

    const isCustomNow = options?.nowMs !== undefined || Math.abs(nowMs - Date.now()) > 1000;
    const res = calculateMonotonicElapsed(
      match.id!,
      match.timerLastStart.getTime(),
      nowMs,
      options ?? (isCustomNow ? { nowMs } : undefined)
    );

    if (res.confidence === 'uncertain' || isRecoveryRequired) {
      // Estado de recuperación conservadora: preservar tiempo sin restar salto anómalo
      return {
        timeLeft: baseRemaining,
        isRunning: true,
        expired: false,
        isClockShiftDetected: true,
        clockShiftSeverity: res.clockShiftSeverity !== 'none' ? res.clockShiftSeverity : 'forward_jump',
        confidence: 'uncertain',
        precisionSource: res.source
      };
    }

    const effective = Math.max(0, baseRemaining - res.elapsedSeconds);
    return {
      timeLeft: effective,
      isRunning: true,
      expired: effective <= 0,
      isClockShiftDetected: res.isClockShiftDetected,
      clockShiftSeverity: res.clockShiftSeverity,
      confidence: res.confidence,
      precisionSource: res.source
    };
  },

  /**
   * Proyección temporal pura del reloj de posesión (DEPORT-04).
   */
  projectShotClock(
    match: Match | undefined,
    nowMs: number = Date.now(),
    options?: TimerServiceOptions
  ): ShotClockProjection {
    if (!match || !match.shotClock || !match.shotClock.enabled) {
      return {
        enabled: false,
        timeLeft: 24,
        isRunning: false,
        expired: false
      };
    }

    const baseRemaining = Math.max(0, match.shotClock.secondsRemaining ?? 24);
    const isRunning = Boolean(match.shotClock.lastStart && match.timerLastStart);
    const isRecoveryRequired = match.timerRecoveryState === 'recovery_required';

    if (!isRunning || !match.shotClock.lastStart) {
      return {
        enabled: true,
        timeLeft: baseRemaining,
        isRunning: false,
        expired: match.status !== 'finished' && baseRemaining <= 0
      };
    }

    if (isRecoveryRequired) {
      return {
        enabled: true,
        timeLeft: baseRemaining,
        isRunning: true,
        expired: false
      };
    }

    const isCustomNow = options?.nowMs !== undefined || Math.abs(nowMs - Date.now()) > 1000;
    const res = calculateShotClockMonotonicElapsed(
      match.id!,
      match.shotClock.lastStart.getTime(),
      nowMs,
      options ?? (isCustomNow ? { nowMs } : undefined)
    );

    if (res.confidence === 'uncertain') {
      return {
        enabled: true,
        timeLeft: baseRemaining,
        isRunning: true,
        expired: false
      };
    }

    const effective = Math.max(0, baseRemaining - res.elapsedSeconds);
    return {
      enabled: true,
      timeLeft: effective,
      isRunning: effective > 0,
      expired: effective <= 0
    };
  },

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

    const proj = this.projectTime(match, nowMs, options);

    return {
      matchId,
      timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
      isRunning: proj.isRunning,
      effectiveTimeLeft: proj.timeLeft,
      status: match.status,
      currentQuarter: match.currentQuarter,
      timerLastStart: match.timerLastStart,
      precisionSource: proj.precisionSource,
      confidence: proj.confidence,
      isClockShiftDetected: proj.isClockShiftDetected
    };
  },

  /**
   * Hook para inyección de barreras transaccionales en pruebas adversariales (Fase 2C R1.5 - C-32).
   */
  _testPreCommitHook: null as (((matchId: number) => void | Promise<void>) | null),

  _setTestPreCommitHook(hook: ((matchId: number) => void | Promise<void>) | null) {
    this._testPreCommitHook = hook;
  },

  /**
   * Valida la autoridad del invocador antes de procesar una operación (comprobación previa fuera de transacción).
   */
  _validateAuthority(
    matchId: number,
    options?: TimerServiceOptions
  ): { valid: boolean; status?: TimerOperationStatus; reason?: string; epoch: number; tabId: string } {
    const coord = options?.coordinator ?? timerAuthorityCoordinator;


    const authState = coord.getAuthorityState(matchId);
    const tabId = options?.tabId ?? authState.tabId;
    const epoch = options?.epoch ?? authState.epoch;

    const isCurrentTab = tabId === authState.tabId;
    if (!authState.hasAuthority || !isCurrentTab) {
      return {
        valid: false,
        status: 'not_owner',
        reason: 'Esta pestaña no posee la autoridad del cronómetro para este partido.',
        epoch,
        tabId
      };
    }

    if (options?.epoch !== undefined && options.epoch !== authState.epoch) {
      return {
        valid: false,
        status: 'not_owner',
        reason: `Operación atrasada (fencing epoch ${options.epoch} !== actual ${authState.epoch}).`,
        epoch,
        tabId
      };
    }

    return { valid: true, status: 'applied', epoch, tabId };
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
    _sportsNowMs = Date.now()
  ): TransactionalAuthorityVerification {
    void _sportsNowMs;
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

    if (callerEpoch > persistedEpoch) {
      return {
        authorized: false,
        status: 'stale_operation',
        reason: `Epoch no reservado respecto a la base de datos (epoch ${callerEpoch} > persistido ${persistedEpoch}).`,
        callerEpoch,
        callerTabId
      };
    }

    // C-27: Verificar propietario persistido en BD
    if (!match.timerOwnerTabId || match.timerOwnerTabId !== callerTabId) {
      return {
        authorized: false,
        status: 'not_owner',
        reason: `El partido pertenece a otra pestaña o no tiene dueño asignado en IndexedDB (propietario: ${match.timerOwnerTabId}, llamador: ${callerTabId}).`,
        callerEpoch,
        callerTabId
      };
    }

    // C-27: Verificar vigencia del lease persistido en BD (obligatorio en todos los modos: Web Locks y Fallback)
    if (match.timerLeaseExpiresAt === undefined || match.timerLeaseExpiresAt === null || match.timerLeaseExpiresAt <= 0) {
      return {
        authorized: false,
        status: 'not_owner',
        reason: 'El lease de autoridad está ausente o no es positivo en IndexedDB.',
        callerEpoch,
        callerTabId
      };
    }

    // C-30: Separación estricta entre control de autoridad (tiempo real del lease) y reloj deportivo
    // Un lease expirado SIEMPRE se rechaza de forma cerrada sin excepciones de precisión deportiva
    const leaseCheckTime = options?.leaseNowMs ?? Date.now();
    if (match.timerLeaseExpiresAt < leaseCheckTime) {
      return {
        authorized: false,
        status: 'not_owner',
        reason: `El lease de autoridad ha expirado en IndexedDB (expiró en ${match.timerLeaseExpiresAt}, actual: ${leaseCheckTime}).`,
        callerEpoch,
        callerTabId
      };
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
  /**
   * Registra una operación asíncrona completa en vuelo en el coordinador correspondiente (C-11 / C-32).
   */
  _trackOp<T>(
    matchId: number,
    options: TimerServiceOptions | undefined,
    fn: () => Promise<T>
  ): Promise<T> {
    const coord = options?.coordinator ?? timerAuthorityCoordinator;
    if (coord.isReleasing(matchId)) {
      return Promise.resolve({
        status: 'not_owner',
        matchId,
        timerSecondsRemaining: 0,
        isRunning: false,
        reason: 'La autoridad del cronómetro está en proceso de liberación.',
        epoch: options?.epoch ?? 0
      } as unknown as T);
    }
    return coord.trackOperation(matchId, fn());
  },

  start(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    return this._trackOp(matchId, options, async () => {
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
        status: authorityCheck.status ?? 'not_owner',
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

      // C-29: Bloquear reanudación silenciosa si hay recuperación pendiente no resuelta
      if (match!.timerRecoveryState === 'recovery_required') {
        return {
          status: 'rejected',
          matchId,
          timerSecondsRemaining: remaining,
          isRunning: false,
          epoch: authCheck.callerEpoch,
          confidence: 'uncertain',
          reason: 'El cronómetro requiere confirmación o ajuste de tiempo antes de reanudar la marcha deportiva.'
        };
      }

      if (this._testPreCommitHook) {
        await this._testPreCommitHook(matchId);
      }

      const startDate = new Date(nowMs);
      const updateData: Partial<Match> = {
        timerLastStart: startDate,
        status: 'playing',
        timerEpoch: authCheck.callerEpoch,
        timerOwnerTabId: authCheck.callerTabId
      };

      if (match!.shotClock?.enabled) {
        if (match!.shotClock.secondsRemaining > 0) {
          updateData.shotClock = {
            ...match!.shotClock,
            lastStart: startDate
          };
          sessionShotClockMonotonicStarts.set(matchId, {
            perfStart:
              options?.simulatedPerfNowMs ??
              (typeof performance !== 'undefined' ? performance.now() : 0),
            wallStartMs: nowMs
          });
        } else {
          updateData.shotClock = {
            ...match!.shotClock,
            lastStart: undefined
          };
          sessionShotClockMonotonicStarts.delete(matchId);
        }
      }

      await db.matches.update(matchId, updateData);

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

    return await opPromise;
    });
  },

  /**
   * Pausa el cronómetro de forma atómica, idempotente y monotónica con fencing (C-11).
   */
  pause(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    return this._trackOp(matchId, options, async () => {
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
        status: authorityCheck.status ?? 'not_owner',
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

      // Cálculo monotónico con protección contra retrocesos y saltos sospechosos (INV-T08 / Precisión Temporal / C-25)
      const lastStartMs = match!.timerLastStart.getTime();
      const { elapsedSeconds, source, confidence } = calculateMonotonicElapsed(matchId, lastStartMs, nowMs, options);
      const newRemaining = confidence === 'uncertain'
        ? currentRemaining
        : Math.max(0, currentRemaining - elapsedSeconds);
      sessionMonotonicStarts.delete(matchId);

      const updateData: Partial<Match> = {
        timerLastStart: undefined,
        timerSecondsRemaining: newRemaining,
        timerEpoch: authCheck.callerEpoch,
        timerOwnerTabId: authCheck.callerTabId
      };

      if (match!.shotClock?.enabled && match!.shotClock.lastStart) {
        const shotLastStartMs = match!.shotClock.lastStart.getTime();
        const { elapsedSeconds: shotElapsed, confidence: shotConfidence } = calculateShotClockMonotonicElapsed(
          matchId,
          shotLastStartMs,
          nowMs,
          options
        );
        const currentShotRemaining = Math.max(0, match!.shotClock.secondsRemaining ?? 24);
        const newShotRemaining = (shotConfidence === 'uncertain' || confidence === 'uncertain')
          ? currentShotRemaining
          : Math.max(0, currentShotRemaining - shotElapsed);

        updateData.shotClock = {
          ...match!.shotClock,
          secondsRemaining: newShotRemaining,
          lastStart: undefined
        };
        sessionShotClockMonotonicStarts.delete(matchId);
      }

      if (confidence === 'uncertain') {
        updateData.timerRecoveryState = 'recovery_required';
        updateData.timerRecoveryReason = 'Anomalía temporal detectada durante la pausa';
      }

      if (this._testPreCommitHook) {
        await this._testPreCommitHook(matchId);
      }

      await db.matches.update(matchId, updateData);

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

    return await opPromise;
    });
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
  reset(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    return this._trackOp(matchId, options, async () => {
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
        status: authorityCheck.status ?? 'not_owner',
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

      const updateData: Partial<Match> = {
        timerSecondsRemaining: targetSeconds,
        timerLastStart: undefined,
        timerEpoch: authCheck.callerEpoch,
        timerOwnerTabId: authCheck.callerTabId
      };

      if (match!.timerRecoveryState === 'recovery_required') {
        updateData.timerRecoveryState = 'normal';
        updateData.timerRecoveryReason = undefined;
      }

      if (match!.shotClock?.enabled) {
        updateData.shotClock = {
          enabled: true,
          secondsRemaining: 24,
          lastStart: undefined
        };
        sessionShotClockMonotonicStarts.delete(matchId);
      }

      if (this._testPreCommitHook) {
        await this._testPreCommitHook(matchId);
      }

      await db.matches.update(matchId, updateData);

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: targetSeconds,
        isRunning: false,
        epoch: authCheck.callerEpoch,
        confidence: 'high'
      };
    });

    return await opPromise;
    });
  },

  /**
   * Ajusta manualmente el tiempo restante (en segundos delta).
   * Solo está permitido cuando el reloj está pausado (INV-T09) y con autoridad válida.
   */
  adjust(matchId: number, deltaSeconds: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    return this._trackOp(matchId, options, async () => {
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
        status: authorityCheck.status ?? 'not_owner',
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

      const updateData: Partial<Match> = {
        timerSecondsRemaining: nextSecs,
        timerLastStart: undefined,
        timerEpoch: authCheck.callerEpoch,
        timerOwnerTabId: authCheck.callerTabId
      };

      // C-29: Si el partido requería recuperación, un ajuste explícito por el dueño la resuelve
      if (match!.timerRecoveryState === 'recovery_required') {
        updateData.timerRecoveryState = 'normal';
        updateData.timerRecoveryReason = undefined;
      }

      if (this._testPreCommitHook) {
        await this._testPreCommitHook(matchId);
      }

      await db.matches.update(matchId, updateData);

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: nextSecs,
        isRunning: false,
        epoch: authCheck.callerEpoch,
        confidence: 'high'
      };
    });

    return await opPromise;
    });
  },

  /**
   * Resuelve explícitamente el estado de recuperación pendiente del cronómetro (Fase 2C R1.5 - C-29).
   * Solo el propietario con lease y epoch vigentes puede validar el tiempo.
   * Limpia transaccionalmente timerRecoveryState a 'normal' y establece los segundos validados.
   */
  resolveRecovery(
    matchId: number,
    validatedSeconds: number,
    options?: TimerServiceOptions
  ): Promise<TimerOperationResult> {
    return this._trackOp(matchId, options, async () => {
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

    const authorityCheck = this._validateAuthority(matchId, options);
    if (!authorityCheck.valid) {
      return {
        status: authorityCheck.status ?? 'not_owner',
        matchId,
        timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0),
        isRunning: false,
        reason: authorityCheck.reason
      };
    }

    const opPromise = db.transaction('rw', db.matches, async (): Promise<TimerOperationResult> => {
      const match = await db.matches.get(matchId);
      const authCheck = this._verifyTransactionalAuthority(match, matchId, options);
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

      if (this._testPreCommitHook) {
        await this._testPreCommitHook(matchId);
      }

      const clampedSeconds = Math.max(0, validatedSeconds);
      sessionMonotonicStarts.delete(matchId);

      await db.matches.update(matchId, {
        timerSecondsRemaining: clampedSeconds,
        timerLastStart: undefined,
        timerRecoveryState: 'normal',
        timerRecoveryReason: undefined,
        timerEpoch: authCheck.callerEpoch,
        timerOwnerTabId: authCheck.callerTabId
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: clampedSeconds,
        isRunning: false,
        expired: clampedSeconds <= 0,
        epoch: authCheck.callerEpoch,
        confidence: 'high',
        precisionSource: 'wall_clock_recovered'
      };
    });

    return await opPromise;
    });
  },

  /**
   * Reconcilia el cronómetro tras suspensión de PWA, cambio de visibilidad,
   * bloqueo de pantalla o descarte de proceso.
   * - Propietario: calcula y persiste en IndexedDB si expiró con verificación transaccional estricta (C-12 / C-21 / C-22).
   * - Observador / Lease expirado: calcula puramente en memoria sin realizar escrituras en BD (C-12 / C-21 / C-22).
   */
  reconcile(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    return this._trackOp(matchId, options, async () => {
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

      // C-25 / C-29: Si hay incertidumbre temporal, pausar o acotar conservadoramente y persistir estado de recuperación
      if (confidence === 'uncertain') {
        const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
        const isBackward = source === 'anomalous_clamp' && nowMs < lastStartMs;

        if (authCheck.authorized) {
          sessionMonotonicStarts.delete(matchId);
          if (this._testPreCommitHook) {
            await this._testPreCommitHook(matchId);
          }

          const updateData: Partial<Match> = {
            timerSecondsRemaining: baseRemaining,
            timerEpoch: authCheck.callerEpoch,
            timerOwnerTabId: authCheck.callerTabId,
            timerRecoveryState: 'recovery_required',
            timerRecoveryReason: 'Anomalía temporal detectada durante la reconciliación'
          };

          if (isBackward) {
            updateData.timerLastStart = new Date(nowMs);
          } else {
            updateData.timerLastStart = undefined;
          }

          await db.matches.update(matchId, updateData);

          return {
            status: 'applied',
            matchId,
            timerSecondsRemaining: baseRemaining,
            isRunning: isBackward,
            expired: false,
            epoch: authCheck.callerEpoch,
            precisionSource: source,
            confidence: 'uncertain',
            reason: isBackward
              ? 'Retroceso del reloj detectado. Cronómetro acotado a 0 preservando el tiempo restante.'
              : 'Anomalía temporal detectada. Cronómetro pausado de forma conservadora preservando el tiempo restante.'
          };
        } else {
          return {
            status: authCheck.status === 'not_owner' ? 'already_applied' : authCheck.status,
            matchId,
            timerSecondsRemaining: baseRemaining,
            isRunning: isBackward,
            expired: false,
            precisionSource: source,
            confidence: 'uncertain',
            reason: authCheck.status === 'not_owner'
              ? 'Anomalía temporal detectada en modo observador (solo lectura, sin mutación en BD).'
              : authCheck.reason
          };
        }
      }

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
        sessionShotClockMonotonicStarts.delete(matchId);
        const updateData: Partial<Match> = {
          timerLastStart: undefined,
          timerSecondsRemaining: 0,
          timerEpoch: authCheck.callerEpoch,
          timerOwnerTabId: authCheck.callerTabId
        };

        if (match.shotClock?.enabled && match.shotClock.lastStart) {
          const shotElapsed = calculateShotClockMonotonicElapsed(matchId, match.shotClock.lastStart.getTime(), nowMs, options).elapsedSeconds;
          const currentShot = Math.max(0, match.shotClock.secondsRemaining ?? 24);
          updateData.shotClock = {
            ...match.shotClock,
            secondsRemaining: Math.max(0, currentShot - shotElapsed),
            lastStart: undefined
          };
        }

        await db.matches.update(matchId, updateData);

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

        let shotClockExpired = false;
        if (match.shotClock?.enabled && match.shotClock.lastStart) {
          const { elapsedSeconds: shotElapsed, confidence: shotConf } = calculateShotClockMonotonicElapsed(
            matchId,
            match.shotClock.lastStart.getTime(),
            nowMs,
            options
          );
          if (shotConf !== 'uncertain') {
            const currentShot = Math.max(0, match.shotClock.secondsRemaining ?? 24);
            const shotLeft = Math.max(0, currentShot - shotElapsed);
            if (shotLeft <= 0) {
              shotClockExpired = true;
              if (isOwner) {
                await db.matches.update(matchId, {
                  shotClock: {
                    ...match.shotClock,
                    secondsRemaining: 0,
                    lastStart: undefined
                  }
                });
                sessionShotClockMonotonicStarts.delete(matchId);
              }
            }
          }
        }

        return {
          status: isOwner ? 'applied' : 'already_applied',
          matchId,
          timerSecondsRemaining: newRemaining,
          isRunning: true,
          expired: false,
          epoch: currentAuth.epoch,
          precisionSource: source,
          confidence,
          shotClockExpired,
          reason: isOwner ? undefined : 'Reconciliación en modo observador (solo lectura, sin mutación en BD).'
        };
      }
    });

    return await opPromise;
    });
  },

  /**
   * Avanza al siguiente cuarto reglamentario con verificación transaccional de autoridad (C-13 / C-22).
   */
  advanceQuarter(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    return this._trackOp(matchId, options, async () => {
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
        status: authorityCheck.status ?? 'not_owner',
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
      sessionShotClockMonotonicStarts.delete(matchId);

      if (this._testPreCommitHook) {
        await this._testPreCommitHook(matchId);
      }

      const updateData: Partial<Match> = {
        currentQuarter: nextQ,
        timerSecondsRemaining: targetSeconds,
        timerLastStart: undefined,
        timerRecoveryState: 'normal',
        timerRecoveryReason: undefined,
        timerEpoch: authCheck.callerEpoch,
        timerOwnerTabId: authCheck.callerTabId,
        ...(isNewHalf ? { localTimeouts: 0, visitorTimeouts: 0 } : {})
      };

      if (match!.shotClock?.enabled) {
        updateData.shotClock = {
          enabled: true,
          secondsRemaining: 24,
          lastStart: undefined
        };
      }

      await db.matches.update(matchId, updateData);

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: targetSeconds,
        isRunning: false,
        epoch: authCheck.callerEpoch
      };
    });

    return await opPromise;
    });
  },

  /**
   * Inicia tiempo extra (OT) de forma transaccional con verificación de autoridad (C-13 / C-22).
   */
  startOvertime(matchId: number, overtimeMinutes = 5, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    return this._trackOp(matchId, options, async () => {
    const matchBefore = await db.matches.get(matchId);
    if (!matchBefore) {
      return { status: 'rejected', matchId, timerSecondsRemaining: 0, isRunning: false, reason: 'El partido no existe.' };
    }
    if (matchBefore.status === 'finished') {
      return { status: 'finished', matchId, timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0), isRunning: false, reason: 'El partido ya ha finalizado.' };
    }

    const authorityCheck = this._validateAuthority(matchId, options);
    if (!authorityCheck.valid) {
      return { status: authorityCheck.status ?? 'not_owner', matchId, timerSecondsRemaining: Math.max(0, matchBefore.timerSecondsRemaining ?? 0), isRunning: false, reason: authorityCheck.reason };
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
      sessionShotClockMonotonicStarts.delete(matchId);

      if (this._testPreCommitHook) {
        await this._testPreCommitHook(matchId);
      }

      const updateData: Partial<Match> = {
        currentQuarter: nextQ,
        timerSecondsRemaining: targetSeconds,
        timerLastStart: undefined,
        timerRecoveryState: 'normal',
        timerRecoveryReason: undefined,
        timerEpoch: authCheck.callerEpoch,
        timerOwnerTabId: authCheck.callerTabId,
        localTimeouts: 0,
        visitorTimeouts: 0
      };

      if (match!.shotClock?.enabled) {
        updateData.shotClock = {
          enabled: true,
          secondsRemaining: 24,
          lastStart: undefined
        };
      }

      await db.matches.update(matchId, updateData);

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: targetSeconds,
        isRunning: false,
        epoch: authCheck.callerEpoch
      };
    });

    return await opPromise;
    });
  },

  /**
   * Finaliza el partido de forma atómica y transaccional con verificación de autoridad y fencing (C-19 / C-22).
   */
  endMatch(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    return this._trackOp(matchId, options, async () => {
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
        status: authorityCheck.status ?? 'not_owner',
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
        const { elapsedSeconds, confidence } = calculateMonotonicElapsed(
          matchId,
          match!.timerLastStart.getTime(),
          nowMs,
          options
        );
        effectiveRemaining = confidence === 'uncertain'
          ? baseRemaining
          : Math.max(0, baseRemaining - elapsedSeconds);
      }

      sessionMonotonicStarts.delete(matchId);
      sessionShotClockMonotonicStarts.delete(matchId);

      const nextEpoch = authCheck.callerEpoch + 1;

      if (this._testPreCommitHook) {
        await this._testPreCommitHook(matchId);
      }

      const updateData: Partial<Match> = {
        status: 'finished',
        finishedAt: new Date(nowMs),
        timerSecondsRemaining: effectiveRemaining,
        timerLastStart: undefined,
        timerRecoveryState: 'normal',
        timerRecoveryReason: undefined,
        timerEpoch: nextEpoch,
        timerOwnerTabId: authCheck.callerTabId,
        timerLeaseExpiresAt: 0
      };

      if (match!.shotClock?.enabled) {
        let effectiveShotRemaining = Math.max(0, match!.shotClock.secondsRemaining ?? 24);
        if (match!.shotClock.lastStart) {
          const { elapsedSeconds: shotElapsed, confidence: shotConfidence } = calculateShotClockMonotonicElapsed(
            matchId,
            match!.shotClock.lastStart.getTime(),
            nowMs,
            options
          );
          if (shotConfidence !== 'uncertain') {
            effectiveShotRemaining = Math.max(0, effectiveShotRemaining - shotElapsed);
          }
        }
        updateData.shotClock = {
          enabled: true,
          secondsRemaining: effectiveShotRemaining,
          lastStart: undefined
        };
      }

      await db.matches.update(matchId, updateData);

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: effectiveRemaining,
        isRunning: false,
        epoch: nextEpoch
      };
    });

    return await opPromise;
    });
  },

  /**
   * Activa o desactiva el reloj de posesión de forma atómica y transaccional (DEPORT-04).
   * Solo está permitido con el cronómetro principal detenido y con autoridad válida.
   */
  setShotClockEnabled(
    matchId: number,
    enabled: boolean,
    options?: TimerServiceOptions
  ): Promise<ShotClockOperationResult> {
    return this._trackOp(matchId, options, async () => {
      const matchBefore = await db.matches.get(matchId);
      if (!matchBefore) {
        return {
          status: 'rejected',
          matchId,
          shotClockSecondsRemaining: 24,
          isRunning: false,
          reason: 'El partido no existe.'
        };
      }

      if (matchBefore.status === 'finished') {
        return {
          status: 'finished',
          matchId,
          shotClockSecondsRemaining: Math.max(0, matchBefore.shotClock?.secondsRemaining ?? 24),
          isRunning: false,
          reason: 'El partido ya ha finalizado. No se puede modificar el reloj de posesión.'
        };
      }

      if (matchBefore.timerLastStart) {
        return {
          status: 'rejected',
          matchId,
          shotClockSecondsRemaining: Math.max(0, matchBefore.shotClock?.secondsRemaining ?? 24),
          isRunning: true,
          reason: 'El reloj de posesión solo puede activarse o desactivarse con el cronómetro principal detenido.'
        };
      }

      const authorityCheck = this._validateAuthority(matchId, options);
      if (!authorityCheck.valid) {
        return {
          status: authorityCheck.status ?? 'not_owner',
          matchId,
          shotClockSecondsRemaining: Math.max(0, matchBefore.shotClock?.secondsRemaining ?? 24),
          isRunning: false,
          reason: authorityCheck.reason
        };
      }

      const nowMs = options?.nowMs ?? Date.now();

      const opPromise = db.transaction('rw', db.matches, async (): Promise<ShotClockOperationResult> => {
        const match = await db.matches.get(matchId);
        const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
        if (!authCheck.authorized) {
          return {
            status: authCheck.status,
            matchId,
            shotClockSecondsRemaining: Math.max(0, match?.shotClock?.secondsRemaining ?? 24),
            isRunning: false,
            reason: authCheck.reason,
            epoch: authCheck.callerEpoch
          };
        }

        if (match!.timerLastStart) {
          return {
            status: 'rejected',
            matchId,
            shotClockSecondsRemaining: Math.max(0, match!.shotClock?.secondsRemaining ?? 24),
            isRunning: true,
            reason: 'El reloj de posesión solo puede activarse o desactivarse con el cronómetro principal detenido.'
          };
        }

        const updateData: Partial<Match> = {
          shotClock: {
            enabled,
            secondsRemaining: enabled ? (match!.shotClock?.secondsRemaining ?? 24) : 24,
            lastStart: undefined
          },
          timerEpoch: authCheck.callerEpoch,
          timerOwnerTabId: authCheck.callerTabId
        };

        sessionShotClockMonotonicStarts.delete(matchId);

        if (this._testPreCommitHook) {
          await this._testPreCommitHook(matchId);
        }

        await db.matches.update(matchId, updateData);

        return {
          status: 'applied',
          matchId,
          shotClockSecondsRemaining: updateData.shotClock!.secondsRemaining,
          isRunning: false,
          epoch: authCheck.callerEpoch
        };
      });

      return await opPromise;
    });
  },

  /**
   * Reinicia rápidamente la posesión a 24 o 14 segundos (DEPORT-04).
   * - Si el cronómetro principal está corriendo, el conteo continúa inmediatamente.
   * - Si el cronómetro principal está pausado, permanece detenido.
   * - Operación atómica, segura e idempotente ante pulsaciones repetidas.
   */
  resetShotClock(
    matchId: number,
    seconds: 24 | 14,
    options?: TimerServiceOptions
  ): Promise<ShotClockOperationResult> {
    return this._trackOp(matchId, options, async () => {
      const matchBefore = await db.matches.get(matchId);
      if (!matchBefore) {
        return {
          status: 'rejected',
          matchId,
          shotClockSecondsRemaining: seconds,
          isRunning: false,
          reason: 'El partido no existe.'
        };
      }

      if (matchBefore.status === 'finished') {
        return {
          status: 'finished',
          matchId,
          shotClockSecondsRemaining: Math.max(0, matchBefore.shotClock?.secondsRemaining ?? seconds),
          isRunning: false,
          reason: 'El partido ya ha finalizado. No se puede reiniciar el reloj de posesión.'
        };
      }

      const authorityCheck = this._validateAuthority(matchId, options);
      if (!authorityCheck.valid) {
        return {
          status: authorityCheck.status ?? 'not_owner',
          matchId,
          shotClockSecondsRemaining: Math.max(0, matchBefore.shotClock?.secondsRemaining ?? seconds),
          isRunning: Boolean(matchBefore.timerLastStart && matchBefore.shotClock?.lastStart),
          reason: authorityCheck.reason
        };
      }

      const nowMs = options?.nowMs ?? Date.now();

      const opPromise = db.transaction('rw', db.matches, async (): Promise<ShotClockOperationResult> => {
        const match = await db.matches.get(matchId);
        const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
        if (!authCheck.authorized) {
          return {
            status: authCheck.status,
            matchId,
            shotClockSecondsRemaining: Math.max(0, match?.shotClock?.secondsRemaining ?? seconds),
            isRunning: Boolean(match?.timerLastStart && match?.shotClock?.lastStart),
            reason: authCheck.reason,
            epoch: authCheck.callerEpoch
          };
        }

        const isMainRunning = Boolean(match!.timerLastStart);
        const startDate = isMainRunning ? new Date(nowMs) : undefined;

        const updateData: Partial<Match> = {
          shotClock: {
            enabled: true,
            secondsRemaining: seconds,
            lastStart: startDate
          },
          ...(match!.possessionAssistant ? {
            possessionAssistant: {
              ...match!.possessionAssistant,
              lastAssistedScoreId: undefined
            }
          } : {}),
          timerEpoch: authCheck.callerEpoch,
          timerOwnerTabId: authCheck.callerTabId
        };

        if (isMainRunning) {
          sessionShotClockMonotonicStarts.set(matchId, {
            perfStart:
              options?.simulatedPerfNowMs ??
              (typeof performance !== 'undefined' ? performance.now() : 0),
            wallStartMs: nowMs
          });
        } else {
          sessionShotClockMonotonicStarts.delete(matchId);
        }

        if (this._testPreCommitHook) {
          await this._testPreCommitHook(matchId);
        }

        await db.matches.update(matchId, updateData);

        return {
          status: 'applied',
          matchId,
          shotClockSecondsRemaining: seconds,
          isRunning: isMainRunning,
          epoch: authCheck.callerEpoch
        };
      });

      return await opPromise;
    });
  },

  /**
   * Persiste la expiración del reloj de posesión en 00 y lo detiene hasta nuevo reinicio (DEPORT-04).
   * No altera el cronómetro principal, el marcador ni la posesión.
   */
  expireShotClock(
    matchId: number,
    options?: TimerServiceOptions
  ): Promise<ShotClockOperationResult> {
    return this._trackOp(matchId, options, async () => {
      const matchBefore = await db.matches.get(matchId);
      if (!matchBefore || !matchBefore.shotClock?.enabled) {
        return {
          status: 'already_applied',
          matchId,
          shotClockSecondsRemaining: 0,
          isRunning: false
        };
      }

      if (matchBefore.status === 'finished') {
        return {
          status: 'finished',
          matchId,
          shotClockSecondsRemaining: 0,
          isRunning: false
        };
      }

      const authorityCheck = this._validateAuthority(matchId, options);
      if (!authorityCheck.valid) {
        return {
          status: authorityCheck.status ?? 'not_owner',
          matchId,
          shotClockSecondsRemaining: Math.max(0, matchBefore.shotClock?.secondsRemaining ?? 0),
          isRunning: Boolean(matchBefore.timerLastStart && matchBefore.shotClock?.lastStart),
          reason: authorityCheck.reason
        };
      }

      const nowMs = options?.nowMs ?? Date.now();

      const opPromise = db.transaction('rw', db.matches, async (): Promise<ShotClockOperationResult> => {
        const match = await db.matches.get(matchId);
        const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
        if (!authCheck.authorized) {
          return {
            status: authCheck.status,
            matchId,
            shotClockSecondsRemaining: 0,
            isRunning: false,
            reason: authCheck.reason,
            epoch: authCheck.callerEpoch
          };
        }

        sessionShotClockMonotonicStarts.delete(matchId);

        await db.matches.update(matchId, {
          shotClock: {
            ...match!.shotClock,
            enabled: true,
            secondsRemaining: 0,
            lastStart: undefined
          },
          timerEpoch: authCheck.callerEpoch,
          timerOwnerTabId: authCheck.callerTabId
        });

        return {
          status: 'applied',
          matchId,
          shotClockSecondsRemaining: 0,
          isRunning: false,
          epoch: authCheck.callerEpoch
        };
      });

      return await opPromise;
    });
  },

  /**
   * Registra una canasta de campo (2 o 3 puntos) con el asistente automático activo (ASIST-01).
   * Ejecución atómica en una sola transacción Dexie sobre db.matches y db.scores:
   * - Valida autoridad y fencing token (timerEpoch, tabId).
   * - Valida periodo esperado y que el partido esté activo.
   * - Registra la anotación en db.scores.
   * - Suma los puntos al marcador del equipo correspondiente.
   * - Cambia la posesión al equipo rival.
   * - Prepara/reinicia el reloj de posesión en 24 segundos.
   * - Si falla la autoridad o cualquier validación, aborta la transacción sin escrituras parciales.
   */
  recordFieldGoalWithAssistant(
    matchId: number,
    params: {
      scoringTeamId: number;
      points: 2 | 3;
      playerId?: number;
    },
    options?: TimerServiceOptions
  ): Promise<AssistantFieldGoalResult> {
    return this._trackOp(matchId, options, async () => {
      const matchBefore = await db.matches.get(matchId);
      if (!matchBefore) {
        return {
          status: 'rejected',
          matchId,
          shotClockSecondsRemaining: 24,
          reason: 'El partido no existe.'
        };
      }

      if (matchBefore.status === 'finished') {
        return {
          status: 'finished',
          matchId,
          shotClockSecondsRemaining: Math.max(0, matchBefore.shotClock?.secondsRemaining ?? 24),
          reason: 'El partido ya ha finalizado.'
        };
      }

      const authorityCheck = this._validateAuthority(matchId, options);
      if (!authorityCheck.valid) {
        return {
          status: authorityCheck.status ?? 'not_owner',
          matchId,
          shotClockSecondsRemaining: Math.max(0, matchBefore.shotClock?.secondsRemaining ?? 24),
          reason: authorityCheck.reason
        };
      }

      const nowMs = options?.nowMs ?? Date.now();

      const opPromise = db.transaction('rw', db.matches, db.scores, async (): Promise<AssistantFieldGoalResult> => {
        const match = await db.matches.get(matchId);
        const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
        if (!authCheck.authorized) {
          return {
            status: authCheck.status,
            matchId,
            shotClockSecondsRemaining: Math.max(0, match?.shotClock?.secondsRemaining ?? 24),
            reason: authCheck.reason,
            epoch: authCheck.callerEpoch
          };
        }

        if (match!.status === 'finished') {
          return {
            status: 'finished',
            matchId,
            shotClockSecondsRemaining: Math.max(0, match!.shotClock?.secondsRemaining ?? 24),
            reason: 'El partido ya ha finalizado.',
            epoch: authCheck.callerEpoch
          };
        }

        const currentPeriod = match!.currentQuarter || 1;
        if (options?.expectedQuarter !== undefined && options.expectedQuarter !== currentPeriod) {
          return {
            status: 'rejected',
            matchId,
            shotClockSecondsRemaining: Math.max(0, match!.shotClock?.secondsRemaining ?? 24),
            reason: `El periodo ya cambió (esperado: #${options.expectedQuarter}, vigente: #${currentPeriod}).`,
            epoch: authCheck.callerEpoch
          };
        }

        if (match!.gameHistory?.some(g => g.gameNumber === currentPeriod)) {
          return {
            status: 'rejected',
            matchId,
            shotClockSecondsRemaining: Math.max(0, match!.shotClock?.secondsRemaining ?? 24),
            reason: `El periodo #${currentPeriod} ya fue cerrado en el historial.`,
            epoch: authCheck.callerEpoch
          };
        }

        const { scoringTeamId, points, playerId } = params;
        if (points !== 2 && points !== 3) {
          return {
            status: 'rejected',
            matchId,
            shotClockSecondsRemaining: Math.max(0, match!.shotClock?.secondsRemaining ?? 24),
            reason: 'Solo se automatizan canastas de campo de 2 o 3 puntos.',
            epoch: authCheck.callerEpoch
          };
        }

        if (scoringTeamId !== match!.localTeamId && scoringTeamId !== match!.visitorTeamId) {
          return {
            status: 'rejected',
            matchId,
            shotClockSecondsRemaining: Math.max(0, match!.shotClock?.secondsRemaining ?? 24),
            reason: 'El equipo no corresponde a este partido.',
            epoch: authCheck.callerEpoch
          };
        }

        const isLocal = scoringTeamId === match!.localTeamId;
        const currentLocal = match!.localScore || 0;
        const currentVisitor = match!.visitorScore || 0;
        const newLocal = isLocal ? currentLocal + points : currentLocal;
        const newVisitor = !isLocal ? currentVisitor + points : currentVisitor;

        // Registrar anotación en scores
        const newScore: Omit<Score, 'id'> = {
          matchId,
          teamId: scoringTeamId,
          playerId,
          points,
          quarter: currentPeriod,
          createdAt: new Date(nowMs)
        };
        const scoreId = await db.scores.add(newScore as Score);

        // Posesión siguiente asignada al rival
        const nextPossession: 'local' | 'visitor' = isLocal ? 'visitor' : 'local';

        // Preparar reloj de ataque en 24s
        const isMainRunning = Boolean(match!.timerLastStart);
        const startDate = isMainRunning ? new Date(nowMs) : undefined;

        if (isMainRunning) {
          sessionShotClockMonotonicStarts.set(matchId, {
            perfStart:
              options?.simulatedPerfNowMs ??
              (typeof performance !== 'undefined' ? performance.now() : 0),
            wallStartMs: nowMs
          });
        } else {
          sessionShotClockMonotonicStarts.delete(matchId);
        }

        const updateData: Partial<Match> = {
          localScore: newLocal,
          visitorScore: newVisitor,
          possession: nextPossession,
          shotClock: {
            enabled: true,
            secondsRemaining: 24,
            lastStart: startDate
          },
          ...(match!.possessionAssistant ? {
            possessionAssistant: {
              ...match!.possessionAssistant,
              enabled: true,
              lastAssistedScoreId: Number(scoreId)
            }
          } : {}),
          timerEpoch: authCheck.callerEpoch,
          timerOwnerTabId: authCheck.callerTabId
        };

        if (match!.status === 'created') {
          updateData.status = 'playing';
        }

        if (this._testPreCommitHook) {
          await this._testPreCommitHook(matchId);
        }

        await db.matches.update(matchId, updateData);

        return {
          status: 'applied',
          matchId,
          newScore: { local: newLocal, visitor: newVisitor },
          nextPossession,
          shotClockSecondsRemaining: 24,
          epoch: authCheck.callerEpoch
        };
      });

      return await opPromise;
    });
  },

  /**
   * Registra un cambio de posesión o robo ('Cambio / Robo') (ASIST-01).
   * - Cambia la posesión al equipo contrario.
   * - Reinicia el reloj de posesión a 24 segundos.
   * - Mantiene el cronómetro principal sin alteraciones.
   * - Si la posesión es desconocida, solicita indicar directamente el equipo.
   */
  applyPossessionTurnover(
    matchId: number,
    options?: TimerServiceOptions
  ): Promise<AssistantTurnoverResult> {
    return this._trackOp(matchId, options, async () => {
      const matchBefore = await db.matches.get(matchId);
      if (!matchBefore) {
        return {
          status: 'rejected',
          matchId,
          shotClockSecondsRemaining: 24,
          isRunning: false,
          reason: 'El partido no existe.'
        };
      }

      if (matchBefore.status === 'finished') {
        return {
          status: 'finished',
          matchId,
          shotClockSecondsRemaining: Math.max(0, matchBefore.shotClock?.secondsRemaining ?? 24),
          isRunning: false,
          reason: 'El partido ya ha finalizado.'
        };
      }

      const authorityCheck = this._validateAuthority(matchId, options);
      if (!authorityCheck.valid) {
        return {
          status: authorityCheck.status ?? 'not_owner',
          matchId,
          shotClockSecondsRemaining: Math.max(0, matchBefore.shotClock?.secondsRemaining ?? 24),
          isRunning: Boolean(matchBefore.timerLastStart && matchBefore.shotClock?.lastStart),
          reason: authorityCheck.reason
        };
      }

      const nowMs = options?.nowMs ?? Date.now();

      const opPromise = db.transaction('rw', db.matches, async (): Promise<AssistantTurnoverResult> => {
        const match = await db.matches.get(matchId);
        const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
        if (!authCheck.authorized) {
          return {
            status: authCheck.status,
            matchId,
            shotClockSecondsRemaining: Math.max(0, match?.shotClock?.secondsRemaining ?? 24),
            isRunning: Boolean(match?.timerLastStart && match?.shotClock?.lastStart),
            reason: authCheck.reason,
            epoch: authCheck.callerEpoch
          };
        }

        if (!match!.possession) {
          return {
            status: 'rejected',
            matchId,
            shotClockSecondsRemaining: Math.max(0, match!.shotClock?.secondsRemaining ?? 24),
            isRunning: Boolean(match!.timerLastStart && match!.shotClock?.lastStart),
            reason: 'La posesión actual es desconocida. Selecciona qué equipo tiene el balón.',
            epoch: authCheck.callerEpoch
          };
        }

        const nextPossession: 'local' | 'visitor' = match!.possession === 'local' ? 'visitor' : 'local';
        const isMainRunning = Boolean(match!.timerLastStart);
        const startDate = isMainRunning ? new Date(nowMs) : undefined;

        if (isMainRunning) {
          sessionShotClockMonotonicStarts.set(matchId, {
            perfStart:
              options?.simulatedPerfNowMs ??
              (typeof performance !== 'undefined' ? performance.now() : 0),
            wallStartMs: nowMs
          });
        } else {
          sessionShotClockMonotonicStarts.delete(matchId);
        }

        const updateData: Partial<Match> = {
          possession: nextPossession,
          shotClock: {
            enabled: true,
            secondsRemaining: 24,
            lastStart: startDate
          },
          ...(match!.possessionAssistant ? {
            possessionAssistant: {
              ...match!.possessionAssistant,
              lastAssistedScoreId: undefined
            }
          } : {}),
          timerEpoch: authCheck.callerEpoch,
          timerOwnerTabId: authCheck.callerTabId
        };

        if (this._testPreCommitHook) {
          await this._testPreCommitHook(matchId);
        }

        await db.matches.update(matchId, updateData);

        return {
          status: 'applied',
          matchId,
          nextPossession,
          shotClockSecondsRemaining: 24,
          isRunning: isMainRunning,
          epoch: authCheck.callerEpoch
        };
      });

      return await opPromise;
    });
  },

  /**
   * Establece o corrige directamente el equipo con posesión de balón (ASIST-01).
   */
  setPossession(
    matchId: number,
    possession: 'local' | 'visitor' | null,
    options?: TimerServiceOptions
  ): Promise<{ status: TimerOperationStatus; matchId: number; possession: 'local' | 'visitor' | null; reason?: string }> {
    return this._trackOp(matchId, options, async () => {
      const matchBefore = await db.matches.get(matchId);
      if (!matchBefore) {
        return { status: 'rejected', matchId, possession, reason: 'El partido no existe.' };
      }

      if (matchBefore.status === 'finished') {
        return { status: 'finished', matchId, possession: matchBefore.possession ?? null, reason: 'El partido ya finalizó.' };
      }

      const authorityCheck = this._validateAuthority(matchId, options);
      if (!authorityCheck.valid) {
        return {
          status: authorityCheck.status ?? 'not_owner',
          matchId,
          possession: matchBefore.possession ?? null,
          reason: authorityCheck.reason
        };
      }

      const nowMs = options?.nowMs ?? Date.now();
      const opPromise = db.transaction('rw', db.matches, async () => {
        const match = await db.matches.get(matchId);
        const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
        if (!authCheck.authorized) {
          return {
            status: authCheck.status,
            matchId,
            possession: match?.possession ?? null,
            reason: authCheck.reason
          };
        }

        await db.matches.update(matchId, {
          possession,
          ...(match?.possessionAssistant ? {
            possessionAssistant: {
              ...match.possessionAssistant,
              lastAssistedScoreId: undefined
            }
          } : {}),
          timerEpoch: authCheck.callerEpoch,
          timerOwnerTabId: authCheck.callerTabId
        });

        return {
          status: 'applied' as TimerOperationStatus,
          matchId,
          possession
        };
      });

      return await opPromise;
    });
  },

  /**
   * Activa o desactiva el asistente automático de posesión de forma transaccional (ASIST-01).
   * Solo permitido con el cronómetro principal detenido.
   * Requiere que el reloj de posesión esté activado para habilitarse.
   */
  setPossessionAssistantEnabled(
    matchId: number,
    enabled: boolean,
    hapticsEnabled: boolean = true,
    options?: TimerServiceOptions
  ): Promise<AssistantConfigResult> {
    return this._trackOp(matchId, options, async () => {
      const matchBefore = await db.matches.get(matchId);
      if (!matchBefore) {
        return {
          status: 'rejected',
          matchId,
          enabled: false,
          reason: 'El partido no existe.'
        };
      }

      if (matchBefore.status === 'finished') {
        return {
          status: 'finished',
          matchId,
          enabled: Boolean(matchBefore.possessionAssistant?.enabled),
          reason: 'El partido ya finalizó. No se puede modificar la configuración.'
        };
      }

      if (matchBefore.timerLastStart) {
        return {
          status: 'rejected',
          matchId,
          enabled: Boolean(matchBefore.possessionAssistant?.enabled),
          reason: 'El asistente solo puede activarse o desactivarse con el cronómetro principal detenido.'
        };
      }

      if (enabled && !matchBefore.shotClock?.enabled) {
        return {
          status: 'rejected',
          matchId,
          enabled: false,
          reason: 'El reloj de posesión (24s / 14s) debe estar activado para habilitar el asistente.'
        };
      }

      const authorityCheck = this._validateAuthority(matchId, options);
      if (!authorityCheck.valid) {
        return {
          status: authorityCheck.status ?? 'not_owner',
          matchId,
          enabled: Boolean(matchBefore.possessionAssistant?.enabled),
          reason: authorityCheck.reason
        };
      }

      const nowMs = options?.nowMs ?? Date.now();
      const opPromise = db.transaction('rw', db.matches, async (): Promise<AssistantConfigResult> => {
        const match = await db.matches.get(matchId);
        const authCheck = this._verifyTransactionalAuthority(match, matchId, options, nowMs);
        if (!authCheck.authorized) {
          return {
            status: authCheck.status,
            matchId,
            enabled: Boolean(match?.possessionAssistant?.enabled),
            reason: authCheck.reason
          };
        }

        await db.matches.update(matchId, {
          possessionAssistant: {
            enabled,
            hapticsEnabled,
            lastAssistedScoreId: undefined
          },
          timerEpoch: authCheck.callerEpoch,
          timerOwnerTabId: authCheck.callerTabId
        });

        return {
          status: 'applied',
          matchId,
          enabled,
          hapticsEnabled
        };
      });

      return await opPromise;
    });
  }
};
