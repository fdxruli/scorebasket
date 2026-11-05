// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '../db/db';
import { LiveMatchProvider } from '../features/match-creations/components/context/LiveMatchContext';
import { TraditionalEngine } from '../features/match-creations/components/engines/TraditionalEngine';
import { RaceEngine } from '../features/match-creations/components/engines/RaceEngine';
import { SeriesEngine } from '../features/match-creations/components/engines/SeriesEngine';
import { LivePlayersModal } from '../components/live/LivePlayersModal';
import * as soundEffects from '../utils/soundEffects';
import type { Match } from '../db/models';

describe('DEPORT-01: Confiabilidad y rapidez del marcador (confirmación real, selector, dobles toques y modalidades)', () => {
  let localTeamId: number;
  let visitorTeamId: number;
  let localPlayerId: number;
  let visitorPlayerId: number;

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
        name: 'Soles Local',
        createdAt: new Date(),
        isArchived: false,
      })
    );

    visitorTeamId = Number(
      await db.teams.add({
        name: 'Astros Visita',
        createdAt: new Date(),
        isArchived: false,
      })
    );

    localPlayerId = Number(
      await db.players.add({
        teamId: localTeamId,
        name: 'Carlos Ruiz',
        number: 10,
        createdAt: new Date(),
        isArchived: false,
      })
    );

    visitorPlayerId = Number(
      await db.players.add({
        teamId: visitorTeamId,
        name: 'Mateo Díaz',
        number: 23,
        createdAt: new Date(),
        isArchived: false,
      })
    );
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
          traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 2 },
        },
        currentQuarter: 1,
        totalQuarters: 4,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        timerSecondsRemaining: 600,
        ...overrides,
      })
    );
  };

  const createRaceMatch = async (overrides: Partial<Match> = {}) => {
    return Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
        config: {
          mode: 'race',
          race: {
            targetScore: 21,
            hasRematches: true,
            currentGame: 1,
            winByTwo: false,
            scoringSystem: 'standard',
          },
        },
        currentQuarter: 1,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: [],
        ...overrides,
      })
    );
  };

  const createSeriesMatch = async (overrides: Partial<Match> = {}) => {
    return Number(
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
            scoringSystem: 'standard',
          },
        },
        currentQuarter: 1,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        gameHistory: [],
        ...overrides,
      })
    );
  };

  // =========================================================================
  // 1. Acción exitosa
  // =========================================================================
  it('1. Acción exitosa: guarda +2 y falta en IndexedDB, actualiza contadores y emite confirmación únicamente tras guardar', async () => {
    const matchId = await createTraditionalMatch();

    render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    const scoreBtn = await screen.findByLabelText(/Sumar 2 puntos a Soles Local/i, {}, { timeout: 5000 });
    fireEvent.click(scoreBtn);

    // Se abre PlayerSelectModal y seleccionamos a Carlos Ruiz
    const playerBtn = await screen.findByText('Carlos Ruiz', {}, { timeout: 5000 });
    fireEvent.click(playerBtn);

    await waitFor(async () => {
      const m = await db.matches.get(matchId);
      expect(m?.localScore).toBe(2);
    }, { timeout: 5000 });

    const savedScores = await db.scores.where('matchId').equals(matchId).toArray();
    expect(savedScores).toHaveLength(1);
    expect(savedScores[0]).toMatchObject({
      matchId,
      teamId: localTeamId,
      playerId: localPlayerId,
      points: 2,
      quarter: 1,
    });
    expect(soundEffects.playScorePop).toHaveBeenCalledWith(2);

    // El modal se cierra tras éxito
    await waitFor(() => {
      expect(screen.queryByText(/Toca al jugador para registrar la acción/i)).toBeNull();
    }, { timeout: 5000 });

    // Ahora registramos una falta a un jugador desde LivePlayersModal
    const openPlayersBtn = screen.getByLabelText(/Jugadores y estadísticas/i);
    fireEvent.click(openPlayersBtn);

    const quickFoulBtn = await screen.findByTitle(/Registrar falta a Carlos Ruiz/i, {}, { timeout: 5000 });
    fireEvent.click(quickFoulBtn);

    // Debe mostrarse el toast de confirmación real y actualizarse IndexedDB
    expect(await screen.findByText(/Falta asignada a Carlos Ruiz/i, {}, { timeout: 5000 })).toBeTruthy();

    const mAfterFoul = await db.matches.get(matchId);
    expect(mAfterFoul?.localFouls).toBe(1);

    const savedFouls = await db.fouls.where('matchId').equals(matchId).toArray();
    expect(savedFouls).toHaveLength(1);
    expect(savedFouls[0]).toMatchObject({
      matchId,
      teamId: localTeamId,
      playerId: localPlayerId,
      quarter: 1,
    });
    expect(soundEffects.playWhistle).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // 2. Acción rechazada en LivePlayersModal
  // =========================================================================
  it('2. Acción rechazada en LivePlayersModal: nunca muestra toast falso de éxito, no cambia el marcador y muestra el error sin duplicar alertas', async () => {
    const matchId = await createRaceMatch({
      localScore: 21,
      visitorScore: 18,
    });

    render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <LivePlayersModal onClose={() => {}} />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    const quickPlus2Btn = await screen.findByTitle(/Sumar \+2 a Carlos Ruiz/i, {}, { timeout: 5000 });
    fireEvent.click(quickPlus2Btn);

    // Debe aparecer la alerta de rechazo comprensible
    const alertEl = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alertEl.textContent).toMatch(/ya tiene ganador/i);

    // NUNCA debe aparecer el toast falso de éxito
    expect(screen.queryByText(/\+2 PTS para Carlos Ruiz/i)).toBeNull();

    // No se emite sonido de anotación ni alerta nativa duplicada
    expect(soundEffects.playScorePop).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();

    // El marcador en IndexedDB permanece intacto en 21
    const matchInDb = await db.matches.get(matchId);
    expect(matchInDb?.localScore).toBe(21);
    const scoresCount = await db.scores.where('matchId').equals(matchId).count();
    expect(scoresCount).toBe(0);
  });

  // =========================================================================
  // 3. Selector de jugadores (PlayerSelectModal) ante error y reintento
  // =========================================================================
  it('3. Selector ante error: una operación rechazada NO cierra PlayerSelectModal, informa el error, permite cancelar manualmente o reintentar', async () => {
    const matchId = await createTraditionalMatch({ currentQuarter: 1 });

    render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    // 1. Abrir el selector de jugador en Q1 para +2
    const scoreBtn = await screen.findByLabelText(/Sumar 2 puntos a Soles Local/i, {}, { timeout: 5000 });
    fireEvent.click(scoreBtn);

    const playerBtn = await screen.findByText('Carlos Ruiz', {}, { timeout: 5000 });
    expect(playerBtn).toBeTruthy();

    // 2. Provocar un rechazo válido: el periodo Q1 se cierra / avanza a Q2 antes de confirmar al jugador
    await db.matches.update(matchId, { currentQuarter: 2 });

    // 3. Intentar asignar la acción abierta en Q1 al jugador
    fireEvent.click(playerBtn);

    // 4. El selector NO debe cerrarse y debe mostrar el error comprensible
    const errorBanner = await screen.findByTestId('player-select-error', {}, { timeout: 5000 });
    expect(errorBanner.textContent).toMatch(/periodo o set ya cambió/i);
    expect(screen.getByText(/Toca al jugador para registrar la acción/i)).toBeTruthy();

    // No hubo éxito falso ni sonido ni cambio de marcador ni doble window.alert
    expect(soundEffects.playScorePop).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
    const matchAfterReject = await db.matches.get(matchId);
    expect(matchAfterReject?.localScore).toBe(0);

    // 5. Si la condición se corrige (o es un fallo transitorio) el usuario puede reintentar desde el mismo selector
    await db.matches.update(matchId, { currentQuarter: 1 });
    fireEvent.click(playerBtn);

    await waitFor(async () => {
      const m = await db.matches.get(matchId);
      expect(m?.localScore).toBe(2);
    }, { timeout: 5000 });

    // Ahora que sí se guardó (success=true), el selector se cierra
    await waitFor(() => {
      expect(screen.queryByText(/Toca al jugador para registrar la acción/i)).toBeNull();
    }, { timeout: 5000 });

    // 6. Verificar que también se puede cancelar manualmente tras un rechazo
    fireEvent.click(screen.getByLabelText(/Sumar 3 puntos a Soles Local/i));
    const unassignedBtn = await screen.findByText(/Solo al Equipo/i, {}, { timeout: 5000 });
    await db.matches.update(matchId, { currentQuarter: 2 });

    fireEvent.click(unassignedBtn);
    expect(await screen.findByTestId('player-select-error', {}, { timeout: 5000 })).toBeTruthy();

    const cancelBtn = screen.getByText(/^Cancelar$/i);
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Toca al jugador para registrar la acción/i)).toBeNull();
    }, { timeout: 5000 });
  });

  // =========================================================================
  // 4. Dobles toques accidentales mientras una operación está pendiente
  // =========================================================================
  it('4. Dobles toques accidentales: tocar repetidamente mientras una operación está en curso registra una sola acción sin bloquear siguientes jugadas', async () => {
    const matchId = await createTraditionalMatch();

    render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    // Abrir selector para +2
    const scoreBtn = await screen.findByLabelText(/Sumar 2 puntos a Soles Local/i, {}, { timeout: 5000 });
    fireEvent.click(scoreBtn);

    const playerBtn = await screen.findByText('Carlos Ruiz', {}, { timeout: 5000 });

    // Doble toque rápido sobre el mismo jugador antes de que resuelva la transacción
    fireEvent.click(playerBtn);
    fireEvent.click(playerBtn);
    fireEvent.click(playerBtn);

    await waitFor(async () => {
      const m = await db.matches.get(matchId);
      expect(m?.localScore).toBe(2);
    }, { timeout: 5000 });

    const scores = await db.scores.where('matchId').equals(matchId).toArray();
    expect(scores).toHaveLength(1);
    expect(soundEffects.playScorePop).toHaveBeenCalledTimes(1);
    expect(window.alert).not.toHaveBeenCalled();

    // También en LivePlayersModal: doble toque rápido en acción directa
    const openPlayersBtn = screen.getByLabelText(/Jugadores y estadísticas/i);
    fireEvent.click(openPlayersBtn);

    const quickPlus3Btn = await screen.findByTitle(/Sumar \+3 a Carlos Ruiz/i, {}, { timeout: 5000 });
    fireEvent.click(quickPlus3Btn);
    fireEvent.click(quickPlus3Btn);

    await waitFor(async () => {
      const m = await db.matches.get(matchId);
      expect(m?.localScore).toBe(5);
    }, { timeout: 5000 });

    const scoresAfterQuick = await db.scores.where('matchId').equals(matchId).toArray();
    expect(scoresAfterQuick).toHaveLength(2);
  });

  // =========================================================================
  // 5. Continuidad de acciones válidas y persistencia tras recarga
  // =========================================================================
  it('5. Continuidad de acciones válidas y persistencia: permite anotar jugadas consecutivas legítimas tras un rechazo y persiste al recargar', async () => {
    const matchId = await createTraditionalMatch({ currentQuarter: 1 });

    const firstRender = render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    // 1. Anotar +2 para local
    fireEvent.click(await screen.findByLabelText(/Sumar 2 puntos a Soles Local/i, {}, { timeout: 5000 }));
    fireEvent.click(await screen.findByText('Carlos Ruiz', {}, { timeout: 5000 }));

    await waitFor(async () => {
      expect((await db.matches.get(matchId))?.localScore).toBe(2);
    }, { timeout: 5000 });

    // 2. Registrar falta a visitante
    fireEvent.click(screen.getByLabelText(/Falta de Astros Visita/i));
    fireEvent.click(await screen.findByText('Mateo Díaz', {}, { timeout: 5000 }));

    await waitFor(async () => {
      expect((await db.matches.get(matchId))?.visitorFouls).toBe(1);
    }, { timeout: 5000 });

    // 3. Provocar un rechazo abriendo selector en Q1 cuando el partido pasa a Q2
    fireEvent.click(screen.getByLabelText(/Sumar 3 puntos a Soles Local/i));
    const localPlayerBtn = await screen.findByText('Carlos Ruiz', {}, { timeout: 5000 });
    await db.matches.update(matchId, { currentQuarter: 2 });
    fireEvent.click(localPlayerBtn);

    expect(await screen.findByTestId('player-select-error', {}, { timeout: 5000 })).toBeTruthy();
    expect((await db.matches.get(matchId))?.localScore).toBe(2);

    // Cerrar el selector rechazado y registrar una nueva acción válida ya en Q2
    fireEvent.click(screen.getByText(/^Cancelar$/i));
    await waitFor(() => {
      expect(screen.queryByTestId('player-select-error')).toBeNull();
    }, { timeout: 5000 });

    fireEvent.click(screen.getByLabelText(/Sumar 3 puntos a Astros Visita/i));
    fireEvent.click(await screen.findByText('Mateo Díaz', {}, { timeout: 5000 }));

    await waitFor(async () => {
      expect((await db.matches.get(matchId))?.visitorScore).toBe(3);
    }, { timeout: 5000 });

    // 4. Simular recarga completa de la aplicación (desmontar y volver a montar desde IndexedDB)
    firstRender.unmount();

    render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <TraditionalEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    await screen.findByLabelText(/Sumar 2 puntos a Soles Local/i, {}, { timeout: 5000 });

    const persistedMatch = await db.matches.get(matchId);
    expect(persistedMatch?.localScore).toBe(2);
    expect(persistedMatch?.visitorScore).toBe(3);
    expect(persistedMatch?.visitorFouls).toBe(1);
    expect(persistedMatch?.currentQuarter).toBe(2);

    const allScores = await db.scores.where('matchId').equals(matchId).toArray();
    const allFouls = await db.fouls.where('matchId').equals(matchId).toArray();
    expect(allScores).toHaveLength(2);
    expect(allFouls).toHaveLength(1);
    expect(allFouls[0].playerId).toBe(visitorPlayerId);
  });

  // =========================================================================
  // 6. Compatibilidad entre modalidades (Race to Score y Best-of-Series)
  // =========================================================================
  it('6A. Compatibilidad en Race to Score: rechaza acción si el juego se cerró mientras el selector estaba abierto sin cerrar el modal, y acepta acción válida', async () => {
    const matchId = await createRaceMatch({ localScore: 10, visitorScore: 8 });

    render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <RaceEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    const scoreBtn = await screen.findByLabelText(/Sumar 2 puntos a Soles Local/i, {}, { timeout: 5000 });
    fireEvent.click(scoreBtn);

    const playerBtn = await screen.findByText('Carlos Ruiz', {}, { timeout: 5000 });

    // Mientras el selector está abierto en el Juego 1, el partido avanza al Juego 2
    await db.matches.update(matchId, {
      localScore: 0,
      visitorScore: 0,
      'config.race.currentGame': 2,
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 8, winner: 'local', finishedAt: new Date() },
      ],
    });

    fireEvent.click(playerBtn);

    // El selector permanece abierto y muestra el error
    const errorBanner = await screen.findByTestId('player-select-error', {}, { timeout: 5000 });
    expect(errorBanner.textContent).toMatch(/periodo o set ya cambió/i);
    expect(soundEffects.playScorePop).not.toHaveBeenCalled();
    expect((await db.matches.get(matchId))?.localScore).toBe(0);

    // Cancelar manualmente y anotar válidamente en el Juego 2
    fireEvent.click(screen.getByText(/^Cancelar$/i));
    await waitFor(() => {
      expect(screen.queryByTestId('player-select-error')).toBeNull();
    }, { timeout: 5000 });

    fireEvent.click(screen.getByLabelText(/Sumar 2 puntos a Soles Local/i));
    fireEvent.click(await screen.findByText('Carlos Ruiz', {}, { timeout: 5000 }));

    await waitFor(async () => {
      expect((await db.matches.get(matchId))?.localScore).toBe(2);
    }, { timeout: 5000 });
  });

  it('6B. Compatibilidad en Best-of-Series: rechaza acción si el set se cerró mientras el selector estaba abierto sin cerrar el modal, y acepta acción válida', async () => {
    const matchId = await createSeriesMatch({ localScore: 12, visitorScore: 10 });

    render(
      <MemoryRouter>
        <LiveMatchProvider matchId={matchId}>
          <SeriesEngine />
        </LiveMatchProvider>
      </MemoryRouter>
    );

    const scoreBtn = await screen.findByLabelText(/Sumar 3 puntos a Astros Visita/i, {}, { timeout: 5000 });
    fireEvent.click(scoreBtn);

    const playerBtn = await screen.findByText('Mateo Díaz', {}, { timeout: 5000 });

    // Mientras el selector está abierto en el Set 1, la serie avanza al Set 2
    await db.matches.update(matchId, {
      currentQuarter: 2,
      localScore: 0,
      visitorScore: 0,
      'config.bestOf.currentGame': 2,
      'config.bestOf.wins': { local: 1, visitor: 0 },
      gameHistory: [
        { gameNumber: 1, localScore: 21, visitorScore: 10, winner: 'local', finishedAt: new Date() },
      ],
    });

    fireEvent.click(playerBtn);

    // El selector permanece abierto y muestra el error
    const errorBanner = await screen.findByTestId('player-select-error', {}, { timeout: 5000 });
    expect(errorBanner.textContent).toMatch(/periodo o set ya cambió/i);
    expect(soundEffects.playScorePop).not.toHaveBeenCalled();
    expect((await db.matches.get(matchId))?.visitorScore).toBe(0);

    // Cancelar manualmente y anotar válidamente en el Set 2
    fireEvent.click(screen.getByText(/^Cancelar$/i));
    await waitFor(() => {
      expect(screen.queryByTestId('player-select-error')).toBeNull();
    }, { timeout: 5000 });

    fireEvent.click(screen.getByLabelText(/Sumar 3 puntos a Astros Visita/i));
    fireEvent.click(await screen.findByText('Mateo Díaz', {}, { timeout: 5000 }));

    await waitFor(async () => {
      expect((await db.matches.get(matchId))?.visitorScore).toBe(3);
    }, { timeout: 5000 });
  });
});
