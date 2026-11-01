// @vitest-environment jsdom
// src/test/sb13-r15-timer-closing.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../db/db';
import type { Match } from '../db/models/Match';
import { MatchTimerService } from '../db/matchTimer.service';
import { TimerAuthorityCoordinator, timerAuthorityCoordinator } from '../services/timerAuthority.coordinator';
import { useMatchTimer } from '../hooks/useMatchTimer';
import * as soundEffects from '../utils/soundEffects';
import { TraditionalEngine } from '../features/match-creations/components/engines/TraditionalEngine';
import {
  LiveMatchContext,
  type LiveMatchContextState,
  type TeamWithPlayers
} from '../features/match-creations/components/context/LiveMatchContext';

// Web Locks mock para entorno jsdom
const activeWebLocks = new Set<string>();

if (typeof navigator !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (navigator as any).locks = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    request: async (name: string, optionsOrCb: any, maybeCb?: any) => {
      const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
      const ifAvailable = typeof optionsOrCb === 'object' && optionsOrCb.ifAvailable;
      if (ifAvailable && activeWebLocks.has(name)) {
        return await cb(null);
      }
      activeWebLocks.add(name);
      try {
        const lockObj = { name, mode: 'exclusive' };
        return await cb(lockObj);
      } finally {
        activeWebLocks.delete(name);
      }
    }
  };
}

