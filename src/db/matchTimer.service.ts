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
  /** Omite verificación de autoridad (p. ej. pausas de emergencia del sistema o timeouts deportivos) */
  skipAuthorityCheck?: boolean;
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
      const elapsed = Math.max(0, (nowMs - match.timerLastStart.getTime()) / 1000);
      effective = Math.max(0, baseRemaining - elapsed);
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
   * Valida la autoridad del invocador antes de escribir.
   */
  _validateAuthority(matchId: number, options?: TimerServiceOptions): { valid: boolean; reason?: string } {
    if (options?.skipAuthorityCheck) {
      return { valid: true };
    }

    const { hasAuthority, epoch: currentEpoch } = timerAuthorityCoordinator.getAuthorityState(matchId);

    // Si el coordinador no considera que esta pestaña es dueña, se rechaza
    if (!hasAuthority) {
      return {
        valid: false,
        reason: 'Esta pestaña no posee la autoridad del cronómetro para este partido.'
      };
    }

    // Fencing token check: si la operación venía con un epoch específico y ya cambió, es stale
    if (options?.epoch !== undefined && options.epoch !== currentEpoch) {
      return {
        valid: false,
        reason: `Operación atrasada (fencing epoch ${options.epoch} !== actual ${currentEpoch}).`
      };
    }

    return { valid: true };
  },

  /**
   * Inicia el cronómetro del partido de forma atómica y transaccional.
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

    return await db.transaction('rw', db.matches, async () => {
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

      // Si ya está corriendo, idempotencia estricta: NO sobreescribir timerLastStart (TC-04)
      if (match.timerLastStart) {
        return {
          status: 'already_applied',
          matchId,
          timerSecondsRemaining: Math.max(0, match.timerSecondsRemaining ?? 0),
          isRunning: true,
          epoch: options?.epoch
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
        status: 'playing'
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: remaining,
        isRunning: true,
        epoch: options?.epoch
      };
    });
  },

  /**
   * Pausa el cronómetro de forma atómica, idempotente y monotónica.
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

    return await db.transaction('rw', db.matches, async () => {
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

      const currentRemaining = Math.max(0, match.timerSecondsRemaining ?? 0);

      // Si ya está pausado, retorno idempotente sin alteraciones (INV-T02)
      if (!match.timerLastStart) {
        return {
          status: 'already_applied',
          matchId,
          timerSecondsRemaining: currentRemaining,
          isRunning: false,
          epoch: options?.epoch
        };
      }

      // Cálculo monotónico con protección contra retrocesos de reloj del sistema (INV-T08)
      const lastStartMs = match.timerLastStart.getTime();
      let elapsedSeconds = 0;
      if (nowMs >= lastStartMs) {
        elapsedSeconds = (nowMs - lastStartMs) / 1000;
      } else {
        elapsedSeconds = 0;
      }

      const newRemaining = Math.max(0, currentRemaining - elapsedSeconds);

      await db.matches.update(matchId, {
        timerLastStart: undefined,
        timerSecondsRemaining: newRemaining
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: newRemaining,
        isRunning: false,
        epoch: options?.epoch
      };
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

    return await db.transaction('rw', db.matches, async () => {
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

      const durationMinutes =
        match.config?.traditional?.minutesPerQuarter ??
        match.quarterDuration ??
        10;
      const targetSeconds = durationMinutes * 60;

      await db.matches.update(matchId, {
        timerSecondsRemaining: targetSeconds,
        timerLastStart: undefined
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: targetSeconds,
        isRunning: false,
        epoch: options?.epoch
      };
    });
  },

  /**
   * Ajusta manualmente el tiempo restante (en segundos delta).
   * Solo está permitido cuando el reloj está pausado (INV-T09).
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

    return await db.transaction('rw', db.matches, async () => {
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

      const currentSecs = Math.ceil(match.timerSecondsRemaining ?? 0);
      const nextSecs = Math.max(0, currentSecs + deltaSeconds);

      await db.matches.update(matchId, {
        timerSecondsRemaining: nextSecs,
        timerLastStart: undefined
      });

      return {
        status: 'applied',
        matchId,
        timerSecondsRemaining: nextSecs,
        isRunning: false,
        epoch: options?.epoch
      };
    });
  },

  /**
   * Reconcilia el cronómetro tras suspensión de PWA, cambio de visibilidad,
   * bloqueo de pantalla o descarte de proceso.
   */
  async reconcile(matchId: number, options?: TimerServiceOptions): Promise<TimerOperationResult> {
    const nowMs = options?.nowMs ?? Date.now();

    return await db.transaction('rw', db.matches, async () => {
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

      // Si no estaba corriendo, no hay reconciliación que hacer
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
      let elapsedSeconds = 0;
      if (nowMs >= lastStartMs) {
        elapsedSeconds = (nowMs - lastStartMs) / 1000;
      } else {
        elapsedSeconds = 0;
      }

      const newRemaining = Math.max(0, baseRemaining - elapsedSeconds);

      if (newRemaining <= 0) {
        // Expiró durante la suspensión o ejecución
        await db.matches.update(matchId, {
          timerLastStart: undefined,
          timerSecondsRemaining: 0
        });

        return {
          status: 'applied',
          matchId,
          timerSecondsRemaining: 0,
          isRunning: false,
          expired: true,
          epoch: options?.epoch
        };
      } else {
        // Sigue corriendo: actualizamos el tiempo restante
        return {
          status: 'applied',
          matchId,
          timerSecondsRemaining: newRemaining,
          isRunning: true,
          expired: false,
          epoch: options?.epoch
        };
      }
    });
  }
};
