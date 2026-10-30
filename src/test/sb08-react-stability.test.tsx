// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { db } from '../db/db';
import type { Match, Score } from '../db/models';
import {
  LiveMatchContext,
  type LiveMatchContextState,
  type TeamWithPlayers
} from '../features/match-creations/components/context/LiveMatchContext';
import { RaceEngine } from '../features/match-creations/components/engines/RaceEngine';
import { TraditionalEngine } from '../features/match-creations/components/engines/TraditionalEngine';
import { SeriesEngine } from '../features/match-creations/components/engines/SeriesEngine';
import { LiveMatch } from '../pages/LiveMatch';
import { advanceTraditionalQuarter, startTraditionalOvertime } from '../features/match-creations/hooks/useTraditionalLogic';
import { SeriesService } from '../db/series.service';

describe('SB_PHASE2B_R1: Estabilidad React 19, Rules of Hooks, Efectos y Continuidad', () => {
  let localTeam: TeamWithPlayers;
  let visitorTeam: TeamWithPlayers;
  let baseRaceMatch: Match;
  let baseTraditionalMatch: Match;
  let baseSeriesMatch: Match;

  beforeEach(async () => {
    await db.delete();
    await db.open();

    const localId = (await db.teams.add({
      name: 'Local Team',
      createdAt: new Date(),
      isArchived: false,
    })) as number;

    const visitorId = (await db.teams.add({
      name: 'Visitor Team',
      createdAt: new Date(),
      isArchived: false,
    })) as number;

    const player1Id = (await db.players.add({
      teamId: localId,
      name: 'Jugador 1',
      number: 10,
      createdAt: new Date(),
      isArchived: false,
    })) as number;

    const player2Id = (await db.players.add({
      teamId: visitorId,
      name: 'Jugador 2',
      number: 20,
      createdAt: new Date(),
      isArchived: false,
    })) as number;

    localTeam = {
      id: localId,
      name: 'Local Team',
      createdAt: new Date(),
      isArchived: false,
      players: [
        {
          id: player1Id,
          teamId: localId,
          name: 'Jugador 1',
          number: 10,
          createdAt: new Date(),
          isArchived: false,
        }
      ]
    };

    visitorTeam = {
      id: visitorId,
      name: 'Visitor Team',
      createdAt: new Date(),
      isArchived: false,
      players: [
        {
          id: player2Id,
          teamId: visitorId,
          name: 'Jugador 2',
          number: 20,
          createdAt: new Date(),
          isArchived: false,
        }
      ]
    };

    const raceMatchId = (await db.matches.add({
      localTeamId: localId,
      visitorTeamId: visitorId,
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'race',
        race: {
          targetScore: 21,
          hasRematches: true,
          winByTwo: false,
          scoringSystem: 'standard',
          currentGame: 1,
        }
      }
    })) as number;

    baseRaceMatch = (await db.matches.get(raceMatchId))!;

    const tradMatchId = (await db.matches.add({
      localTeamId: localId,
      visitorTeamId: visitorId,
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      status: 'playing',
      currentQuarter: 1,
      totalQuarters: 4,
      timerSecondsRemaining: 600,
      createdAt: new Date(),
      config: {
        mode: 'traditional',
        traditional: {
          totalQuarters: 4,
          minutesPerQuarter: 10,
        }
      }
    })) as number;

    baseTraditionalMatch = (await db.matches.get(tradMatchId))!;

    const seriesMatchId = (await db.matches.add({
      localTeamId: localId,
      visitorTeamId: visitorId,
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      status: 'playing',
      currentQuarter: 1,
      createdAt: new Date(),
      eventsProvenance: 'live_session',
      config: {
        mode: 'best-of-series',
        bestOf: {
          totalGames: 3,
          targetScorePerGame: 21,
          winByTwo: false,
          scoringSystem: 'standard',
          currentGame: 1,
          wins: { local: 0, visitor: 0 }
        }
      }
    })) as number;

    baseSeriesMatch = (await db.matches.get(seriesMatchId))!;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const createMockContext = (
    match?: Match,
    local: TeamWithPlayers = localTeam,
    visitor: TeamWithPlayers = visitorTeam,
    overrides: Partial<LiveMatchContextState> = {}
  ): LiveMatchContextState => ({
    match,
    localTeam: local,
    visitorTeam: visitor,
    isLoading: !match,
    error: null,
    isActionModalOpen: false,
    hasActiveOverlay: false,
    setActionModalOpen: vi.fn(),
    registerOpenModal: vi.fn(() => () => {}),
    ...overrides,
  });

  // ==========================================
  // GRUPO A — RULES OF HOOKS
  // ==========================================
  describe('Grupo A — Rules of Hooks', () => {
    it('F2B-01: Race no presenta errores de hooks al pasar de datos incompletos a datos cargados', () => {
      let currentMatch: Match | undefined = undefined;
      let currentLocal: TeamWithPlayers | undefined = undefined;
      let currentVisitor: TeamWithPlayers | undefined = undefined;

      const DynamicWrapper: React.FC<{ version: number }> = () => {
        const fullContext = createMockContext(currentMatch, currentLocal as TeamWithPlayers, currentVisitor as TeamWithPlayers);
        return (
          <MemoryRouter>
            <LiveMatchContext.Provider value={fullContext}>
              <RaceEngine />
            </LiveMatchContext.Provider>
          </MemoryRouter>
        );
      };

      const { rerender } = render(<DynamicWrapper version={1} />);
      expect(document.body).toBeTruthy();

      currentMatch = baseRaceMatch;
      currentLocal = localTeam;
      currentVisitor = visitorTeam;

      expect(() => {
        rerender(<DynamicWrapper version={2} />);
      }).not.toThrow();

      expect(screen.getAllByText('Local Team').length).toBeGreaterThan(0);
    });

    it('F2B-02: Traditional no presenta errores de hooks en esa transición', () => {
      let currentMatch: Match | undefined = undefined;
      let currentLocal: TeamWithPlayers | undefined = undefined;
      let currentVisitor: TeamWithPlayers | undefined = undefined;

      const DynamicWrapper: React.FC<{ version: number }> = () => {
        const fullContext = createMockContext(currentMatch, currentLocal as TeamWithPlayers, currentVisitor as TeamWithPlayers);
        return (
          <MemoryRouter>
            <LiveMatchContext.Provider value={fullContext}>
              <TraditionalEngine />
            </LiveMatchContext.Provider>
          </MemoryRouter>
        );
      };

      const { rerender } = render(<DynamicWrapper version={1} />);
      expect(document.body).toBeTruthy();

      currentMatch = baseTraditionalMatch;
      currentLocal = localTeam;
      currentVisitor = visitorTeam;

      expect(() => {
        rerender(<DynamicWrapper version={2} />);
      }).not.toThrow();

      expect(screen.getAllByText('Local Team').length).toBeGreaterThan(0);
    });

    it('F2B-03: Series conserva la corrección de hooks del PR #4', () => {
      let currentMatch: Match | undefined = undefined;

      const DynamicWrapper: React.FC<{ version: number }> = () => {
        const fullContext = createMockContext(currentMatch, localTeam, visitorTeam);
        return (
          <MemoryRouter>
            <LiveMatchContext.Provider value={fullContext}>
              <SeriesEngine />
            </LiveMatchContext.Provider>
          </MemoryRouter>
        );
      };

      const { rerender } = render(<DynamicWrapper version={1} />);
      expect(document.body).toBeTruthy();

      currentMatch = baseSeriesMatch;

      expect(() => {
        rerender(<DynamicWrapper version={2} />);
      }).not.toThrow();

      expect(screen.getAllByText('Local Team').length).toBeGreaterThan(0);
    });

    it('F2B-04: Cambio de partido sin violaciones del orden de hooks', async () => {
      const raceMatch2Id = (await db.matches.add({
        localTeamId: localTeam.id!,
        visitorTeamId: visitorTeam.id!,
        localScore: 5,
        visitorScore: 3,
        localFouls: 0,
        visitorFouls: 0,
        status: 'playing',
        createdAt: new Date(),
        config: {
          mode: 'race',
          race: { targetScore: 11, hasRematches: false, winByTwo: false, currentGame: 1 }
        }
      })) as number;
      const raceMatch2 = (await db.matches.get(raceMatch2Id))!;

      let activeMatch: Match = baseRaceMatch;

      const DynamicWrapper: React.FC<{ version: number }> = () => {
        const fullContext = createMockContext(activeMatch);
        return (
          <MemoryRouter>
            <LiveMatchContext.Provider value={fullContext}>
              <RaceEngine />
            </LiveMatchContext.Provider>
          </MemoryRouter>
        );
      };

      const { rerender } = render(<DynamicWrapper version={1} />);
      expect(screen.getByText('RETA A 21 PTS')).toBeTruthy();

      // Cambiar de partido al segundo sin recrear el componente
      activeMatch = raceMatch2;
      expect(() => {
        rerender(<DynamicWrapper version={2} />);
      }).not.toThrow();

      expect(screen.getByText('RETA A 11 PTS')).toBeTruthy();
    });

    it('F2B-05: Renderizado con React StrictMode sin errores ni bucles', () => {
      const fullContext = createMockContext(baseRaceMatch);

      expect(() => {
        render(
          <StrictMode>
            <MemoryRouter>
              <LiveMatchContext.Provider value={fullContext}>
                <RaceEngine />
              </LiveMatchContext.Provider>
            </MemoryRouter>
          </StrictMode>
        );
      }).not.toThrow();

      expect(screen.getAllByText('Local Team').length).toBeGreaterThan(0);
    });
  });

  // ==========================================
  // GRUPO B — CICLO DE VIDA Y RECURSOS
  // ==========================================
  describe('Grupo B — Ciclo de vida y recursos', () => {
    it('F2B-06: Montaje y desmontaje sin fugas de listeners', () => {
      const addSpy = vi.spyOn(document, 'addEventListener');
      const removeSpy = vi.spyOn(document, 'removeEventListener');

      const fullContext = createMockContext(baseTraditionalMatch);

      const { unmount } = render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      unmount();

      // Verificar que los listeners registrados durante el ciclo se retiren
      const addedVisibilityListeners = addSpy.mock.calls.filter(call => call[0] === 'visibilitychange').length;
      const removedVisibilityListeners = removeSpy.mock.calls.filter(call => call[0] === 'visibilitychange').length;
      expect(removedVisibilityListeners).toBe(addedVisibilityListeners);
    });

    it('F2B-07: Sin duplicaciones de intervalos en remounts', async () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(window, 'setInterval');
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval');

      const runningMatch: Match = {
        ...baseTraditionalMatch,
        timerLastStart: new Date(Date.now() - 5000),
        timerSecondsRemaining: 595
      };

      const fullContext = createMockContext(runningMatch);

      const { unmount, rerender } = render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Re-render
      rerender(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      unmount();

      // Cada intervalo creado debe haber sido limpiado
      expect(clearIntervalSpy.mock.calls.length).toBeGreaterThanOrEqual(setIntervalSpy.mock.calls.length);

      vi.useRealTimers();
    });

    it('F2B-08: Una operación pendiente no aplica efectos de interfaz a un partido nuevo', async () => {
      const fullContext1 = createMockContext(baseRaceMatch);

      const { rerender } = render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext1}>
            <RaceEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Abrir modal de confirmación en partido 1
      const earlyFinishBtn = screen.getByTitle('Finalizar y cerrar partido');
      fireEvent.click(earlyFinishBtn);
      expect(screen.getByText('¿Finalizar la Reta?')).toBeTruthy();

      // Cambiar a partido 2
      const raceMatch2: Match = {
        ...baseRaceMatch,
        id: 9999,
        config: {
          mode: 'race',
          race: { targetScore: 15, hasRematches: false, winByTwo: false, currentGame: 1 }
        }
      };
      const fullContext2 = createMockContext(raceMatch2);

      rerender(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext2}>
            <RaceEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // El modal del partido 1 debe haberse limpiado al cambiar de partido
      expect(screen.queryByText('¿Finalizar la Reta?')).toBeNull();
    });

    it('F2B-09: Las suscripciones a faltas se actualizan reactivamente sin bucles', async () => {
      const fullContext = createMockContext(baseTraditionalMatch);

      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Agregar una falta en BD para el partido
      await act(async () => {
        await db.fouls.add({
          matchId: baseTraditionalMatch.id!,
          teamId: localTeam.id!,
          quarter: 1,
          createdAt: new Date(),
        });
      });

      // El componente se actualiza sin bucles infinitos
      expect(screen.getAllByText('Local Team').length).toBeGreaterThan(0);
    });

    it('F2B-10: Una promesa tardía no deja el componente en un estado incoherente', async () => {
      const fullContext = createMockContext(baseRaceMatch);

      const { unmount } = render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <RaceEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Simular desmontaje inmediato mientras hay promesas en curso
      expect(() => {
        unmount();
      }).not.toThrow();
    });
  });

  // ==========================================
  // GRUPO C — ESTADO Y MODALES
  // ==========================================
  describe('Grupo C — Estado y modales', () => {
    it('F2B-11: Ganador Race detectado correctamente y modal presentado puramente de forma reactiva', async () => {
      const winningMatch: Match = {
        ...baseRaceMatch,
        localScore: 21,
        visitorScore: 18,
      };

      const fullContext = createMockContext(winningMatch);

      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <RaceEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // El modal debe presentarse de forma directa y síncrona
      expect(screen.getByText('¡Tenemos un Ganador!')).toBeTruthy();
      expect(screen.getByText(/Ha alcanzado la meta de 21 puntos/i)).toBeTruthy();
    });

    it('F2B-12: Modal de fin de cuarto Traditional abre al expirar el tiempo reglamentario', async () => {
      const expiredMatch: Match = {
        ...baseTraditionalMatch,
        timerSecondsRemaining: 0,
        timerLastStart: undefined, // Pausado
      };

      const fullContext = createMockContext(expiredMatch);

      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Fin del Q1')).toBeTruthy();
      });
    });

    it('F2B-13: Modal de fin de serie preservado en DOM para visualización y compartir resultado', async () => {
      const finishedSeriesMatch: Match = {
        ...baseSeriesMatch,
        status: 'finished',
        config: {
          ...baseSeriesMatch.config,
          bestOf: {
            ...baseSeriesMatch.config!.bestOf!,
            wins: { local: 2, visitor: 0 }
          }
        }
      };

      const fullContext = createMockContext(finishedSeriesMatch);

      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <SeriesEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      expect(screen.getByText('¡Serie Finalizada!')).toBeTruthy();
      expect(screen.getByText('Ir al Historial de Partidos')).toBeTruthy();
    });

    it('F2B-14: Descartar o volver a abrir modales no duplica operaciones ni corrompe el estado', async () => {
      const fullContext = createMockContext(baseRaceMatch);

      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <RaceEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      const earlyFinishBtn = screen.getByTitle('Finalizar y cerrar partido');
      fireEvent.click(earlyFinishBtn);
      expect(screen.getByText('¿Finalizar la Reta?')).toBeTruthy();

      // Cancelar / Seguir Jugando
      const cancelBtn = screen.getByText('Seguir Jugando');
      fireEvent.click(cancelBtn);
      expect(screen.queryByText('¿Finalizar la Reta?')).toBeNull();

      // Abrir de nuevo
      fireEvent.click(earlyFinishBtn);
      expect(screen.getByText('¿Finalizar la Reta?')).toBeTruthy();
    });

    it('F2B-15: La preferencia de seguimiento de jugadores se conserva correctamente (usuario apaga)', async () => {
      const fullContext = createMockContext(baseRaceMatch);

      const { rerender } = render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <RaceEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // trackPlayers inicia activo porque hay jugadores
      const trackChip = screen.getByTitle('Elegir jugador al anotar');
      expect(trackChip.classList.contains('is-on')).toBe(true);

      // El usuario lo apaga manualmente
      fireEvent.click(trackChip);
      expect(trackChip.classList.contains('is-on')).toBe(false);

      // Re-render del componente por actualización externa
      rerender(
        <MemoryRouter>
          <LiveMatchContext.Provider value={{ ...fullContext }}>
            <RaceEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // No se vuelve a activar automáticamente
      const trackChipAfter = screen.getByTitle('Elegir jugador al anotar');
      expect(trackChipAfter.classList.contains('is-on')).toBe(false);
    });

    it('F2B-16: Cambio de partido no conserva una selección de jugador anterior', async () => {
      const fullContext = createMockContext(baseTraditionalMatch);

      const { rerender } = render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Abrir modal de jugador con click en +2
      const plusTwoButtons = screen.getAllByText('+2');
      fireEvent.click(plusTwoButtons[0]);
      expect(screen.getByText(/Toca al jugador/i)).toBeTruthy();

      // Cambiar de partido al segundo
      const match2: Match = { ...baseTraditionalMatch, id: 888 };
      rerender(
        <MemoryRouter>
          <LiveMatchContext.Provider value={createMockContext(match2)}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // El modal de jugador del partido anterior debe haberse cerrado
      expect(screen.queryByText(/Toca al jugador/i)).toBeNull();
    });
  });

  // ==========================================
  // GRUPO D — PERSISTENCIA E INTEGRIDAD
  // ==========================================
  describe('Grupo D — Persistencia e Integridad', () => {
    it('F2B-17: Un render adicional no duplica anotaciones ni altera contadores', async () => {
      const initialScoresCount = await db.scores.count();
      const fullContext = createMockContext(baseRaceMatch);

      const { rerender } = render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <RaceEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Múltiples re-renders
      rerender(
        <MemoryRouter>
          <LiveMatchContext.Provider value={{ ...fullContext }}>
            <RaceEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );
      rerender(
        <MemoryRouter>
          <LiveMatchContext.Provider value={{ ...fullContext }}>
            <RaceEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      const finalScoresCount = await db.scores.count();
      expect(finalScoresCount).toBe(initialScoresCount);
    });

    it('F2B-18: Un efecto de presentación no modifica resultados cerrados ni escribe a BD', async () => {
      const finishedMatch: Match = {
        ...baseRaceMatch,
        status: 'finished',
        finishedAt: new Date(),
        localScore: 21,
        visitorScore: 15,
      };
      await db.matches.put(finishedMatch);

      const fullContext = createMockContext(finishedMatch);

      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <RaceEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      const dbMatch = await db.matches.get(finishedMatch.id!);
      expect(dbMatch?.status).toBe('finished');
      expect(dbMatch?.localScore).toBe(21);
      expect(dbMatch?.visitorScore).toBe(15);
    });

    it('F2B-19: El desmontaje no registra un cierre deportivo ficticio ni modifica scores en DB', async () => {
      const activeMatch = (await db.matches.get(baseRaceMatch.id!))!;
      const fullContext = createMockContext(activeMatch);

      const { unmount } = render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <RaceEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      unmount();

      const afterMatch = await db.matches.get(activeMatch.id!);
      expect(afterMatch?.status).toBe('playing');
      expect(afterMatch?.localScore).toBe(0);
      expect(afterMatch?.visitorScore).toBe(0);
    });

    it('F2B-20: Los invariantes de Fase 2A siguen funcionando (Best-of-Series y transacciones)', async () => {
      // Registrar eventos para el set 1
      const matchId = baseSeriesMatch.id!;
      const scores: Omit<Score, 'id'>[] = [
        { matchId, teamId: localTeam.id!, points: 3, quarter: 1, createdAt: new Date() },
        { matchId, teamId: localTeam.id!, points: 3, quarter: 1, createdAt: new Date() },
        { matchId, teamId: localTeam.id!, points: 3, quarter: 1, createdAt: new Date() },
        { matchId, teamId: localTeam.id!, points: 3, quarter: 1, createdAt: new Date() },
        { matchId, teamId: localTeam.id!, points: 3, quarter: 1, createdAt: new Date() },
        { matchId, teamId: localTeam.id!, points: 3, quarter: 1, createdAt: new Date() },
        { matchId, teamId: localTeam.id!, points: 3, quarter: 1, createdAt: new Date() }, // 21 pts
      ];
      await db.scores.bulkAdd(scores as Score[]);
      await db.matches.update(matchId, { localScore: 21, visitorScore: 0 });

      // Confirmar set mediante servicio de dominio
      const res = await SeriesService.confirmSet({ matchId, setNumber: 1 });
      expect(res.status).toBe('confirmed');

      const updated = (await db.matches.get(matchId))!;
      expect(updated.config?.bestOf?.wins?.local).toBe(1);
      expect(updated.config?.bestOf?.currentGame).toBe(2);
      expect(updated.localScore).toBe(0);
    });
  });

  // ==========================================
  // GRUPO E — REGRESIONES
  // ==========================================
  describe('Grupo E — Regresiones', () => {
    it('F2B-21: Race mantiene su rematch: resetea marcadores a 0 y avanza currentGameNumber', async () => {
      // Simular partido en meta de 21
      const matchId = baseRaceMatch.id!;
      await db.matches.update(matchId, { localScore: 21, visitorScore: 19 });

      const updatedMatch = (await db.matches.get(matchId))!;
      const fullContext = createMockContext(updatedMatch);

      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <RaceEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Clic en revancha
      const rematchBtn = screen.getByText('Dar la Vuelta (Revancha)');
      await act(async () => {
        fireEvent.click(rematchBtn);
      });

      const dbMatchAfter = (await db.matches.get(matchId))!;
      expect(dbMatchAfter.localScore).toBe(0);
      expect(dbMatchAfter.visitorScore).toBe(0);
      expect(dbMatchAfter.config?.race?.currentGame).toBe(2);
      expect(dbMatchAfter.gameHistory?.length).toBe(1);
    });

    it('F2B-22: Traditional conserva el avance de cuarto y overtime', async () => {
      const matchId = baseTraditionalMatch.id!;

      // Avanzar de Q1 a Q2
      const advanced = await advanceTraditionalQuarter(matchId);
      expect(advanced).toBe(true);

      const matchAfterQ2 = (await db.matches.get(matchId))!;
      expect(matchAfterQ2.currentQuarter).toBe(2);
      expect(matchAfterQ2.timerSecondsRemaining).toBe(600);
      expect(matchAfterQ2.timerLastStart).toBeUndefined();

      // Iniciar Overtime
      const otStarted = await startTraditionalOvertime(matchId, 5);
      expect(otStarted).toBe(true);

      const matchAfterOt = (await db.matches.get(matchId))!;
      expect(matchAfterOt.currentQuarter).toBe(3);
      expect(matchAfterOt.timerSecondsRemaining).toBe(300);
    });

    it('F2B-23: Best-of-Series conserva la idempotencia (cierre no duplica sets)', async () => {
      const matchId = baseSeriesMatch.id!;
      await db.matches.update(matchId, {
        status: 'finished',
        config: {
          ...baseSeriesMatch.config,
          bestOf: {
            ...baseSeriesMatch.config!.bestOf!,
            wins: { local: 2, visitor: 1 }
          }
        }
      });

      const res = await SeriesService.finishSeriesEarly({ matchId, countCurrentSet: false });
      expect(res.status).toBe('already_finished');

      const matchAfter = (await db.matches.get(matchId))!;
      expect(matchAfter.config?.bestOf?.wins?.local).toBe(2);
      expect(matchAfter.config?.bestOf?.wins?.visitor).toBe(1);
    });

    it('F2B-24: El flujo de navegación no queda atrapado en errores de render', async () => {
      const matchId = baseRaceMatch.id!;

      render(
        <MemoryRouter initialEntries={[`/matches/${matchId}`]}>
          <Routes>
            <Route path="/matches/:id" element={<LiveMatch />} />
            <Route path="/matches" element={<div>Lista de Partidos</div>} />
          </Routes>
        </MemoryRouter>
      );

      // Esperar a que el partido cargue desde IndexedDB
      await waitFor(() => {
        expect(screen.getAllByText('Local Team').length).toBeGreaterThan(0);
      });
    });

    it('F2B-25: Los errores de carga pueden presentarse sin provocar loops de React', async () => {
      render(
        <MemoryRouter initialEntries={['/matches/999999']}>
          <Routes>
            <Route path="/matches/:id" element={<LiveMatch />} />
            <Route path="/matches" element={<div>Lista de Partidos</div>} />
          </Routes>
        </MemoryRouter>
      );

      // Partido inexistente muestra la pantalla amigable de no encontrado
      await waitFor(() => {
        expect(screen.getByText('Partido no encontrado')).toBeTruthy();
      });
    });
  });
});
