// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { db } from '../db/db';
import { MatchHistoryModal } from '../components/matches/MatchHistoryModal';
import { computeMatchReportStats } from '../utils/matchHelpers';
import { buildShareMatchCardInputFromDb } from '../utils/shareCardGenerator';

describe('DEPORT-02: Reportes y Estadísticas Deportivas (MatchHistoryModal, matchHelpers y shareCardGenerator)', () => {
  beforeEach(async () => {
    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // Helper atómico fiel a useGameActions para registrar jugadas en pruebas
  const recordScoreInTest = async (params: {
    matchId: number;
    teamId: number;
    playerId?: number;
    points: 1 | 2 | 3;
    quarter: number;
  }) => {
    await db.transaction('rw', db.matches, db.scores, async () => {
      const m = await db.matches.get(params.matchId);
      if (!m) throw new Error('Match not found');
      await db.scores.add({
        matchId: params.matchId,
        teamId: params.teamId,
        playerId: params.playerId,
        points: params.points,
        quarter: params.quarter,
        createdAt: new Date()
      });
      const isLocal = params.teamId === m.localTeamId;
      await db.matches.update(params.matchId, {
        localScore: isLocal ? (m.localScore || 0) + params.points : m.localScore || 0,
        visitorScore: !isLocal ? (m.visitorScore || 0) + params.points : m.visitorScore || 0
      });
    });
  };

  const recordFoulInTest = async (params: {
    matchId: number;
    teamId: number;
    playerId?: number;
    quarter: number;
  }) => {
    await db.transaction('rw', db.matches, db.fouls, async () => {
      const m = await db.matches.get(params.matchId);
      if (!m) throw new Error('Match not found');
      await db.fouls.add({
        matchId: params.matchId,
        teamId: params.teamId,
        playerId: params.playerId,
        quarter: params.quarter,
        createdAt: new Date()
      });
      const isLocal = params.teamId === m.localTeamId;
      await db.matches.update(params.matchId, {
        localFouls: isLocal ? (m.localFouls || 0) + 1 : m.localFouls || 0,
        visitorFouls: !isLocal ? (m.visitorFouls || 0) + 1 : m.visitorFouls || 0
      });
    });
  };

  // =========================================================================
  // 1. PRUEBA PRINCIPAL OBLIGATORIA
  // =========================================================================
  it('PRUEBA PRINCIPAL: calcula y presenta exactamente Local 8 - Visitante 3, desglose de canastas (+1, +2, +3), faltas, sin jugador asignado, recarga offline y tarjeta compartida consistente', async () => {
    const localTeamId = Number(
      await db.teams.add({ name: 'Halcones Local', createdAt: new Date(), isArchived: false })
    );
    const visitorTeamId = Number(
      await db.teams.add({ name: 'Toros Visita', createdAt: new Date(), isArchived: false })
    );

    const playerAId = Number(
      await db.players.add({
        teamId: localTeamId,
        name: 'Jugador A',
        number: 10,
        createdAt: new Date(),
        isArchived: false
      })
    );
    const playerBId = Number(
      await db.players.add({
        teamId: visitorTeamId,
        name: 'Jugador B',
        number: 23,
        createdAt: new Date(),
        isArchived: false
      })
    );

    const matchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        currentQuarter: 1,
        totalQuarters: 4,
        quarterDuration: 10,
        timerSecondsRemaining: 600,
        status: 'playing',
        eventsProvenance: 'live_session',
        createdAt: new Date('2026-04-11T18:00:00.000Z'),
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 2 }
        }
      })
    );

    // Equipo local: Jugador A (+1 en Q1, +2 en Q2, +3 en Q3), +2 sin jugador en Q4, 1 falta a Jugador A
    await recordScoreInTest({ matchId, teamId: localTeamId, playerId: playerAId, points: 1, quarter: 1 });
    await recordScoreInTest({ matchId, teamId: localTeamId, playerId: playerAId, points: 2, quarter: 2 });
    await recordScoreInTest({ matchId, teamId: localTeamId, playerId: playerAId, points: 3, quarter: 3 });
    await recordScoreInTest({ matchId, teamId: localTeamId, playerId: undefined, points: 2, quarter: 4 });
    await recordFoulInTest({ matchId, teamId: localTeamId, playerId: playerAId, quarter: 4 });

    // Equipo visitante: Jugador B (+3 en Q2), 1 falta a Jugador B
    await recordScoreInTest({ matchId, teamId: visitorTeamId, playerId: playerBId, points: 3, quarter: 2 });
    await recordFoulInTest({ matchId, teamId: visitorTeamId, playerId: playerBId, quarter: 2 });

    // Finalizar partido
    await db.matches.update(matchId, { status: 'finished', currentQuarter: 4 });

    // 1A. Verificación directa del motor de cálculo
    const [match, scores, fouls, players] = await Promise.all([
      db.matches.get(matchId),
      db.scores.where({ matchId }).toArray(),
      db.fouls.where({ matchId }).toArray(),
      db.players.where('teamId').anyOf([localTeamId, visitorTeamId]).toArray()
    ]);

    const report = computeMatchReportStats({
      match: match!,
      scores,
      fouls,
      players
    });

    expect(report.mainLocalScore).toBe(8);
    expect(report.mainVisitorScore).toBe(3);
    expect(report.localWon).toBe(true);
    expect(report.visitorWon).toBe(false);
    expect(report.hasCompleteEvents).toBe(true);
    expect(report.integrityNotice).toBeNull();

    // Estadísticas por equipo (no confundir cantidad de canastas con puntos)
    expect(report.localTeamStats.officialPoints).toBe(8);
    expect(report.localTeamStats.baskets1).toBe(1);
    expect(report.localTeamStats.baskets2).toBe(2); // 1 de Jugador A + 1 sin jugador
    expect(report.localTeamStats.baskets3).toBe(1);
    expect(report.localTeamStats.totalBaskets).toBe(4); // 4 canastas registradas != 8 puntos
    expect(report.localTeamStats.fouls).toBe(1);

    expect(report.visitorTeamStats.officialPoints).toBe(3);
    expect(report.visitorTeamStats.baskets1).toBe(0);
    expect(report.visitorTeamStats.baskets2).toBe(0);
    expect(report.visitorTeamStats.baskets3).toBe(1);
    expect(report.visitorTeamStats.totalBaskets).toBe(1); // 1 canasta registrada != 3 puntos
    expect(report.visitorTeamStats.fouls).toBe(1);

    // Estadísticas de Jugador A
    expect(report.localTeamStats.players).toHaveLength(1);
    expect(report.localTeamStats.players[0]).toEqual({
      id: playerAId,
      name: 'Jugador A',
      number: 10,
      points: 6,
      baskets1: 1,
      baskets2: 1,
      baskets3: 1,
      totalBaskets: 3,
      fouls: 1
    });

    // Sin jugador asignado (Local)
    expect(report.localTeamStats.unassigned).toEqual({
      points: 2,
      baskets1: 0,
      baskets2: 1,
      baskets3: 0,
      totalBaskets: 1,
      fouls: 0,
      hasData: true
    });

    // Estadísticas de Jugador B
    expect(report.visitorTeamStats.players).toHaveLength(1);
    expect(report.visitorTeamStats.players[0]).toEqual({
      id: playerBId,
      name: 'Jugador B',
      number: 23,
      points: 3,
      baskets1: 0,
      baskets2: 0,
      baskets3: 1,
      totalBaskets: 1,
      fouls: 1
    });
    expect(report.visitorTeamStats.unassigned.hasData).toBe(false);

    // Desglose por periodos (Q1: 1-0, Q2: 2-3, Q3: 3-0, Q4: 2-0)
    expect(report.periodStats.map(p => ({ label: p.label, local: p.local, visitor: p.visitor }))).toEqual([
      { label: 'Q1', local: 1, visitor: 0 },
      { label: 'Q2', local: 2, visitor: 3 },
      { label: 'Q3', local: 3, visitor: 0 },
      { label: 'Q4', local: 2, visitor: 0 }
    ]);

    // 1B. Renderizado en MatchHistoryModal y persistencia tras desmontar y volver a abrir (recarga offline)
    const { unmount } = render(<MatchHistoryModal matchId={matchId} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('report-main-local-score').textContent).toBe('8');
      expect(screen.getByTestId('report-main-visitor-score').textContent).toBe('3');
    });

    expect(screen.getByTestId('report-winner-summary').textContent).toContain('Ganador: Halcones Local');
    expect(screen.getByTestId('report-fouls-summary').textContent).toContain('Faltas: 1 - 1');

    // Verificar tabla de equipo
    expect(within(screen.getByTestId('team-stat-points')).getAllByText('8')).toHaveLength(1);
    expect(within(screen.getByTestId('team-stat-points')).getAllByText('3')).toHaveLength(1);
    expect(within(screen.getByTestId('team-stat-total-baskets')).getByText('4')).toBeDefined();
    expect(within(screen.getByTestId('team-stat-total-baskets')).getByText('1')).toBeDefined();

    // Verificar filas de jugadores y sin jugador asignado
    const rowPlayerA = screen.getByTestId(`player-row-${playerAId}`);
    expect(rowPlayerA.textContent).toContain('Jugador A');
    expect(rowPlayerA.textContent).toContain('6');

    const rowUnassignedLocal = screen.getByTestId('unassigned-row-local');
    expect(rowUnassignedLocal.textContent).toContain('Sin jugador asignado');
    expect(rowUnassignedLocal.textContent).toContain('2');

    const rowPlayerB = screen.getByTestId(`player-row-${playerBId}`);
    expect(rowPlayerB.textContent).toContain('Jugador B');
    expect(rowPlayerB.textContent).toContain('3');

    // Simular cierre y reapertura (recarga desde IndexedDB sin red)
    unmount();
    render(<MatchHistoryModal matchId={matchId} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('report-main-local-score').textContent).toBe('8');
      expect(screen.getByTestId('unassigned-row-local').textContent).toContain('Sin jugador asignado');
    });

    // 1C. Tarjeta compartida consistente con el reporte
    const cardPayload = await buildShareMatchCardInputFromDb(matchId);
    expect(cardPayload).not.toBeNull();
    expect(cardPayload!.mainLocalScore).toBe(8);
    expect(cardPayload!.mainVisitorScore).toBe(3);
    expect(cardPayload!.localPointsScored).toBe(8);
    expect(cardPayload!.visitorPointsScored).toBe(3);
    expect(cardPayload!.localFoulsTotal).toBe(1);
    expect(cardPayload!.visitorFoulsTotal).toBe(1);
    expect(cardPayload!.localPlayers[0]).toMatchObject({
      name: 'Jugador A',
      points: 6,
      fouls: 1,
      baskets1: 1,
      baskets2: 1,
      baskets3: 1
    });
  });

  // =========================================================================
  // 2. REGRESIONES POR MODALIDAD Y CASOS BORDE DE INTEGRIDAD
  // =========================================================================
  it('REGRESIÓN 1 (Traditional con OT y ordenación): diferencia tiempo extra (OT1) y ordena jugadores por mayor puntuación', async () => {
    const localTeamId = Number(await db.teams.add({ name: 'Local OT', createdAt: new Date() }));
    const visitorTeamId = Number(await db.teams.add({ name: 'Visita OT', createdAt: new Date() }));
    const p1 = Number(
      await db.players.add({ teamId: localTeamId, name: 'Anotador Menor', number: 4, createdAt: new Date() })
    );
    const p2 = Number(
      await db.players.add({ teamId: localTeamId, name: 'Líder Anotador', number: 9, createdAt: new Date() })
    );

    const matchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        localScore: 12,
        visitorScore: 10,
        localFouls: 0,
        visitorFouls: 0,
        currentQuarter: 5,
        totalQuarters: 4,
        quarterDuration: 10,
        timerSecondsRemaining: 0,
        status: 'finished',
        eventsProvenance: 'live_session',
        createdAt: new Date(),
        config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 2 } }
      })
    );

    // Q1..Q4 empatados 8-8, OT1 (quarter 5): Local +4, Visita +2
    await db.scores.bulkAdd([
      { matchId, teamId: localTeamId, playerId: p1, points: 3, quarter: 1, createdAt: new Date() },
      { matchId, teamId: localTeamId, playerId: p2, points: 3, quarter: 2, createdAt: new Date() },
      { matchId, teamId: localTeamId, playerId: p2, points: 2, quarter: 4, createdAt: new Date() },
      { matchId, teamId: localTeamId, playerId: p2, points: 2, quarter: 5, createdAt: new Date() },
      { matchId, teamId: localTeamId, playerId: p2, points: 2, quarter: 5, createdAt: new Date() },
      { matchId, teamId: visitorTeamId, points: 3, quarter: 1, createdAt: new Date() },
      { matchId, teamId: visitorTeamId, points: 3, quarter: 3, createdAt: new Date() },
      { matchId, teamId: visitorTeamId, points: 2, quarter: 4, createdAt: new Date() },
      { matchId, teamId: visitorTeamId, points: 2, quarter: 5, createdAt: new Date() }
    ]);

    const match = (await db.matches.get(matchId))!;
    const scores = await db.scores.where({ matchId }).toArray();
    const players = await db.players.where('teamId').anyOf([localTeamId, visitorTeamId]).toArray();

    const report = computeMatchReportStats({ match, scores, fouls: [], players });
    expect(report.periodStats.map(p => p.label)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'OT1']);
    expect(report.periodStats[4]).toMatchObject({ label: 'OT1', local: 4, visitor: 2 });

    // Jugador p2 (9 pts) debe aparecer antes que p1 (3 pts)
    expect(report.localTeamStats.players.map(p => p.name)).toEqual(['Líder Anotador', 'Anotador Menor']);
  });

  it('REGRESIÓN 2 (Race to Score con revanchas): no duplica puntos al combinar eventos con gameHistory y conserva faltas de todos los juegos', async () => {
    const localTeamId = Number(await db.teams.add({ name: 'Street Local', createdAt: new Date() }));
    const visitorTeamId = Number(await db.teams.add({ name: 'Street Visita', createdAt: new Date() }));

    const matchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        localScore: 21,
        visitorScore: 15,
        localFouls: 1, // faltas del último juego en el contador vivo
        visitorFouls: 0,
        currentQuarter: 2,
        status: 'finished',
        eventsProvenance: 'live_session',
        createdAt: new Date(),
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 12, winner: 'local', finishedAt: new Date() },
          { gameNumber: 2, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() }
        ],
        config: {
          mode: 'race',
          race: {
            targetScore: 21,
            hasRematches: true,
            currentGame: 2,
            winByTwo: false,
            scoringSystem: 'standard'
          }
        }
      })
    );

    // Eventos de ambos juegos (Juego 1: 21-12, Juego 2: 21-15 -> Total puntos reales: 42 - 27, NO 84 - 54)
    await db.scores.bulkAdd([
      // Juego 1
      ...Array.from({ length: 7 }, () => ({
        matchId,
        teamId: localTeamId,
        points: 3 as const,
        quarter: 1,
        createdAt: new Date()
      })),
      ...Array.from({ length: 4 }, () => ({
        matchId,
        teamId: visitorTeamId,
        points: 3 as const,
        quarter: 1,
        createdAt: new Date()
      })),
      // Juego 2
      ...Array.from({ length: 7 }, () => ({
        matchId,
        teamId: localTeamId,
        points: 3 as const,
        quarter: 2,
        createdAt: new Date()
      })),
      ...Array.from({ length: 5 }, () => ({
        matchId,
        teamId: visitorTeamId,
        points: 3 as const,
        quarter: 2,
        createdAt: new Date()
      }))
    ]);

    // 2 faltas en Juego 1 y 1 falta en Juego 2 para Local (3 en total en db.fouls, aunque match.localFouls quedó en 1)
    await db.fouls.bulkAdd([
      { matchId, teamId: localTeamId, quarter: 1, createdAt: new Date() },
      { matchId, teamId: localTeamId, quarter: 1, createdAt: new Date() },
      { matchId, teamId: localTeamId, quarter: 2, createdAt: new Date() }
    ]);

    const [match, scores, fouls] = await Promise.all([
      db.matches.get(matchId),
      db.scores.where({ matchId }).toArray(),
      db.fouls.where({ matchId }).toArray()
    ]);

    const report = computeMatchReportStats({ match: match!, scores, fouls, players: [] });

    // Marcador principal son JUEGOS ganados (2 - 0)
    expect(report.mainLocalScore).toBe(2);
    expect(report.mainVisitorScore).toBe(0);
    expect(report.scoreUnitLabel).toBe('JUEGOS');

    // Puntos totales anotados por equipo son 42 y 27 (sin duplicar gameHistory + scores)
    expect(report.localTeamStats.officialPoints).toBe(42);
    expect(report.visitorTeamStats.officialPoints).toBe(27);
    expect(report.localTeamStats.baskets3).toBe(14);
    expect(report.localTeamStats.totalBaskets).toBe(14);

    // Faltas totales conservan las 3 faltas registradas entre Juego 1 y Juego 2
    expect(report.localTeamStats.fouls).toBe(3);
  });

  it('REGRESIÓN 3 (Best-of-Series): preserva sets ganados en marcador principal, suma puntos por set sin duplicar y conserva faltas entre sets', async () => {
    const localTeamId = Number(await db.teams.add({ name: 'Serie Local', createdAt: new Date() }));
    const visitorTeamId = Number(await db.teams.add({ name: 'Serie Visita', createdAt: new Date() }));

    const matchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        localScore: 15,
        visitorScore: 9,
        localFouls: 0,
        visitorFouls: 1,
        currentQuarter: 2,
        status: 'finished',
        eventsProvenance: 'live_session',
        createdAt: new Date(),
        gameHistory: [
          { gameNumber: 1, localScore: 15, visitorScore: 12, winner: 'local', finishedAt: new Date() },
          { gameNumber: 2, localScore: 15, visitorScore: 9, winner: 'local', finishedAt: new Date() }
        ],
        config: {
          mode: 'best-of-series',
          bestOf: {
            totalGames: 3,
            targetScorePerGame: 15,
            winByTwo: false,
            currentGame: 2,
            wins: { local: 2, visitor: 0 }
          }
        }
      })
    );

    // Eventos para Set 1 (15-12) y Set 2 (15-9) -> Total puntos: 30 - 21
    await db.scores.bulkAdd([
      ...Array.from({ length: 5 }, () => ({
        matchId,
        teamId: localTeamId,
        points: 3 as const,
        quarter: 1,
        createdAt: new Date()
      })),
      ...Array.from({ length: 4 }, () => ({
        matchId,
        teamId: visitorTeamId,
        points: 3 as const,
        quarter: 1,
        createdAt: new Date()
      })),
      ...Array.from({ length: 5 }, () => ({
        matchId,
        teamId: localTeamId,
        points: 3 as const,
        quarter: 2,
        createdAt: new Date()
      })),
      ...Array.from({ length: 3 }, () => ({
        matchId,
        teamId: visitorTeamId,
        points: 3 as const,
        quarter: 2,
        createdAt: new Date()
      }))
    ]);

    const [match, scores] = await Promise.all([
      db.matches.get(matchId),
      db.scores.where({ matchId }).toArray()
    ]);

    const report = computeMatchReportStats({ match: match!, scores, fouls: [], players: [] });
    expect(report.mainLocalScore).toBe(2);
    expect(report.mainVisitorScore).toBe(0);
    expect(report.scoreUnitLabel).toBe('SETS');
    expect(report.periodStats).toHaveLength(2);
    expect(report.localTeamStats.officialPoints).toBe(30);
    expect(report.visitorTeamStats.officialPoints).toBe(21);
    expect(report.localTeamStats.totalBaskets).toBe(10);
  });

  it('REGRESIÓN 4 (Partido sin jugadores asignados): conserva todos los puntos y faltas bajo "Sin jugador asignado" y nunca los atribuye a un jugador arbitrario', async () => {
    const localTeamId = Number(await db.teams.add({ name: 'Local Sin Asignar', createdAt: new Date() }));
    const visitorTeamId = Number(await db.teams.add({ name: 'Visita Sin Asignar', createdAt: new Date() }));
    // Jugador registrado en plantilla pero que no anotó
    const benchPlayerId = Number(
      await db.players.add({
        teamId: localTeamId,
        name: 'Jugador En Banca',
        number: 99,
        createdAt: new Date()
      })
    );

    const matchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        localScore: 5,
        visitorScore: 2,
        localFouls: 2,
        visitorFouls: 0,
        currentQuarter: 4,
        totalQuarters: 4,
        quarterDuration: 10,
        timerSecondsRemaining: 0,
        status: 'finished',
        eventsProvenance: 'live_session',
        createdAt: new Date(),
        config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 2 } }
      })
    );

    await db.scores.bulkAdd([
      { matchId, teamId: localTeamId, playerId: undefined, points: 2, quarter: 1, createdAt: new Date() },
      { matchId, teamId: localTeamId, playerId: undefined, points: 3, quarter: 2, createdAt: new Date() },
      { matchId, teamId: visitorTeamId, playerId: undefined, points: 2, quarter: 3, createdAt: new Date() }
    ]);
    await db.fouls.bulkAdd([
      { matchId, teamId: localTeamId, playerId: undefined, quarter: 1, createdAt: new Date() },
      { matchId, teamId: localTeamId, playerId: undefined, quarter: 4, createdAt: new Date() }
    ]);

    const [match, scores, fouls, players] = await Promise.all([
      db.matches.get(matchId),
      db.scores.where({ matchId }).toArray(),
      db.fouls.where({ matchId }).toArray(),
      db.players.where('teamId').anyOf([localTeamId, visitorTeamId]).toArray()
    ]);

    const report = computeMatchReportStats({ match: match!, scores, fouls, players });
    // El jugador en banca NO recibe puntos ni faltas arbitrarias
    expect(report.localTeamStats.players.find(p => p.id === benchPlayerId)).toBeUndefined();
    expect(report.localTeamStats.unassigned).toEqual({
      points: 5,
      baskets1: 0,
      baskets2: 1,
      baskets3: 1,
      totalBaskets: 2,
      fouls: 2,
      hasData: true
    });
    expect(report.visitorTeamStats.unassigned).toEqual({
      points: 2,
      baskets1: 0,
      baskets2: 1,
      baskets3: 0,
      totalBaskets: 1,
      fouls: 0,
      hasData: true
    });
  });

  it('REGRESIÓN 5 (Partido histórico con eventos incompletos o ausentes): preserva el marcador oficial del partido y muestra "No disponible" en desglose faltante', async () => {
    const localTeamId = Number(await db.teams.add({ name: 'Histórico Local', createdAt: new Date() }));
    const visitorTeamId = Number(await db.teams.add({ name: 'Histórico Visita', createdAt: new Date() }));

    // Partido con marcador oficial 54 - 48 pero solo 1 evento parcial (+2) guardado
    const matchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        localScore: 54,
        visitorScore: 48,
        localFouls: 6,
        visitorFouls: 4,
        currentQuarter: 4,
        totalQuarters: 4,
        quarterDuration: 10,
        timerSecondsRemaining: 0,
        status: 'finished',
        createdAt: new Date(),
        config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 2 } }
      })
    );

    await db.scores.add({
      matchId,
      teamId: localTeamId,
      points: 2,
      quarter: 1,
      createdAt: new Date()
    });

    render(<MatchHistoryModal matchId={matchId} onClose={() => {}} />);

    await waitFor(() => {
      // NUNCA debe reemplazar 54 por la suma parcial 2
      expect(screen.getByTestId('report-main-local-score').textContent).toBe('54');
      expect(screen.getByTestId('report-main-visitor-score').textContent).toBe('48');
    });

    expect(screen.getByTestId('report-integrity-notice')).toBeDefined();
    expect(screen.getByTestId('team-stat-points').textContent).toContain('54 (2 reg.)');
    expect(screen.getByTestId('team-stat-points').textContent).toContain('48');
    expect(screen.getByTestId('team-stat-baskets2').textContent).toContain('No disponible (1 reg.)');
    expect(screen.getByTestId('team-stat-baskets3').textContent).toContain('No disponible');

    // La tarjeta compartible tampoco reemplaza 54 por 2
    const cardPayload = await buildShareMatchCardInputFromDb(matchId);
    expect(cardPayload!.mainLocalScore).toBe(54);
    expect(cardPayload!.mainVisitorScore).toBe(48);
    expect(cardPayload!.localPointsScored).toBe(54);
    expect(cardPayload!.visitorPointsScored).toBe(48);
  });

  it('REGRESIÓN 6 (Partido con datos válidos en cero): distingue cero real (0) de "No disponible"', async () => {
    const localTeamId = Number(await db.teams.add({ name: 'Cero Local', createdAt: new Date() }));
    const visitorTeamId = Number(await db.teams.add({ name: 'Cero Visita', createdAt: new Date() }));

    const matchId = Number(
      await db.matches.add({
        localTeamId,
        visitorTeamId,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        currentQuarter: 1,
        totalQuarters: 4,
        quarterDuration: 10,
        timerSecondsRemaining: 600,
        status: 'playing',
        eventsProvenance: 'live_session',
        createdAt: new Date(),
        config: { mode: 'traditional', traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 2 } }
      })
    );

    render(<MatchHistoryModal matchId={matchId} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('report-main-local-score').textContent).toBe('0');
      expect(screen.getByTestId('report-main-visitor-score').textContent).toBe('0');
    });

    // No debe mostrar aviso de eventos incompletos ni "No disponible" en las métricas de equipo
    expect(screen.queryByTestId('report-integrity-notice')).toBeNull();
    expect(within(screen.getByTestId('team-stat-baskets1')).getAllByText('0')).toHaveLength(2);
    expect(within(screen.getByTestId('team-stat-baskets2')).getAllByText('0')).toHaveLength(2);
    expect(within(screen.getByTestId('team-stat-baskets3')).getAllByText('0')).toHaveLength(2);
    expect(within(screen.getByTestId('team-stat-total-baskets')).getAllByText('0')).toHaveLength(2);
    expect(within(screen.getByTestId('team-stat-fouls')).getAllByText('0')).toHaveLength(2);
    expect(screen.getByTestId('player-boxscore-local').textContent).toContain(
      'Sin anotaciones ni faltas registradas (0 pts).'
    );
  });
});