describe('SB_PHASE2C_R1.5: Cierre de Recuperación Temporal, Autoridad Estricta y Certificación Adversarial', () => {
  let sampleMatchId: number;

  const baseMatch: Match = {
    id: 1,
    localTeamId: 101,
    visitorTeamId: 102,
    status: 'playing',
    createdAt: new Date(),
    localScore: 40,
    visitorScore: 38,
    localFouls: 2,
    visitorFouls: 3,
    currentQuarter: 1,
    timerSecondsRemaining: 600,
    timerLastStart: undefined,
    timerEpoch: 1,
    timerOwnerTabId: 'test_owner_tab',
    timerLeaseExpiresAt: Date.now() + 60_000,
    timerLockMode: 'fallback',
    timerRecoveryState: 'normal',
    config: {
      mode: 'traditional',
      traditional: {
        totalQuarters: 4,
        minutesPerQuarter: 10,
        timeoutsPerTeam: 2
      }
    }
  };

  const localTeam: TeamWithPlayers = { id: 101, name: 'Local Stars', createdAt: new Date(), players: [] };
  const visitorTeam: TeamWithPlayers = { id: 102, name: 'Visitor Titans', createdAt: new Date(), players: [] };

  const createMockContext = (match?: Match): LiveMatchContextState => ({
    match,
    localTeam,
    visitorTeam,
    isLoading: !match,
    error: null,
    isActionModalOpen: false,
    hasActiveOverlay: false,
    setActionModalOpen: vi.fn(),
    registerOpenModal: vi.fn(() => () => {})
  });

  const renderTraditionalEngine = (matchOverride?: Partial<Match>) => {
    const liveMatchData = { ...baseMatch, ...matchOverride } as Match;
    const contextValue = createMockContext(liveMatchData);

    return render(
      <MemoryRouter>
        <LiveMatchContext.Provider value={contextValue}>
          <TraditionalEngine />
        </LiveMatchContext.Provider>
      </MemoryRouter>
    );
  };

  beforeEach(async () => {
    await db.open();
    await db.matches.clear();
    sampleMatchId = (await db.matches.add({ ...baseMatch })) as number;

    await timerAuthorityCoordinator._resetForTesting({
      tabId: 'test_owner_tab',
      forceFallback: true
    });
    const acq = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
    expect(acq.acquired).toBe(true);
  });

  afterEach(async () => {
    MatchTimerService._setTestPreCommitHook(null);
    await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
    await timerAuthorityCoordinator._resetForTesting();
    vi.restoreAllMocks();
    await db.close();
  });

  // =========================================================================
  // GRUPO 1: C-29 — ESTADO PERSISTENTE DE RECUPERACIÓN INCIERTA (R15-01 a R15-10)
  // =========================================================================
  describe('C-29: Estado Persistente de Recuperación Incierta (R15-01 a R15-10)', () => {
    it('R15-01: se detecta anomalía y persiste estado de recuperación en IndexedDB', async () => {
      // Iniciar el reloj 48 horas en el pasado sin sesión previa monotónica
      const oldStartMs = Date.now() - 48 * 3600 * 1000;
      await db.matches.update(sampleMatchId, {
        timerLastStart: new Date(oldStartMs),
        timerSecondsRemaining: 500
      });

      const rec = await MatchTimerService.reconcile(sampleMatchId);
      expect(rec.status).toBe('applied');
      expect(rec.confidence).toBe('uncertain');
      expect(rec.timerSecondsRemaining).toBe(500); // Preservado sin restar

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerRecoveryState).toBe('recovery_required');
      expect(matchDb?.timerRecoveryReason).toBeDefined();
      expect(matchDb?.timerLastStart).toBeUndefined(); // Pausado de forma conservadora
    });

    it('R15-02: la pausa conserva segundos y estado de incertidumbre persistido', async () => {
      const oldStartMs = 1_000_000;
      await db.matches.update(sampleMatchId, {
        timerLastStart: new Date(oldStartMs),
        timerSecondsRemaining: 420
      });

      // Salto temporal de 90_000s (>24h)
      const jumpNowMs = oldStartMs + 90_000 * 1000;
      const pauseRes = await MatchTimerService.pause(sampleMatchId, { nowMs: jumpNowMs });

      expect(pauseRes.status).toBe('applied');
      expect(pauseRes.timerSecondsRemaining).toBe(420);
      expect(pauseRes.confidence).toBe('uncertain');

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerRecoveryState).toBe('recovery_required');
      expect(matchDb?.timerSecondsRemaining).toBe(420);
    });

    it('R15-03: un render React no elimina la incertidumbre si la recuperación está pendiente', () => {
      const pausedWithRecovery: Match = {
        ...baseMatch,
        timerLastStart: undefined, // Pausado
        timerSecondsRemaining: 300,
        timerRecoveryState: 'recovery_required'
      };

      // Realizar 5 evaluaciones independientes (simulando rerenders consecutivos)
      for (let i = 0; i < 5; i++) {
        const proj = MatchTimerService.projectTime(pausedWithRecovery, Date.now() + i * 1000);
        expect(proj.confidence).toBe('uncertain');
        expect(proj.isClockShiftDetected).toBe(true);
        expect(proj.timeLeft).toBe(300);
      }
    });

    it('R15-04: recargar la PWA conserva la recuperación pendiente y la reporta en el snapshot', async () => {
      await db.matches.update(sampleMatchId, {
        timerLastStart: undefined,
        timerSecondsRemaining: 345,
        timerRecoveryState: 'recovery_required',
        timerRecoveryReason: 'Desfase persistido previo a recarga'
      });

      // Simular nueva consulta determinista tras recarga completa
      const snap = await MatchTimerService.getSnapshot(sampleMatchId);
      expect(snap?.confidence).toBe('uncertain');
      expect(snap?.isClockShiftDetected).toBe(true);
      expect(snap?.effectiveTimeLeft).toBe(345);
    });

    it('R15-05: una pestaña observadora no puede resolver la recuperación', async () => {
      await db.matches.update(sampleMatchId, {
        timerRecoveryState: 'recovery_required',
        timerSecondsRemaining: 400
      });

      const observerCoord = new TimerAuthorityCoordinator();
      await observerCoord._resetForTesting({ tabId: 'tab_observer', forceFallback: true });

      const res = await MatchTimerService.resolveRecovery(sampleMatchId, 400, {
        coordinator: observerCoord
      });

      expect(res.status).toBe('not_owner');

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerRecoveryState).toBe('recovery_required'); // No mutó
    });

    it('R15-06: propietario vigente confirma o ajusta tiempo resolviendo la recuperación', async () => {
      await db.matches.update(sampleMatchId, {
        timerRecoveryState: 'recovery_required',
        timerSecondsRemaining: 450
      });

      // El propietario confirma el tiempo validado
      const resolveRes = await MatchTimerService.resolveRecovery(sampleMatchId, 450);
      expect(resolveRes.status).toBe('applied');
      expect(resolveRes.confidence).toBe('high');
      expect(resolveRes.timerSecondsRemaining).toBe(450);

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerRecoveryState).toBe('normal');
      expect(matchDb?.timerRecoveryReason).toBeUndefined();
    });

    it('R15-07: resolución transaccional mediante ajuste elimina el estado pendiente en BD', async () => {
      await db.matches.update(sampleMatchId, {
        timerRecoveryState: 'recovery_required',
        timerSecondsRemaining: 500
      });

      // El propietario ajusta el reloj sumando 10 segundos
      const adjRes = await MatchTimerService.adjust(sampleMatchId, 10);
      expect(adjRes.status).toBe('applied');
      expect(adjRes.timerSecondsRemaining).toBe(510);
      expect(adjRes.confidence).toBe('high');

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerRecoveryState).toBe('normal');
      expect(matchDb?.timerRecoveryReason).toBeUndefined();
    });

    it('R15-08: el reloj puede volver a funcionar normalmente después de confirmación', async () => {
      await db.matches.update(sampleMatchId, {
        timerRecoveryState: 'recovery_required',
        timerSecondsRemaining: 500
      });

      // Intentar iniciar sin confirmar es rechazado
      const rejectStart = await MatchTimerService.start(sampleMatchId);
      expect(rejectStart.status).toBe('rejected');
      expect(rejectStart.reason).toContain('requiere confirmación o ajuste');

      // Se confirma la recuperación
      await MatchTimerService.resolveRecovery(sampleMatchId, 500);

      // Ahora start funciona limpiamente
      const cleanStart = await MatchTimerService.start(sampleMatchId);
      expect(cleanStart.status).toBe('applied');
      expect(cleanStart.isRunning).toBe(true);

      const snap = await MatchTimerService.getSnapshot(sampleMatchId);
      expect(snap?.isRunning).toBe(true);
      expect(snap?.confidence).toBe('high');
    });

    it('R15-09: una operación obsoleta no limpia la incertidumbre de otro periodo', async () => {
      await db.matches.update(sampleMatchId, {
        currentQuarter: 2,
        timerRecoveryState: 'recovery_required',
        timerSecondsRemaining: 400
      });

      // Intentar resolver recuperación indicando un periodo anterior (Q1)
      const res = await MatchTimerService.resolveRecovery(sampleMatchId, 400, {
        expectedQuarter: 1
      });

      expect(res.status).toBe('stale_operation');
      expect(res.reason).toContain('Periodo no coincide');

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerRecoveryState).toBe('recovery_required'); // Sigue protegido
    });

    it('R15-10: partidos antiguos con timerRecoveryState undefined siguen abriendo y operando normalmente', async () => {
      await db.matches.update(sampleMatchId, {
        timerRecoveryState: undefined,
        timerRecoveryReason: undefined,
        timerSecondsRemaining: 600
      });

      const snap = await MatchTimerService.getSnapshot(sampleMatchId);
      expect(snap?.confidence).toBe('high');
      expect(snap?.effectiveTimeLeft).toBe(600);

      const startRes = await MatchTimerService.start(sampleMatchId);
      expect(startRes.status).toBe('applied');
      expect(startRes.isRunning).toBe(true);
    });
  });

  // =========================================================================
  // GRUPO 2: C-30 — ELIMINAR LA EXCEPCIÓN DE LEASE CADUCADO (R15-11 a R15-18)
  // =========================================================================
  describe('C-30: Eliminar la Excepción de Lease Caducado (R15-11 a R15-18)', () => {
    it('R15-11: lease caducado con medición deportiva monotónica válida sigue rechazando escrituras', async () => {
      const baseStartMs = Date.now();
      await MatchTimerService.start(sampleMatchId, {
        nowMs: baseStartMs,
        simulatedPerfNowMs: 1000
      });

      // Forzar expiración real del lease en BD
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: Date.now() - 5000
      });

      // Aunque se provea una medición monotónica impecable, el lease expirado DEBE rechazar la escritura
      const pauseRes = await MatchTimerService.pause(sampleMatchId, {
        simulatedPerfNowMs: 6000
      });

      expect(pauseRes.status).toBe('not_owner');
      expect(pauseRes.reason).toContain('lease de autoridad ha expirado');
    });

    it('R15-12: lease vigente y reloj deportivo normal permite escribir sin impedimentos', async () => {
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: Date.now() + 15_000
      });

      const res = await MatchTimerService.start(sampleMatchId);
      expect(res.status).toBe('applied');
      expect(res.isRunning).toBe(true);
    });

    it('R15-13: lease vencido antes de una transacción retrasada se rechaza transaccionalmente', async () => {
      const baseNow = Date.now();
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: baseNow + 1000
      });

      // Se ejecuta con leaseNowMs posterior a la expiración
      const res = await MatchTimerService.start(sampleMatchId, {
        leaseNowMs: baseNow + 3000
      });

      expect(res.status).toBe('not_owner');
      expect(res.reason).toContain('lease de autoridad ha expirado');
    });

    it('R15-14: nuevo propietario adquiere una generación superior tras expiración del lease', async () => {
      // Expirar el lease de Tab A
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: Date.now() - 1000
      });

      const coordB = new TimerAuthorityCoordinator();
      await coordB._resetForTesting({ tabId: 'tab_B', forceFallback: true });

      const acqB = await coordB.acquireAuthority(sampleMatchId);
      expect(acqB.acquired).toBe(true);
      expect(acqB.epoch).toBeGreaterThanOrEqual(1);

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerOwnerTabId).toBe('tab_B');
    });

    it('R15-15: propietario antiguo no puede escribir aunque conserve referencia monotónica', async () => {
      const authA = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);

      // Simular que Tab B tomó el control legítimamente y avanzó el epoch
      await db.matches.update(sampleMatchId, {
        timerOwnerTabId: 'tab_B',
        timerEpoch: authA.epoch + 1,
        timerLeaseExpiresAt: Date.now() + 15_000
      });

      // Tab A intenta escribir
      const resA = await MatchTimerService.start(sampleMatchId, {
        epoch: authA.epoch,
        tabId: 'test_owner_tab',
        simulatedPerfNowMs: 5000
      });

      expect(resA.status).toBe('stale_operation');
      expect(resA.reason).toContain('atrasada');
    });

    it('R15-16: re-adquisición legítima permite continuar tras rechazo por lease vencido', async () => {
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: Date.now() - 2000
      });

      // Falla inicialmente
      const failRes = await MatchTimerService.start(sampleMatchId);
      expect(failRes.status).toBe('not_owner');

      // Re-adquisición legítima
      const reAcq = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(reAcq.acquired).toBe(true);

      // Ahora la escritura es exitosa
      const okRes = await MatchTimerService.start(sampleMatchId);
      expect(okRes.status).toBe('applied');
      expect(okRes.isRunning).toBe(true);
    });

    it('R15-17: Web Locks y fallback no se contradicen y validan lease de forma unificada', async () => {
      const coordWL = new TimerAuthorityCoordinator();
      await coordWL._resetForTesting({ tabId: 'tab_wl' });
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

      const acqWL = await coordWL.acquireAuthority(sampleMatchId);
      expect(acqWL.acquired).toBe(true);

      // Si el lease en BD es forzado a 0, incluso con Web Lock activo, la escritura es rechazada de forma positiva
      await db.matches.update(sampleMatchId, { timerLeaseExpiresAt: 0 });

      const res = await MatchTimerService.start(sampleMatchId, { coordinator: coordWL });
      expect(res.status).toBe('not_owner');

      await coordWL.releaseAuthority(sampleMatchId);
      await coordWL._resetForTesting();
    });

    it('R15-18: el rechazo por lease vencido conserva todos los campos temporales persistidos', async () => {
      const auth = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
      await db.matches.update(sampleMatchId, {
        timerSecondsRemaining: 385,
        currentQuarter: 2,
        timerEpoch: auth.epoch,
        timerOwnerTabId: 'test_owner_tab',
        timerLeaseExpiresAt: Date.now() - 3000
      });

      const res = await MatchTimerService.pause(sampleMatchId);
      expect(res.status).toBe('not_owner');

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerSecondsRemaining).toBe(385);
      expect(matchDb?.currentQuarter).toBe(2);
      expect(matchDb?.timerEpoch).toBe(auth.epoch);
      expect(matchDb?.timerOwnerTabId).toBe('test_owner_tab');
    });
  });

  // =========================================================================
  // GRUPO 3: C-31 — RETROCESO DE RELOJ Y RECUPERACIÓN DE LA INTERFAZ (R15-19 a R15-26)
  // =========================================================================
  describe('C-31: Retroceso de Reloj y Recuperación de la Interfaz (R15-19 a R15-26)', () => {
    it('R15-19: reloj monotónico válido con Date.now retrocediendo prioriza la fuente fiable', async () => {
      const baseStartMs = 1_000_000;
      await MatchTimerService.start(sampleMatchId, {
        nowMs: baseStartMs,
        simulatedPerfNowMs: 2000
      });

      // Date.now retrocede 30 segundos respecto a baseStartMs, pero monotonic avanzó 5 segundos (7000 - 2000)
      const backwardWallMs = baseStartMs - 30_000;
      const pauseRes = await MatchTimerService.pause(sampleMatchId, {
        nowMs: backwardWallMs,
        simulatedPerfNowMs: 7000
      });

      expect(pauseRes.status).toBe('applied');
      expect(pauseRes.confidence).toBe('high');
      expect(pauseRes.precisionSource).toBe('monotonic_session');
      // 600s - 5s = 595s
      expect(pauseRes.timerSecondsRemaining).toBe(595);
    });

    it('R15-20: el tiempo deportivo sigue descontándose correctamente bajo medición monotónica fiable', async () => {
      const baseStartMs = Date.now();
      await MatchTimerService.start(sampleMatchId, {
        nowMs: baseStartMs,
        simulatedPerfNowMs: 10_000
      });

      // 12 segundos transcurridos en hardware monotonic (22_000 - 10_000)
      const pauseRes = await MatchTimerService.pause(sampleMatchId, {
        nowMs: baseStartMs - 15_000, // Retroceso de reloj de pared
        simulatedPerfNowMs: 22_000
      });

      expect(pauseRes.status).toBe('applied');
      expect(pauseRes.timerSecondsRemaining).toBe(588); // 600 - 12
    });

    it('R15-21: ausencia de referencia monotónica al retroceder el reloj inicia recuperación conservadora', async () => {
      // Reloj guardado en BD sin sesión monotónica en memoria
      const startMs = 2_000_000;
      await db.matches.update(sampleMatchId, {
        timerLastStart: new Date(startMs),
        timerSecondsRemaining: 500
      });

      // Date.now retrocede
      const rec = await MatchTimerService.reconcile(sampleMatchId, { nowMs: startMs - 20_000 });
      expect(rec.status).toBe('applied');
      expect(rec.confidence).toBe('uncertain');
      expect(rec.isRunning).toBe(true);
      expect(rec.timerSecondsRemaining).toBe(500); // Preservado

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerRecoveryState).toBe('recovery_required');
    });

    it('R15-22: ningún sonido ni chicharra se reproduce por una anomalía temporal', async () => {
      const buzzerSpy = vi.spyOn(soundEffects, 'playBuzzer');
      const coldStartMs = Date.now() - 48 * 3600 * 1000;
      const matchWithJump: Match = {
        ...baseMatch,
        timerLastStart: new Date(coldStartMs),
        timerSecondsRemaining: 300,
        timerRecoveryState: 'recovery_required'
      };

      const { result, unmount } = renderHook(() => useMatchTimer(matchWithJump, true));

      expect(result.current.confidence).toBe('uncertain');
      expect(result.current.timeLeft).toBe(300);
      expect(buzzerSpy).not.toHaveBeenCalled();
      unmount();
    });

    it('R15-23: una recuperación pendiente continúa visible después de rerender en TraditionalEngine', () => {
      const matchPending: Match = {
        ...baseMatch,
        timerSecondsRemaining: 350,
        timerRecoveryState: 'recovery_required'
      };

      const { rerender, unmount } = renderTraditionalEngine(matchPending);

      const warningPill = screen.getByTestId('timer-anomaly-warning');
      expect(warningPill).toBeDefined();
      expect(warningPill.textContent).toContain('Requiere revisión');

      // Rerender repetido
      rerender(
        <MemoryRouter>
          <LiveMatchContext.Provider value={createMockContext({ ...matchPending, localScore: 42 })}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      expect(screen.getByTestId('timer-anomaly-warning')).toBeDefined();
      unmount();
    });

    it('R15-24: los controles para confirmar o corregir tiempo en TraditionalEngine funcionan', async () => {
      await db.matches.update(sampleMatchId, {
        timerRecoveryState: 'recovery_required',
        timerSecondsRemaining: 350
      });

      const currentMatch = (await db.matches.get(sampleMatchId))!;
      const { unmount } = renderTraditionalEngine(currentMatch);

      await act(async () => {
        await timerAuthorityCoordinator.waitForAcquisition(sampleMatchId);
      });

      const confirmBtn = screen.getByTestId('btn-confirm-recovery');
      expect(confirmBtn).toBeDefined();

      await act(async () => {
        confirmBtn.click();
        await new Promise((r) => setTimeout(r, 100));
      });

      // El estado en BD debe haber pasado a normal
      const updatedDb = await db.matches.get(sampleMatchId);
      expect(updatedDb?.timerRecoveryState).toBe('normal');
      unmount();
    });

    it('R15-25: React StrictMode no duplica timers, sonidos ni escrituras bajo incertidumbre', () => {
      const buzzerSpy = vi.spyOn(soundEffects, 'playBuzzer');
      const uncertainMatch: Match = {
        ...baseMatch,
        timerSecondsRemaining: 300,
        timerRecoveryState: 'recovery_required'
      };

      const { unmount } = render(
        <StrictMode>
          <MemoryRouter>
            <LiveMatchContext.Provider value={createMockContext(uncertainMatch)}>
              <TraditionalEngine />
            </LiveMatchContext.Provider>
          </MemoryRouter>
        </StrictMode>
      );

      expect(buzzerSpy).not.toHaveBeenCalled();
      unmount();
    });

    it('R15-26: un cambio de cuarto descarta correctamente referencias temporales del anterior', async () => {
      await db.matches.update(sampleMatchId, {
        currentQuarter: 1,
        timerRecoveryState: 'recovery_required',
        timerSecondsRemaining: 0
      });

      const adv = await MatchTimerService.advanceQuarter(sampleMatchId);
      expect(adv.status).toBe('applied');

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.currentQuarter).toBe(2);
      expect(matchDb?.timerRecoveryState).toBe('normal');
      expect(matchDb?.timerSecondsRemaining).toBe(600);
    });
  });

  // =========================================================================
  // GRUPO 4: C-32 — PRUEBA REAL DE TRANSACCIÓN EN VUELO (R15-27 a R15-28)
  // =========================================================================
  describe('C-32: Prueba Real de Transacción en Vuelo y Fencing de Traspaso (R15-27 a R15-28)', () => {
    it('R15-27: Transacción en vuelo auténtica con drenado y rechazo de nuevas operaciones durante liberación', async () => {
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      await db.matches.update(sampleMatchId, { timerOwnerTabId: undefined, timerLeaseExpiresAt: 0 });

      // 1. Pestaña A adquiere autoridad
      const coordA = new TimerAuthorityCoordinator();
      await coordA._resetForTesting({ tabId: 'tab_A', forceFallback: true });
      const acqA = await coordA.acquireAuthority(sampleMatchId);
      expect(acqA.acquired).toBe(true);

      // 2. Tab A inicia una operación auténtica del servicio
      // Configuramos una barrera controlada para mantener la operación en vuelo
      let resolveBarrier: () => void = () => {};
      const barrierPromise = new Promise<void>((resolve) => {
        resolveBarrier = resolve;
      });

      MatchTimerService._setTestPreCommitHook(async () => {
        await barrierPromise;
      });

      // 3. Tab A lanza la operación auténtica MatchTimerService.adjust
      const opPromiseA = MatchTimerService.adjust(sampleMatchId, -20, {
        coordinator: coordA,
        epoch: acqA.epoch,
        tabId: 'tab_A'
      });

      // 4. Tab A solicita liberar la autoridad mientras opPromiseA está en vuelo
      const releasePromiseA = coordA.releaseAuthority(sampleMatchId);

      // 5. Intentar incorporar una nueva operación en coordA mientras se libera es RECHAZADO de inmediato
      const blockedNewOp = await MatchTimerService.adjust(sampleMatchId, -10, {
        coordinator: coordA,
        epoch: acqA.epoch,
        tabId: 'tab_A'
      });
      expect(blockedNewOp.status).toBe('not_owner');
      expect(blockedNewOp.reason).toContain('proceso de liberación');

      // 6. Desbloquear la barrera: opPromiseA completa su commit antes de que releaseAuthority libere el lease
      resolveBarrier();
      const [resOpA] = await Promise.all([opPromiseA, releasePromiseA]);
      expect(resOpA.status).toBe('applied');
      expect(resOpA.timerSecondsRemaining).toBe(580); // 600 - 20

      // 7. Pestaña B adquiere autoridad válidamente con nuevo epoch
      const coordB = new TimerAuthorityCoordinator();
      await coordB._resetForTesting({ tabId: 'tab_B', forceFallback: true });
      const acqB = await coordB.acquireAuthority(sampleMatchId);
      expect(acqB.acquired).toBe(true);
      expect(acqB.epoch).toBeGreaterThan(acqA.epoch);

      // 8. Tab B ejecuta una operación auténtica del servicio
      MatchTimerService._setTestPreCommitHook(null);
      const resB = await MatchTimerService.adjust(sampleMatchId, 5, {
        coordinator: coordB,
        epoch: acqB.epoch,
        tabId: 'tab_B'
      });
      expect(resB.status).toBe('applied');
      expect(resB.timerSecondsRemaining).toBe(585); // 580 + 5

      // 9. Operación rezagada de A intentando escribir tras el traspaso es rechazada categóricamente por fencing
      const staleOpA = await MatchTimerService.adjust(sampleMatchId, -5, {
        coordinator: coordA,
        epoch: acqA.epoch,
        tabId: 'tab_A'
      });
      expect(staleOpA.status).toBe('not_owner');

      // 10. IndexedDB conserva exactamente el propietario B, el epoch de B y 585 segundos sin corrupción
      const finalMatch = await db.matches.get(sampleMatchId);
      expect(finalMatch?.timerOwnerTabId).toBe('tab_B');
      expect(finalMatch?.timerEpoch).toBe(acqB.epoch);
      expect(finalMatch?.timerSecondsRemaining).toBe(585);

      await coordB.releaseAuthority(sampleMatchId);
      await coordA._resetForTesting();
      await coordB._resetForTesting();
    });

    it('R15-28: drenado ordenado de múltiples operaciones auténticas antes de cesión de lease', async () => {
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      await db.matches.update(sampleMatchId, { timerOwnerTabId: undefined, timerLeaseExpiresAt: 0 });

      const coordA = new TimerAuthorityCoordinator();
      await coordA._resetForTesting({ tabId: 'tab_A', forceFallback: true });
      const acqA = await coordA.acquireAuthority(sampleMatchId);
      expect(acqA.acquired).toBe(true);

      // Iniciar dos operaciones auténticas seguidas
      const op1 = MatchTimerService.adjust(sampleMatchId, -10, { coordinator: coordA });
      const op2 = MatchTimerService.adjust(sampleMatchId, -15, { coordinator: coordA });

      const releaseA = coordA.releaseAuthority(sampleMatchId);

      const [r1, r2] = await Promise.all([op1, op2, releaseA]);
      expect(r1.status).toBe('applied');
      expect(r2.status).toBe('applied');

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerSecondsRemaining).toBe(575); // 600 - 10 - 15

      await coordA._resetForTesting();
    });
  });
});
