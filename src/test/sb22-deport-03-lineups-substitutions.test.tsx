// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../db/db';
import { LineupService } from '../db/lineups.service';
import { LocalBackupService } from '../db/localBackup.service';
import { LiveMatchProvider } from '../features/match-creations/components/context/LiveMatchContext';
import { TraditionalEngine } from '../features/match-creations/components/engines/TraditionalEngine';
import { RaceEngine } from '../features/match-creations/components/engines/RaceEngine';
import { SeriesEngine } from '../features/match-creations/components/engines/SeriesEngine';
import { MatchHistoryModal } from '../components/matches/MatchHistoryModal';
import * as soundEffects from '../utils/soundEffects';
import type { Match } from '../db/models';

describe('DEPORT-03: Alineaciones y Sustituciones Opcionales (5 vs 5 Traditional)', () => {
  let localTeamId: number;
  let visitorTeamId: number;
  let localPlayerIds: number[];
  let visitorPlayerIds: number[];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(soundEffects, 'unlockAudioContext').mockImplementation(() => {});
    vi.spyOn(soundEffects, 'playScorePop').mockImplementation(() => {});
    vi.spyOn(soundEffects, 'playWhistle').mockImplementation(() => {});
    vi.spyOn(soundEffects, 'playBuzzer').mockImplementation(() => {});
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();

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

    localPlayerIds = [];
    const localLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    for (let i = 0; i < localLabels.length; i++) {
      const id = Number(
        await db.players.add({
          teamId: localTeamId,
          name: `Jugador ${localLabels[i]}`,
          number: i + 1,
          createdAt: new Date(),
          isArchived: false
        })
      );
      localPlayerIds.push(id);
    }

    visitorPlayerIds = [];
    const visitorLabels = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7'];
    for (let i = 0; i < visitorLabels.length; i++) {
      const id = Number(
        await db.players.add({
          teamId: visitorTeamId,
          name: `Visitante ${visitorLabels[i]}`,
          number: i + 11,
          createdAt: new Date(),
          isArchived: false
        })
      );
      visitorPlayerIds.push(id);
    }
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const createTraditionalMatch = async (overrides: Partial<Match> = {}) => {
    return Number(
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
        totalQuarters: 4,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        timerSecondsRemaining: 600,
        timerLastStart: undefined,
        ...overrides
      })
    );
  };

  // =========================================================================
  // 1. Recorrido Principal Completo (Sección 9: Pasos A a O + Backup)
  // =========================================================================
  it('1. Recorrido principal completo (A-O): partido casual inicial, activación 5v5, +2 a Jugador A, sustitución A->F, +3 a Jugador F, recarga, offline y acta DEPORT-02 intacta', async () => {
    const matchId = await createTraditionalMatch();
    const [playerA, playerB, playerC, playerD, playerE, playerF] = localPlayerIds;
    const [v1, v2, v3, v4, v5, v6, v7] = visitorPlayerIds;

    // A. Iniciar el partido sin activar alineaciones
    const firstRender = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    const manageBtn = await screen.findByTestId('btn-manage-lineups', {}, { timeout: 5000 });
    expect(manageBtn.getAttribute('aria-pressed')).toBe('false');

    // B. Confirmar que se puede anotar normalmente sin activar alineaciones (sin jugador asignado para dejar marcador en 0 antes del paso F, o verificar casual en otro test; aquí verificamos que el selector abre sin bloqueos y cancelamos, y en el paso F registramos +2 a Jugador A para que al paso J el marcador sea exactamente 5)
    fireEvent.click(screen.getByLabelText(/Sumar 2 puntos a Halcones Local/i));
    expect(await screen.findByText(/Toca al jugador para registrar la acción/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/^Cancelar$/i));

    // C. Activar la gestión de quintetos
    fireEvent.click(manageBtn);

    // D. Seleccionar cinco titulares por cada equipo (A, B, C, D, E en local; V1..V5 en visitante)
    for (const id of [playerA, playerB, playerC, playerD, playerE]) {
      fireEvent.click(await screen.findByTestId(`starter-option-${id}`));
    }
    for (const id of [v1, v2, v3, v4, v5]) {
      fireEvent.click(await screen.findByTestId(`starter-option-${id}`));
    }

    // E. Confirmar que quedan dos suplentes por equipo en la vista previa y al guardar
    const localPreview = await screen.findByTestId('starter-preview-local');
    expect(localPreview.textContent).toContain('EN CANCHA (5)');
    expect(localPreview.textContent).toContain('BANCA (2 suplentes)');
    expect(localPreview.textContent).toContain('Jugador F');
    expect(localPreview.textContent).toContain('Jugador G');

    const visitorPreview = await screen.findByTestId('starter-preview-visitor');
    expect(visitorPreview.textContent).toContain('EN CANCHA (5)');
    expect(visitorPreview.textContent).toContain('BANCA (2 suplentes)');

    fireEvent.click(screen.getByTestId('btn-save-lineup'));

    // Tras guardar, se muestra la vista activa con EN CANCHA (5) y BANCA (2)
    const localOnCourtSection = await screen.findByTestId('on-court-section-local', {}, { timeout: 6000 });
    const localBenchSection = await screen.findByTestId('bench-section-local', {}, { timeout: 6000 });
    expect(within(localOnCourtSection).getByText('Jugador A')).toBeTruthy();
    expect(within(localBenchSection).getByText('Jugador F')).toBeTruthy();
    expect(within(localBenchSection).getByText('Jugador G')).toBeTruthy();

    // Cerrar el modal de alineación para volver al partido
    fireEvent.click(screen.getByText(/Volver al Partido/i));

    // F. Registrar +2 al Jugador A del equipo local
    fireEvent.click(screen.getByLabelText(/Sumar 2 puntos a Halcones Local/i));
    const selectOnCourt = await screen.findByTestId('player-select-on-court');
    const selectBench = await screen.findByTestId('player-select-bench');
    expect(within(selectOnCourt).getByText('Jugador A')).toBeTruthy();
    expect(within(selectBench).getByText('Jugador F')).toBeTruthy();

    fireEvent.click(within(selectOnCourt).getByText('Jugador A'));

    await waitFor(async () => {
      const m = await db.matches.get(matchId);
      expect(m?.localScore).toBe(2);
    });

    // G. Sustituir al Jugador A por el Jugador F
    fireEvent.click(screen.getByTestId('btn-manage-lineups'));
    fireEvent.click(await screen.findByTestId(`btn-sub-out-${playerA}`));
    fireEvent.click(await screen.findByTestId(`btn-sub-in-${playerF}`));
    fireEvent.click(screen.getByTestId('btn-confirm-sub-local'));

    // H. Confirmar que Jugador A está en banca, Jugador F está en cancha, permanecen 5 en cancha, y los 2 puntos siguen en Jugador A
    await waitFor(async () => {
      const m = await db.matches.get(matchId);
      expect(m?.lineups?.localOnCourt).toEqual([playerF, playerB, playerC, playerD, playerE]);
      expect(m?.lineups?.localOnCourt).toHaveLength(5);
    });

    const updatedOnCourtSection = screen.getByTestId('on-court-section-local');
    const updatedBenchSection = screen.getByTestId('bench-section-local');
    expect(within(updatedOnCourtSection).getByText('Jugador F')).toBeTruthy();
    expect(within(updatedOnCourtSection).queryByText('Jugador A')).toBeNull();
    expect(within(updatedBenchSection).getByText('Jugador A')).toBeTruthy();
    expect(within(updatedBenchSection).getByText('2 PTS')).toBeTruthy();

    fireEvent.click(screen.getByText(/Volver al Partido/i));

    // I. Registrar +3 al Jugador F
    fireEvent.click(screen.getByLabelText(/Sumar 3 puntos a Halcones Local/i));
    const selectOnCourtAfterSub = await screen.findByTestId('player-select-on-court', {}, { timeout: 6000 });
    fireEvent.click(await within(selectOnCourtAfterSub).findByText('Jugador F', {}, { timeout: 6000 }));

    // J. Confirmar: Marcador local: 5, Jugador A: 2 puntos, Jugador F: 3 puntos
    await waitFor(async () => {
      const m = await db.matches.get(matchId);
      expect(m?.localScore).toBe(5);
    });

    const allScores = await db.scores.where('matchId').equals(matchId).toArray();
    expect(allScores).toHaveLength(2);
    const scoreA = allScores.find(s => s.playerId === playerA);
    const scoreF = allScores.find(s => s.playerId === playerF);
    expect(scoreA?.points).toBe(2);
    expect(scoreF?.points).toBe(3);

    // K & L. Recargar la aplicación y verificar que el quinteto vigente se conserva
    firstRender.unmount();

    const secondRender = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    const manageBtnAfterReload = await screen.findByTestId('btn-manage-lineups', {}, { timeout: 6000 });
    expect(manageBtnAfterReload.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(manageBtnAfterReload);

    const reloadedOnCourt = await screen.findByTestId('on-court-section-local', {}, { timeout: 6000 });
    const reloadedBench = await screen.findByTestId('bench-section-local', {}, { timeout: 6000 });
    expect(within(reloadedOnCourt).getByText('Jugador F')).toBeTruthy();
    expect(within(reloadedBench).getByText('Jugador A')).toBeTruthy();

    // M & N. Desconectar internet, realizar otra sustitución (Visitante V1 -> V6) y recargar offline
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fireEvent.click(await screen.findByTestId(`btn-sub-out-${v1}`, {}, { timeout: 6000 }));
    fireEvent.click(await screen.findByTestId(`btn-sub-in-${v6}`, {}, { timeout: 6000 }));
    fireEvent.click(screen.getByTestId('btn-confirm-sub-visitor'));

    await waitFor(async () => {
      const m = await db.matches.get(matchId);
      expect(m?.lineups?.visitorOnCourt).toEqual([v6, v2, v3, v4, v5]);
      expect(m?.lineups?.visitorOnCourt).not.toContain(v7);
    });

    secondRender.unmount();

    const thirdRender = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByTestId('btn-manage-lineups', {}, { timeout: 6000 }));
    const offlineVisitorOnCourt = await screen.findByTestId('on-court-section-visitor', {}, { timeout: 6000 });
    const offlineVisitorBench = await screen.findByTestId('bench-section-visitor', {}, { timeout: 6000 });
    expect(within(offlineVisitorOnCourt).getByText('Visitante V6')).toBeTruthy();
    expect(within(offlineVisitorBench).getByText('Visitante V1')).toBeTruthy();
    onLineSpy.mockRestore();
    thirdRender.unmount();

    // O. Abrir el acta de estadísticas (MatchHistoryModal) y comprobar que no cambió la atribución de anotaciones
    const reportRender = render(
      <MatchHistoryModal
        matchId={matchId}
        onClose={() => {}}
      />
    );

    expect(await screen.findByText('Jugador A')).toBeTruthy();
    expect(await screen.findByText('Jugador F')).toBeTruthy();
    reportRender.unmount();

    // Verificar persistencia también en exportación y restauración desde Backup Local v2
    const exportedJson = await LocalBackupService.exportJson();
    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();

    await LocalBackupService.restoreIntoEmpty(exportedJson);
    const restoredMatch = await db.matches.get(matchId);
    expect(restoredMatch?.lineups?.enabled).toBe(true);
    expect(restoredMatch?.lineups?.localOnCourt).toEqual([playerF, playerB, playerC, playerD, playerE]);
    expect(restoredMatch?.lineups?.visitorOnCourt).toEqual([v6, v2, v3, v4, v5]);
  });

  // =========================================================================
  // 2. Partido casual sin alineaciones y Traditional sin jugadores
  // =========================================================================
  it('2. Partido casual sin alineaciones: permite anotar puntos, faltas y acciones sin jugador asignado sin pasos obligatorios', async () => {
    const matchId = await createTraditionalMatch();

    render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    // Anotar +2 a Jugador B sin configurar alineaciones
    fireEvent.click(await screen.findByLabelText(/Sumar 2 puntos a Halcones Local/i));
    // En modo casual NO aparece división EN CANCHA / BANCA
    expect(screen.queryByTestId('player-select-on-court')).toBeNull();
    fireEvent.click(await screen.findByText('Jugador B'));

    await waitFor(async () => {
      expect((await db.matches.get(matchId))?.localScore).toBe(2);
    });

    // Registrar falta sin jugador asignado (Falta de Banca / Equipo)
    fireEvent.click(screen.getByLabelText(/Falta de Tigres Visita/i));
    fireEvent.click(await screen.findByText(/Falta de Banca \/ Equipo/i));

    await waitFor(async () => {
      expect((await db.matches.get(matchId))?.visitorFouls).toBe(1);
    });

    const m = await db.matches.get(matchId);
    expect(m?.lineups).toBeUndefined();
  });

  // =========================================================================
  // 3. Equipo con menos de cinco jugadores + agregar jugador con función existente
  // =========================================================================
  it('3. Equipo con menos de 5 jugadores: informa qué equipo necesita jugadores, impide activar alineación incompleta y permite completarlos usando la función existente', async () => {
    const shortLocalTeamId = Number(
      await db.teams.add({ name: 'Cortos Local', createdAt: new Date(), isArchived: false })
    );
    for (let i = 1; i <= 4; i++) {
      await db.players.add({
        teamId: shortLocalTeamId,
        name: `Corto ${i}`,
        number: i,
        createdAt: new Date(),
        isArchived: false
      });
    }

    const matchId = await createTraditionalMatch({ localTeamId: shortLocalTeamId });

    // Intentar activar por servicio con equipo incompleto debe rechazarse
    const directAttempt = await LineupService.activateLineups({
      matchId,
      localStarters: [1, 2, 3, 4, 5],
      visitorStarters: visitorPlayerIds.slice(0, 5)
    });
    expect(directAttempt.success).toBe(false);
    expect(directAttempt.error).toMatch(/Cortos Local necesita al menos 5 jugadores activos/i);

    render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByTestId('btn-manage-lineups'));

    // Informa qué equipo necesita jugadores y deshabilita el botón de guardar
    const warning = await screen.findByTestId('lineup-incomplete-warning');
    expect(warning.textContent).toMatch(/Cortos Local/i);
    expect(warning.textContent).toMatch(/4 de 5/i);

    const saveBtn = screen.getByTestId('btn-save-lineup') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Agregar el 5to jugador usando el formulario existente en el modal
    fireEvent.click(screen.getByTestId('btn-add-player-local'));
    fireEvent.change(screen.getByLabelText(/Dorsal nuevo jugador Cortos Local/i), {
      target: { value: '99' }
    });
    fireEvent.change(screen.getByLabelText(/Nombre nuevo jugador Cortos Local/i), {
      target: { value: 'Corto Cinco' }
    });
    fireEvent.click(screen.getByText('Guardar'));

    // Ahora que ambos equipos tienen >= 5 jugadores, desaparece el bloqueo y permite elegir 5 titulares
    await waitFor(() => {
      expect(screen.queryByTestId('lineup-incomplete-warning')).toBeNull();
    });

    fireEvent.click(await screen.findByTestId('btn-auto-select-starters-local'));
    fireEvent.click(await screen.findByTestId('btn-auto-select-starters-visitor'));
    fireEvent.click(screen.getByTestId('btn-save-lineup'));

    await waitFor(async () => {
      const m = await db.matches.get(matchId);
      expect(m?.lineups?.enabled).toBe(true);
      expect(m?.lineups?.localOnCourt).toHaveLength(5);
      expect(m?.lineups?.visitorOnCourt).toHaveLength(5);
    });
  });

  // =========================================================================
  // 4. Validaciones focales: duplicados, reloj corriendo, retirados, otro equipo, finalizado
  // =========================================================================
  it('4. Validaciones de seguridad: rechaza duplicados, reloj en marcha (sin alterarlo), jugador retirado, jugador de otro equipo y partido finalizado', async () => {
    const matchId = await createTraditionalMatch();
    const [p1, p2, p3, p4, p5, p6] = localPlayerIds;
    const [v1, v2, v3, v4, v5] = visitorPlayerIds;

    // 4A. Rechazar titular repetido
    const dupStarterRes = await LineupService.activateLineups({
      matchId,
      localStarters: [p1, p1, p2, p3, p4],
      visitorStarters: [v1, v2, v3, v4, v5]
    });
    expect(dupStarterRes.success).toBe(false);
    expect(dupStarterRes.error).toMatch(/repetido/i);

    // Activar alineación válida
    const activeRes = await LineupService.activateLineups({
      matchId,
      localStarters: [p1, p2, p3, p4, p5],
      visitorStarters: [v1, v2, v3, v4, v5]
    });
    expect(activeRes.success).toBe(true);

    // 4B. Rechazar sustitución con el reloj corriendo SIN modificar el reloj
    const runningStart = new Date(Date.now() - 5000);
    await db.matches.update(matchId, {
      timerLastStart: runningStart,
      timerSecondsRemaining: 580
    });

    const clockRunningSub = await LineupService.substitutePlayer({
      matchId,
      teamId: localTeamId,
      playerOutId: p1,
      playerInId: p6
    });
    expect(clockRunningSub.success).toBe(false);
    expect(clockRunningSub.error).toMatch(/reloj principal está corriendo/i);

    const matchAfterClockReject = await db.matches.get(matchId);
    expect(matchAfterClockReject?.timerLastStart?.getTime()).toBe(runningStart.getTime());
    expect(matchAfterClockReject?.timerSecondsRemaining).toBe(580);
    expect(matchAfterClockReject?.lineups?.localOnCourt).toEqual([p1, p2, p3, p4, p5]);

    // Pausar el reloj para continuar pruebas de validación
    await db.matches.update(matchId, { timerLastStart: undefined });

    // 4C. Rechazar jugador repetido (mismo que sale y entra) o jugador que ya está en cancha
    const samePlayerSub = await LineupService.substitutePlayer({
      matchId,
      teamId: localTeamId,
      playerOutId: p1,
      playerInId: p1
    });
    expect(samePlayerSub.success).toBe(false);
    expect(samePlayerSub.error).toMatch(/repetido|mismo/i);

    const alreadyOnCourtSub = await LineupService.substitutePlayer({
      matchId,
      teamId: localTeamId,
      playerOutId: p1,
      playerInId: p2
    });
    expect(alreadyOnCourtSub.success).toBe(false);
    expect(alreadyOnCourtSub.error).toMatch(/ya se encuentra en cancha/i);

    // 4D. Rechazar jugador de otro equipo
    const wrongTeamSub = await LineupService.substitutePlayer({
      matchId,
      teamId: localTeamId,
      playerOutId: p1,
      playerInId: v1
    });
    expect(wrongTeamSub.success).toBe(false);
    expect(wrongTeamSub.error).toMatch(/otro equipo/i);

    // 4E. Rechazar jugador archivado / retirado de la plantilla
    await db.players.update(p6, { isArchived: true, archivedAt: new Date() });
    const archivedPlayerSub = await LineupService.substitutePlayer({
      matchId,
      teamId: localTeamId,
      playerOutId: p1,
      playerInId: p6
    });
    expect(archivedPlayerSub.success).toBe(false);
    expect(archivedPlayerSub.error).toMatch(/retirado o archivado/i);
    await db.players.update(p6, { isArchived: false, archivedAt: undefined });

    // 4F. Rechazar sustitución en partido finalizado
    await db.matches.update(matchId, { status: 'finished' });
    const finishedSub = await LineupService.substitutePlayer({
      matchId,
      teamId: localTeamId,
      playerOutId: p1,
      playerInId: p6
    });
    expect(finishedSub.success).toBe(false);
    expect(finishedSub.error).toMatch(/partido finalizado/i);
  });

  // =========================================================================
  // 5. Concurrencia: doble toque pendiente y conflicto desde dos pestañas
  // =========================================================================
  it('5. Concurrencia: evita doble sustitución durante operación pendiente y rechaza operación obsoleta desde segunda pestaña con mensaje claro', async () => {
    const matchId = await createTraditionalMatch();
    const [p1, p2, p3, p4, p5, p6, p7] = localPlayerIds;
    const [v1, v2, v3, v4, v5] = visitorPlayerIds;

    await LineupService.activateLineups({
      matchId,
      localStarters: [p1, p2, p3, p4, p5],
      visitorStarters: [v1, v2, v3, v4, v5]
    });

    // 5A. Dos pestañas intentan sustituciones concurrentes sobre la misma versión de alineación (v1)
    const [tab1Res, tab2Res] = await Promise.all([
      LineupService.substitutePlayer({
        matchId,
        teamId: localTeamId,
        playerOutId: p1,
        playerInId: p6
      }),
      LineupService.substitutePlayer({
        matchId,
        teamId: localTeamId,
        playerOutId: p2,
        playerInId: p7
      })
    ]);

    expect(tab1Res.success).toBe(true);
    expect(tab2Res.success).toBe(false);
    expect(tab2Res.error).toMatch(/otra pestaña/i);

    const matchAfterConcurrent = await db.matches.get(matchId);
    expect(matchAfterConcurrent?.lineups?.localOnCourt).toEqual([p6, p2, p3, p4, p5]);
    expect(matchAfterConcurrent?.lineups?.version).toBe(2);

    // 5B. En UI: Pestaña B prepara un cambio sobre v2, pero Pestaña A ejecuta un cambio antes de que Pestaña B confirme
    render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByTestId('btn-manage-lineups'));

    // Pestaña B selecciona Sale p2 y Entra p7 (capturando expectedVersion = 2)
    fireEvent.click(await screen.findByTestId(`btn-sub-out-${p2}`));
    fireEvent.click(await screen.findByTestId(`btn-sub-in-${p7}`));

    // Mientras tanto, Pestaña A realiza el cambio p3 -> p1 (subiendo version a 3 en BD)
    const externalSub = await LineupService.substitutePlayer({
      matchId,
      teamId: localTeamId,
      playerOutId: p3,
      playerInId: p1,
      expectedVersion: 2
    });
    expect(externalSub.success).toBe(true);

    // Pestaña B intenta confirmar su cambio preparado sobre la alineación obsoleta (v2)
    fireEvent.click(screen.getByTestId('btn-confirm-sub-local'));

    const errorAlert = await screen.findByTestId('lineup-error');
    expect(errorAlert.textContent).toMatch(/otra pestaña/i);

    // El cambio de Pestaña A (p1 en cancha, p3 en banca) NO fue sobrescrito
    const matchAfterUiConflict = await db.matches.get(matchId);
    expect(matchAfterUiConflict?.lineups?.localOnCourt).toEqual([p6, p2, p1, p4, p5]);
    expect(matchAfterUiConflict?.lineups?.version).toBe(3);
  });

  // =========================================================================
  // 6. Modalidades Race y Best-of-Series sin cambios
  // =========================================================================
  it('6. Alcance estricto: Race y Best-of-Series no muestran gestión de quintetos ni permiten activar alineaciones', async () => {
    const raceMatchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
        config: {
          mode: 'race',
          race: { targetScore: 21, hasRematches: true, currentGame: 1, winByTwo: false, scoringSystem: 'standard' }
        },
        currentQuarter: 1,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: []
      })
    );

    const seriesMatchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
        config: {
          mode: 'best-of-series',
          bestOf: {
            totalGames: 3,
            targetScorePerGame: 21,
            currentGame: 1,
            wins: { local: 0, visitor: 0 },
            winByTwo: false,
            scoringSystem: 'standard'
          }
        },
        currentQuarter: 1,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: []
      })
    );

    const raceRender = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={raceMatchId}>
          <RaceEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );
    await screen.findByLabelText(/Sumar 2 puntos a Halcones Local/i);
    expect(screen.queryByTestId('btn-manage-lineups')).toBeNull();
    raceRender.unmount();

    const seriesRender = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={seriesMatchId}>
          <SeriesEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );
    await screen.findByLabelText(/Sumar 2 puntos a Halcones Local/i);
    expect(screen.queryByTestId('btn-manage-lineups')).toBeNull();
    seriesRender.unmount();

    const raceLineupAttempt = await LineupService.activateLineups({
      matchId: raceMatchId,
      localStarters: localPlayerIds.slice(0, 5),
      visitorStarters: visitorPlayerIds.slice(0, 5)
    });
    expect(raceLineupAttempt.success).toBe(false);
    expect(raceLineupAttempt.error).toMatch(/Traditional/i);
  });
});
