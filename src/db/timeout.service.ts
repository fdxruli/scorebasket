// src/db/timeout.service.ts
import { db } from './db';

export interface RequestTimeoutOptions {
  /** Marca de tiempo opcional (ms) para cálculo determinista del tiempo transcurrido */
  nowMs?: number;
  /** Callback ejecutado únicamente cuando el tiempo fuera fue efectivamente concedido y persistido */
  onGranted?: () => void;
}

export interface RequestTimeoutResult {
  success: boolean;
  error?: string;
  localTimeouts?: number;
  visitorTimeouts?: number;
  /** Indica si el reloj estaba corriendo al momento de conceder el tiempo fuera y fue pausado */
  timerWasRunning?: boolean;
  /** Segundos restantes en el cronómetro tras la operación */
  timerSecondsRemaining?: number;
}

export const TimeoutService = {
  /**
   * Solicita un tiempo fuera para el equipo correspondiente ('local' | 'visitor').
   * Reglas de integridad (SB-03 y R1.2-B):
   * 1. Ejecuta toda la validación y actualización en una única transacción `rw` sobre `db.matches`.
   * 2. Consulta el estado real del partido y el límite configurado (`timeoutsPerTeam`, por defecto 3).
   * 3. Si el partido no existe, ya finalizó o el límite está agotado (`current >= max`), rechaza la
   *    solicitud sin modificar el contador (NUNCA reinicia a 0) y sin alterar el cronómetro.
   * 4. Si la solicitud es concedida:
   *    - Incrementa el contador del equipo solicitante en +1.
   *    - Pausa el cronómetro de forma idempotente: solo si `timerLastStart` está activo, descuenta
   *      una única vez el tiempo transcurrido (`elapsed`) y limpia `timerLastStart = undefined`.
   *      Si el reloj ya estaba pausado, conserva `timerSecondsRemaining` intacto y NUNCA arranca ni reanuda el reloj.
   * 5. Solo ejecuta `options.onGranted` (sonido/confirmación) cuando la transacción concede el tiempo fuera.
   */
  async requestTimeout(
    matchId: number,
    side: 'local' | 'visitor',
    options?: RequestTimeoutOptions
  ): Promise<RequestTimeoutResult> {
    const result = await db.transaction('rw', db.matches, async () => {
      const match = await db.matches.get(matchId);
      if (!match) {
        return { success: false, error: 'El partido no existe.' };
      }

      const currentLocal = match.localTimeouts ?? 0;
      const currentVisitor = match.visitorTimeouts ?? 0;
      const timerRunning = Boolean(match.timerLastStart);

      if (match.status === 'finished') {
        return {
          success: false,
          error: 'El partido ya finalizó.',
          localTimeouts: currentLocal,
          visitorTimeouts: currentVisitor,
          timerWasRunning: timerRunning,
          timerSecondsRemaining: match.timerSecondsRemaining
        };
      }

      const maxTimeouts = match.config?.traditional?.timeoutsPerTeam ?? 3;
      if (maxTimeouts <= 0) {
        return {
          success: false,
          error: 'Los tiempos fuera no están habilitados en este partido.',
          localTimeouts: currentLocal,
          visitorTimeouts: currentVisitor,
          timerWasRunning: timerRunning,
          timerSecondsRemaining: match.timerSecondsRemaining
        };
      }

      const currentCount = side === 'local' ? currentLocal : currentVisitor;

      if (currentCount >= maxTimeouts) {
        return {
          success: false,
          error: 'Tiempos fuera agotados para este equipo.',
          localTimeouts: currentLocal,
          visitorTimeouts: currentVisitor,
          timerWasRunning: timerRunning,
          timerSecondsRemaining: match.timerSecondsRemaining
        };
      }

      const nextCount = currentCount + 1;
      let nextSecondsRemaining = match.timerSecondsRemaining;

      const updates: {
        localTimeouts?: number;
        visitorTimeouts?: number;
        timerLastStart?: undefined;
        timerSecondsRemaining?: number;
      } =
        side === 'local'
          ? { localTimeouts: nextCount }
          : { visitorTimeouts: nextCount };

      // Pausa idempotente del reloj dentro de la misma transacción:
      // Solo si el reloj está corriendo (timerLastStart definido), descontamos el tiempo transcurrido
      // y limpiamos timerLastStart. Si ya estaba pausado, jamás lo arrancamos ni descontamos dos veces.
      if (match.timerLastStart) {
        const nowMs = options?.nowMs ?? Date.now();
        const elapsed = Math.max(0, (nowMs - match.timerLastStart.getTime()) / 1000);
        nextSecondsRemaining = Math.max(0, (match.timerSecondsRemaining ?? 0) - elapsed);
        updates.timerLastStart = undefined;
        updates.timerSecondsRemaining = nextSecondsRemaining;
      }

      await db.matches.update(matchId, updates);

      return {
        success: true,
        localTimeouts: side === 'local' ? nextCount : currentLocal,
        visitorTimeouts: side === 'visitor' ? nextCount : currentVisitor,
        timerWasRunning: timerRunning,
        timerSecondsRemaining: nextSecondsRemaining
      };
    });

    if (result.success && options?.onGranted) {
      options.onGranted();
    }

    return result;
  }
};
