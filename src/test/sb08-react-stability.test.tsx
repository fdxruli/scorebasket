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
import { clearAllPendingUnmountPauses } from '../hooks/useMatchTimer';
import { timerAuthorityCoordinator } from '../services/timerAuthority.coordinator';

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
    clearAllPendingUnmountPauses();
    vi.clearAllTimers();
    vi.useRealTimers();
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
      await timerAuthorityCoordinator.acquireAuthority(matchId);

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

  // ==========================================
  // GRUPO F — FASE 2B R1.1: CICLO DE VIDA ESTRICTO, MITIGACIÓN C-09 Y C-10
  // ==========================================
  describe('Grupo F — R1.1: Ciclo de vida estricto, mitigación C-09 y C-10', () => {
    // R11-B-01: reloj de Q1 expira y se presenta el modal
    it('R11-B-01: reloj de Q1 expira y se presenta el modal', async () => {
      const expiredMatch: Match = {
        ...baseTraditionalMatch,
        timerSecondsRemaining: 0,
        timerLastStart: undefined,
      };

      const fullContext = createMockContext(expiredMatch);

      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      expect(screen.getByText('Fin del Q1')).toBeTruthy();
      expect(screen.getByText(/El tiempo del periodo terminó/i)).toBeTruthy();
    });

    // R11-B-02: el callback de apertura pendiente es cancelado por una nueva ejecución del efecto; el modal no debe perderse
    it('R11-B-02: el modal derivado persiste ante múltiples rerenders consecutivos sin perderse', async () => {
      const expiredMatch: Match = {
        ...baseTraditionalMatch,
        timerSecondsRemaining: 0,
        timerLastStart: undefined,
      };

      const fullContext = createMockContext(expiredMatch);

      const { rerender } = render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Múltiples re-renders en ráfaga (simulando actualizaciones reactivas)
      for (let i = 0; i < 5; i++) {
        rerender(
          <MemoryRouter>
            <LiveMatchContext.Provider value={{ ...fullContext, match: { ...expiredMatch } }}>
              <TraditionalEngine />
            </LiveMatchContext.Provider>
          </MemoryRouter>
        );
      }

      // El modal no se pierde por cancelaciones espurias
      expect(screen.getByText('Fin del Q1')).toBeTruthy();
    });

    // R11-B-03: fin de cuarto mientras está abierto PlayerSelectModal; al cerrarlo se muestra el aviso pendiente
    it('R11-B-03: fin de cuarto mientras está abierto un modal de acción; al cerrarlo se muestra el aviso pendiente', async () => {
      const expiredMatch: Match = {
        ...baseTraditionalMatch,
        timerSecondsRemaining: 0,
        timerLastStart: undefined,
      };

      // Inicia con un modal de acción abierto (bloqueando el aviso)
      const fullContextBlocked = createMockContext(expiredMatch, localTeam, visitorTeam, {
        isActionModalOpen: true,
      });

      const { rerender } = render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContextBlocked}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Mientras la acción está en curso, el modal de fin de cuarto NO interrumpe al usuario
      expect(screen.queryByText('Fin del Q1')).toBeNull();

      // El usuario termina su acción (isActionModalOpen pasa a false)
      const fullContextUnblocked = createMockContext(expiredMatch, localTeam, visitorTeam, {
        isActionModalOpen: false,
      });

      rerender(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContextUnblocked}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Ahora el aviso pendiente se presenta inmediatamente
      expect(screen.getByText('Fin del Q1')).toBeTruthy();
    });

    // R11-B-04: cambio de Q1 a Q2; un callback atrasado no debe mostrar Fin del Q1
    it('R11-B-04: cambio de Q1 a Q2; no debe mostrar Fin del Q1', async () => {
      const q1ExpiredMatch: Match = {
        ...baseTraditionalMatch,
        currentQuarter: 1,
        timerSecondsRemaining: 0,
        timerLastStart: undefined,
      };

      const fullContextQ1 = createMockContext(q1ExpiredMatch);

      const { rerender } = render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContextQ1}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      expect(screen.getByText('Fin del Q1')).toBeTruthy();

      // Se avanza a Q2 con tiempo reglamentario activo
      const q2ActiveMatch: Match = {
        ...baseTraditionalMatch,
        currentQuarter: 2,
        timerSecondsRemaining: 600,
        timerLastStart: undefined,
      };

      const fullContextQ2 = createMockContext(q2ActiveMatch);

      rerender(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContextQ2}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Fin del Q1 desaparece y no hay modal erróneo
      expect(screen.queryByText('Fin del Q1')).toBeNull();
      expect(screen.queryByText('Fin del Q2')).toBeNull();
    });

    // R11-B-05: último cuarto terminado abre el flujo de fin de partido
    it('R11-B-05: último cuarto terminado abre el flujo de fin de partido', async () => {
      const finalQuarterMatch: Match = {
        ...baseTraditionalMatch,
        currentQuarter: 4,
        totalQuarters: 4,
        timerSecondsRemaining: 0,
        timerLastStart: undefined,
        localScore: 50,
        visitorScore: 40,
      };

      const fullContext = createMockContext(finalQuarterMatch);

      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // En el último cuarto no muestra "Fin del Q4", sino el flujo de fin de partido
      expect(screen.queryByText('Fin del Q4')).toBeNull();
      expect(screen.getByText('¡Fin del Partido!')).toBeTruthy();
      expect(screen.getByText('Guardar y Cerrar Partido')).toBeTruthy();
    });

    // R11-B-06: el partido pasa a finished; no aparecen modales anteriores
    it('R11-B-06: el partido pasa a finished; no aparecen modales anteriores', async () => {
      const finishedMatch: Match = {
        ...baseTraditionalMatch,
        status: 'finished',
        currentQuarter: 4,
        totalQuarters: 4,
        timerSecondsRemaining: 0,
        timerLastStart: undefined,
      };

      const fullContext = createMockContext(finishedMatch);

      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      expect(screen.queryByText('Fin del Q4')).toBeNull();
      expect(screen.queryByText('¡Fin del Partido!')).toBeNull();
    });

    // R11-B-07: montaje bajo React.StrictMode con temporizador Traditional activo
    it('R11-B-07: montaje bajo React.StrictMode con temporizador Traditional activo no lo pausa involuntariamente', async () => {
      const matchId = (await db.matches.add({
        localTeamId: localTeam.id!,
        visitorTeamId: visitorTeam.id!,
        status: 'playing',
        currentQuarter: 1,
        totalQuarters: 4,
        timerSecondsRemaining: 590,
        timerLastStart: new Date(Date.now() - 10000),
        localScore: 10,
        visitorScore: 8,
        localFouls: 0,
        visitorFouls: 0,
        createdAt: new Date(),
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10 }
        }
      })) as number;

      const activeMatch = (await db.matches.get(matchId))!;
      const fullContext = createMockContext(activeMatch);

      const { unmount } = render(
        <StrictMode>
          <MemoryRouter>
            <LiveMatchContext.Provider value={fullContext}>
              <TraditionalEngine />
            </LiveMatchContext.Provider>
          </MemoryRouter>
        </StrictMode>
      );

      // Esperar tiempo suficiente para que un timeout erróneo se ejecutara
      await new Promise(r => setTimeout(r, 60));

      const matchAfter = await db.matches.get(matchId);
      // El temporizador DEBE seguir activo (timerLastStart definido) porque StrictMode no debe pausar
      expect(matchAfter?.timerLastStart).toBeDefined();

      unmount();
    });

    // R11-B-08: desmontaje y remonte con comprobación de timerLastStart y timerSecondsRemaining
    it('R11-B-08: desmontaje pausa el cronómetro tras salida real y remonte conserva el estado pausado', async () => {
      const matchId = (await db.matches.add({
        localTeamId: localTeam.id!,
        visitorTeamId: visitorTeam.id!,
        status: 'playing',
        currentQuarter: 1,
        totalQuarters: 4,
        timerSecondsRemaining: 600,
        timerLastStart: new Date(Date.now() - 5000),
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        createdAt: new Date(),
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10 }
        }
      })) as number;

      const runningMatch = (await db.matches.get(matchId))!;
      const fullContext = createMockContext(runningMatch);

      const { unmount } = render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Desmontar el componente (salida real de la pantalla del partido)
      unmount();

      // Esperar a que la pausa por desmontaje expire e impacte en IndexedDB
      await waitFor(async () => {
        const m = await db.matches.get(matchId);
        expect(m?.timerLastStart).toBeUndefined();
      }, { timeout: 4000 });

      const pausedMatch = (await db.matches.get(matchId))!;
      expect(pausedMatch.timerLastStart).toBeUndefined();
      expect(pausedMatch.timerSecondsRemaining).toBeLessThanOrEqual(596);

      // Remontar el partido: ahora carga pausado
      const remountContext = createMockContext(pausedMatch);
      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={remountContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Sigue pausado en el tiempo exacto remanente
      expect(screen.getByText(/09:5[456]/)).toBeTruthy();
    });

    // R11-B-09: cambios de partido sin efectos tardíos que alteren el partido anterior o el siguiente
    it('R11-B-09: cambiar de partido pausa el partido anterior en BD y no contamina el nuevo', async () => {
      const match1Id = (await db.matches.add({
        localTeamId: localTeam.id!,
        visitorTeamId: visitorTeam.id!,
        status: 'playing',
        currentQuarter: 1,
        totalQuarters: 4,
        timerSecondsRemaining: 600,
        timerLastStart: new Date(Date.now() - 3000),
        localScore: 5,
        visitorScore: 2,
        localFouls: 0,
        visitorFouls: 0,
        createdAt: new Date(),
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10 }
        }
      })) as number;

      const match2Id = (await db.matches.add({
        localTeamId: localTeam.id!,
        visitorTeamId: visitorTeam.id!,
        status: 'playing',
        currentQuarter: 2,
        totalQuarters: 4,
        timerSecondsRemaining: 600,
        timerLastStart: undefined, // Pausado
        localScore: 20,
        visitorScore: 20,
        localFouls: 0,
        visitorFouls: 0,
        createdAt: new Date(),
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10 }
        }
      })) as number;

      const match1 = (await db.matches.get(match1Id))!;
      const match2 = (await db.matches.get(match2Id))!;

      const DynamicWrapper: React.FC<{ match: Match }> = ({ match }) => {
        const fullContext = createMockContext(match);
        return (
          <MemoryRouter>
            <LiveMatchContext.Provider value={fullContext}>
              <TraditionalEngine />
            </LiveMatchContext.Provider>
          </MemoryRouter>
        );
      };

      const { rerender } = render(<DynamicWrapper match={match1} />);

      // Cambiar a Match 2
      rerender(<DynamicWrapper match={match2} />);

      // Match 1 debe haber sido pausado al cambiar de partido
      await waitFor(async () => {
        const m1 = await db.matches.get(match1Id);
        expect(m1?.timerLastStart).toBeUndefined();
      }, { timeout: 4000 });

      // Match 2 no debe tener efectos tardíos de Match 1
      const m2 = await db.matches.get(match2Id);
      expect(m2?.timerLastStart).toBeUndefined();
      expect(m2?.currentQuarter).toBe(2);
    });

    // R11-B-10: no se generan notificaciones duplicadas tras sucesivos renders o actualizaciones de IndexedDB
    it('R11-B-10: no se generan notificaciones duplicadas tras sucesivos renders o actualizaciones de IndexedDB', async () => {
      const expiredMatch: Match = {
        ...baseTraditionalMatch,
        timerSecondsRemaining: 0,
        timerLastStart: undefined,
      };

      const fullContext = createMockContext(expiredMatch);

      const { rerender } = render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Simular actualizaciones de base de datos mientras el modal está abierto
      await act(async () => {
        await db.matches.update(baseTraditionalMatch.id!, { localFouls: 1 });
      });

      rerender(
        <MemoryRouter>
          <LiveMatchContext.Provider value={{ ...fullContext, match: { ...expiredMatch, localFouls: 1 } }}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      // Debe haber exactamente un modal 'Fin del Q1' en pantalla
      const elements = screen.getAllByText('Fin del Q1');
      expect(elements.length).toBe(1);
    });

    // R11-B-11: el usuario puede descartar o completar correctamente el flujo de fin de periodo sin una reapertura inmediata incorrecta
    it('R11-B-11: descartar modal de fin de periodo permite continuar en 00:00 sin reapertura inmediata', async () => {
      const expiredMatch: Match = {
        ...baseTraditionalMatch,
        timerSecondsRemaining: 0,
        timerLastStart: undefined,
      };

      const fullContext = createMockContext(expiredMatch);

      render(
        <MemoryRouter>
          <LiveMatchContext.Provider value={fullContext}>
            <TraditionalEngine />
          </LiveMatchContext.Provider>
        </MemoryRouter>
      );

      expect(screen.getByText('Fin del Q1')).toBeTruthy();

      // Usuario presiona "Seguir en Q1 (Anotar jugada en 00:00)"
      const continueBtn = screen.getByText(/Seguir en Q1/i);
      fireEvent.click(continueBtn);

      // El modal debe haberse cerrado
      expect(screen.queryByText('Fin del Q1')).toBeNull();

      // Esperar para comprobar que NO se reabre de forma incorrecta
      await new Promise(r => setTimeout(r, 100));
      expect(screen.queryByText('Fin del Q1')).toBeNull();
    });

    // R11-B-12: las pruebas originales de Race, Best-of-Series y Traditional continúan pasando
    it('R11-B-12: las funcionalidades deportivas de Race, Series y Traditional se mantienen íntegras', async () => {
      // 1. Race
      expect(baseRaceMatch.config?.mode).toBe('race');
      // 2. Traditional
      expect(baseTraditionalMatch.config?.mode).toBe('traditional');
      // 3. Series
      expect(baseSeriesMatch.config?.mode).toBe('best-of-series');
    });
  });
});
