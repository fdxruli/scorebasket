// src/db/timeout.service.ts
import { db } from './db';

export interface RequestTimeoutResult {
  success: boolean;
  error?: string;
  localTimeouts?: number;
  visitorTimeouts?: number;
}

export const TimeoutService = {
  /**
   * Solicita un tiempo fuera para el equipo correspondiente ('local' | 'visitor').
   * Reglas de integridad:
   * 1. Consulta el estado vigente del partido.
   * 2. Consulta el límite configurado (timeoutsPerTeam, por defecto 3 en modo tradicional).
   * 3. Si el límite está agotado (current >= max), rechaza el incremento y no modifica el contador (NUNCA reinicia a 0).
   * 4. Si el partido está finalizado, rechaza la solicitud.
   * 5. Incrementa el contador de forma atómica y segura.
   */
  async requestTimeout(
    matchId: number,
    side: 'local' | 'visitor'
  ): Promise<RequestTimeoutResult> {
    return db.transaction('rw', db.matches, async () => {
      const match = await db.matches.get(matchId);
      if (!match) {
        return { success: false, error: 'El partido no existe.' };
      }

      if (match.status === 'finished') {
        return { success: false, error: 'El partido ya finalizó.' };
      }

      const maxTimeouts = match.config?.traditional?.timeoutsPerTeam ?? 3;
      if (maxTimeouts <= 0) {
        return { success: false, error: 'Los tiempos fuera no están habilitados en este partido.' };
      }

      const currentLocal = match.localTimeouts ?? 0;
      const currentVisitor = match.visitorTimeouts ?? 0;
      const currentCount = side === 'local' ? currentLocal : currentVisitor;

      if (currentCount >= maxTimeouts) {
        return {
          success: false,
          error: 'Tiempos fuera agotados para este equipo.',
          localTimeouts: currentLocal,
          visitorTimeouts: currentVisitor
        };
      }

      const nextCount = currentCount + 1;
      const updates = side === 'local'
        ? { localTimeouts: nextCount }
        : { visitorTimeouts: nextCount };

      await db.matches.update(matchId, updates);

      return {
        success: true,
        localTimeouts: side === 'local' ? nextCount : currentLocal,
        visitorTimeouts: side === 'visitor' ? nextCount : currentVisitor
      };
    });
  }
};
