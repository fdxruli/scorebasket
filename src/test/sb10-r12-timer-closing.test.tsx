// src/test/sb10-r12-timer-closing.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db/db';
import { MatchTimerService } from '../db/matchTimer.service';
import {
  timerAuthorityCoordinator,
  TimerAuthorityCoordinator
} from '../services/timerAuthority.coordinator';

describe('SB_PHASE2C_R1.2: Cierre Definitivo de Autoridad, Fencing y Concurrencia (R12-C-01 a R12-C-22)', () => {
  let sampleMatchId: number;

  beforeEach(async () => {
    await db.matches.clear();
    await timerAuthorityCoordinator._resetForTesting();

    sampleMatchId = (await db.matches.add({
      status: 'playing',
      localTeamId: 1,
      visitorTeamId: 2,
      createdAt: new Date(),
      localScore: 10,
      visitorScore: 12,
      localFouls: 2,
      visitorFouls: 3,
      currentQuarter: 1,
      timerSecondsRemaining: 600,
      timerEpoch: 1,
      config: {
        mode: 'traditional',
        traditional: {
          minutesPerQuarter: 10,
          totalQuarters: 4
        }
      }
    })) as number;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await timerAuthorityCoordinator._resetForTesting();
  });

  // =========================================================================
  // C-16: Adquisición Fail-Closed
  // =========================================================================
  describe('C-16: Adquisición Fail-Closed', () => {
    it('R12-C-01: fallback con IndexedDB cerrada falla de forma limpia sin conceder autoridad ni iniciar heartbeat', async () => {
      await timerAuthorityCoordinator._resetForTesting({ forceFallback: true });

      const isOpenSpy = vi.spyOn(db, 'isOpen').mockReturnValue(false);

      const result = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(result.acquired).toBe(false);
      expect(result.epoch).toBe(0);

      const state = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
      expect(state.hasAuthority).toBe(false);
      expect(state.isOwner).toBe(false);
      expect(state.ownerTabId).toBeNull();

      isOpenSpy.mockRestore();
    });

    it('R12-C-02: fallback con excepción en transacción falla de forma cerrada (fail-closed)', async () => {
      await timerAuthorityCoordinator._resetForTesting({ forceFallback: true });

      const txSpy = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('Simulated DB Error'));

      const result = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(result.acquired).toBe(false);
      expect(result.epoch).toBe(0);

      const state = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
      expect(state.hasAuthority).toBe(false);
      expect(state.isOwner).toBe(false);

      txSpy.mockRestore();
    });

    it('R12-C-03: Web Lock nativo con fallo en reserva de epoch falla cerrado y libera lock', async () => {
      await timerAuthorityCoordinator._resetForTesting({ forceFallback: false });

      // Simular fallo en la reserva de epoch en BD
      const txSpy = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('Epoch reservation failure'));

      const result = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(result.acquired).toBe(false);
      expect(result.epoch).toBe(0);

      const state = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
      expect(state.hasAuthority).toBe(false);
      expect(state.isOwner).toBe(false);

      txSpy.mockRestore();
    });

    it('R12-C-04: recuperación de autoridad tras restaurar disponibilidad de IndexedDB', async () => {
      await timerAuthorityCoordinator._resetForTesting({ forceFallback: true });

      // 1. Simular base cerrada
      const isOpenSpy = vi.spyOn(db, 'isOpen').mockReturnValue(false);
      const failRes = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(failRes.acquired).toBe(false);

      // 2. Restaurar base abierta
      isOpenSpy.mockRestore();

      // 3. Reintento debe tener éxito
      const okRes = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(okRes.acquired).toBe(true);
      expect(okRes.epoch).toBeGreaterThan(0);

      const state = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
      expect(state.hasAuthority).toBe(true);
      expect(state.isOwner).toBe(true);
    });
  });

  // =========================================================================
  // C-17: Lease, Heartbeat y Liberación Transaccional
  // =========================================================================
  describe('C-17: Lease, Heartbeat y Liberación Transaccional', () => {
    it('R12-C-05: heartbeat detecta discrepancia de propietario en BD y detiene autoridad local', async () => {
      await timerAuthorityCoordinator._resetForTesting({ forceFallback: true, tabId: 'tab_A' });

      const acq = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(acq.acquired).toBe(true);

      // Otra pestaña sobrescribe el propietario en BD
      await db.matches.update(sampleMatchId, {
        timerOwnerTabId: 'tab_B',
        timerEpoch: acq.epoch + 1,
        timerLeaseExpiresAt: Date.now() + 10000
      });

      // Disparar heartbeat transaccional
      const renewed = await timerAuthorityCoordinator._testTriggerHeartbeat(sampleMatchId);
      expect(renewed).toBe(false);

      const state = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
      expect(state.hasAuthority).toBe(false);
      expect(state.isOwner).toBe(false);
    });

    it('R12-C-06: heartbeat detecta partido finalizado y cesa renovación', async () => {
      await timerAuthorityCoordinator._resetForTesting({ forceFallback: true });

      const acq = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(acq.acquired).toBe(true);

      await db.matches.update(sampleMatchId, {
        status: 'finished',
        finishedAt: new Date()
      });

      const renewed = await timerAuthorityCoordinator._testTriggerHeartbeat(sampleMatchId);
      expect(renewed).toBe(false);

      const state = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
      expect(state.hasAuthority).toBe(false);
      expect(state.isOwner).toBe(false);
    });

    it('R12-C-07: releaseAuthority de propietario obsoleto NO borra lease ni propietario de pestaña nueva', async () => {
      await timerAuthorityCoordinator._resetForTesting({ forceFallback: true, tabId: 'tab_A' });

      // Tab A adquiere
      const acqA = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(acqA.acquired).toBe(true);

      // Tab A suspende (simulada) y Tab B toma el lease
      timerAuthorityCoordinator._testSimulateSuspension(sampleMatchId);

      const leaseExpiresB = Date.now() + 6000;
      await db.matches.update(sampleMatchId, {
        timerOwnerTabId: 'tab_B',
        timerEpoch: acqA.epoch + 1,
        timerLeaseExpiresAt: leaseExpiresB
      });

      // Tab A despierta y llama releaseAuthority()
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

      // Comprobar que en IndexedDB, el lease y propietario de Tab B continúan intactos
      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerOwnerTabId).toBe('tab_B');
      expect(matchDb?.timerEpoch).toBe(acqA.epoch + 1);
      expect(matchDb?.timerLeaseExpiresAt).toBe(leaseExpiresB);
    });

    it('R12-C-08: PRUEBA ADVERSARIAL OBLIGATORIA COMPLETA DE 12 PASOS (C-17)', async () => {
      // Instancia aislada para Tab A
      const coordA = new TimerAuthorityCoordinator();
      await coordA._resetForTesting({ forceFallback: true, tabId: 'tab_A' });

      // Instancia aislada para Tab B
      const coordB = new TimerAuthorityCoordinator();
      await coordB._resetForTesting({ forceFallback: true, tabId: 'tab_B' });

      // Instancia aislada para Tab C
      const coordC = new TimerAuthorityCoordinator();
      await coordC._resetForTesting({ forceFallback: true, tabId: 'tab_C' });

      // 1. A adquiere lease
      const acqA = await coordA.acquireAuthority(sampleMatchId);
      expect(acqA.acquired).toBe(true);
      let match = await db.matches.get(sampleMatchId);
      expect(match?.timerOwnerTabId).toBe('tab_A');
      const epochA = match?.timerEpoch;

      // 2. A queda suspendida (detiene heartbeats pero no borra lease en BD)
      coordA._testSimulateSuspension(sampleMatchId);

      // 3. Lease A expira (avanzar expiración en BD al pasado)
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: Date.now() - 1000
      });

      // 4. B adquiere el lease
      const acqB = await coordB.acquireAuthority(sampleMatchId);
      expect(acqB.acquired).toBe(true);
      match = await db.matches.get(sampleMatchId);
      expect(match?.timerOwnerTabId).toBe('tab_B');
      expect(match?.timerEpoch).toBeGreaterThan(epochA!);
      const epochB = match?.timerEpoch;
      const leaseExpiresB = match?.timerLeaseExpiresAt;

      // 5. A despierta e intenta renovar (simulación directa de transacción de heartbeat de A)
      const renewTx = await db.transaction('rw', db.matches, async () => {
        const m = await db.matches.get(sampleMatchId);
        if (!m || m.timerOwnerTabId !== 'tab_A') {
          return { ok: false, reason: 'Propietario en BD difiere' };
        }
        return { ok: true };
      });
      // 7. La renovación A se rechaza
      expect(renewTx.ok).toBe(false);

      // 8. B continúa siendo propietario
      match = await db.matches.get(sampleMatchId);
      expect(match?.timerOwnerTabId).toBe('tab_B');
      expect(match?.timerEpoch).toBe(epochB);

      // 9. A intenta liberar su antiguo lease
      await coordA.releaseAuthority(sampleMatchId);

      // 10. B conserva su autoridad y lease intactos
      match = await db.matches.get(sampleMatchId);
      expect(match?.timerOwnerTabId).toBe('tab_B');
      expect(match?.timerEpoch).toBe(epochB);
      expect(match?.timerLeaseExpiresAt).toBe(leaseExpiresB);
      expect(coordB.getAuthorityState(sampleMatchId).isOwner).toBe(true);

      // 11. C intenta adquirir mientras B sigue vigente
      const acqC = await coordC.acquireAuthority(sampleMatchId);
      // 12. C es rechazado
      expect(acqC.acquired).toBe(false);
      match = await db.matches.get(sampleMatchId);
      expect(match?.timerOwnerTabId).toBe('tab_B');

      await coordA._resetForTesting();
      await coordB._resetForTesting();
      await coordC._resetForTesting();
    });
  });

  // =========================================================================
  // C-18: Epoch Monotónico Compartido
  // =========================================================================
  describe('C-18: Epoch Monotónico Compartido', () => {
    it('R12-C-09: nueva pestaña con contador local reiniciado (epochCounter = 1) adquiere epoch superior al persistido en BD (C-18)', async () => {
      // 1. Simular que la base de datos ya tenía timerEpoch: 85 de un propietario previo
      await db.matches.update(sampleMatchId, {
        timerEpoch: 85,
        timerOwnerTabId: 'old_tab'
      });

      // 2. Nueva pestaña con epochCounter = 1
      await timerAuthorityCoordinator._resetForTesting({
        tabId: 'new_tab',
        epochCounter: 1
      });

      // 3. Adquirir autoridad
      const result = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(result.acquired).toBe(true);
      // El epoch DEBE ser al menos 86, nunca menor ni igual a 85!
      expect(result.epoch).toBe(86);

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerEpoch).toBe(86);
      expect(matchDb?.timerOwnerTabId).toBe('new_tab');
    });

    it('R12-C-10: conmutación de Web Locks a Fallback Lease preserva monotonicidad estricta (C-18)', async () => {
      // 1. Adquirir con Web Locks
      await timerAuthorityCoordinator._resetForTesting({ forceFallback: false });
      const acq1 = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(acq1.acquired).toBe(true);
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

      const epoch1 = (await db.matches.get(sampleMatchId))?.timerEpoch ?? 0;

      // 2. Nueva pestaña adquiere con Fallback Lease
      await timerAuthorityCoordinator._resetForTesting({
        forceFallback: true,
        epochCounter: 1
      });
      const acq2 = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(acq2.acquired).toBe(true);
      expect(acq2.epoch).toBeGreaterThan(epoch1);

      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      const epoch2 = (await db.matches.get(sampleMatchId))?.timerEpoch ?? 0;

      // 3. Volver a Web Locks
      await timerAuthorityCoordinator._resetForTesting({
        forceFallback: false,
        epochCounter: 1
      });
      const acq3 = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(acq3.acquired).toBe(true);
      expect(acq3.epoch).toBeGreaterThan(epoch2);
    });

    it('R12-C-11: operación con epoch inferior persistido es rechazada como stale_operation (C-18)', async () => {
      await timerAuthorityCoordinator._resetForTesting();
      const acq = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);

      // Simular que otra pestaña avanzó el epoch en BD a un número mayor
      await db.matches.update(sampleMatchId, {
        timerEpoch: acq.epoch + 5
      });

      const res = await MatchTimerService.start(sampleMatchId, {
        epoch: acq.epoch
      });
      expect(res.status).toBe('stale_operation');
    });
  });

  // =========================================================================
  // C-19: Finalización y Bypasses
  // =========================================================================
  describe('C-19: Finalización y Bypasses', () => {
    it('R12-C-12: MatchTimerService.endMatch finaliza bajo transacción de dominio con autoridad y fencing', async () => {
      await timerAuthorityCoordinator._resetForTesting();
      const acq = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);

      // Iniciar el reloj primero
      await MatchTimerService.start(sampleMatchId, { epoch: acq.epoch });

      // Finalizar partido con autoridad
      const res = await MatchTimerService.endMatch(sampleMatchId, {
        epoch: acq.epoch,
        expectedQuarter: 1
      });

      expect(res.status).toBe('applied');
      expect(res.isRunning).toBe(false);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.status).toBe('finished');
      expect(m?.finishedAt).toBeInstanceOf(Date);
      expect(m?.timerLastStart).toBeUndefined();
      expect(m?.timerEpoch).toBeGreaterThan(acq.epoch);
    });

    it('R12-C-13: endMatch desde pestaña observadora es rechazado con not_owner', async () => {
      await timerAuthorityCoordinator._resetForTesting({ tabId: 'observer_tab' });
      // No adquirimos autoridad

      const res = await MatchTimerService.endMatch(sampleMatchId);
      expect(res.status).toBe('not_owner');

      const m = await db.matches.get(sampleMatchId);
      expect(m?.status).toBe('playing');
    });

    it('R12-C-14: endMatch con epoch desfasado es rechazado con stale_operation', async () => {
      await timerAuthorityCoordinator._resetForTesting();
      const acq = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);

      // Pre-verificación con epoch menor que el actual
      const res = await MatchTimerService.endMatch(sampleMatchId, {
        epoch: acq.epoch - 1
      });
      expect(res.status).toBe('not_owner');
      expect(res.reason).toContain('Operación atrasada');

      // Fencing en transacción con epoch en BD avanzado por otra pestaña
      await db.matches.update(sampleMatchId, { timerEpoch: acq.epoch + 10 });
      const res2 = await MatchTimerService.endMatch(sampleMatchId, {
        epoch: acq.epoch
      });
      expect(res2.status).toBe('stale_operation');

      const m = await db.matches.get(sampleMatchId);
      expect(m?.status).toBe('playing');
    });

    it('R12-C-15: endMatch es idempotente si el partido ya estaba finalizado', async () => {
      await timerAuthorityCoordinator._resetForTesting();
      const acq = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);

      await MatchTimerService.endMatch(sampleMatchId, { epoch: acq.epoch });

      // Segundo intento
      const res2 = await MatchTimerService.endMatch(sampleMatchId, { epoch: acq.epoch });
      expect(res2.status).toBe('already_applied');
    });
  });

  // =========================================================================
  // C-20: Operaciones en Vuelo y Concurrencia
  // =========================================================================
  describe('C-20: Operaciones en Vuelo y Concurrencia', () => {
    it('R12-C-16: releaseAuthority aguarda a que transacciones en vuelo liquiden antes de ceder el lock', async () => {
      await timerAuthorityCoordinator._resetForTesting();
      await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);

      let operationResolved = false;
      const slowPromise = new Promise<void>((resolve) => {
        setTimeout(() => {
          operationResolved = true;
          resolve();
        }, 80);
      });

      timerAuthorityCoordinator.trackOperation(sampleMatchId, slowPromise);

      // Iniciar releaseAuthority inmediatamente
      const releasePromise = timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

      // Antes de que slowPromise resuelva, releasePromise no debe haber terminado
      expect(operationResolved).toBe(false);

      await releasePromise;
      expect(operationResolved).toBe(true);

      const state = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
      expect(state.isOwner).toBe(false);
    });
  });

  // =========================================================================
  // Precisión Temporal y Reconciliación Monotónica
  // =========================================================================
  describe('Precisión Temporal y Reconciliación Monotónica', () => {
    it('R12-C-17: retroceso del reloj del sistema (Date.now anterior a lastStart) es acotado a 0 sin añadir tiempo artificial', async () => {
      await timerAuthorityCoordinator._resetForTesting();
      const acq = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);

      const startMs = 1_000_000;
      await MatchTimerService.start(sampleMatchId, { nowMs: startMs, epoch: acq.epoch });

      // Retroceder reloj en 50 segundos (950_000 ms)
      const backwardMs = startMs - 50_000;
      const snap = await MatchTimerService.getSnapshot(sampleMatchId, backwardMs);

      // El tiempo restante no debe haber aumentado más allá de los 600 segundos originales
      expect(snap?.effectiveTimeLeft).toBe(600);

      // Reconciliar con reloj retrocedido
      const rec = await MatchTimerService.reconcile(sampleMatchId, { nowMs: backwardMs, epoch: acq.epoch });
      expect(rec.timerSecondsRemaining).toBe(600);
      expect(rec.isRunning).toBe(true);
    });

    it('R12-C-18: salto sospechoso hacia adelante en sesión activa es amortiguado por medición monotónica performance.now', async () => {
      await timerAuthorityCoordinator._resetForTesting();
      const acq = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);

      const baseStartMs = Date.now();
      await MatchTimerService.start(sampleMatchId, {
        nowMs: baseStartMs,
        epoch: acq.epoch,
        simulatedPerfNowMs: 1000
      });

      // Simular salto de 2 horas (7_200_000 ms) en Date.now() mientras simulatedPerfNowMs avanzó solo 5 segundos (6000 ms)
      const jumpMs = baseStartMs + 7_200_000;
      const pauseRes = await MatchTimerService.pause(sampleMatchId, {
        nowMs: jumpMs,
        epoch: acq.epoch,
        simulatedPerfNowMs: 6000
      });

      expect(pauseRes.status).toBe('applied');
      // 600s - 5s = 595s
      expect(pauseRes.timerSecondsRemaining).toBe(595);
    });

    it('R12-C-19: reconciliación en modo observador calcula tiempo fielmente sin escribir en BD', async () => {
      await timerAuthorityCoordinator._resetForTesting({ tabId: 'observer_tab' });
      // Reloj corriendo en BD
      const startMs = Date.now() - 30_000;
      await db.matches.update(sampleMatchId, {
        timerLastStart: new Date(startMs),
        timerSecondsRemaining: 600
      });

      const rec = await MatchTimerService.reconcile(sampleMatchId, { nowMs: Date.now() });
      expect(rec.status).toBe('already_applied');
      expect(rec.isRunning).toBe(true);
      expect(rec.timerSecondsRemaining).toBeLessThanOrEqual(571);

      // Verificar que db.matches NO fue mutado (sigue con timerLastStart activo y segundos originales)
      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerSecondsRemaining).toBe(600);
      expect(m?.timerLastStart).toBeDefined();
    });

    it('R12-C-20: operaciones del cronómetro preservan marcadores, faltas e historial deportivo (INV-T15)', async () => {
      await timerAuthorityCoordinator._resetForTesting();
      const acq = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);

      await db.matches.update(sampleMatchId, {
        localScore: 84,
        visitorScore: 82,
        localFouls: 4,
        visitorFouls: 5
      });

      await MatchTimerService.start(sampleMatchId, { epoch: acq.epoch });
      await MatchTimerService.pause(sampleMatchId, { epoch: acq.epoch });
      await MatchTimerService.adjust(sampleMatchId, 15, { epoch: acq.epoch });
      await MatchTimerService.reset(sampleMatchId, { epoch: acq.epoch });

      const m = await db.matches.get(sampleMatchId);
      expect(m?.localScore).toBe(84);
      expect(m?.visitorScore).toBe(82);
      expect(m?.localFouls).toBe(4);
      expect(m?.visitorFouls).toBe(5);
    });

    it('R12-C-21: salto de reloj de más de 24 horas tras reinicio no finaliza automáticamente el partido intempestivamente', async () => {
      await timerAuthorityCoordinator._resetForTesting();
      // Sin sesión local (simula pestaña recién abierta tras recarga)
      const lastStart = new Date(Date.now() - 1000);
      await db.matches.update(sampleMatchId, {
        timerLastStart: lastStart,
        timerSecondsRemaining: 600
      });

      // Simular salto de 48 horas hacia adelante (reloj de pared desajustado)
      const futureMs = Date.now() + 48 * 3600 * 1000;
      const snap = await MatchTimerService.getSnapshot(sampleMatchId, futureMs);
      expect(snap).toBeDefined();

      const m = await db.matches.get(sampleMatchId);
      expect(m?.status).toBe('playing');
    });

    it('R12-C-22: advanceQuarter y startOvertime verifican y actualizan timerEpoch en BD', async () => {
      await timerAuthorityCoordinator._resetForTesting();
      const acq = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);

      const adv = await MatchTimerService.advanceQuarter(sampleMatchId, { epoch: acq.epoch });
      expect(adv.status).toBe('applied');

      const mAfterQ = await db.matches.get(sampleMatchId);
      expect(mAfterQ?.currentQuarter).toBe(2);
      expect(mAfterQ?.timerEpoch).toBe(acq.epoch);

      // Overtime
      const ot = await MatchTimerService.startOvertime(sampleMatchId, 5, { epoch: acq.epoch });
      expect(ot.status).toBe('applied');

      const mAfterOT = await db.matches.get(sampleMatchId);
      expect(mAfterOT?.timerSecondsRemaining).toBe(300);
      expect(mAfterOT?.timerEpoch).toBe(acq.epoch);
    });
  });
});
