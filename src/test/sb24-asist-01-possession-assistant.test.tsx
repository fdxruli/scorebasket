// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../db/db';
import { MatchTimerService } from '../db/matchTimer.service';
import { MatchesRepository } from '../db/matches.repository';
import { GameActionsRepository } from '../db/gameActions.repository';
import { timerAuthorityCoordinator } from '../services/timerAuthority.coordinator';
import { clearAllPendingUnmountPauses } from '../hooks/useMatchTimer';
import { LiveMatchProvider } from '../features/match-creations/components/context/LiveMatchContext';
import { TraditionalEngine } from '../features/match-creations/components/engines/TraditionalEngine';
import { LocalBackupService } from '../db/localBackup.service';
import * as soundEffects from '../utils/soundEffects';
import * as haptics from '../utils/haptics';

describe('ASIST-01: Asistente automático de posesión y reloj de ataque', () => {
  let localTeamId: number;
  let visitorTeamId: number;
  let sampleMatchId: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(soundEffects, 'unlockAudioContext').mockImplementation(() => {});
    vi.spyOn(soundEffects, 'playBuzzer').mockImplementation(() => {});
    vi.spyOn(soundEffects, 'playWhistle').mockImplementation(() => {});
    vi.spyOn(soundEffects, 'playScorePop').mockImplementation(() => {});
    vi.spyOn(haptics, 'triggerHaptic').mockImplementation(() => {});
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
          traditional: {
            totalQuarters: 4,
            minutesPerQuarter: 10,
            timeoutsPerTeam: 3,
            shotClockEnabled: true,
            possessionAssistantEnabled: true
          }
        },
        currentQuarter: 1,
        timerSecondsRemaining: 300,
        timerLastStart: undefined,
        shotClock: {
          enabled: true,
          secondsRemaining: 24,
          lastStart: undefined
        },
        possessionAssistant: {
          enabled: true,
          hapticsEnabled: true
        },
        possession: null,
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
  // 1. CONFIGURACIÓN POR DEFECTO DESACTIVADA Y PARTIDOS LEGACY
  // =========================================================================
  it('1. Configuración por defecto desactivada y compatibilidad con partidos legacy', async () => {
    // A. Partido creado sin asistente
    const defaultMatchId = await MatchesRepository.create({
      localTeamId,
      visitorTeamId,
      config: {
        mode: 'traditional',
        traditional: {
          totalQuarters: 4,
          minutesPerQuarter: 10,
          timeoutsPerTeam: 3
        }
      }
    });

    const defaultMatch = await db.matches.get(defaultMatchId);
    expect(defaultMatch?.shotClock?.enabled).toBeFalsy();
    expect(defaultMatch?.possessionAssistant?.enabled).toBeFalsy();

    // B. Partido legacy sin campos de shotClock ni possessionAssistant
    const legacyMatchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10 }
        },
        currentQuarter: 1,
        timerSecondsRemaining: 600,
        localScore: 10,
        visitorScore: 8,
        localFouls: 1,
        visitorFouls: 2
      })
    );

    const legacyMatch = await db.matches.get(legacyMatchId);
    expect(legacyMatch?.possessionAssistant).toBeUndefined();
    expect(legacyMatch?.shotClock).toBeUndefined();
  });

  // =========================================================================
  // 2. ACTIVACIÓN Y DESACTIVACIÓN DURANTE EL PARTIDO
  // =========================================================================
  it('2. Activación y desactivación durante el partido: bloqueada con reloj en marcha y requiere reloj de posesión', async () => {
    // Match con reloj apagado
    const matchWithoutShot = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
        config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10 } },
        currentQuarter: 1,
        timerSecondsRemaining: 600,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0
      })
    );
    await timerAuthorityCoordinator.acquireAuthority(matchWithoutShot);

    // Intentar activar asistente sin reloj de posesión -> rechazado
    const resNoShot = await MatchTimerService.setPossessionAssistantEnabled(matchWithoutShot, true);
    expect(resNoShot.status).toBe('rejected');
    expect(resNoShot.reason).toContain('reloj de posesión');

    // Activar reloj de posesión primero
    await MatchTimerService.setShotClockEnabled(matchWithoutShot, true);

    // Ahora activar asistente -> applied
    const resEnable = await MatchTimerService.setPossessionAssistantEnabled(matchWithoutShot, true);
    expect(resEnable.status).toBe('applied');
    expect(resEnable.enabled).toBe(true);

    const matchUpdated = await db.matches.get(matchWithoutShot);
    expect(matchUpdated?.possessionAssistant?.enabled).toBe(true);

    // Con reloj en marcha, no permite cambiar modo
    await MatchTimerService.start(matchWithoutShot);
    const resRunning = await MatchTimerService.setPossessionAssistantEnabled(matchWithoutShot, false);
    expect(resRunning.status).toBe('rejected');
    expect(resRunning.reason).toContain('detenido');

    // Pausar y desactivar asistente -> applied
    await MatchTimerService.pause(matchWithoutShot);
    const resDisable = await MatchTimerService.setPossessionAssistantEnabled(matchWithoutShot, false);
    expect(resDisable.status).toBe('applied');
    expect(resDisable.enabled).toBe(false);
  });

  // =========================================================================
  // 3. SELECCIÓN INICIAL DE POSESIÓN
  // =========================================================================
  it('3. Selección inicial de posesión: muestra prompt al iniciar si posesión es null y asigna al tocar equipo', async () => {
    const { unmount } = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={sampleMatchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    // A. El control muestra el aviso de selección inicial
    await waitFor(() => {
      expect(screen.getByTestId('possession-prompt')).toBeTruthy();
      expect(screen.getByTestId('possession-prompt').textContent).toContain('¿Quién tiene el balón?');
    });

    // B. Al tocar el botón del equipo local, se asigna la posesión a local y desaparece el aviso
    const localBtn = screen.getByTestId('btn-possession-local');
    await act(async () => {
      fireEvent.click(localBtn);
    });

    await waitFor(async () => {
      const m = await db.matches.get(sampleMatchId);
      expect(m?.possession).toBe('local');
      expect(screen.queryByTestId('possession-prompt')).toBeNull();
    });

    unmount();
  });

  // =========================================================================
  // 4. CANASTA DE CAMPO AUTOMÁTICA (+2 / +3): PUNTOS, CAMBIO DE POSESIÓN Y 24S
  // =========================================================================
  it('4. Canasta de campo automática (+2): guarda anotación, pasa posesión a visitante y prepara reloj en 24s', async () => {
    // Fijar posesión inicial en Local
    await db.matches.update(sampleMatchId, { possession: 'local' });

    const { unmount } = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={sampleMatchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('score-btn-local-2')).toBeTruthy();
    });

    // Registrar +2 para Local
    const scoreBtn = screen.getByTestId('score-btn-local-2');
    await act(async () => {
      fireEvent.click(scoreBtn);
    });

    await waitFor(async () => {
      const m = await db.matches.get(sampleMatchId);
      expect(m?.localScore).toBe(2);
      expect(m?.visitorScore).toBe(0);
      expect(m?.possession).toBe('visitor');
      expect(m?.shotClock?.secondsRemaining).toBe(24);
    });

    // Verificar en db.scores
    const scores = await db.scores.where('matchId').equals(sampleMatchId).toArray();
    expect(scores).toHaveLength(1);
    expect(scores[0].points).toBe(2);
    expect(scores[0].teamId).toBe(localTeamId);

    unmount();
  });

  // =========================================================================
  // 5. TIRO LIBRE (+1): SIN CAMBIO AUTOMÁTICO DE POSESIÓN NI RELOJ
  // =========================================================================
  it('5. Tiro libre (+1): registra el punto conservando la posesión y el reloj de tiro intactos', async () => {
    // Posesión en Local, reloj en 16s
    await db.matches.update(sampleMatchId, {
      possession: 'local',
      shotClock: { enabled: true, secondsRemaining: 16, lastStart: undefined }
    });

    const { unmount } = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={sampleMatchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('score-btn-local-1')).toBeTruthy();
    });

    // Registrar +1 para Local
    const scoreBtn = screen.getByTestId('score-btn-local-1');
    await act(async () => {
      fireEvent.click(scoreBtn);
    });

    await waitFor(async () => {
      const m = await db.matches.get(sampleMatchId);
      expect(m?.localScore).toBe(1);
      // Posesión NO debe haber cambiado
      expect(m?.possession).toBe('local');
      // Reloj de posesión NO debe haber sido reiniciado a 24
      expect(m?.shotClock?.secondsRemaining).toBe(16);
    });

    unmount();
  });

  // =========================================================================
  // 6. ACCIÓN RÁPIDA: CAMBIO / ROBO
  // =========================================================================
  it('6. Cambio / Robo: cambia posesión al rival, reinicia a 24s y permite robos consecutivos legítimos', async () => {
    // Posesión en Visitante, 9 segundos restantes
    await db.matches.update(sampleMatchId, {
      possession: 'visitor',
      shotClock: { enabled: true, secondsRemaining: 9, lastStart: undefined }
    });

    const { unmount } = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={sampleMatchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('btn-turnover')).toBeTruthy();
    });

    // 1er Robo: pasa a Local y reinicia a 24s
    const turnoverBtn = screen.getByTestId('btn-turnover');
    await act(async () => {
      fireEvent.click(turnoverBtn);
    });

    await waitFor(async () => {
      const m = await db.matches.get(sampleMatchId);
      expect(m?.possession).toBe('local');
      expect(m?.shotClock?.secondsRemaining).toBe(24);
    });

    // 2do Robo consecutivo legítimo: pasa a Visitante y reinicia a 24s
    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-turnover'));
    });

    await waitFor(async () => {
      const m2 = await db.matches.get(sampleMatchId);
      expect(m2?.possession).toBe('visitor');
      expect(m2?.shotClock?.secondsRemaining).toBe(24);
    });

    unmount();
  });

  // =========================================================================
  // 7. REINICIO A 14S (REBOTE OFENSIVO): SIN MODIFICAR POSESIÓN
  // =========================================================================
  it('7. Rebote ofensivo: el botón de 14s reinicia a 14 sin alterar la posesión del equipo', async () => {
    await db.matches.update(sampleMatchId, {
      possession: 'local',
      shotClock: { enabled: true, secondsRemaining: 5, lastStart: undefined }
    });

    const { unmount } = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={sampleMatchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('btn-shot-14')).toBeTruthy();
    });

    const btn14 = screen.getByTestId('btn-shot-14');
    await act(async () => {
      fireEvent.click(btn14);
    });

    await waitFor(async () => {
      const m = await db.matches.get(sampleMatchId);
      expect(m?.possession).toBe('local');
      expect(m?.shotClock?.secondsRemaining).toBe(14);
    });

    unmount();
  });

  // =========================================================================
  // 8. FALTAS: SIN CAMBIOS ARBITRARIOS DE POSESIÓN NI RELOJ
  // =========================================================================
  it('8. Faltas: registrar una falta no altera la posesión ni el reloj de tiro automáticamente', async () => {
    await db.matches.update(sampleMatchId, {
      possession: 'visitor',
      shotClock: { enabled: true, secondsRemaining: 18, lastStart: undefined }
    });

    const { unmount } = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={sampleMatchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('foul-btn-local')).toBeTruthy();
    });

    const foulBtn = screen.getByTestId('foul-btn-local');
    await act(async () => {
      fireEvent.click(foulBtn);
    });

    await waitFor(async () => {
      const m = await db.matches.get(sampleMatchId);
      expect(m?.localFouls).toBe(1);
      // Posesión y reloj intactos
      expect(m?.possession).toBe('visitor');
      expect(m?.shotClock?.secondsRemaining).toBe(18);
    });

    unmount();
  });

  // =========================================================================
  // 9. AUTORIDAD Y FENCING: PESTAÑA OBSERVADORA RECHAZADA SIN ESCRITURA PARCIAL
  // =========================================================================
  it('9. Protección de autoridad: rechaza operaciones automáticas desde pestañas no propietarias sin escrituras parciales', async () => {
    await db.matches.update(sampleMatchId, {
      possession: 'local',
      localScore: 10,
      shotClock: { enabled: true, secondsRemaining: 15, lastStart: undefined }
    });

    // Simular llamada con autoridad inválida / observador (epoch diferente o tab distinta)
    const result = await MatchTimerService.recordFieldGoalWithAssistant(
      sampleMatchId,
      { scoringTeamId: localTeamId, points: 2 },
      { epoch: 9999, tabId: 'observer-tab-fake' }
    );

    expect(result.status).toBe('not_owner');

    // Verificar en BD que NO hubo escrituras parciales
    const m = await db.matches.get(sampleMatchId);
    expect(m?.localScore).toBe(10);
    expect(m?.possession).toBe('local');
    expect(m?.shotClock?.secondsRemaining).toBe(15);

    const scores = await db.scores.where('matchId').equals(sampleMatchId).toArray();
    expect(scores).toHaveLength(0);
  });

  // =========================================================================
  // 10. DESHACER (UNDO): REVERSIÓN COHERENTE O PRESERVACIÓN CON AVISO
  // =========================================================================
  it('10. Deshacer: revierte la anotación atómicamente y restaura la posesión si el estado previo está intacto', async () => {
    await db.matches.update(sampleMatchId, { possession: 'local' });

    // Anotar canasta de 2
    const res = await MatchTimerService.recordFieldGoalWithAssistant(
      sampleMatchId,
      { scoringTeamId: localTeamId, points: 2 }
    );
    expect(res.status).toBe('applied');

    let m = await db.matches.get(sampleMatchId);
    expect(m?.localScore).toBe(2);
    expect(m?.possession).toBe('visitor');

    // Deshacer inmediatamente mientras sigue pausado y a 24s
    const undoRes = await GameActionsRepository.undoLastAction(sampleMatchId, 1);
    expect(undoRes.success).toBe(true);

    m = await db.matches.get(sampleMatchId);
    expect(m?.localScore).toBe(0);
    // Debe haber restaurado la posesión al equipo que anotó
    expect(m?.possession).toBe('local');
  });

  // =========================================================================
  // 11. PERSISTENCIA Y RESPALDO OFFLINE
  // =========================================================================
  it('11. Persistencia y respaldo: exportación e importación preservan la configuración del asistente y estado de posesión', async () => {
    await db.matches.update(sampleMatchId, {
      possession: 'visitor',
      possessionAssistant: { enabled: true, hapticsEnabled: true },
      shotClock: { enabled: true, secondsRemaining: 19, lastStart: undefined }
    });

    const backupJson = await LocalBackupService.exportJson();
    expect(backupJson).toContain('possessionAssistant');

    await db.scores.clear();
    await db.fouls.clear();
    await db.players.clear();
    await db.matches.clear();
    await db.teams.clear();

    const restoreCounts = await LocalBackupService.restoreIntoEmpty(backupJson);
    expect(restoreCounts.matches).toBeGreaterThan(0);

    const mRestored = await db.matches.get(sampleMatchId);
    expect(mRestored?.possession).toBe('visitor');
    expect(mRestored?.possessionAssistant?.enabled).toBe(true);
    expect(mRestored?.shotClock?.enabled).toBe(true);
    expect(mRestored?.shotClock?.secondsRemaining).toBe(19);
  });
});
