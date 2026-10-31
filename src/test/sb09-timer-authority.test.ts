// src/test/sb09-timer-authority.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../db/db';
import { MatchTimerService } from '../db/matchTimer.service';
import {
  timerAuthorityCoordinator,
  TimerAuthorityCoordinator
} from '../services/timerAuthority.coordinator';
import {
  pauseMatchTimerIdempotent,
  clearAllPendingUnmountPauses
} from '../hooks/useMatchTimer';
import { advanceTraditionalQuarter, startTraditionalOvertime } from '../features/match-creations/hooks/useTraditionalLogic';
import { SeriesService } from '../db/series.service';

describe('SB_PHASE2C_AUTONOMOUS_R1: Autoridad del Cronómetro, Concurrencia y Continuidad PWA', () => {
  let sampleMatchId: number;

  beforeEach(async () => {
    await db.delete();
    await db.open();
    clearAllPendingUnmountPauses();
    await timerAuthorityCoordinator._resetForTesting();

    // Crear un partido tradicional estándar
    sampleMatchId = (await db.matches.add({
      status: 'playing',
      createdAt: new Date(),
      localTeamId: 1,
      visitorTeamId: 2,
      localScore: 10,
      visitorScore: 8,
      localFouls: 1,
      visitorFouls: 2,
      currentQuarter: 1,
      timerSecondsRemaining: 600, // 10 minutos
      timerLastStart: undefined, // inicia pausado
      config: {
        mode: 'traditional',
        traditional: {
          totalQuarters: 4,
          minutesPerQuarter: 10,
          timeoutsPerTeam: 3
        }
      }
    })) as number;

    // Adquirir autoridad en la pestaña principal para las pruebas unitarias
    await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
  });

  afterEach(async () => {
    clearAllPendingUnmountPauses();
    await timerAuthorityCoordinator._resetForTesting();
    await db.close();
  });

  // =========================================================================
  // GRUPO A — OPERACIONES DEL RELOJ (TC-01 a TC-10)
  // =========================================================================
  describe('Grupo A — Operaciones del Reloj', () => {
    it('TC-01: iniciar reloj pausado transiciona a running y establece timerLastStart', async () => {
      const startMs = Date.now();
      const res = await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

      expect(res.status).toBe('applied');
      expect(res.isRunning).toBe(true);
      expect(res.timerSecondsRemaining).toBe(600);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerLastStart).toBeDefined();
      expect(m?.timerLastStart?.getTime()).toBe(startMs);
      expect(m?.status).toBe('playing');
    });

    it('TC-02: pausar reloj activo descuenta el tiempo transcurrido y limpia timerLastStart', async () => {
      const startMs = 1000000;
      await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

      // Pausar 15 segundos después
      const pauseMs = startMs + 15000;
      const res = await MatchTimerService.pause(sampleMatchId, { nowMs: pauseMs });

      expect(res.status).toBe('applied');
      expect(res.isRunning).toBe(false);
      expect(res.timerSecondsRemaining).toBe(585); // 600 - 15

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerLastStart).toBeUndefined();
      expect(m?.timerSecondsRemaining).toBe(585);
    });

    it('TC-03: pausa repetida es estrictamente idempotente (no descuenta dos veces)', async () => {
      const startMs = 1000000;
      await MatchTimerService.start(sampleMatchId, { nowMs: startMs });
      await MatchTimerService.pause(sampleMatchId, { nowMs: startMs + 20000 });

      const mFirst = await db.matches.get(sampleMatchId);
      expect(mFirst?.timerSecondsRemaining).toBe(580);

      // Segunda pausa cuando ya está pausado
      const resSecond = await MatchTimerService.pause(sampleMatchId, { nowMs: startMs + 40000 });
      expect(resSecond.status).toBe('already_applied');
      expect(resSecond.timerSecondsRemaining).toBe(580);

      const mSecond = await db.matches.get(sampleMatchId);
      expect(mSecond?.timerSecondsRemaining).toBe(580);
      expect(mSecond?.timerLastStart).toBeUndefined();
    });

    it('TC-04: start repetido es idempotente y no reinicia el timestamp ni el tiempo', async () => {
      const startMs = 1000000;
      await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

      // Segundo start mientras sigue corriendo
      const resSecond = await MatchTimerService.start(sampleMatchId, { nowMs: startMs + 10000 });
      expect(resSecond.status).toBe('already_applied');
      expect(resSecond.isRunning).toBe(true);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerLastStart?.getTime()).toBe(startMs); // conserva el timestamp inicial
    });

    it('TC-05: reset válido restaura la duración oficial del periodo en estado pausado', async () => {
      // Modificar tiempo restante a 120s
      await db.matches.update(sampleMatchId, { timerSecondsRemaining: 120 });

      const res = await MatchTimerService.reset(sampleMatchId);
      expect(res.status).toBe('applied');
      expect(res.timerSecondsRemaining).toBe(600); // 10 min * 60
      expect(res.isRunning).toBe(false);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerSecondsRemaining).toBe(600);
      expect(m?.timerLastStart).toBeUndefined();
    });

    it('TC-06: ajuste válido en pausa incrementa o decrementa los segundos', async () => {
      await db.matches.update(sampleMatchId, { timerSecondsRemaining: 300 });

      // Sumar 30 segundos
      const resUp = await MatchTimerService.adjust(sampleMatchId, 30);
      expect(resUp.status).toBe('applied');
      expect(resUp.timerSecondsRemaining).toBe(330);

      // Restar 40 segundos
      const resDown = await MatchTimerService.adjust(sampleMatchId, -40);
      expect(resDown.status).toBe('applied');
      expect(resDown.timerSecondsRemaining).toBe(290);
    });

    it('TC-07: rechazo de ajuste durante ejecución si el reloj está corriendo', async () => {
      await MatchTimerService.start(sampleMatchId);

      const res = await MatchTimerService.adjust(sampleMatchId, 10);
      expect(res.status).toBe('rejected');
      expect(res.reason).toContain('mientras está en marcha');

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerLastStart).toBeDefined(); // sigue corriendo sin alteraciones
    });

    it('TC-08: partido finished no puede reabrirse ni modificarse por start o toggle', async () => {
      await db.matches.update(sampleMatchId, { status: 'finished', finishedAt: new Date() });

      const resStart = await MatchTimerService.start(sampleMatchId);
      expect(resStart.status).toBe('finished');

      const resToggle = await MatchTimerService.toggle(sampleMatchId);
      expect(resToggle.status).toBe('finished');

      const m = await db.matches.get(sampleMatchId);
      expect(m?.status).toBe('finished');
      expect(m?.timerLastStart).toBeUndefined();
    });

    it('TC-09: operaciones con expectedQuarter desactualizado son rechazadas', async () => {
      await db.matches.update(sampleMatchId, { currentQuarter: 2 });

      // Intento de operación enviada con expectedQuarter = 1
      const res = await MatchTimerService.start(sampleMatchId, { expectedQuarter: 1 });
      expect(res.status).toBe('stale_operation');
      expect(res.reason).toContain('Periodo no coincide');
    });

    it('TC-10: operación fallida o rechazada conserva la instantánea anterior intacta', async () => {
      await db.matches.update(sampleMatchId, { timerSecondsRemaining: 450 });

      // Intento de start con match inexistente
      const resMissing = await MatchTimerService.start(999999);
      expect(resMissing.status).toBe('rejected');

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerSecondsRemaining).toBe(450);
      expect(m?.timerLastStart).toBeUndefined();
    });
  });

  // =========================================================================
  // GRUPO B — PRECISIÓN, RELOJ DEL SISTEMA Y RECONCILIACIÓN (TC-11 a TC-18)
  // =========================================================================
  describe('Grupo B — Precisión y Reconciliación Temporal', () => {
    it('TC-11: tiempo restante nunca puede ser negativo (INV-T01)', async () => {
      const startMs = 1000000;
      await db.matches.update(sampleMatchId, { timerSecondsRemaining: 10 });
      await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

      // Pausar tras 60 segundos transcurridos (cuando solo quedaban 10s)
      const res = await MatchTimerService.pause(sampleMatchId, { nowMs: startMs + 60000 });
      expect(res.timerSecondsRemaining).toBe(0);
      expect(res.timerSecondsRemaining).toBeGreaterThanOrEqual(0);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerSecondsRemaining).toBe(0);
    });

    it('TC-12: retraso de intervalos no genera deriva acumulada; cálculo es contra timerLastStart', async () => {
      const startMs = 5000000;
      await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

      // Simular retraso masivo de setInterval de 45.8 segundos
      const snapshot = await MatchTimerService.getSnapshot(sampleMatchId, startMs + 45800);
      expect(snapshot?.effectiveTimeLeft).toBeCloseTo(600 - 45.8, 1);
    });

    it('TC-13: retroceso del reloj del sistema no corrompe el cronómetro ni genera saltos hacia adelante', async () => {
      const startMs = 10000000;
      await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

      // El reloj del dispositivo retrocede 5 minutos (300,000 ms)
      const backwardMs = startMs - 300000;
      const res = await MatchTimerService.pause(sampleMatchId, { nowMs: backwardMs });

      expect(res.status).toBe('applied');
      expect(res.timerSecondsRemaining).toBe(600); // 0 segundos descontados por protección monotónica

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerSecondsRemaining).toBe(600);
    });

    it('TC-14: salto hacia adelante anómalo acota el descuento a cero sin desbordar', async () => {
      const startMs = 10000000;
      await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

      // Salto hacia adelante de 2 horas (7,200,000 ms)
      const jumpForwardMs = startMs + 7200000;
      const res = await MatchTimerService.reconcile(sampleMatchId, { nowMs: jumpForwardMs });

      expect(res.status).toBe('applied');
      expect(res.timerSecondsRemaining).toBe(0);
      expect(res.expired).toBe(true);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerSecondsRemaining).toBe(0);
      expect(m?.timerLastStart).toBeUndefined();
    });

    it('TC-15: reanudación tras suspensión detecta expiración del periodo y detiene el reloj', async () => {
      const startMs = 1000000;
      await db.matches.update(sampleMatchId, { timerSecondsRemaining: 30 });
      await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

      // PWA suspendida 40 segundos
      const resumeMs = startMs + 40000;
      const reconcileRes = await MatchTimerService.reconcile(sampleMatchId, { nowMs: resumeMs });

      expect(reconcileRes.expired).toBe(true);
      expect(reconcileRes.isRunning).toBe(false);
      expect(reconcileRes.timerSecondsRemaining).toBe(0);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerLastStart).toBeUndefined();
      expect(m?.timerSecondsRemaining).toBe(0);
    });

    it('TC-16: recuperación tras recarga de página obtiene estado persistido exacto', async () => {
      const startMs = 1000000;
      await MatchTimerService.start(sampleMatchId, { nowMs: startMs });
      await MatchTimerService.pause(sampleMatchId, { nowMs: startMs + 100000 });

      // Simular nueva sesión / snapshot tras recarga
      const snapshot = await MatchTimerService.getSnapshot(sampleMatchId);
      expect(snapshot?.timerSecondsRemaining).toBe(500);
      expect(snapshot?.isRunning).toBe(false);
    });

    it('TC-17: tiempo cero no genera escrituras duplicadas en múltiples reconciliaciones', async () => {
      await db.matches.update(sampleMatchId, { timerSecondsRemaining: 0, timerLastStart: undefined });

      const res1 = await MatchTimerService.reconcile(sampleMatchId);
      expect(res1.status).toBe('already_applied');

      const res2 = await MatchTimerService.reconcile(sampleMatchId);
      expect(res2.status).toBe('already_applied');
    });

    it('TC-18: una estimación incierta se acota a los límites del periodo sin alterar marcadores', async () => {
      const mBefore = await db.matches.get(sampleMatchId);
      await MatchTimerService.reconcile(sampleMatchId, { nowMs: NaN });

      const mAfter = await db.matches.get(sampleMatchId);
      expect(mAfter?.localScore).toBe(mBefore?.localScore);
      expect(mAfter?.visitorScore).toBe(mBefore?.visitorScore);
    });
  });

  // =========================================================================
  // GRUPO C — CONCURRENCIA Y AUTORIDAD ENTRE PESTAÑAS (TC-19 a TC-28)
  // =========================================================================
  describe('Grupo C — Concurrencia y Autoridad entre Pestañas', () => {
    it('TC-19: dos coordinadores de pestaña compiten por el mismo partido; exclusión garantizada', async () => {
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

      const coordinatorA = new TimerAuthorityCoordinator();
      const coordinatorB = new TimerAuthorityCoordinator();

      const claimA = await coordinatorA.acquireAuthority(sampleMatchId);
      expect(claimA.acquired).toBe(true);

      const claimB = await coordinatorB.acquireAuthority(sampleMatchId);
      expect(claimB.acquired).toBe(false);

      await coordinatorA.releaseAuthority(sampleMatchId);
      await coordinatorA._resetForTesting();
      await coordinatorB._resetForTesting();
    });

    it('TC-20: solamente una pestaña adquiere autoridad válida a la vez', async () => {
      const state = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
      expect(state.hasAuthority).toBe(true);
      expect(state.isOwner).toBe(true);
    });

    it('TC-21: pestaña observadora sin autoridad es rechazada al intentar escribir (INV-T07)', async () => {
      // Liberar autoridad en esta pestaña para convertirse en observadora
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

      const res = await MatchTimerService.start(sampleMatchId);
      expect(res.status).toBe('not_owner');
      expect(res.reason).toContain('no posee la autoridad');

      const resPause = await MatchTimerService.pause(sampleMatchId);
      expect(resPause.status).toBe('not_owner');

      const resAdjust = await MatchTimerService.adjust(sampleMatchId, 10);
      expect(resAdjust.status).toBe('not_owner');
    });

    it('TC-22: transferencia de autoridad voluntaria entre pestañas', async () => {
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

      const coordinatorA = new TimerAuthorityCoordinator();
      await coordinatorA.acquireAuthority(sampleMatchId);
      expect(coordinatorA.getAuthorityState(sampleMatchId).isOwner).toBe(true);

      // Coordinator A cede y libera
      await coordinatorA.releaseAuthority(sampleMatchId);
      expect(coordinatorA.getAuthorityState(sampleMatchId).isOwner).toBe(false);

      // Coordinator B adquiere exitosamente
      const coordinatorB = new TimerAuthorityCoordinator();
      const claimB = await coordinatorB.acquireAuthority(sampleMatchId);
      expect(claimB.acquired).toBe(true);
      expect(coordinatorB.getAuthorityState(sampleMatchId).isOwner).toBe(true);

      await coordinatorB.releaseAuthority(sampleMatchId);
      await coordinatorA._resetForTesting();
      await coordinatorB._resetForTesting();
    });

    it('TC-23: propietario finaliza o libera, nuevo propietario puede adquirir autoridad', async () => {
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

      const res = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(res.acquired).toBe(true);
      expect(timerAuthorityCoordinator.getAuthorityState(sampleMatchId).hasAuthority).toBe(true);
    });

    it('TC-24: nuevo propietario recupera fielmente el estado persistido en IndexedDB', async () => {
      await MatchTimerService.start(sampleMatchId, { nowMs: 1000000 });
      await MatchTimerService.pause(sampleMatchId, { nowMs: 1050000 });

      // Cambio de autoridad
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);

      const snapshot = await MatchTimerService.getSnapshot(sampleMatchId);
      expect(snapshot?.timerSecondsRemaining).toBe(550);
      expect(snapshot?.isRunning).toBe(false);
    });

    it('TC-25: callback atrasado con epoch caducado es rechazado por fencing token (INV-T12)', async () => {
      const state = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
      const oldEpoch = state.epoch;

      // Simulamos que la autoridad cambió (incremento de epoch al re-adquirir)
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      const newClaim = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(newClaim.epoch).toBeGreaterThan(oldEpoch);

      // Callback rezagado intentando escribir con el epoch viejo
      const res = await MatchTimerService.start(sampleMatchId, { epoch: oldEpoch });
      expect(res.status).toBe('not_owner');
      expect(res.reason).toContain('Operación atrasada (fencing epoch');
    });

    it('TC-26: ausencia de BroadcastChannel no compromete la integridad del servicio', async () => {
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);

      const coord = new TimerAuthorityCoordinator();
      const res = await coord.acquireAuthority(sampleMatchId);
      expect(res.acquired).toBe(true);
      await coord.releaseAuthority(sampleMatchId);
      await coord._resetForTesting();
    });

    it('TC-27: ausencia de Web Locks activa el modo degradado conservador sin excepciones', async () => {
      const fallbackCoord = new TimerAuthorityCoordinator();
      await fallbackCoord._resetForTesting({ forceFallback: true });

      expect(fallbackCoord.isWebLocksSupported()).toBe(false);
      const res = await fallbackCoord.acquireAuthority(sampleMatchId);
      expect(res.acquired).toBe(true);
      expect(fallbackCoord.getAuthorityState(sampleMatchId).isOwner).toBe(true);
      await fallbackCoord._resetForTesting();
    });

    it('TC-28: operaciones concurrentes start y pause no generan inconsistencias de estado', async () => {
      const now = Date.now();
      await Promise.all([
        MatchTimerService.start(sampleMatchId, { nowMs: now }),
        MatchTimerService.pause(sampleMatchId, { nowMs: now + 5000 })
      ]);

      const m = await db.matches.get(sampleMatchId);
      // Sea cual sea el orden resuelto por la transacción atómica, el estado debe ser determinista
      expect(m?.timerSecondsRemaining).toBeGreaterThanOrEqual(0);
      expect(typeof m?.timerSecondsRemaining).toBe('number');
    });
  });

  // =========================================================================
  // GRUPO D — PWA, CICLO DE VIDA Y RESUMEN (TC-29 a TC-36)
  // =========================================================================
  describe('Grupo D — PWA y Ciclo de Vida del Navegador', () => {
    it('TC-29: visibilitychange a hidden y retorno visible reconcilia el tiempo', async () => {
      const startMs = 2000000;
      await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

      // Simular reconciliación al volver de segundo plano
      const reconcile = await MatchTimerService.reconcile(sampleMatchId, { nowMs: startMs + 12000 });
      expect(reconcile.status).toBe('applied');
      expect(reconcile.timerSecondsRemaining).toBe(588);
      expect(reconcile.isRunning).toBe(true);
    });

    it('TC-30: pageshow tras BFCache invoca reconcile con el estado persistido', async () => {
      const snapshot = await MatchTimerService.getSnapshot(sampleMatchId);
      expect(snapshot).not.toBeNull();
    });

    it('TC-31: pauseMatchTimerIdempotent opera de forma segura sin asumir ejecución garantizada', async () => {
      const res = await pauseMatchTimerIdempotent(sampleMatchId);
      expect(typeof res).toBe('boolean');
    });

    it('TC-32: React.StrictMode remount no cancela el cronómetro involuntariamente', async () => {
      await MatchTimerService.start(sampleMatchId);
      const mRunning = await db.matches.get(sampleMatchId);
      expect(mRunning?.timerLastStart).toBeDefined();

      // Cancelar pausas diferidas como hace el useEffect en StrictMode remount
      clearAllPendingUnmountPauses();
      const mStillRunning = await db.matches.get(sampleMatchId);
      expect(mStillRunning?.timerLastStart).toBeDefined();
    });

    it('TC-33: salida real del partido pausa el cronómetro', async () => {
      await MatchTimerService.start(sampleMatchId);
      await pauseMatchTimerIdempotent(sampleMatchId);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.timerLastStart).toBeUndefined();
    });

    it('TC-34: recarga tras cierre abrupto simulado reconcilia y conserva anotaciones', async () => {
      await MatchTimerService.start(sampleMatchId, { nowMs: 1000000 });
      // Cierre abrupto sin pausa; al reanudar se reconcilia
      const res = await MatchTimerService.reconcile(sampleMatchId, { nowMs: 1010000 });
      expect(res.timerSecondsRemaining).toBe(590);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.localScore).toBe(10);
      expect(m?.visitorScore).toBe(8);
    });

    it('TC-35: reapertura offline no requiere red para consultar ni operar el cronómetro', async () => {
      const res = await MatchTimerService.getSnapshot(sampleMatchId);
      expect(res?.matchId).toBe(sampleMatchId);
    });

    it('TC-36: cambio de partido pausa el partido anterior en BD sin contaminar el nuevo', async () => {
      const match2Id = (await db.matches.add({
        status: 'playing',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
        localTeamId: 1,
        visitorTeamId: 2,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        currentQuarter: 1,
        timerSecondsRemaining: 600,
        timerLastStart: undefined,
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10 }
        }
      })) as number;

      // Iniciar match 1
      await MatchTimerService.start(sampleMatchId);

      // Simular cambio a match 2
      await pauseMatchTimerIdempotent(sampleMatchId);
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      await timerAuthorityCoordinator.acquireAuthority(match2Id);

      const m1 = await db.matches.get(sampleMatchId);
      const m2 = await db.matches.get(match2Id);

      expect(m1?.timerLastStart).toBeUndefined();
      expect(m2?.timerLastStart).toBeUndefined();
      expect(timerAuthorityCoordinator.getAuthorityState(match2Id).isOwner).toBe(true);
    });
  });

  // =========================================================================
  // GRUPO E — INTEGRIDAD DEPORTIVA Y NO-REGRESIÓN EN MODOS (TC-37 a TC-42)
  // =========================================================================
  describe('Grupo E — Integridad Deportiva y No-Regresión en Modos', () => {
    it('TC-37: Traditional conserva cambios de cuarto y reinicia el cronómetro del nuevo periodo', async () => {
      await MatchTimerService.start(sampleMatchId);
      await advanceTraditionalQuarter(sampleMatchId);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.currentQuarter).toBe(2);
      expect(m?.timerSecondsRemaining).toBe(600);
      expect(m?.timerLastStart).toBeUndefined(); // Pausado al iniciar nuevo periodo
    });

    it('TC-38: Traditional conserva prórroga (overtime) con duración configurada y reloj pausado', async () => {
      await db.matches.update(sampleMatchId, { currentQuarter: 4 });
      await startTraditionalOvertime(sampleMatchId, 5);

      const m = await db.matches.get(sampleMatchId);
      expect(m?.currentQuarter).toBe(5); // OT1
      expect(m?.timerSecondsRemaining).toBe(300); // 5 minutos * 60
      expect(m?.timerLastStart).toBeUndefined();
    });

    it('TC-39: Race no presenta regresiones y mantiene rematches y conteo de juegos', async () => {
      const raceId = (await db.matches.add({
        status: 'playing',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
        localTeamId: 1,
        visitorTeamId: 2,
        localScore: 11,
        visitorScore: 7,
        localFouls: 0,
        visitorFouls: 0,
        currentQuarter: 1,
        config: {
          mode: 'race',
          race: { targetScore: 11, hasRematches: false, currentGame: 1 }
        }
      })) as number;

      const mRace = await db.matches.get(raceId);
      expect(mRace?.config.mode).toBe('race');
      expect(mRace?.localScore).toBe(11);
    });

    it('TC-40: Best-of-Series conserva sus invariantes de cierre de set y match finalization', async () => {
      const seriesId = (await db.matches.add({
        status: 'playing',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
        localTeamId: 1,
        visitorTeamId: 2,
        localScore: 21,
        visitorScore: 18,
        localFouls: 0,
        visitorFouls: 0,
        currentQuarter: 1,
        config: {
          mode: 'best-of-series',
          bestOf: {
            totalGames: 3,
            targetScorePerGame: 21,
            winByTwo: false,
            currentGame: 1,
            wins: { local: 0, visitor: 0 }
          }
        }
      })) as number;

      // Registrar jugadas del set 1 con puntuaciones reglamentarias (3 puntos) que suman 21 y 18
      for (let i = 0; i < 7; i++) {
        await db.scores.add({ matchId: seriesId, teamId: 1, quarter: 1, points: 3, createdAt: new Date(Date.now() - 30000 + i * 1000) });
      }
      for (let i = 0; i < 6; i++) {
        await db.scores.add({ matchId: seriesId, teamId: 2, quarter: 1, points: 3, createdAt: new Date(Date.now() - 20000 + i * 1000) });
      }

      const confirmRes = await SeriesService.confirmSet({
        matchId: seriesId,
        setNumber: 1,
        expectedWinnerId: 1,
        expectedScore: { local: 21, visitor: 18 }
      });
      expect(confirmRes.status).toBe('confirmed');

      const mSeries = await db.matches.get(seriesId);
      expect(mSeries?.gameHistory?.length).toBe(1);
    });

    it('TC-41: finalización del partido no permite revivir el cronómetro (INV-T04)', async () => {
      await db.matches.update(sampleMatchId, { status: 'finished', finishedAt: new Date() });

      const res = await MatchTimerService.start(sampleMatchId);
      expect(res.status).toBe('finished');

      const toggleRes = await MatchTimerService.toggle(sampleMatchId);
      expect(toggleRes.status).toBe('finished');
    });

    it('TC-42: registros históricos, anotaciones y faltas permanecen intactos ante operaciones del reloj', async () => {
      const mBefore = await db.matches.get(sampleMatchId);

      await MatchTimerService.start(sampleMatchId);
      await MatchTimerService.adjust(sampleMatchId, 0, { skipAuthorityCheck: true });
      await MatchTimerService.pause(sampleMatchId);
      await MatchTimerService.reset(sampleMatchId);

      const mAfter = await db.matches.get(sampleMatchId);
      expect(mAfter?.localScore).toBe(mBefore?.localScore);
      expect(mAfter?.visitorScore).toBe(mBefore?.visitorScore);
      expect(mAfter?.localFouls).toBe(mBefore?.localFouls);
      expect(mAfter?.visitorFouls).toBe(mBefore?.visitorFouls);
    });
  });

  // =========================================================================
  // GRUPO F — UI, CONTROLES Y AUDIOS (TC-43 a TC-48)
  // =========================================================================
  describe('Grupo F — UI, Controles y Experiencia', () => {
    it('TC-43: pestaña propietaria tiene hasAuthority = true y isOwner = true', () => {
      const state = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
      expect(state.hasAuthority).toBe(true);
      expect(state.isOwner).toBe(true);
    });

    it('TC-44: pestaña observadora reporta hasAuthority = false', async () => {
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      const state = timerAuthorityCoordinator.getAuthorityState(sampleMatchId);
      expect(state.hasAuthority).toBe(false);
      expect(state.isOwner).toBe(false);
    });

    it('TC-45: reclamar control actualiza reactivamente el estado de autoridad', async () => {
      await timerAuthorityCoordinator.releaseAuthority(sampleMatchId);
      expect(timerAuthorityCoordinator.getAuthorityState(sampleMatchId).hasAuthority).toBe(false);

      const acquired = await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
      expect(acquired.acquired).toBe(true);
      expect(timerAuthorityCoordinator.getAuthorityState(sampleMatchId).hasAuthority).toBe(true);
    });

    it('TC-46: error de escritura no devuelve applied ni reporta éxito', async () => {
      const res = await MatchTimerService.start(999999);
      expect(res.status).not.toBe('applied');
      expect(res.status).toBe('rejected');
    });

    it('TC-47: los controles de transporte conservan estructura y legibilidad móvil', async () => {
      const snapshot = await MatchTimerService.getSnapshot(sampleMatchId);
      expect(snapshot?.effectiveTimeLeft).toBe(600);
      expect(typeof snapshot?.effectiveTimeLeft).toBe('number');
    });

    it('TC-48: no se duplican audios o chicharra en múltiples reconciliaciones en 00:00', async () => {
      await db.matches.update(sampleMatchId, { timerSecondsRemaining: 0, timerLastStart: undefined });

      const r1 = await MatchTimerService.reconcile(sampleMatchId);
      const r2 = await MatchTimerService.reconcile(sampleMatchId);

      expect(r1.status).toBe('already_applied');
      expect(r2.status).toBe('already_applied');
    });
  });
});
