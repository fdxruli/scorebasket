// @vitest-environment jsdom
// src/test/sb12-r14-timer-closing.test.tsx
import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../db/db';
import type { Match } from '../db/models';
import { MatchTimerService } from '../db/matchTimer.service';
import {
  timerAuthorityCoordinator,
  TimerAuthorityCoordinator
} from '../services/timerAuthority.coordinator';
import {
  useMatchTimer,
  clearAllPendingUnmountPauses
} from '../hooks/useMatchTimer';
import {
  LiveMatchContext,
  type LiveMatchContextState,
  type TeamWithPlayers
} from '../features/match-creations/components/context/LiveMatchContext';
import { TraditionalEngine } from '../features/match-creations/components/engines/TraditionalEngine';
import * as soundEffects from '../utils/soundEffects';

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

describe('SB_PHASE2C_R1.4: Cierre Integral de Precisión, Autoridad y Recuperación', () => {
  let sampleMatchId: number;
  let localTeam: TeamWithPlayers;
  let visitorTeam: TeamWithPlayers;
  let baseMatch: Match;

  beforeEach(async () => {
    activeWebLocks.clear();
    await db.delete();
    await db.open();
    clearAllPendingUnmountPauses();
    await timerAuthorityCoordinator._resetForTesting();
    vi.restoreAllMocks();

    const localId = (await db.teams.add({
      name: 'Equipo Local',
      createdAt: new Date(),
      isArchived: false
    })) as number;

    const visitorId = (await db.teams.add({
      name: 'Equipo Visitante',
      createdAt: new Date(),
      isArchived: false
    })) as number;

    localTeam = {
      id: localId,
      name: 'Equipo Local',
      createdAt: new Date(),
      isArchived: false,
      players: []
    };

    visitorTeam = {
      id: visitorId,
      name: 'Equipo Visitante',
      createdAt: new Date(),
      isArchived: false,
      players: []
    };

    sampleMatchId = (await db.matches.add({
      status: 'playing',
      createdAt: new Date(),
      localTeamId: localId,
      visitorTeamId: visitorId,
      localScore: 20,
      visitorScore: 18,
      localFouls: 1,
      visitorFouls: 2,
      currentQuarter: 1,
      timerSecondsRemaining: 600,
      timerLastStart: undefined,
      config: {
        mode: 'traditional',
        traditional: {
          totalQuarters: 4,
          minutesPerQuarter: 10,
          timeoutsPerTeam: 3
        }
      }
    })) as number;

    baseMatch = (await db.matches.get(sampleMatchId))!;
    await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
  });

  afterEach(async () => {
    cleanup();
    activeWebLocks.clear();
    clearAllPendingUnmountPauses();
    await timerAuthorityCoordinator._resetForTesting();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await db.close();
  });

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

  // =========================================================================
  // GRUPO 1: PRECISIÓN TEMPORAL Y RECUPERACIÓN DE ANOMALÍAS (C-25)
  // =========================================================================
  describe('C-25: Precisión Temporal y Recuperación de Anomalías (R14-T-01 a R14-T-08)', () => {
    it('R14-T-01: salto hacia adelante (+2 horas) en sesión activa con performance.now monotónico calcula elapsed fielmente', async () => {
      const baseStartMs = Date.now();
      await MatchTimerService.start(sampleMatchId, {
        nowMs: baseStartMs,
        simulatedPerfNowMs: 1000
      });

      // Reloj del sistema salta 2 horas adelante, pero monotonic solo avanzó 5 segundos (6000 - 1000)
      const jumpMs = baseStartMs + 7_200_000;
      const pauseRes = await MatchTimerService.pause(sampleMatchId, {
        nowMs: jumpMs,
        simulatedPerfNowMs: 6000
      });

      expect(pauseRes.status).toBe('applied');
      expect(pauseRes.confidence).toBe('high');
      expect(pauseRes.precisionSource).toBe('monotonic_session');
      // 600s - 5s = 595s
      expect(pauseRes.timerSecondsRemaining).toBe(595);
    });

    it('R14-T-02: retroceso del reloj del sistema acota elapsed a 0 y marca severidad backward', async () => {
      const baseStartMs = 1_000_000;
      await MatchTimerService.start(sampleMatchId, { nowMs: baseStartMs });

      // Reloj retrocede 50 segundos
      const backwardMs = baseStartMs - 50_000;
      const pauseRes = await MatchTimerService.pause(sampleMatchId, { nowMs: backwardMs });

      expect(pauseRes.status).toBe('applied');
      expect(pauseRes.confidence).toBe('uncertain');
      expect(pauseRes.precisionSource).toBe('anomalous_clamp');
      expect(pauseRes.timerSecondsRemaining).toBe(600); // no resta tiempo negativo ni inventa segundos
    });

    it('R14-T-03: salto hacia adelante desproporcionado (+48h) sin sesión previa entra en recuperación conservadora', async () => {
      // Configurar el reloj corriendo desde hace 48 horas en frío (sin sessionMonotonicStarts)
      const coldStartMs = Date.now() - 48 * 3600 * 1000;
      await db.matches.update(sampleMatchId, {
        timerLastStart: new Date(coldStartMs),
        timerSecondsRemaining: 400
      });

      const snap = await MatchTimerService.getSnapshot(sampleMatchId, Date.now());
      expect(snap?.confidence).toBe('uncertain');
      expect(snap?.precisionSource).toBe('anomalous_clamp');
      // No trunca a cero ni inventa precisión: preserva los 400s conocidos
      expect(snap?.effectiveTimeLeft).toBe(400);
    });

    it('R14-T-04: getSnapshot con salto anómalo reporta effectiveTimeLeft preservado (no 0) y confianza uncertain', async () => {
      const coldStartMs = 1_000_000;
      await db.matches.update(sampleMatchId, {
        timerLastStart: new Date(coldStartMs),
        timerSecondsRemaining: 350
      });

      const nowMs = coldStartMs + 100_000 * 1000; // > 24 horas
      const snap = await MatchTimerService.getSnapshot(sampleMatchId, nowMs);

      expect(snap?.effectiveTimeLeft).toBe(350);
      expect(snap?.confidence).toBe('uncertain');
      expect(snap?.isClockShiftDetected).toBe(true);
    });

    it('R14-T-05: reconciliación con salto anómalo hacia adelante preserva timerSecondsRemaining y pausa el reloj', async () => {
      const coldStartMs = 1_000_000;
      await db.matches.update(sampleMatchId, {
        timerLastStart: new Date(coldStartMs),
        timerSecondsRemaining: 500
      });

      const jumpNowMs = coldStartMs + 90_000 * 1000; // > 24h
      const rec = await MatchTimerService.reconcile(sampleMatchId, { nowMs: jumpNowMs });

      expect(rec.status).toBe('applied');
      expect(rec.expired).toBe(false);
      expect(rec.isRunning).toBe(false);
      expect(rec.timerSecondsRemaining).toBe(500); // NO truncó a 00:00!
      expect(rec.confidence).toBe('uncertain');

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerLastStart).toBeUndefined(); // Pausado en estado seguro
      expect(matchDb?.timerSecondsRemaining).toBe(500);
      expect(matchDb?.status).toBe('playing'); // Cuarto NO finalizado
    });

    it('R14-T-06: pausa con salto anómalo no resta tiempo excesivo ni finaliza el periodo', async () => {
      const coldStartMs = 1_000_000;
      await db.matches.update(sampleMatchId, {
        timerLastStart: new Date(coldStartMs),
        timerSecondsRemaining: 450
      });

      const jumpNowMs = coldStartMs + 90_000 * 1000;
      const pauseRes = await MatchTimerService.pause(sampleMatchId, { nowMs: jumpNowMs });

      expect(pauseRes.status).toBe('applied');
      expect(pauseRes.timerSecondsRemaining).toBe(450);
      expect(pauseRes.confidence).toBe('uncertain');

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerSecondsRemaining).toBe(450);
      expect(matchDb?.status).toBe('playing');
    });

    it('R14-T-07: recuperación tras salto anómalo permite ajuste manual o reanudación legítima posterior', async () => {
      // Tras haber quedado pausado por salto anómalo con 450s:
      await db.matches.update(sampleMatchId, {
        timerLastStart: undefined,
        timerSecondsRemaining: 450
      });

      // El usuario puede ajustar manualmente el tiempo
      const adjRes = await MatchTimerService.adjust(sampleMatchId, -30);
      expect(adjRes.status).toBe('applied');
      expect(adjRes.timerSecondsRemaining).toBe(420);

      // Y reanudar la marcha del partido legítimamente
      const startRes = await MatchTimerService.start(sampleMatchId);
      expect(startRes.status).toBe('applied');
      expect(startRes.isRunning).toBe(true);

      const snap = await MatchTimerService.getSnapshot(sampleMatchId);
      expect(snap?.isRunning).toBe(true);
      expect(snap?.effectiveTimeLeft).toBeCloseTo(420, 0);
    });

    it('R14-T-08: suspensión normal de PWA (30 segundos) con reloj consistente descuenta tiempo legítimo', async () => {
      const baseStartMs = Date.now();
      await MatchTimerService.start(sampleMatchId, { nowMs: baseStartMs });

      // Suspensión de 30s de pantalla
      const resumeMs = baseStartMs + 30_000;
      const rec = await MatchTimerService.reconcile(sampleMatchId, { nowMs: resumeMs });

      expect(rec.status).toBe('applied');
      expect(rec.isRunning).toBe(true);
      expect(rec.expired).toBe(false);
      expect(rec.confidence).toBe('approximate');
      expect(rec.timerSecondsRemaining).toBe(570); // 600 - 30
    });
  });

  // =========================================================================
  // GRUPO 2: UNIFICACIÓN DE RELOJ UI Y SERVICIO (C-26)
  // =========================================================================
  describe('C-26: Unificación de Reloj UI y Servicio (R14-UI-01 a R14-UI-08)', () => {
    it('R14-UI-01: proyección en UI y getSnapshot retornan exactamente el mismo valor en el mismo instante', async () => {
      const startMs = Date.now();
      await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

      const currentMatch = (await db.matches.get(sampleMatchId))!;
      const snap = await MatchTimerService.getSnapshot(sampleMatchId, startMs + 12_000);
      const proj = MatchTimerService.projectTime(currentMatch, startMs + 12_000);

      expect(snap?.effectiveTimeLeft).toBe(proj.timeLeft);
      expect(snap?.effectiveTimeLeft).toBe(588);
      expect(proj.isRunning).toBe(true);
      expect(proj.confidence).toBe(snap?.confidence);
    });

    it('R14-UI-02: retraso en tick visual simulado no desvía el tiempo respecto a la proyección del servicio', async () => {
      const startMs = Date.now();
      await MatchTimerService.start(sampleMatchId, { nowMs: startMs });
      const currentMatch = (await db.matches.get(sampleMatchId))!;

      // Simular retraso acumulado de 47.3s
      const delayMs = startMs + 47_300;
      const proj = MatchTimerService.projectTime(currentMatch, delayMs);
      const snap = await MatchTimerService.getSnapshot(sampleMatchId, delayMs);

      expect(proj.timeLeft).toBe(snap?.effectiveTimeLeft);
      expect(proj.timeLeft).toBeCloseTo(600 - 47.3, 1);
    });

    it('R14-UI-03: salto temporal hacia adelante en UI no dispara chicharra si la proyección es uncertain', async () => {
      const buzzerSpy = vi.spyOn(soundEffects, 'playBuzzer');
      const coldStartMs = Date.now() - 48 * 3600 * 1000;
      const matchWithJump: Match = {
        ...baseMatch,
        timerLastStart: new Date(coldStartMs),
        timerSecondsRemaining: 300
      };

      const { result, unmount } = renderHook(() => useMatchTimer(matchWithJump, true));

      expect(result.current.confidence).toBe('uncertain');
      expect(result.current.timeLeft).toBe(300);
      expect(buzzerSpy).not.toHaveBeenCalled();
      unmount();
    });

    it('R14-UI-04: retroceso temporal en UI mantiene tiempo previo sin sumar segundos fantasma', async () => {
      const startMs = 1_000_000;
      const matchRunning: Match = {
        ...baseMatch,
        timerLastStart: new Date(startMs),
        timerSecondsRemaining: 600
      };

      // Retroceder reloj de sistema a startMs - 20_000
      const backwardMs = startMs - 20_000;
      const proj = MatchTimerService.projectTime(matchRunning, backwardMs);

      expect(proj.timeLeft).toBe(600);
      expect(proj.clockShiftSeverity).toBe('backward');
      expect(proj.confidence).toBe('uncertain');
    });

    it('R14-UI-05: expiración legítima a 00:00 dispara chicharra una sola vez por cuarto en UI', async () => {
      const buzzerSpy = vi.spyOn(soundEffects, 'playBuzzer');
      const startMs = Date.now() - 601_000; // Expiró legítimamente hace 1s
      const expiredMatch: Match = {
        ...baseMatch,
        timerLastStart: new Date(startMs),
        timerSecondsRemaining: 600
      };

      const { rerender, unmount } = renderHook(({ m }) => useMatchTimer(m, true), {
        initialProps: { m: expiredMatch }
      });

      expect(buzzerSpy).toHaveBeenCalledTimes(1);

      // Rerender repetido del mismo cuarto expirado
      rerender({ m: expiredMatch });
      rerender({ m: expiredMatch });

      expect(buzzerSpy).toHaveBeenCalledTimes(1); // Exactamente una sola vez!
      unmount();
    });

    it('R14-UI-06: estado de incertidumbre temporal muestra aviso sin transicionar a fin de periodo', async () => {
      const coldStartMs = Date.now() - 48 * 3600 * 1000;
      const uncertainMatch = {
        ...baseMatch,
        timerLastStart: new Date(coldStartMs),
        timerSecondsRemaining: 250
      };

      const { unmount } = renderTraditionalEngine(uncertainMatch);

      // Debe mostrar el badge de aviso de anomalía temporal
      const warningPill = screen.getByTestId('timer-anomaly-warning');
      expect(warningPill).toBeDefined();
      expect(warningPill.textContent).toContain('Desfase o salto anómalo detectado');

      // No debe abrir automáticamente modales de fin de cuarto
      expect(screen.queryByText(/Fin del 1er Cuarto/i)).toBeNull();
      expect(screen.queryByText(/Fin del Partido/i)).toBeNull();
      unmount();
    });

    it('R14-UI-07: cambio de cuarto resetea la proyección previa sin residuos del periodo anterior', async () => {
      const buzzerSpy = vi.spyOn(soundEffects, 'playBuzzer');
      const startMs = Date.now() - 605_000;
      const expiredQ1: Match = {
        ...baseMatch,
        currentQuarter: 1,
        timerLastStart: new Date(startMs),
        timerSecondsRemaining: 600
      };

      const { rerender, result, unmount } = renderHook(({ m }) => useMatchTimer(m, true), {
        initialProps: { m: expiredQ1 }
      });

      expect(result.current.timeLeft).toBe(0);
      expect(buzzerSpy).toHaveBeenCalledTimes(1);

      // Cambiar a Q2 con 600s
      const cleanQ2: Match = {
        ...baseMatch,
        currentQuarter: 2,
        timerLastStart: undefined,
        timerSecondsRemaining: 600
      };

      rerender({ m: cleanQ2 });

      expect(result.current.timeLeft).toBe(600);
      expect(result.current.isRunning).toBe(false);
      expect(result.current.confidence).toBe('high');
      expect(buzzerSpy).toHaveBeenCalledTimes(1); // No suena de nuevo al resetear
      unmount();
    });

    it('R14-UI-08: montaje bajo React.StrictMode no duplica la reproducción de chicharra ni desincroniza la proyección', () => {
      const buzzerSpy = vi.spyOn(soundEffects, 'playBuzzer');
      const startMs = Date.now() - 601_000;
      const expiredMatch: Match = {
        ...baseMatch,
        timerLastStart: new Date(startMs),
        timerSecondsRemaining: 600
      };

      const { unmount } = render(
        <StrictMode>
          <MemoryRouter>
            <LiveMatchContext.Provider value={createMockContext(expiredMatch)}>
              <TraditionalEngine />
            </LiveMatchContext.Provider>
          </MemoryRouter>
        </StrictMode>
      );

      // En React 19 StrictMode (doble ciclo mount-unmount-mount), la chicharra debe sonar solo 1 vez
      expect(buzzerSpy).toHaveBeenCalledTimes(1);
      unmount();
    });
  });

  // =========================================================================
  // GRUPO 3: AUTORIZACIÓN TRANSACCIONAL Y CICLO DE VIDA DE LEASE (C-27)
  // =========================================================================
  describe('C-27: Autorización Transaccional y Ciclo de Vida de Lease (R14-A-01 a R14-A-12)', () => {
    it('R14-A-01: operación con lease válido y propietario coincidente es autorizada (applied)', async () => {
      const res = await MatchTimerService.start(sampleMatchId);
      expect(res.status).toBe('applied');
      expect(res.isRunning).toBe(true);
    });

    it('R14-A-02: operación con lease ausente (undefined) es rechazada con not_owner', async () => {
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: undefined
      });

      const res = await MatchTimerService.start(sampleMatchId);
      expect(res.status).toBe('not_owner');
      expect(res.reason).toContain('lease de autoridad está ausente o no es positivo');
    });

    it('R14-A-03: operación con lease = 0 es rechazada con not_owner', async () => {
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: 0
      });

      const res = await MatchTimerService.start(sampleMatchId);
      expect(res.status).toBe('not_owner');
      expect(res.reason).toContain('lease de autoridad está ausente o no es positivo');
    });

    it('R14-A-04: operación con lease expirado (timerLeaseExpiresAt < nowMs) es rechazada con not_owner', async () => {
      const baseNow = Date.now();
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: baseNow - 2000
      });

      const res = await MatchTimerService.start(sampleMatchId, { nowMs: baseNow });
      expect(res.status).toBe('not_owner');
      expect(res.reason).toContain('lease de autoridad ha expirado');
    });

    it('R14-A-05: operación con propietario diferente en BD es rechazada con not_owner', async () => {
      await db.matches.update(sampleMatchId, {
        timerOwnerTabId: 'other_tab_foreign'
      });

      const res = await MatchTimerService.start(sampleMatchId);
      expect(res.status).toBe('not_owner');
      expect(res.reason).toContain('pertenece a otra pestaña o no tiene dueño');
    });

    it('R14-A-06: operación con epoch inferior al persistido es rechazada con stale_operation', async () => {
      const auth = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
      // BD avanza a un epoch mayor (simulando que otra pestaña tomó posesión y avanzó el epoch en BD)
      await db.matches.update(sampleMatchId, {
        timerEpoch: auth.epoch + 5
      });

      // El llamador intenta escribir con su epoch local legítimo (auth.epoch),
      // pasando el pre-check local pero siendo rechazado por el fencing transaccional en BD.
      const res = await MatchTimerService.start(sampleMatchId, { epoch: auth.epoch });
      expect(res.status).toBe('stale_operation');
      expect(res.reason).toContain('Operación atrasada respecto a la base de datos');
    });

    it('R14-A-07: operación con epoch superior no reservado es rechazada con stale_operation', async () => {
      // Liberamos la autoridad inicial para que coordHigher pueda adquirirla legítimamente
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      await db.matches.update(sampleMatchId, { timerOwnerTabId: undefined, timerLeaseExpiresAt: 0 });

      // Configuramos un coordinador con epoch superior no reservado en BD
      const coordHigher = new TimerAuthorityCoordinator();
      await coordHigher._resetForTesting({ tabId: 'tab_higher', forceFallback: true });
      const acq = await coordHigher.acquireAuthority(sampleMatchId);
      expect(acq.acquired).toBe(true);

      // En BD manipulamos timerEpoch para que sea inferior al callerEpoch (simulando desincronización o falta de reserva previa)
      await db.matches.update(sampleMatchId, {
        timerEpoch: acq.epoch - 1
      });

      const res = await MatchTimerService.start(sampleMatchId, { coordinator: coordHigher });
      expect(res.status).toBe('stale_operation');
      expect(res.reason).toMatch(/epoch.*no reservado/i);

      await coordHigher.releaseAuthority(sampleMatchId);
      await coordHigher._resetForTesting();
    });

    it('R14-A-08: pestaña con Web Lock pero lease expirado en BD es rechazada con not_owner', async () => {
      // Re-adquirir en Web Locks mode
      const coordWL = new TimerAuthorityCoordinator();
      await coordWL._resetForTesting({ tabId: 'tab_wl' });
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      await db.matches.update(sampleMatchId, { timerOwnerTabId: undefined, timerLeaseExpiresAt: 0 });

      const acq = await coordWL.acquireAuthority(sampleMatchId);
      expect(acq.acquired).toBe(true);
      expect(coordWL.hasActiveLock(sampleMatchId)).toBe(true);

      const baseNow = Date.now();
      // Pero el lease en BD venció
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: baseNow - 3000
      });

      const res = await MatchTimerService.start(sampleMatchId, {
        nowMs: baseNow,
        epoch: acq.epoch,
        tabId: 'tab_wl',
        coordinator: coordWL
      });
      expect(res.status).toBe('not_owner');
      expect(res.reason).toContain('lease de autoridad ha expirado');
    });

    it('R14-A-09: pestaña en fallback toma autoridad legítimamente tras expiración del lease anterior', async () => {
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      await db.matches.update(sampleMatchId, { timerOwnerTabId: undefined, timerLeaseExpiresAt: 0 });

      const coordA = new TimerAuthorityCoordinator();
      await coordA._resetForTesting({ tabId: 'tab_A', forceFallback: true });
      const acqA = await coordA.acquireAuthority(sampleMatchId);
      expect(acqA.acquired).toBe(true);

      // Simular expiración de lease de A
      coordA._testSimulateSuspension(sampleMatchId);
      const expiredMs = Date.now() - 1000;
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: expiredMs
      });

      // Pestaña B en fallback intenta adquirir
      const coordB = new TimerAuthorityCoordinator();
      await coordB._resetForTesting({ tabId: 'tab_B', forceFallback: true });
      const acqB = await coordB.acquireAuthority(sampleMatchId);

      expect(acqB.acquired).toBe(true);
      expect(acqB.epoch).toBeGreaterThan(acqA.epoch);

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerOwnerTabId).toBe('tab_B');
      expect(matchDb?.timerLeaseExpiresAt).toBeGreaterThan(Date.now());
    });

    it('R14-A-10: pestaña anterior intenta escribir tras la toma de posesión del sucesor y es rechazada', async () => {
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      await db.matches.update(sampleMatchId, { timerOwnerTabId: undefined, timerLeaseExpiresAt: 0 });

      const coordA = new TimerAuthorityCoordinator();
      await coordA._resetForTesting({ tabId: 'tab_A', forceFallback: true });
      const acqA = await coordA.acquireAuthority(sampleMatchId);

      // Simular suspensión y takeover por B
      coordA._testSimulateSuspension(sampleMatchId);
      await db.matches.update(sampleMatchId, { timerLeaseExpiresAt: Date.now() - 1000 });

      const coordB = new TimerAuthorityCoordinator();
      await coordB._resetForTesting({ tabId: 'tab_B', forceFallback: true });
      const acqB = await coordB.acquireAuthority(sampleMatchId);
      expect(acqB.acquired).toBe(true);

      // Tab A despierta y trata de escribir usando su epoch anterior
      const writeA = await MatchTimerService.start(sampleMatchId, {
        epoch: acqA.epoch,
        tabId: 'tab_A',
        coordinator: coordA
      });

      expect(['not_owner', 'stale_operation']).toContain(writeA.status);

      // Las modificaciones de B permanecen intactas
      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerOwnerTabId).toBe('tab_B');
    });

    it('R14-A-11: renovación de lease por propietario legítimo antes de expiración extiende vigencia', async () => {
      const initialMatch = (await db.matches.get(sampleMatchId))!;
      const initialLease = initialMatch.timerLeaseExpiresAt!;

      // Simular avance de 2 segundos en tiempo real
      await new Promise(r => setTimeout(r, 50));

      const renewed = await timerAuthorityCoordinator.renewLease(sampleMatchId);
      expect(renewed).toBe(true);

      const afterMatch = (await db.matches.get(sampleMatchId))!;
      expect(afterMatch.timerLeaseExpiresAt).toBeGreaterThanOrEqual(initialLease);
    });

    it('R14-A-12: liberación explícita de lease por pestaña saliente no corrompe el lease de un sucesor', async () => {
      const coordA = new TimerAuthorityCoordinator();
      await coordA._resetForTesting({ tabId: 'tab_A', forceFallback: true });
      const acqA = await coordA.acquireAuthority(sampleMatchId);

      // Simular que Tab B ya tomó posesión legítima (epoch superior y nuevo lease)
      const successorLease = Date.now() + 10_000;
      await db.matches.update(sampleMatchId, {
        timerOwnerTabId: 'tab_B',
        timerEpoch: acqA.epoch + 1,
        timerLeaseExpiresAt: successorLease
      });

      // Tab A al desmontar o cerrar ejecuta releaseAuthority
      await coordA.releaseAuthority(sampleMatchId);

      // El lease de Tab B debe seguir intacto
      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerOwnerTabId).toBe('tab_B');
      expect(matchDb?.timerEpoch).toBe(acqA.epoch + 1);
      expect(matchDb?.timerLeaseExpiresAt).toBe(successorLease);
    });
  });

  // =========================================================================
  // GRUPO 4: ESCENARIOS ADVERSARIALES REALES (C-28)
  // =========================================================================
  describe('C-28: Escenarios Adversariales Reales (Escenario A, B y C)', () => {
    it('R14-ADV-01 (Escenario A: Mismo Cuarto, Conflicto Real): rechazo de Tab A exclusivamente por autoridad/epoch sin cambiar a Q2', async () => {
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      await db.matches.update(sampleMatchId, { timerOwnerTabId: undefined, timerLeaseExpiresAt: 0, timerEpoch: 1 });

      // 1. Tab A en Q1 arranca el reloj con epoch 2
      const coordA = new TimerAuthorityCoordinator();
      await coordA._resetForTesting({ tabId: 'tab_A', forceFallback: true, epochCounter: 1 });
      const acqA = await coordA.acquireAuthority(sampleMatchId);
      expect(acqA.epoch).toBe(2);

      const startMs = 1_000_000;
      const startRes = await MatchTimerService.start(sampleMatchId, {
        nowMs: startMs,
        epoch: acqA.epoch,
        tabId: 'tab_A',
        coordinator: coordA
      });
      expect(startRes.status).toBe('applied');

      // 2. Tab A entra en suspensión profunda y su lease expira
      coordA._testSimulateSuspension(sampleMatchId);
      const expiredMs = startMs + 10_000;
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: expiredMs - 1000
      });

      // 3. Tab B adquiere válidamente la autoridad en el MISMO Q1 con epoch 3
      const coordB = new TimerAuthorityCoordinator();
      await coordB._resetForTesting({ tabId: 'tab_B', forceFallback: true, epochCounter: 2 });
      const acqB = await coordB.acquireAuthority(sampleMatchId);
      expect(acqB.acquired).toBe(true);
      expect(acqB.epoch).toBe(3);

      // 4. Tab B modifica el tiempo en Q1 (pausa a los 580s)
      const pauseB = await MatchTimerService.pause(sampleMatchId, {
        nowMs: expiredMs + 20_000,
        epoch: acqB.epoch,
        tabId: 'tab_B',
        coordinator: coordB
      });
      expect(pauseB.status).toBe('applied');

      // Verificar que el partido sigue en Q1 con 580s
      let matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.currentQuarter).toBe(1); // ¡Mismo cuarto!
      expect(matchDb?.timerEpoch).toBe(3);
      expect(matchDb?.timerOwnerTabId).toBe('tab_B');

      // 5. Tab A despierta e intenta pausar o reconciliar en el MISMO Q1
      const staleWakeup = await MatchTimerService.pause(sampleMatchId, {
        nowMs: expiredMs + 30_000,
        epoch: acqA.epoch,
        tabId: 'tab_A',
        expectedQuarter: 1, // Mismo cuarto Q1!
        coordinator: coordA
      });

      // Debe ser rechazada por stale_operation / not_owner SIN alterar los datos de B
      expect(['stale_operation', 'not_owner']).toContain(staleWakeup.status);

      matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.currentQuarter).toBe(1);
      expect(matchDb?.timerEpoch).toBe(3);
      expect(matchDb?.timerOwnerTabId).toBe('tab_B');
      expect(matchDb?.timerSecondsRemaining).toBe(pauseB.timerSecondsRemaining);
    });

    it('R14-ADV-02 (Escenario B: Web Locks y Fallback Takeover): cero concurrencia de escritores activos', async () => {
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      await db.matches.update(sampleMatchId, { timerOwnerTabId: undefined, timerLeaseExpiresAt: 0 });

      // Tab A opera con Web Locks
      const coordA = new TimerAuthorityCoordinator();
      await coordA._resetForTesting({ tabId: 'tab_A' });
      const acqA = await coordA.acquireAuthority(sampleMatchId);
      expect(acqA.acquired).toBe(true);

      // Tab B en fallback intenta usurpar mientras lease y lock de A son válidos
      const coordB = new TimerAuthorityCoordinator();
      await coordB._resetForTesting({ tabId: 'tab_B', forceFallback: true });
      const acqBInitial = await coordB.acquireAuthority(sampleMatchId);
      expect(acqBInitial.acquired).toBe(false); // Rechazada: no puede usurpar

      // A pierde su lease por desconexión / tiempo sin heartbeat
      coordA._testSimulateSuspension(sampleMatchId);
      await db.matches.update(sampleMatchId, {
        timerLeaseExpiresAt: Date.now() - 2000
      });

      // B toma posesión legítima en fallback
      const acqBTakeover = await coordB.acquireAuthority(sampleMatchId);
      expect(acqBTakeover.acquired).toBe(true);
      expect(acqBTakeover.epoch).toBeGreaterThan(acqA.epoch);

      // A intenta escribir: rechazada
      const staleWriteA = await MatchTimerService.start(sampleMatchId, {
        epoch: acqA.epoch,
        tabId: 'tab_A',
        coordinator: coordA
      });
      expect(['stale_operation', 'not_owner']).toContain(staleWriteA.status);

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerOwnerTabId).toBe('tab_B');
    });

    it('R14-ADV-03 (Escenario C: Escritura en Vuelo Durante Traspaso): no existe interleaving corruptor', async () => {
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      await db.matches.update(sampleMatchId, { timerOwnerTabId: undefined, timerLeaseExpiresAt: 0 });

      const coordA = new TimerAuthorityCoordinator();
      await coordA._resetForTesting({ tabId: 'tab_A', forceFallback: true });
      const acqA = await coordA.acquireAuthority(sampleMatchId);
      expect(acqA.acquired).toBe(true);

      // Tab A inicia una operación transaccional lenta (simulada con delay)
      let transactionFinished = false;
      const slowOp = new Promise<void>((resolve) => {
        setTimeout(async () => {
          await db.matches.update(sampleMatchId, { timerSecondsRemaining: 550 });
          transactionFinished = true;
          resolve();
        }, 50);
      });
      coordA.trackOperation(sampleMatchId, slowOp);

      // Mientras la transacción de A está en vuelo, se inicia la liberación y transferencia a B
      const releasePromise = coordA.releaseAuthority(sampleMatchId);

      // B espera a que acabe cualquier adquisición/liberación en vuelo
      await releasePromise;
      expect(transactionFinished).toBe(true); // La operación lenta de A terminó antes de ceder el control

      const coordB = new TimerAuthorityCoordinator();
      await coordB._resetForTesting({ tabId: 'tab_B', forceFallback: true });
      const acqB = await coordB.acquireAuthority(sampleMatchId);
      expect(acqB.acquired).toBe(true);

      // B escribe su valor limpio
      await MatchTimerService.adjust(sampleMatchId, 10, {
        epoch: acqB.epoch,
        tabId: 'tab_B',
        coordinator: coordB
      });

      const matchDb = await db.matches.get(sampleMatchId);
      expect(matchDb?.timerSecondsRemaining).toBe(560); // 550 + 10 sin corrupción ni escrituras zombi
      expect(matchDb?.timerOwnerTabId).toBe('tab_B');
    });
  });
});
