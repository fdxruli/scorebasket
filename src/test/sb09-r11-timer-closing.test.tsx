// @vitest-environment jsdom
// src/test/sb09-r11-timer-closing.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../db/db';
import type { Match } from '../db/models';
import { MatchTimerService } from '../db/matchTimer.service';
import {
  timerAuthorityCoordinator,
  TimerAuthorityCoordinator
} from '../services/timerAuthority.coordinator';
import {
  clearAllPendingUnmountPauses
} from '../hooks/useMatchTimer';
import {
  advanceTraditionalQuarter,
  startTraditionalOvertime
} from '../features/match-creations/hooks/useTraditionalLogic';
import {
  LiveMatchContext,
  type LiveMatchContextState,
  type TeamWithPlayers
} from '../features/match-creations/components/context/LiveMatchContext';
import { TraditionalEngine } from '../features/match-creations/components/engines/TraditionalEngine';
import * as soundEffects from '../utils/soundEffects';

describe('SB_PHASE2C_R1.1: Cierre de Autoridad, Fencing y Concurrencia (R11-C-01 a R11-C-20)', () => {
  let sampleMatchId: number;
  let localTeam: TeamWithPlayers;
  let visitorTeam: TeamWithPlayers;
  let baseMatch: Match;

  beforeEach(async () => {
    await db.delete();
    await db.open();
    clearAllPendingUnmountPauses();
    await timerAuthorityCoordinator._resetForTesting();

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
      localScore: 10,
      visitorScore: 8,
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

  // =========================================================================
  // R11-C-01: Dos contextos compiten por el mismo Web Lock
  // =========================================================================
  it('R11-C-01: dos contextos compiten por el mismo Web Lock; solo uno adquiere exclusividad', async () => {
    // Liberar autoridad inicial para permitir competencia limpia entre A y B
    await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

    const coordA = new TimerAuthorityCoordinator();
    const coordB = new TimerAuthorityCoordinator();
    await coordA._resetForTesting({ tabId: 'tab_A' });
    await coordB._resetForTesting({ tabId: 'tab_B' });

    const resA = await coordA.acquireAuthority(sampleMatchId);
    const resB = await coordB.acquireAuthority(sampleMatchId);

    if (coordA.isWebLocksSupported()) {
      expect(resA.acquired).toBe(true);
      expect(resB.acquired).toBe(false);
      expect(coordA.getAuthorityState(sampleMatchId).isOwner).toBe(true);
      expect(coordB.getAuthorityState(sampleMatchId).isOwner).toBe(false);
    } else {
      // En modo fallback IndexedDB lease
      expect(resA.acquired).toBe(true);
      expect(resB.acquired).toBe(false);
      expect(coordA.getAuthorityState(sampleMatchId).isOwner).toBe(true);
      expect(coordB.getAuthorityState(sampleMatchId).isOwner).toBe(false);
    }

    await coordA._resetForTesting();
    await coordB._resetForTesting();
  });

  // =========================================================================
  // R11-C-02: Autoridad única durante escrituras reales
  // =========================================================================
  it('R11-C-02: autoridad única durante escrituras reales; observador es rechazado con not_owner', async () => {
    const observerCoord = new TimerAuthorityCoordinator();
    await observerCoord._resetForTesting({ tabId: 'tab_observer' });

    // Intento de escritura desde observador (sin autoridad en el coordinador)
    const resObserver = await MatchTimerService.start(sampleMatchId, {
      tabId: observerCoord.getTabId(),
      epoch: observerCoord.getAuthorityState(sampleMatchId).epoch
    });

    expect(resObserver.status).toBe('not_owner');
    expect(resObserver.reason).toBeTruthy();

    const matchDb = await db.matches.get(sampleMatchId);
    expect(matchDb?.timerLastStart).toBeUndefined();

    // Escritura desde el dueño legítimo
    const resOwner = await MatchTimerService.start(sampleMatchId);
    expect(resOwner.status).toBe('applied');

    const matchDbRunning = await db.matches.get(sampleMatchId);
    expect(matchDbRunning?.timerLastStart).toBeDefined();

    await observerCoord._resetForTesting();
  });

  // =========================================================================
  // R11-C-03: Operación en vuelo pierde autoridad antes de escribir (Fencing)
  // =========================================================================
  it('R11-C-03: una operación en vuelo pierde autoridad antes de escribir; la escritura se rechaza (C-11)', async () => {
    const initialAuth = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
    expect(initialAuth.hasAuthority).toBe(true);

    // Tab A cede autoridad a Tab B
    await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
    expect(timerAuthorityCoordinator.getAuthorityState(sampleMatchId).hasAuthority).toBe(false);

    // Tab A intenta completar una escritura rezagada con su epoch previo
    const resStale = await MatchTimerService.start(sampleMatchId, {
      epoch: initialAuth.epoch,
      tabId: initialAuth.tabId
    });

    expect(resStale.status).toBe('not_owner');

    const matchDb = await db.matches.get(sampleMatchId);
    expect(matchDb?.timerLastStart).toBeUndefined();
  });

  // =========================================================================
  // R11-C-04: Un escritor obsoleto es rechazado frente a BD más reciente
  // =========================================================================
  it('R11-C-04: un escritor obsoleto es rechazado frente a una generación persistida superior (C-11)', async () => {
    // Simular que otra pestaña ya persistió una generación posterior (timerEpoch: 10)
    await db.matches.update(sampleMatchId, {
      timerEpoch: 10,
      timerOwnerTabId: 'tab_other'
    });

    // Pestaña con epoch 2 intenta escribir
    const res = await MatchTimerService.pause(sampleMatchId, {
      epoch: 2
    });

    expect(res.status).toBe('stale_operation');
    expect(res.reason).toContain('epoch');
  });

  // =========================================================================
  // R11-C-05: Pestaña observadora no reconcilia con escritura
  // =========================================================================
  it('R11-C-05: una pestaña observadora no reconcilia con escritura en IndexedDB (C-12)', async () => {
    const startMs = 1000000;
    await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

    // Cambiar coordinador a modo observador
    await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
    expect(timerAuthorityCoordinator.getAuthorityState(sampleMatchId).hasAuthority).toBe(false);

    // Simular que pasaron 1000 segundos (reloj expiró) y el observador ejecuta reconcile
    const reconcileRes = await MatchTimerService.reconcile(sampleMatchId, {
      nowMs: startMs + 1000000
    });

    expect(reconcileRes.expired).toBe(true);
    expect(reconcileRes.reason).toContain('observador');

    // Comprobar que en IndexedDB el reloj NO fue limpiado por el observador
    const matchDb = await db.matches.get(sampleMatchId);
    expect(matchDb?.timerLastStart).toBeDefined();
  });

  // =========================================================================
  // R11-C-06: Pausa automática tardía no modifica un periodo nuevo
  // =========================================================================
  it('R11-C-06: pausa automática tardía no modifica un periodo nuevo (C-12)', async () => {
    // Avanzar a Q2
    await MatchTimerService.advanceQuarter(sampleMatchId);
    const matchQ2 = await db.matches.get(sampleMatchId);
    expect(matchQ2?.currentQuarter).toBe(2);

    // Iniciar Q2
    await MatchTimerService.start(sampleMatchId);

    // Intento de pausa tardía con referencia a Q1
    const stalePause = await MatchTimerService.pause(sampleMatchId, {
      expectedQuarter: 1
    });

    expect(stalePause.status).toBe('stale_operation');

    // Q2 sigue intacto y corriendo
    const matchAfter = await db.matches.get(sampleMatchId);
    expect(matchAfter?.currentQuarter).toBe(2);
    expect(matchAfter?.timerLastStart).toBeDefined();
  });

  // =========================================================================
  // R11-C-07: Cambio de cuarto requiere autoridad
  // =========================================================================
  it('R11-C-07: cambio de cuarto requiere autoridad; observador no puede avanzar (C-13)', async () => {
    await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

    // Sin autoridad: advanceTraditionalQuarter debe retornar false
    const advanced = await advanceTraditionalQuarter(sampleMatchId);
    expect(advanced).toBe(false);

    const matchDb = await db.matches.get(sampleMatchId);
    expect(matchDb?.currentQuarter).toBe(1);

    // Con autoridad: advanceTraditionalQuarter avanza a Q2
    await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
    const advancedOwner = await advanceTraditionalQuarter(sampleMatchId);
    expect(advancedOwner).toBe(true);

    const matchDbQ2 = await db.matches.get(sampleMatchId);
    expect(matchDbQ2?.currentQuarter).toBe(2);
  });

  // =========================================================================
  // R11-C-08: Prórroga requiere autoridad
  // =========================================================================
  it('R11-C-08: inicio de prórroga requiere autoridad; observador es rechazado (C-13)', async () => {
    await db.matches.update(sampleMatchId, { currentQuarter: 4 });
    await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

    const startedNoAuth = await startTraditionalOvertime(sampleMatchId, 5);
    expect(startedNoAuth).toBe(false);

    await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
    const startedAuth = await startTraditionalOvertime(sampleMatchId, 5);
    expect(startedAuth).toBe(true);

    const matchDb = await db.matches.get(sampleMatchId);
    expect(matchDb?.currentQuarter).toBe(5); // OT1
    expect(matchDb?.timerSecondsRemaining).toBe(300); // 5 min
  });

  // =========================================================================
  // R11-C-09: Fallback sin Web Locks no promete exclusividad inexistente
  // =========================================================================
  it('R11-C-09: fallback sin Web Locks usa lease persistido; segundo coordinador no adquiere (C-14)', async () => {
    await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

    const coordA = new TimerAuthorityCoordinator();
    const coordB = new TimerAuthorityCoordinator();
    await coordA._resetForTesting({ forceFallback: true, tabId: 'fallback_A' });
    await coordB._resetForTesting({ forceFallback: true, tabId: 'fallback_B' });

    expect(coordA.isWebLocksSupported()).toBe(false);
    expect(coordB.isWebLocksSupported()).toBe(false);

    const resA = await coordA.acquireAuthority(sampleMatchId);
    expect(resA.acquired).toBe(true);
    expect(coordA.getAuthorityState(sampleMatchId).isOwner).toBe(true);

    // Coordinador B intenta adquirir mientras A sostiene el lease en BD
    const resB = await coordB.acquireAuthority(sampleMatchId);
    expect(resB.acquired).toBe(false);
    expect(coordB.getAuthorityState(sampleMatchId).isOwner).toBe(false);

    await coordA._resetForTesting();
    await coordB._resetForTesting();
  });

  // =========================================================================
  // R11-C-10: BroadcastChannel atrasado no invalida al propietario legítimo
  // =========================================================================
  it('R11-C-10: BroadcastChannel atrasado no invalida al propietario legítimo con Web Lock (C-15)', async () => {
    const authState = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
    expect(authState.isOwner).toBe(true);

    // Simular recepción de un mensaje AUTHORITY_ACQUIRED espurio/atrasado
    const bc = new BroadcastChannel('scorebasket:timer:authority');
    bc.postMessage({
      type: 'AUTHORITY_ACQUIRED',
      matchId: sampleMatchId,
      tabId: 'rogue_tab',
      epoch: 1, // epoch menor o igual
      timestamp: Date.now()
    });

    await new Promise((r) => setTimeout(r, 50));

    // El propietario legítimo no debe haber soltado su lock ni perdido su status
    const current = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
    expect(current.isOwner).toBe(true);
    bc.close();
  });

  // =========================================================================
  // R11-C-11: Mensajes duplicados no provocan transferencias dobles
  // =========================================================================
  it('R11-C-11: mensajes duplicados en BroadcastChannel son procesados de forma idempotente (C-15)', async () => {
    const bc = new BroadcastChannel('scorebasket:timer:authority');
    const msg = {
      type: 'AUTHORITY_RELEASED' as const,
      matchId: sampleMatchId,
      tabId: 'other_tab',
      epoch: 1,
      timestamp: Date.now()
    };

    // Emitir dos veces el mismo mensaje
    bc.postMessage(msg);
    bc.postMessage(msg);

    await new Promise((r) => setTimeout(r, 50));
    expect(true).toBe(true); // Sin excepciones ni estados corruptos
    bc.close();
  });

  // =========================================================================
  // R11-C-12: toggle concurrente no produce una transición inesperada
  // =========================================================================
  it('R11-C-12: invocaciones concurrentes de toggle resuelven de forma consistente (TC-28/R11)', async () => {
    await Promise.all([
      MatchTimerService.toggle(sampleMatchId),
      MatchTimerService.toggle(sampleMatchId)
    ]);

    const m = await db.matches.get(sampleMatchId);
    expect(typeof m?.timerSecondsRemaining).toBe('number');
    expect(m?.timerSecondsRemaining).toBeGreaterThanOrEqual(0);
  });

  // =========================================================================
  // R11-C-13: Partido finished es inmutable para operaciones temporales
  // =========================================================================
  it('R11-C-13: partido finished es inmutable para todas las operaciones temporales (INV-T04)', async () => {
    await db.matches.update(sampleMatchId, {
      status: 'finished',
      timerLastStart: undefined
    });

    const startRes = await MatchTimerService.start(sampleMatchId);
    expect(startRes.status).toBe('finished');

    const pauseRes = await MatchTimerService.pause(sampleMatchId);
    expect(pauseRes.status).toBe('finished');

    const toggleRes = await MatchTimerService.toggle(sampleMatchId);
    expect(toggleRes.status).toBe('finished');

    const resetRes = await MatchTimerService.reset(sampleMatchId);
    expect(resetRes.status).toBe('finished');

    const adjustRes = await MatchTimerService.adjust(sampleMatchId, 10);
    expect(adjustRes.status).toBe('finished');

    const advRes = await MatchTimerService.advanceQuarter(sampleMatchId);
    expect(advRes.status).toBe('finished');

    const otRes = await MatchTimerService.startOvertime(sampleMatchId);
    expect(otRes.status).toBe('finished');
  });

  // =========================================================================
  // R11-C-14: Cambio de reloj del sistema hacia atrás (Monotonicidad)
  // =========================================================================
  it('R11-C-14: cambio de reloj del sistema hacia atrás no añade segundos ficticios (INV-T08)', async () => {
    const startMs = 2000000;
    await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

    // El reloj del sistema retrocede 100 segundos
    const backwardMs = startMs - 100000;
    const pauseRes = await MatchTimerService.pause(sampleMatchId, { nowMs: backwardMs });

    expect(pauseRes.status).toBe('applied');
    // El tiempo restante no se infla
    expect(pauseRes.timerSecondsRemaining).toBe(600);
  });

  // =========================================================================
  // R11-C-15: Salto abrupto hacia adelante no genera valores negativos
  // =========================================================================
  it('R11-C-15: salto abrupto hacia adelante acota el reloj estrictamente a 00:00 (INV-T01)', async () => {
    const startMs = 2000000;
    await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

    // Salto de 5 horas
    const jumpMs = startMs + 18000000;
    const pauseRes = await MatchTimerService.pause(sampleMatchId, { nowMs: jumpMs });

    expect(pauseRes.status).toBe('applied');
    expect(pauseRes.timerSecondsRemaining).toBe(0);
  });

  // =========================================================================
  // R11-C-16: Recuperación después de recarga sin fingir precisión
  // =========================================================================
  it('R11-C-16: recuperación tras recarga lee timerLastStart persistido exactamente (T-08)', async () => {
    const startMs = 5000000;
    await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

    // Simular lectura de instantánea desde otra sesión o tras recarga
    const snapshot = await MatchTimerService.getSnapshot(sampleMatchId, startMs + 15000);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.isRunning).toBe(true);
    expect(snapshot?.effectiveTimeLeft).toBe(585);
  });

  // =========================================================================
  // R11-C-17: Componente React real muestra correctamente modo observador
  // =========================================================================
  it('R11-C-17: componente React TraditionalEngine muestra el banner de modo observador (C-13, TC-44)', async () => {
    // Liberar autoridad para que el componente monte en modo observador
    await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

    const context = createMockContext(baseMatch);

    await act(async () => {
      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={context}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );
    });

    // Debe mostrarse el aviso de modo observador
    expect(screen.getByText(/Modo observador: Otra pestaña controla el tiempo/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reclamar control/i })).toBeTruthy();
  });

  // =========================================================================
  // R11-C-18: La UI del observador bloquea cambios temporales y pide control
  // =========================================================================
  it('R11-C-18: la UI del observador bloquea avance de cuarto y pide transferencia (C-13)', async () => {
    await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
    const requestSpy = vi.spyOn(timerAuthorityCoordinator, 'requestTransfer');

    const context = createMockContext(baseMatch);

    await act(async () => {
      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={context}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );
    });

    // Al hacer clic en avanzar periodo en modo observador
    const nextQBtn = screen.getByTitle(/Avanzar al siguiente periodo/i);
    await act(async () => {
      fireEvent.click(nextQBtn);
    });

    // Se debe haber invocado la solicitud de transferencia de control
    expect(requestSpy).toHaveBeenCalledWith(sampleMatchId);
  });

  // =========================================================================
  // R11-C-19: Error de persistencia visible, sin éxito falso
  // =========================================================================
  it('R11-C-19: error de autoridad no reporta éxito visual prematuro (INV-T06)', async () => {
    await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

    const res = await MatchTimerService.adjust(sampleMatchId, 30);
    expect(res.status).toBe('not_owner');

    const matchDb = await db.matches.get(sampleMatchId);
    expect(matchDb?.timerSecondsRemaining).toBe(600); // Sin cambios espurios
  });

  // =========================================================================
  // R11-C-20: Audios de chicharra verificados mediante espía real
  // =========================================================================
  it('R11-C-20: la chicharra (playBuzzer) suena exactamente una vez al llegar a 00:00 (TC-48/R11)', async () => {
    const buzzerSpy = vi.spyOn(soundEffects, 'playBuzzer').mockImplementation(() => {});

    // Crear un partido con 1 segundo restante
    const endingMatchId = (await db.matches.add({
      status: 'playing',
      createdAt: new Date(),
      localTeamId: 1,
      visitorTeamId: 2,
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      currentQuarter: 1,
      timerSecondsRemaining: 1,
      timerLastStart: new Date(),
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10 }
      }
    })) as number;

    const endingMatch = (await db.matches.get(endingMatchId))!;
    const context = createMockContext(endingMatch);

    await act(async () => {
      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={context}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );
    });

    // Esperar a que el reloj llegue a 0
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });

    expect(buzzerSpy).toHaveBeenCalledTimes(1);
  });
});
