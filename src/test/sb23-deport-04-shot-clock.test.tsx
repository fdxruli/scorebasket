// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../db/db';
import { MatchTimerService } from '../db/matchTimer.service';
import { timerAuthorityCoordinator } from '../services/timerAuthority.coordinator';
import { clearAllPendingUnmountPauses } from '../hooks/useMatchTimer';
import { LiveMatchProvider } from '../features/match-creations/components/context/LiveMatchContext';
import { TraditionalEngine } from '../features/match-creations/components/engines/TraditionalEngine';
import { RaceEngine } from '../features/match-creations/components/engines/RaceEngine';
import { SeriesEngine } from '../features/match-creations/components/engines/SeriesEngine';
import { LocalBackupService } from '../db/localBackup.service';
import * as soundEffects from '../utils/soundEffects';

describe('DEPORT-04: Reloj de Posesión Opcional (Shot Clock)', () => {
  let localTeamId: number;
  let visitorTeamId: number;
  let sampleMatchId: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(soundEffects, 'unlockAudioContext').mockImplementation(() => {});
    vi.spyOn(soundEffects, 'playBuzzer').mockImplementation(() => {});
    vi.spyOn(soundEffects, 'playWhistle').mockImplementation(() => {});
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    await db.delete();
    await db.open();
    clearAllPendingUnmountPauses();
    await timerAuthorityCoordinator._resetForTesting();

    localTeamId = Number(
      await db.teams.add({
        name: 'Halcones Local',
        createdAt: new Date(),
        isArchived: false
      })
    );

    visitorTeamId = Number(
      await db.teams.add({
        name: 'Tigres Visita',
        createdAt: new Date(),
        isArchived: false
      })
    );

    sampleMatchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 }
        },
        currentQuarter: 1,
        timerSecondsRemaining: 300, // 5:00
        timerLastStart: undefined, // Pausado
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0
      })
    );

    await timerAuthorityCoordinator.acquireAuthority(sampleMatchId);
  });

  afterEach(async () => {
    cleanup();
    clearAllPendingUnmountPauses();
    await timerAuthorityCoordinator._resetForTesting();
    vi.restoreAllMocks();
    await db.close();
  });

  // =========================================================================
  // 1. RECORRIDO PRINCIPAL: CASUAL INICIAL, ACTIVACIÓN, CUENTA, REINICIOS, EXPIRACIÓN
  // =========================================================================
  it('1. Recorrido principal: casual inicial oculto, activación a 24s detenido, marcha conjunta, reinicios 24 y 14, expiración a 00 con alerta única', async () => {
    const { unmount } = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={sampleMatchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    // A. Partido casual inicial: no muestra reloj de posesión
    await waitFor(() => {
      expect(screen.getByTestId('btn-toggle-shot-clock')).toBeTruthy();
    });
    expect(screen.queryByTestId('shot-clock-bar')).toBeNull();

    // B. Activación: mientras está pausado, activar reloj de posesión
    const toggleBtn = screen.getByTestId('btn-toggle-shot-clock');
    await act(async () => {
      fireEvent.click(toggleBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('shot-clock-bar')).toBeTruthy();
      expect(screen.getByTestId('shot-clock-digits').textContent).toContain('24');
    });

    // C. El reloj de posesión permanece detenido hasta iniciar el principal
    const display = screen.getByTestId('shot-clock-display');
    expect(display.className).toContain('is-paused');

    // D. Iniciar cronómetro principal: ambos descuentan coordinadamente
    const playBtn = screen.getByRole('button', { name: /^Iniciar/i });
    await act(async () => {
      fireEvent.click(playBtn);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Pausar/i })).toBeTruthy();
    });

    // E. Proyección con paso del tiempo
    const matchRunning = await db.matches.get(sampleMatchId);
    expect(matchRunning?.timerLastStart).toBeDefined();
    expect(matchRunning?.shotClock?.lastStart).toBeDefined();

    // Proyección a 5 segundos de juego
    const nowMs = matchRunning!.timerLastStart!.getTime() + 5000;
    const mainProj = MatchTimerService.projectTime(matchRunning, nowMs);
    const shotProj = MatchTimerService.projectShotClock(matchRunning, nowMs);
    expect(mainProj.timeLeft).toBeCloseTo(295, 0.5);
    expect(shotProj.timeLeft).toBeCloseTo(19, 0.5);
    expect(shotProj.isRunning).toBe(true);

    // F. Reinicio a 24 segundos en marcha
    const btn24 = screen.getByTestId('btn-shot-24');
    await act(async () => {
      fireEvent.click(btn24);
    });

    await waitFor(async () => {
      const mAfter24 = await db.matches.get(sampleMatchId);
      expect(mAfter24?.shotClock?.secondsRemaining).toBe(24);
      expect(mAfter24?.shotClock?.lastStart).toBeDefined();
    });

    // G. Reinicio a 14 segundos en marcha
    const btn14 = screen.getByTestId('btn-shot-14');
    await act(async () => {
      fireEvent.click(btn14);
    });

    await waitFor(async () => {
      const mAfter14 = await db.matches.get(sampleMatchId);
      expect(mAfter14?.shotClock?.secondsRemaining).toBe(14);
      expect(mAfter14?.shotClock?.lastStart).toBeDefined();
    });

    // H. Pausa conjunta: conserva los tiempos restantes
    const pauseBtn = screen.getByRole('button', { name: /Pausar/i });
    await act(async () => {
      fireEvent.click(pauseBtn);
    });

    await waitFor(async () => {
      const mPaused = await db.matches.get(sampleMatchId);
      expect(mPaused?.timerLastStart).toBeUndefined();
      expect(mPaused?.shotClock?.lastStart).toBeUndefined();
      expect(mPaused?.shotClock?.secondsRemaining).toBeLessThanOrEqual(14);
    });

    unmount();
  });

  // =========================================================================
  // 2. ACTIVACIÓN SEGURA: BLOQUEADA CON RELOJ EN MARCHA
  // =========================================================================
  it('2. Activación segura: impide activar o desactivar posesión si el reloj principal está en marcha', async () => {
    // Iniciar reloj principal
    await MatchTimerService.start(sampleMatchId);

    // Intentar activar con reloj en marcha vía servicio
    const res = await MatchTimerService.setShotClockEnabled(sampleMatchId, true);
    expect(res.status).toBe('rejected');
    expect(res.reason).toContain('detenido');

    // Verificar en BD que no se alteró
    const m = await db.matches.get(sampleMatchId);
    expect(m?.shotClock?.enabled).toBeFalsy();
  });

  // =========================================================================
  // 3. EXPIRACIÓN A 00 Y ALERTA ÚNICA SIN ALTERAR RESULTADOS DEPORTIVOS
  // =========================================================================
  it('3. Expiración a 00: emite alerta sonora una sola vez, muestra 00, detiene la posesión y mantiene cronómetro principal y marcador intactos', async () => {
    // Activar posesión
    await MatchTimerService.setShotClockEnabled(sampleMatchId, true);

    // Iniciar cronómetro principal
    const startMs = 1000000;
    await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

    // Posesión llega a 24 segundos (expiración)
    const expireMs = startMs + 24500; // 24.5 segundos transcurridos
    const matchBeforeExpire = await db.matches.get(sampleMatchId);
    const shotProj = MatchTimerService.projectShotClock(matchBeforeExpire, expireMs);
    expect(shotProj.expired).toBe(true);
    expect(shotProj.timeLeft).toBe(0);

    // Ejecutar expiración transaccional
    const expireRes = await MatchTimerService.expireShotClock(sampleMatchId, { nowMs: expireMs });
    expect(expireRes.status).toBe('applied');

    const mExpired = await db.matches.get(sampleMatchId);
    expect(mExpired?.shotClock?.secondsRemaining).toBe(0);
    expect(mExpired?.shotClock?.lastStart).toBeUndefined();
    // Cronómetro principal sigue corriendo y marcador no cambió
    expect(mExpired?.timerLastStart).toBeDefined();
    expect(mExpired?.localScore).toBe(0);
    expect(mExpired?.visitorScore).toBe(0);
    expect(mExpired?.localFouls).toBe(0);

    // Reanudar posesión a 24 segundos en marcha
    const resetRes = await MatchTimerService.resetShotClock(sampleMatchId, 24, { nowMs: expireMs + 1000 });
    expect(resetRes.status).toBe('applied');
    expect(resetRes.isRunning).toBe(true);
    expect(resetRes.shotClockSecondsRemaining).toBe(24);
  });

  // =========================================================================
  // 4. CAMBIO DE PERIODO Y TIEMPO EXTRA: PREPARA 24s DETENIDO
  // =========================================================================
  it('4. Cambios de periodo: avanzar de cuarto o iniciar tiempo extra prepara nueva posesión de 24s detenida', async () => {
    await MatchTimerService.setShotClockEnabled(sampleMatchId, true);
    await MatchTimerService.start(sampleMatchId, { nowMs: 1000000 });

    // Avanzar de cuarto mientras estaba corriendo
    await MatchTimerService.advanceQuarter(sampleMatchId, { expectedQuarter: 1 });

    const mQ2 = await db.matches.get(sampleMatchId);
    expect(mQ2?.currentQuarter).toBe(2);
    expect(mQ2?.shotClock?.enabled).toBe(true);
    expect(mQ2?.shotClock?.secondsRemaining).toBe(24);
    expect(mQ2?.shotClock?.lastStart).toBeUndefined(); // Detenida
    expect(mQ2?.timerLastStart).toBeUndefined(); // Detenido

    // Iniciar OT
    await MatchTimerService.startOvertime(sampleMatchId, 5);

    const mOT = await db.matches.get(sampleMatchId);
    expect(mOT?.shotClock?.enabled).toBe(true);
    expect(mOT?.shotClock?.secondsRemaining).toBe(24);
    expect(mOT?.shotClock?.lastStart).toBeUndefined();
  });

  // =========================================================================
  // 5. FIN DEL PARTIDO: DETIENE POSESIÓN Y RECHAZA NUEVOS REINICIOS
  // =========================================================================
  it('5. Fin de partido: detiene ambos relojes y rechaza reinicios de posesión posteriores', async () => {
    await MatchTimerService.setShotClockEnabled(sampleMatchId, true);
    await MatchTimerService.start(sampleMatchId);

    // Finalizar partido
    await MatchTimerService.endMatch(sampleMatchId);

    const mFinished = await db.matches.get(sampleMatchId);
    expect(mFinished?.status).toBe('finished');
    expect(mFinished?.timerLastStart).toBeUndefined();
    expect(mFinished?.shotClock?.lastStart).toBeUndefined();

    // Intentar reiniciar posesión en partido concluido
    const res = await MatchTimerService.resetShotClock(sampleMatchId, 24);
    expect(res.status).toBe('finished');
  });

  // =========================================================================
  // 6. AUTORIDAD Y CONCURRENCIA: OBSERVADOR RECHAZADO Y DOBLE TOQUE SEGURO
  // =========================================================================
  it('6. Autoridad y concurrencia: pestaña observadora no puede reiniciar posesión y doble toque es idempotente', async () => {
    await MatchTimerService.setShotClockEnabled(sampleMatchId, true);

    // Pestaña observadora sin autoridad
    const observerTabId = 'tab_observer_adversary';
    const failRes = await MatchTimerService.resetShotClock(sampleMatchId, 24, {
      tabId: observerTabId,
      epoch: 999
    });

    expect(failRes.status).toBe('not_owner');

    // Doble toque seguro en pestaña propietaria
    const t1 = MatchTimerService.resetShotClock(sampleMatchId, 24);
    const t2 = MatchTimerService.resetShotClock(sampleMatchId, 24);
    const [res1, res2] = await Promise.all([t1, t2]);

    expect(res1.status).toBe('applied');
    expect(res2.status).toBe('applied');

    const m = await db.matches.get(sampleMatchId);
    expect(m?.shotClock?.secondsRemaining).toBe(24);
  });

  // =========================================================================
  // 7. PERSISTENCIA, OFFLINE Y RESPALDO (BACKUP EXPORT / RESTORE)
  // =========================================================================
  it('7. Persistencia y respaldo: exportación e importación conservan estado de reloj de posesión', async () => {
    await MatchTimerService.setShotClockEnabled(sampleMatchId, true);
    await MatchTimerService.resetShotClock(sampleMatchId, 14);

    const mBefore = await db.matches.get(sampleMatchId);
    expect(mBefore?.shotClock?.secondsRemaining).toBe(14);

    // Exportar respaldo
    const backupJson = await LocalBackupService.exportJson();
    expect(backupJson).toContain('shotClock');

    // Limpiar BD por completo para permitir restoreIntoEmpty
    await Promise.all([
      db.teams.clear(),
      db.players.clear(),
      db.matches.clear(),
      db.scores.clear(),
      db.fouls.clear()
    ]);

    // Restaurar respaldo
    const restoreCounts = await LocalBackupService.restoreIntoEmpty(backupJson);
    expect(restoreCounts.matches).toBe(1);

    const mRestored = await db.matches.get(sampleMatchId);
    expect(mRestored?.shotClock?.enabled).toBe(true);
    expect(mRestored?.shotClock?.secondsRemaining).toBe(14);
    expect(mRestored?.shotClock?.lastStart).toBeUndefined(); // Limpio tras restauración
  });

  // =========================================================================
  // 8. INCERTIDUMBRE DE RELOJ: NO INVENTA SEGUNDOS EN DESFASE ANÓMALO
  // =========================================================================
  it('8. Incertidumbre temporal: si se detecta retroceso o salto anómalo, preserva tiempo restante sin inventar segundos', async () => {
    await MatchTimerService.setShotClockEnabled(sampleMatchId, true);
    const startMs = 5000000;
    await MatchTimerService.start(sampleMatchId, { nowMs: startMs });

    // Salto anómalo hacia atrás (reloj del dispositivo retrocedió)
    const backwardMs = startMs - 10000;
    const match = await db.matches.get(sampleMatchId);
    const shotProj = MatchTimerService.projectShotClock(match, backwardMs);

    // Tiempo restante se preserva en 24, no se resta ni se inventa
    expect(shotProj.timeLeft).toBe(24);
  });

  // =========================================================================
  // 9. ALCANCE ESTRICTO: RACE Y BEST-OF NO MUESTRAN NI PERMITEN RELOJ DE POSESIÓN
  // =========================================================================
  it('9. Alcance estricto: Race y Best-of-Series no muestran herramienta de reloj de posesión', async () => {
    const raceMatchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        config: { mode: 'race', race: { targetScore: 21, hasRematches: false, currentGame: 1 } },
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0
      })
    );

    const { unmount: unmountRace } = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={raceMatchId}>
          <RaceEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Halcones Local')[0]).toBeTruthy();
    });
    expect(screen.queryByTestId('btn-toggle-shot-clock')).toBeNull();
    expect(screen.queryByTestId('shot-clock-bar')).toBeNull();
    unmountRace();

    const seriesMatchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        config: {
          mode: 'best-of-series',
          bestOf: {
            totalGames: 3,
            targetScorePerGame: 15,
            currentGame: 1,
            wins: { local: 0, visitor: 0 }
          }
        },
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0
      })
    );

    const { unmount: unmountSeries } = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={seriesMatchId}>
          <SeriesEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Halcones Local')[0]).toBeTruthy();
    });
    expect(screen.queryByTestId('btn-toggle-shot-clock')).toBeNull();
    expect(screen.queryByTestId('shot-clock-bar')).toBeNull();
    unmountSeries();
  });
});
