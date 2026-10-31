// src/test/sb11-r13-timer-closing.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db/db';
import { MatchTimerService } from '../db/matchTimer.service';
import {
  timerAuthorityCoordinator,
  TimerAuthorityCoordinator
} from '../services/timerAuthority.coordinator';

describe('SB_PHASE2C_R1.3: Cierre Unificado de Autoridad, Fencing y Recuperación (R13-C-01 a R13-C-25)', () => {
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
  // C-21: Reconciliación Segura y Escenario Adversarial
  // =========================================================================
  describe('C-21: Reconciliación Segura y Escenario Adversarial', () => {
    it('R13-C-01: escenario adversarial de 10 pasos (Tab A Q1 suspendida -> Tab B Q2 -> Tab A despierta y reconcilia)', async () => {
      // 1. Tab A en Q1 con 600s adquiere autoridad y arranca el reloj
      const coordA = new TimerAuthorityCoordinator();
      await coordA._resetForTesting({ tabId: 'tab_A', forceFallback: true });
      const acqA = await coordA.acquireAuthority(sampleMatchId);
      expect(acqA.acquired).toBe(true);
      expect(acqA.epoch).toBeGreaterThanOrEqual(1);

      const startMs = 1_000_000;
      const startRes = await MatchTimerService.start(sampleMatchId, {
        nowMs: startMs,
        epoch: acqA.epoch,
        tabId: 'tab_A',
        coordinator: coordA
      });
      expect(startRes.status).toBe('applied');

      // 2. Transcurren 10s en Q1
      const elapsed10s = startMs + 10_000;
      const pauseRes = await MatchTimerService.pause(sampleMatchId, {
        nowMs: elapsed10s,
        epoch: acqA.epoch,
        tabId: 'tab_A',
        coordinator: coordA
      });
      expect(pauseRes.status).toBe('applied');
      expect(pauseRes.timerSecondsRemaining).toBe(590);

      // 3. Tab A es suspendida y su lease expira
      coordA._testSimulateSuspension(sampleMatchId);
      // Forzar expiración del lease en BD
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: elapsed10s + 1000
      });

      // 4. Tab B detecta lease expirado y adquiere autoridad (epoch incrementado)
      const coordB = new TimerAuthorityCoordinator();
      await coordB._resetForTesting({ tabId: 'tab_B', forceFallback: true });
      const nowB = elapsed10s + 20_000; // posterior a la expiración
      const acqB = await coordB.acquireAuthority(sampleMatchId);
      expect(acqB.acquired).toBe(true);
      expect(acqB.epoch).toBeGreaterThan(acqA.epoch);

      // 5. Tab B avanza a Q2 con 600s y arranca el cronómetro en Q2
      const advRes = await MatchTimerService.advanceQuarter(sampleMatchId, {
        nowMs: nowB,
        epoch: acqB.epoch,
        tabId: 'tab_B',
        coordinator: coordB
      });
      expect(advRes.status).toBe('applied');

      const startQ2Res = await MatchTimerService.start(sampleMatchId, {
        nowMs: nowB + 1000,
        epoch: acqB.epoch,
        tabId: 'tab_B',
        coordinator: coordB
      });
      expect(startQ2Res.status).toBe('applied');

      // Verificar estado en BD controlado por Tab B en Q2
      const matchInQ2 = await db.matches.get(sampleMatchId);
      expect(matchInQ2?.currentQuarter).toBe(2);
      expect(matchInQ2?.timerOwnerTabId).toBe('tab_B');
      expect(matchInQ2?.timerEpoch).toBe(acqB.epoch);

      // 6. Tab A despierta de la suspensión. Cree seguir en Q1 con epoch anterior
      // 7. Tab A intenta ejecutar reconcile simulando que pasaron 600s de Q1
      const staleWakeupNow = startMs + 650_000;
      const reconcileStaleRes = await MatchTimerService.reconcile(sampleMatchId, {
        nowMs: staleWakeupNow,
        epoch: acqA.epoch,
        tabId: 'tab_A',
        expectedQuarter: 1,
        coordinator: coordA
      });

      // 8 & 9. Tab A no muta IndexedDB y su intento no corrompe Q2 ni el dueño B
      expect(reconcileStaleRes.status).toMatch(/already_applied|stale_operation/);

      const matchAfterStaleAttempt = await db.matches.get(sampleMatchId);
      expect(matchAfterStaleAttempt?.currentQuarter).toBe(2);
      expect(matchAfterStaleAttempt?.timerOwnerTabId).toBe('tab_B');
      expect(matchAfterStaleAttempt?.timerEpoch).toBe(acqB.epoch);
      expect(matchAfterStaleAttempt?.timerLastStart).toBeDefined();

      // 10. Limpieza
      await coordA._resetForTesting();
      await coordB._resetForTesting();
    });

    it('R13-C-02: observador ejecutando reconcile con reloj expirado retorna already_applied sin mutar BD', async () => {
      const coordOwner = new TimerAuthorityCoordinator();
      await coordOwner._resetForTesting({ tabId: 'tab_owner', forceFallback: true });
      const acq = await coordOwner.acquireAuthority(sampleMatchId);
      expect(acq.acquired).toBe(true);

      const startMs = 500_000;
      await MatchTimerService.start(sampleMatchId, {
        nowMs: startMs,
        epoch: acq.epoch,
        tabId: 'tab_owner',
        coordinator: coordOwner
      });

      // Coordinador de observador
      const coordObserver = new TimerAuthorityCoordinator();
      await coordObserver._resetForTesting({ tabId: 'tab_obs', forceFallback: true });

      // Transcurren 700s (reloj llega a 00:00)
      const rec = await MatchTimerService.reconcile(sampleMatchId, {
        nowMs: startMs + 700_000,
        tabId: 'tab_obs',
        coordinator: coordObserver
      });

      expect(rec.status).toBe('already_applied');
      expect(rec.expired).toBe(true);
      expect(rec.reason).toContain('observador');

      // Verificar que en IndexedDB sigue el timerLastStart original (cero escrituras de observador)
      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerLastStart).toBeDefined();
      expect(m?.timerOwnerTabId).toBe('tab_owner');

      await coordOwner._resetForTesting();
      await coordObserver._resetForTesting();
    });

    it('R13-C-03: observador ejecutando reconcile con reloj activo retorna already_applied con cálculo en memoria', async () => {
      const coordOwner = new TimerAuthorityCoordinator();
      await coordOwner._resetForTesting({ tabId: 'tab_owner', forceFallback: true });
      const acq = await coordOwner.acquireAuthority(sampleMatchId);

      const startMs = 500_000;
      await MatchTimerService.start(sampleMatchId, {
        nowMs: startMs,
        epoch: acq.epoch,
        tabId: 'tab_owner',
        coordinator: coordOwner
      });

      // Observador reconcilia a los 20 segundos
      const coordObserver = new TimerAuthorityCoordinator();
      await coordObserver._resetForTesting({ tabId: 'tab_obs', forceFallback: true });

      const rec = await MatchTimerService.reconcile(sampleMatchId, {
        nowMs: startMs + 20_000,
        tabId: 'tab_obs',
        coordinator: coordObserver
      });

      expect(rec.status).toBe('already_applied');
      expect(rec.isRunning).toBe(true);
      expect(rec.timerSecondsRemaining).toBe(580);
      expect(rec.reason).toContain('observador');

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerSecondsRemaining).toBe(600); // Intacto en BD

      await coordOwner._resetForTesting();
      await coordObserver._resetForTesting();
    });

    it('R13-C-04: propietario legítimo persiste atómicamente la expiración del cuarto', async () => {
      const coord = new TimerAuthorityCoordinator();
      await coord._resetForTesting({ tabId: 'tab_owner', forceFallback: true });
      const acq = await coord.acquireAuthority(sampleMatchId);

      const startMs = 500_000;
      await MatchTimerService.start(sampleMatchId, {
        nowMs: startMs,
        epoch: acq.epoch,
        tabId: 'tab_owner',
        coordinator: coord
      });

      // El propietario reconcilia cuando el tiempo se agotó (600s después)
      const rec = await MatchTimerService.reconcile(sampleMatchId, {
        nowMs: startMs + 600_000,
        epoch: acq.epoch,
        tabId: 'tab_owner',
        coordinator: coord
      });

      expect(rec.status).toBe('applied');
      expect(rec.expired).toBe(true);
      expect(rec.timerSecondsRemaining).toBe(0);
      expect(rec.isRunning).toBe(false);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerSecondsRemaining).toBe(0);
      expect(m?.timerLastStart).toBeUndefined();

      await coord._resetForTesting();
    });

    it('R13-C-05: reconciliación con expectedQuarter mismatch es rechazada con stale_operation', async () => {
      const coord = new TimerAuthorityCoordinator();
      await coord._resetForTesting({ tabId: 'tab_owner', forceFallback: true });
      const acq = await coord.acquireAuthority(sampleMatchId);

      const startMs = 500_000;
      await MatchTimerService.start(sampleMatchId, {
        nowMs: startMs,
        epoch: acq.epoch,
        tabId: 'tab_owner',
        coordinator: coord
      });

      // Reconciliación indicando que espera cuarto 2 cuando el partido está en cuarto 1
      const rec = await MatchTimerService.reconcile(sampleMatchId, {
        nowMs: startMs + 10_000,
        epoch: acq.epoch,
        tabId: 'tab_owner',
        expectedQuarter: 2,
        coordinator: coord
      });

      expect(rec.status).toBe('stale_operation');
      expect(rec.reason).toContain('esperado: 2, actual: 1');

      await coord._resetForTesting();
    });
  });

  // =========================================================================
  // C-22: Validación de Vigencia del Lease al Escribir
  // =========================================================================
  describe('C-22: Validación de Vigencia del Lease al Escribir', () => {
    it('R13-C-06: en modo fallback, operaciones con lease vigente se ejecutan exitosamente', async () => {
      const coord = new TimerAuthorityCoordinator();
      await coord._resetForTesting({ tabId: 'tab_fb', forceFallback: true });
      const acq = await coord.acquireAuthority(sampleMatchId);
      expect(acq.acquired).toBe(true);

      const now = Date.now();
      const startRes = await MatchTimerService.start(sampleMatchId, {
        nowMs: now,
        epoch: acq.epoch,
        tabId: 'tab_fb',
        coordinator: coord
      });
      expect(startRes.status).toBe('applied');

      const pauseRes = await MatchTimerService.pause(sampleMatchId, {
        nowMs: now + 5000,
        epoch: acq.epoch,
        tabId: 'tab_fb',
        coordinator: coord
      });
      expect(pauseRes.status).toBe('applied');

      await coord._resetForTesting();
    });

    it('R13-C-07: en modo fallback, start es rechazado si el lease en BD ha expirado', async () => {
      const coord = new TimerAuthorityCoordinator();
      await coord._resetForTesting({ tabId: 'tab_fb', forceFallback: true });
      const acq = await coord.acquireAuthority(sampleMatchId);

      const baseNow = Date.now();
      // Simular que el lease en BD expiró hace 5 segundos
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: baseNow - 5000
      });

      const res = await MatchTimerService.start(sampleMatchId, {
        nowMs: baseNow,
        epoch: acq.epoch,
        tabId: 'tab_fb',
        coordinator: coord
      });

      expect(res.status).toBe('not_owner');
      expect(res.reason).toContain('lease de autoridad ha expirado');

      await coord._resetForTesting();
    });

    it('R13-C-08: en modo fallback, pause es rechazado si el lease en BD ha expirado', async () => {
      const coord = new TimerAuthorityCoordinator();
      await coord._resetForTesting({ tabId: 'tab_fb', forceFallback: true });
      const acq = await coord.acquireAuthority(sampleMatchId);

      const baseNow = Date.now();
      await MatchTimerService.start(sampleMatchId, {
        nowMs: baseNow,
        epoch: acq.epoch,
        tabId: 'tab_fb',
        coordinator: coord
      });

      // Expirar lease
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: baseNow - 1000
      });

      const res = await MatchTimerService.pause(sampleMatchId, {
        nowMs: baseNow + 2000,
        epoch: acq.epoch,
        tabId: 'tab_fb',
        coordinator: coord
      });

      expect(res.status).toBe('not_owner');
      expect(res.reason).toContain('lease de autoridad ha expirado');

      await coord._resetForTesting();
    });

    it('R13-C-09: en modo fallback, advanceQuarter es rechazado si el lease ha expirado', async () => {
      const coord = new TimerAuthorityCoordinator();
      await coord._resetForTesting({ tabId: 'tab_fb', forceFallback: true });
      const acq = await coord.acquireAuthority(sampleMatchId);

      const baseNow = Date.now();
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: baseNow - 1000
      });

      const res = await MatchTimerService.advanceQuarter(sampleMatchId, {
        nowMs: baseNow,
        epoch: acq.epoch,
        tabId: 'tab_fb',
        coordinator: coord
      });

      expect(res.status).toBe('not_owner');
      expect(res.reason).toContain('lease de autoridad ha expirado');

      const m = await db.matches.get(sampleMatchId);
      expect(m?.currentQuarter).toBe(1);

      await coord._resetForTesting();
    });

    it('R13-C-10: en modo fallback, endMatch es rechazado si el lease ha expirado', async () => {
      const coord = new TimerAuthorityCoordinator();
      await coord._resetForTesting({ tabId: 'tab_fb', forceFallback: true });
      const acq = await coord.acquireAuthority(sampleMatchId);

      const baseNow = Date.now();
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: baseNow - 1000
      });

      const res = await MatchTimerService.endMatch(sampleMatchId, {
        nowMs: baseNow,
        epoch: acq.epoch,
        tabId: 'tab_fb',
        coordinator: coord
      });

      expect(res.status).toBe('not_owner');
      expect(res.reason).toContain('lease de autoridad ha expirado');

      const m = await db.matches.get(sampleMatchId);
      expect(m?.status).toBe('playing');

      await coord._resetForTesting();
    });

    it('R13-C-11: tras readquisición limpia de lease expirado, las escrituras vuelven a permitirse', async () => {
      const coord = new TimerAuthorityCoordinator();
      await coord._resetForTesting({ tabId: 'tab_fb', forceFallback: true });
      await coord.acquireAuthority(sampleMatchId);

      const baseNow = Date.now();
      // Expirar lease
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: baseNow - 2000
      });

      // Intento fallido con lease expirado
      const failRes = await MatchTimerService.start(sampleMatchId, {
        nowMs: baseNow,
        tabId: 'tab_fb',
        coordinator: coord
      });
      expect(failRes.status).toBe('not_owner');

      // Readquirir limpiamente la autoridad (C-22)
      const reacquired = await coord.acquireAuthority(sampleMatchId);
      expect(reacquired.acquired).toBe(true);

      // Ahora start tiene éxito
      const okRes = await MatchTimerService.start(sampleMatchId, {
        nowMs: Date.now(),
        tabId: 'tab_fb',
        epoch: reacquired.epoch,
        coordinator: coord
      });
      expect(okRes.status).toBe('applied');

      await coord._resetForTesting();
    });
  });

  // =========================================================================
  // C-23: Unificación Web Locks y Fallback Coexistentes
  // =========================================================================
  describe('C-23: Unificación Web Locks y Fallback Coexistentes', () => {
    it('R13-C-12: pestaña con Web Locks persiste timerLockMode web_locks y lease unificado en IndexedDB', async () => {
      const coordWL = new TimerAuthorityCoordinator();
      await coordWL._resetForTesting({ tabId: 'tab_wl' });

      const acq = await coordWL.acquireAuthority(sampleMatchId);
      expect(acq.acquired).toBe(true);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerLockMode).toBe('web_locks');
      expect(m?.timerOwnerTabId).toBe('tab_wl');
      expect(m?.timerLeaseExpiresAt).toBeGreaterThan(Date.now());

      await coordWL._resetForTesting();
    });

    it('R13-C-13: pestaña fallback no adquiere autoridad si Web Lock mantiene lease activo en IndexedDB', async () => {
      const coordWL = new TimerAuthorityCoordinator();
      await coordWL._resetForTesting({ tabId: 'tab_wl' });
      await coordWL.acquireAuthority(sampleMatchId);

      // Tab Fallback intenta adquirir
      const coordFB = new TimerAuthorityCoordinator();
      await coordFB._resetForTesting({ tabId: 'tab_fb', forceFallback: true });

      const acqFB = await coordFB.acquireAuthority(sampleMatchId);
      expect(acqFB.acquired).toBe(false);
      expect(coordFB.getAuthorityState(sampleMatchId).isOwner).toBe(false);

      await coordWL._resetForTesting();
      await coordFB._resetForTesting();
    });

    it('R13-C-14: pestaña Web Locks no adquiere si una pestaña fallback mantiene lease activo en IndexedDB', async () => {
      // Tab Fallback adquiere primero
      const coordFB = new TimerAuthorityCoordinator();
      await coordFB._resetForTesting({ tabId: 'tab_fb', forceFallback: true });
      const acqFB = await coordFB.acquireAuthority(sampleMatchId);
      expect(acqFB.acquired).toBe(true);

      // Tab Web Lock intenta adquirir sobre el mismo partido
      const coordWL = new TimerAuthorityCoordinator();
      await coordWL._resetForTesting({ tabId: 'tab_wl' });

      const acqWL = await coordWL.acquireAuthority(sampleMatchId);
      expect(acqWL.acquired).toBe(false);
      expect(coordWL.getAuthorityState(sampleMatchId).isOwner).toBe(false);

      await coordFB._resetForTesting();
      await coordWL._resetForTesting();
    });

    it('R13-C-15: liberación de Web Lock limpia lease en IndexedDB permitiendo adquisición fallback', async () => {
      const coordWL = new TimerAuthorityCoordinator();
      await coordWL._resetForTesting({ tabId: 'tab_wl' });
      await coordWL.acquireAuthority(sampleMatchId);

      // Liberar Web Lock
      await coordWL.releaseAuthority(sampleMatchId);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerLeaseExpiresAt).toBe(0);

      // Fallback adquiere de inmediato
      const coordFB = new TimerAuthorityCoordinator();
      await coordFB._resetForTesting({ tabId: 'tab_fb', forceFallback: true });
      const acqFB = await coordFB.acquireAuthority(sampleMatchId);
      expect(acqFB.acquired).toBe(true);

      await coordWL._resetForTesting();
      await coordFB._resetForTesting();
    });

    it('R13-C-16: liberación de fallback limpia lease permitiendo adquisición por Web Locks', async () => {
      const coordFB = new TimerAuthorityCoordinator();
      await coordFB._resetForTesting({ tabId: 'tab_fb', forceFallback: true });
      await coordFB.acquireAuthority(sampleMatchId);

      await coordFB.releaseAuthority(sampleMatchId);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerLeaseExpiresAt).toBe(0);

      // Web Lock adquiere de inmediato
      const coordWL = new TimerAuthorityCoordinator();
      await coordWL._resetForTesting({ tabId: 'tab_wl' });
      const acqWL = await coordWL.acquireAuthority(sampleMatchId);
      expect(acqWL.acquired).toBe(true);

      await coordFB._resetForTesting();
      await coordWL._resetForTesting();
    });
  });

  // =========================================================================
  // C-24: Precisión Temporal y Fuentes de Medición
  // =========================================================================
  describe('C-24: Precisión Temporal y Fuentes de Medición', () => {
    it('R13-C-17: medición activa en misma sesión reporta monotonic_session y high confidence', async () => {
      const coord = new TimerAuthorityCoordinator();
      await coord._resetForTesting({ tabId: 'tab_active' });
      const acq = await coord.acquireAuthority(sampleMatchId);

      const startMs = Date.now();
      const perfStart = 1000;
      await MatchTimerService.start(sampleMatchId, {
        nowMs: startMs,
        simulatedPerfNowMs: perfStart,
        epoch: acq.epoch,
        tabId: 'tab_active',
        coordinator: coord
      });

      // Pausar con 5s transcurridos medidos monotónicamente
      const pauseRes = await MatchTimerService.pause(sampleMatchId, {
        nowMs: startMs + 5000,
        simulatedPerfNowMs: perfStart + 5000,
        epoch: acq.epoch,
        tabId: 'tab_active',
        coordinator: coord
      });

      expect(pauseRes.status).toBe('applied');
      expect(pauseRes.precisionSource).toBe('monotonic_session');
      expect(pauseRes.confidence).toBe('high');

      await coord._resetForTesting();
    });

    it('R13-C-18: medición recuperada de timestamp reporta wall_clock_recovered y approximate confidence', async () => {
      // Simular recuperación donde no hay registro en memoria sessionMonotonicStarts
      const startMs = Date.now() - 30_000;
      await db.matches.update(sampleMatchId, {
        timerLastStart: new Date(startMs),
        timerSecondsRemaining: 600
      });

      const snap = await MatchTimerService.getSnapshot(sampleMatchId);
      expect(snap?.isRunning).toBe(true);
      expect(snap?.precisionSource).toBe('wall_clock_recovered');
      expect(snap?.confidence).toBe('approximate');
      expect(snap?.isClockShiftDetected).toBe(false);
    });

    it('R13-C-19: salto anómalo mayor a 24 horas reporta anomalous_clamp y uncertain confidence', async () => {
      const startMs = Date.now() - 100_000_000; // > 27 horas en el pasado
      await db.matches.update(sampleMatchId, {
        timerLastStart: new Date(startMs),
        timerSecondsRemaining: 600
      });

      const snap = await MatchTimerService.getSnapshot(sampleMatchId);
      expect(snap?.precisionSource).toBe('anomalous_clamp');
      expect(snap?.confidence).toBe('uncertain');
      expect(snap?.isClockShiftDetected).toBe(true);
    });

    it('R13-C-20: salto anómalo mayor a 24 horas no finaliza prematuramente el partido', async () => {
      const startMs = Date.now() - 100_000_000;
      await db.matches.update(sampleMatchId, {
        timerLastStart: new Date(startMs),
        timerSecondsRemaining: 600
      });

      const rec = await MatchTimerService.reconcile(sampleMatchId);
      expect(rec.status).toBeDefined();
      const m = await db.matches.get(sampleMatchId);
      expect(m?.status).toBe('playing');
      expect(m?.status).not.toBe('finished');
    });

    it('R13-C-21: retroceso de reloj del sistema acota descuento a cero', async () => {
      const startMs = 500_000;
      await db.matches.update(sampleMatchId, {
        timerLastStart: new Date(startMs),
        timerSecondsRemaining: 600
      });

      const snap = await MatchTimerService.getSnapshot(sampleMatchId, { nowMs: 400_000 });
      expect(snap?.timerSecondsRemaining).toBe(600);
      expect(snap?.precisionSource).toBe('anomalous_clamp');
      expect(snap?.confidence).toBe('uncertain');
    });
  });

  // =========================================================================
  // Sección 9: Heartbeat de Producción y Pérdida de Lease
  // =========================================================================
  describe('Sección 9: Heartbeat de Producción y Pérdida de Lease', () => {
    it('R13-C-22: renewLease renueva atómicamente el lease en IndexedDB si el llamador es el propietario', async () => {
      const coord = new TimerAuthorityCoordinator();
      await coord._resetForTesting({ tabId: 'tab_owner', forceFallback: true });
      await coord.acquireAuthority(sampleMatchId);

      const beforeMatch = await db.matches.get(sampleMatchId);
      const initialLease = beforeMatch?.timerLeaseExpiresAt ?? 0;

      // Esperar breve tiempo o invocar con Date.now avanzado
      const ok = await coord.renewLease(sampleMatchId);
      expect(ok).toBe(true);

      const afterMatch = await db.matches.get(sampleMatchId);
      expect(afterMatch?.timerLeaseExpiresAt).toBeGreaterThanOrEqual(initialLease);

      await coord._resetForTesting();
    });

    it('R13-C-23: renewLease retorna false y degrada a la pestaña si el lease fue reasignado a otra pestaña', async () => {
      const coordA = new TimerAuthorityCoordinator();
      await coordA._resetForTesting({ tabId: 'tab_A', forceFallback: true });
      await coordA.acquireAuthority(sampleMatchId);

      // Simular que tras suspensión de A, Tab B tomó el lease
      await db.matches.update(sampleMatchId, {
        timerOwnerTabId: 'tab_B',
        timerEpoch: 5,
        timerLeaseExpiresAt: Date.now() + 6000
      });

      // Heartbeat de A despierta y trata de renovar
      const renewed = await coordA.renewLease(sampleMatchId);
      expect(renewed).toBe(false);

      // Tab A debe haberse degradado a observador
      const stateA = coordA.getAuthorityState(sampleMatchId);
      expect(stateA.isOwner).toBe(false);
      expect(stateA.hasAuthority).toBe(false);

      await coordA._resetForTesting();
    });

    it('R13-C-24: degradación por pérdida de lease detiene heartbeat y no perturba a la nueva pestaña dueña', async () => {
      const coordA = new TimerAuthorityCoordinator();
      await coordA._resetForTesting({ tabId: 'tab_A', forceFallback: true });
      await coordA.acquireAuthority(sampleMatchId);

      // Tab B toma el control
      await db.matches.update(sampleMatchId, {
        timerOwnerTabId: 'tab_B',
        timerEpoch: 10,
        timerLeaseExpiresAt: Date.now() + 10_000
      });

      await coordA.renewLease(sampleMatchId);

      // Tab B sigue con su lease intacto
      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerOwnerTabId).toBe('tab_B');
      expect(m?.timerEpoch).toBe(10);

      await coordA._resetForTesting();
    });

    it('R13-C-25: releaseAuthority de una pestaña que perdió la autoridad no limpia el lease de la nueva dueña', async () => {
      const coordA = new TimerAuthorityCoordinator();
      await coordA._resetForTesting({ tabId: 'tab_A', forceFallback: true });
      await coordA.acquireAuthority(sampleMatchId);

      // Tab B tomó el control
      await db.matches.update(sampleMatchId, {
        timerOwnerTabId: 'tab_B',
        timerEpoch: 20,
        timerLeaseExpiresAt: Date.now() + 8000
      });

      // Tab A llama a releaseAuthority
      await coordA.releaseAuthority(sampleMatchId);

      // El lease de Tab B debe permanecer intacto
      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerOwnerTabId).toBe('tab_B');
      expect(m?.timerEpoch).toBe(20);
      expect(m?.timerLeaseExpiresAt).toBeGreaterThan(0);

      await coordA._resetForTesting();
    });
  });
});
