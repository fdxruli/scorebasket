import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db';
import type { Match, Score } from '../db/models';
import {
  calculateRaceWinner,
  resolveRaceGameResult,
  getRaceDisplaySummary,
  buildRaceReportProjection,
} from '../utils/raceLogicHelpers';
import { buildShareMatchCardInputFromDb } from '../utils/shareCardGenerator';

describe('SB-07 & C-03: Race Mode Ties, Winners, and Report Projections Without Fictitious Ties', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  describe('calculateRaceWinner()', () => {
    it('returns null for an active race at 0-0', () => {
      const winner = calculateRaceWinner(0, 0, 21, false);
      expect(winner).toBeNull();
    });

    it('returns null when scores are below target', () => {
      expect(calculateRaceWinner(15, 10, 21, false)).toBeNull();
      expect(calculateRaceWinner(10, 15, 21, false)).toBeNull();
    });

    it('returns "local" when local reaches target score (winByTwo=false)', () => {
      const winner = calculateRaceWinner(21, 18, 21, false);
      expect(winner).toBe('local');
    });

    it('returns "visitor" when visitor reaches target score (winByTwo=false)', () => {
      const winner = calculateRaceWinner(19, 21, 21, false);
      expect(winner).toBe('visitor');
    });

    it('does not declare a winner when target reached without 2-point difference when winByTwo=true', () => {
      expect(calculateRaceWinner(21, 20, 21, true)).toBeNull();
      expect(calculateRaceWinner(20, 21, 21, true)).toBeNull();
    });

    it('declares winner with valid 2-point difference when winByTwo=true', () => {
      expect(calculateRaceWinner(22, 20, 21, true)).toBe('local');
      expect(calculateRaceWinner(21, 23, 21, true)).toBe('visitor');
    });
  });

  describe('resolveRaceGameResult()', () => {
    it('returns "unresolved" for an ongoing match with no target reached', () => {
      const res = resolveRaceGameResult(5, 7, 21, false, false);
      expect(res).toBe('unresolved');
    });

    it('returns "tie" when explicitly finished with equal scores (0-0, 10-10)', () => {
      expect(resolveRaceGameResult(10, 10, 21, false, true)).toBe('tie');
      expect(resolveRaceGameResult(0, 0, 21, false, true)).toBe('tie');
    });

    it('returns "local" when local reaches target or leads on early close', () => {
      expect(resolveRaceGameResult(21, 14, 21, false, false)).toBe('local');
      expect(resolveRaceGameResult(14, 9, 21, false, true)).toBe('local');
    });

    it('returns "visitor" when visitor reaches target or leads on early close', () => {
      expect(resolveRaceGameResult(10, 21, 21, false, false)).toBe('visitor');
      expect(resolveRaceGameResult(8, 12, 21, false, true)).toBe('visitor');
    });
  });

  describe('C-03: 12 Required Race Scenarios (Active vs Completed, Rematches, Reports & Share Cards)', () => {
    it('1. Race en curso 10-8 con meta 21 -> en curso, sin ganador ni empate', () => {
      const match: Match = {
        id: 101,
        localTeamId: 1,
        visitorTeamId: 2,
        status: 'playing',
        createdAt: new Date(),
        localScore: 10,
        visitorScore: 8,
        localFouls: 0,
        visitorFouls: 0,
        localTimeouts: 0,
        visitorTimeouts: 0,
        config: {
          mode: 'race',
          race: { targetScore: 21, winByTwo: false, hasRematches: false, currentGame: 1 },
        },
        gameHistory: [],
      };

      const summary = getRaceDisplaySummary(match);
      expect(summary.status).toBe('in_progress');
      expect(summary.localWon).toBe(false);
      expect(summary.visitorWon).toBe(false);
      expect(summary.isTie).toBe(false);
      expect(summary.tiesCount).toBe(0);
      expect(summary.completedGamesCount).toBe(0);
      expect(summary.activeGame?.state).toBe('in_progress');
      expect(summary.activeGame?.winner).toBe('unresolved');
      expect(summary.activeGame?.finishedAt).toBeUndefined();
    });

    it('2. Race en curso 10-10 con meta 21 -> en curso, NO empate cerrado', () => {
      const match: Match = {
        id: 102,
        localTeamId: 1,
        visitorTeamId: 2,
        status: 'playing',
        createdAt: new Date(),
        localScore: 10,
        visitorScore: 10,
        localFouls: 0,
        visitorFouls: 0,
        localTimeouts: 0,
        visitorTimeouts: 0,
        config: {
          mode: 'race',
          race: { targetScore: 21, winByTwo: false, hasRematches: false, currentGame: 1 },
        },
        gameHistory: [],
      };

      const summary = getRaceDisplaySummary(match);
      expect(summary.status).toBe('in_progress');
      expect(summary.isTie).toBe(false);
      expect(summary.tiesCount).toBe(0);
      expect(summary.completedGamesCount).toBe(0);
      expect(summary.activeGame?.winner).toBe('unresolved');
    });

    it('3. Race finalizado anticipadamente 10-10 -> empate real', () => {
      const closedAt = new Date('2026-03-01T18:00:00.000Z');
      const match: Match = {
        id: 103,
        localTeamId: 1,
        visitorTeamId: 2,
        status: 'finished',
        createdAt: new Date('2026-03-01T17:30:00.000Z'),
        finishedAt: closedAt,
        localScore: 10,
        visitorScore: 10,
        localFouls: 0,
        visitorFouls: 0,
        localTimeouts: 0,
        visitorTimeouts: 0,
        config: {
          mode: 'race',
          race: { targetScore: 21, winByTwo: false, hasRematches: false, currentGame: 1 },
        },
        gameHistory: [
          { gameNumber: 1, localScore: 10, visitorScore: 10, winner: 'tie', finishedAt: closedAt },
        ],
      };

      const summary = getRaceDisplaySummary(match);
      expect(summary.status).toBe('tie');
      expect(summary.isTie).toBe(true);
      expect(summary.localWon).toBe(false);
      expect(summary.visitorWon).toBe(false);
      expect(summary.tiesCount).toBe(1);
      expect(summary.completedGamesCount).toBe(1);
      expect(summary.activeGame).toBeNull();
    });

    it('4. Race finalizado 21-18 -> ganador local', () => {
      const closedAt = new Date('2026-03-01T18:10:00.000Z');
      const match: Match = {
        id: 104,
        localTeamId: 1,
        visitorTeamId: 2,
        status: 'finished',
        createdAt: new Date(),
        finishedAt: closedAt,
        localScore: 21,
        visitorScore: 18,
        localFouls: 0,
        visitorFouls: 0,
        localTimeouts: 0,
        visitorTimeouts: 0,
        config: {
          mode: 'race',
          race: { targetScore: 21, winByTwo: false, hasRematches: false, currentGame: 1 },
        },
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: closedAt },
        ],
      };

      const summary = getRaceDisplaySummary(match);
      expect(summary.status).toBe('local_win');
      expect(summary.localWon).toBe(true);
      expect(summary.visitorWon).toBe(false);
      expect(summary.isTie).toBe(false);
      expect(summary.localGamesWon).toBe(1);
      expect(summary.visitorGamesWon).toBe(0);
    });

    it('5. Race finalizado 18-21 -> ganador visitante', () => {
      const closedAt = new Date('2026-03-01T18:20:00.000Z');
      const match: Match = {
        id: 105,
        localTeamId: 1,
        visitorTeamId: 2,
        status: 'finished',
        createdAt: new Date(),
        finishedAt: closedAt,
        localScore: 18,
        visitorScore: 21,
        localFouls: 0,
        visitorFouls: 0,
        localTimeouts: 0,
        visitorTimeouts: 0,
        config: {
          mode: 'race',
          race: { targetScore: 21, winByTwo: false, hasRematches: false, currentGame: 1 },
        },
        gameHistory: [
          { gameNumber: 1, localScore: 18, visitorScore: 21, winner: 'visitor', finishedAt: closedAt },
        ],
      };

      const summary = getRaceDisplaySummary(match);
      expect(summary.status).toBe('visitor_win');
      expect(summary.visitorWon).toBe(true);
      expect(summary.localWon).toBe(false);
      expect(summary.isTie).toBe(false);
      expect(summary.visitorGamesWon).toBe(1);
      expect(summary.localGamesWon).toBe(0);
    });

    it('6. Race 0-0 activo -> en curso, sin ganador ni empate falso', () => {
      const match: Match = {
        id: 106,
        localTeamId: 1,
        visitorTeamId: 2,
        status: 'playing',
        createdAt: new Date(),
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0,
        localTimeouts: 0,
        visitorTimeouts: 0,
        config: {
          mode: 'race',
          race: { targetScore: 21, winByTwo: false, hasRematches: false, currentGame: 1 },
        },
        gameHistory: [],
      };

      const projection = buildRaceReportProjection(match, []);
      expect(projection.summary.status).toBe('in_progress');
      expect(projection.summary.isTie).toBe(false);
      expect(projection.summary.tiesCount).toBe(0);
      expect(projection.completedGames).toHaveLength(0);
      expect(projection.activeGame).not.toBeNull();
      expect(projection.activeGame?.winner).toBe('unresolved');
      expect(projection.activeGame?.state).toBe('in_progress');
      expect(projection.activeGame?.finishedAt).toBeUndefined();
    });

    it('7. Revancha con 1 juego cerrado y 1 juego activo -> 1 juego cerrado + 1 en curso', () => {
      const game1ClosedAt = new Date('2026-03-01T19:00:00.000Z');
      const match: Match = {
        id: 107,
        localTeamId: 1,
        visitorTeamId: 2,
        status: 'playing',
        createdAt: new Date(),
        localScore: 7,
        visitorScore: 9,
        localFouls: 0,
        visitorFouls: 0,
        localTimeouts: 0,
        visitorTimeouts: 0,
        config: {
          mode: 'race',
          race: { targetScore: 21, winByTwo: false, hasRematches: true, currentGame: 2 },
        },
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: game1ClosedAt },
        ],
      };

      const scores: Score[] = [
        { matchId: 107, teamId: 1, playerId: 1, points: 3, quarter: 1, createdAt: game1ClosedAt },
        { matchId: 107, teamId: 2, playerId: 2, points: 3, quarter: 1, createdAt: game1ClosedAt },
        { matchId: 107, teamId: 1, playerId: 1, points: 3, quarter: 2, createdAt: new Date() },
        { matchId: 107, teamId: 2, playerId: 2, points: 3, quarter: 2, createdAt: new Date() },
      ];

      const projection = buildRaceReportProjection(match, scores);
      expect(projection.completedGames).toHaveLength(1);
      expect(projection.completedGames[0].winner).toBe('local');
      expect(projection.projectedGames[0].state).toBe('completed');
      expect(projection.completedGames[0].finishedAt).toEqual(game1ClosedAt);

      expect(projection.activeGame).not.toBeNull();
      expect(projection.activeGame?.gameNumber).toBe(2);
      expect(projection.activeGame?.localScore).toBe(7);
      expect(projection.activeGame?.visitorScore).toBe(9);
      expect(projection.activeGame?.state).toBe('in_progress');
      expect(projection.activeGame?.winner).toBe('unresolved');
      expect(projection.activeGame?.finishedAt).toBeUndefined();

      // Active game MUST NOT be counted as a tie or completed game
      expect(projection.summary.completedGamesCount).toBe(1);
      expect(projection.summary.tiesCount).toBe(0);
    });

    it('8. Revancha con 2 juegos cerrados y tercero activo -> 2 cerrados, tercero no contado como empate', () => {
      const g1Date = new Date('2026-03-01T19:00:00.000Z');
      const g2Date = new Date('2026-03-01T19:15:00.000Z');
      const match: Match = {
        id: 108,
        localTeamId: 1,
        visitorTeamId: 2,
        status: 'playing',
        createdAt: new Date(),
        localScore: 12,
        visitorScore: 12, // Currently tied in-progress in game 3!
        localFouls: 0,
        visitorFouls: 0,
        localTimeouts: 0,
        visitorTimeouts: 0,
        config: {
          mode: 'race',
          race: { targetScore: 21, winByTwo: false, hasRematches: true, currentGame: 3 },
        },
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 17, winner: 'local', finishedAt: g1Date },
          { gameNumber: 2, localScore: 14, visitorScore: 21, winner: 'visitor', finishedAt: g2Date },
        ],
      };

      const projection = buildRaceReportProjection(match, []);
      expect(projection.completedGames).toHaveLength(2);
      expect(projection.summary.completedGamesCount).toBe(2);
      expect(projection.summary.localGamesWon).toBe(1);
      expect(projection.summary.visitorGamesWon).toBe(1);
      expect(projection.summary.tiesCount).toBe(0); // Game 3 is 12-12 in progress, NOT a closed tie!
      expect(projection.summary.isTie).toBe(false); // Match is still playing!
      expect(projection.activeGame?.gameNumber).toBe(3);
      expect(projection.activeGame?.winner).toBe('unresolved');
    });

    it('9. Revancha con empate real cerrado -> incrementa tiesCount sin sumar victorias', () => {
      const g1Date = new Date('2026-03-01T19:00:00.000Z');
      const g2Date = new Date('2026-03-01T19:15:00.000Z');
      const g3Date = new Date('2026-03-01T19:30:00.000Z');
      const match: Match = {
        id: 109,
        localTeamId: 1,
        visitorTeamId: 2,
        status: 'finished',
        createdAt: new Date(),
        finishedAt: g3Date,
        localScore: 21,
        visitorScore: 19,
        localFouls: 0,
        visitorFouls: 0,
        localTimeouts: 0,
        visitorTimeouts: 0,
        config: {
          mode: 'race',
          race: { targetScore: 21, winByTwo: false, hasRematches: true, currentGame: 3 },
        },
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: g1Date },
          { gameNumber: 2, localScore: 12, visitorScore: 12, winner: 'tie', finishedAt: g2Date },
          { gameNumber: 3, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: g3Date },
        ],
      };

      const summary = getRaceDisplaySummary(match);
      expect(summary.completedGamesCount).toBe(3);
      expect(summary.localGamesWon).toBe(2);
      expect(summary.visitorGamesWon).toBe(0);
      expect(summary.tiesCount).toBe(1);
      expect(summary.localWon).toBe(true);
      expect(summary.isTie).toBe(false);
    });

    it('10. Generación de tarjeta compartible (buildShareMatchCardInputFromDb) sin entradas ficticias de juegos en curso', async () => {
      const localTeamId = (await db.teams.add({ name: 'Street Kings', createdAt: new Date(), isArchived: false })) as number;
      const visitorTeamId = (await db.teams.add({ name: 'Hoopers', createdAt: new Date(), isArchived: false })) as number;
      const g1Closed = new Date('2026-03-01T20:00:00.000Z');

      const matchId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'playing',
        createdAt: new Date(),
        localScore: 6,
        visitorScore: 6,
        localFouls: 1,
        visitorFouls: 1,
        localTimeouts: 0,
        visitorTimeouts: 0,
        config: {
          mode: 'race',
          race: { targetScore: 21, winByTwo: false, hasRematches: true, currentGame: 2 },
        },
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 16, winner: 'local', finishedAt: g1Closed },
        ],
      })) as number;

      await db.scores.bulkAdd([
        { matchId, teamId: localTeamId, playerId: 1, points: 3, quarter: 1, createdAt: g1Closed },
        { matchId, teamId: visitorTeamId, playerId: 2, points: 2, quarter: 1, createdAt: g1Closed },
        { matchId, teamId: localTeamId, playerId: 1, points: 3, quarter: 2, createdAt: new Date() },
        { matchId, teamId: visitorTeamId, playerId: 2, points: 3, quarter: 2, createdAt: new Date() },
      ]);

      const cardInput = (await buildShareMatchCardInputFromDb(matchId))!;

      // Card input for an active rematch series:
      // - Must mark isFinished as false
      // - periodStats must contain ONLY completed games (Game 1), NOT the in-progress Game 2 as a completed period
      expect(cardInput.isFinished).toBe(false);
      expect(cardInput.periodStats).toHaveLength(1);
      expect(cardInput.periodStats[0]).toEqual({
        label: 'Juego 1',
        local: 21,
        visitor: 16,
      });
      expect(cardInput.mainLocalScore).toBe(1); // 1 game won by local
      expect(cardInput.mainVisitorScore).toBe(0); // 0 games won by visitor
    });

    it('11. Consistencia exacta entre MatchHistoryModal (buildRaceReportProjection) y shareCardGenerator (buildShareMatchCardInputFromDb)', async () => {
      const localTeamId = (await db.teams.add({ name: 'Team North', createdAt: new Date(), isArchived: false })) as number;
      const visitorTeamId = (await db.teams.add({ name: 'Team South', createdAt: new Date(), isArchived: false })) as number;
      const g1Date = new Date('2026-03-02T10:00:00.000Z');
      const g2Date = new Date('2026-03-02T10:20:00.000Z');

      const matchId = (await db.matches.add({
        localTeamId,
        visitorTeamId,
        status: 'finished',
        createdAt: new Date('2026-03-02T09:50:00.000Z'),
        finishedAt: g2Date,
        localScore: 15,
        visitorScore: 21,
        localFouls: 2,
        visitorFouls: 2,
        localTimeouts: 0,
        visitorTimeouts: 0,
        config: {
          mode: 'race',
          race: { targetScore: 21, winByTwo: false, hasRematches: true, currentGame: 2 },
        },
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 18, winner: 'local', finishedAt: g1Date },
          { gameNumber: 2, localScore: 15, visitorScore: 21, winner: 'visitor', finishedAt: g2Date },
        ],
      })) as number;

      const match = (await db.matches.get(matchId))!;
      const scores = await db.scores.where('matchId').equals(matchId).toArray();

      const modalProjection = buildRaceReportProjection(match, scores);
      const shareCardInput = (await buildShareMatchCardInputFromDb(matchId))!;

      expect(modalProjection.summary.localDisplayScore).toBe(shareCardInput.mainLocalScore);
      expect(modalProjection.summary.visitorDisplayScore).toBe(shareCardInput.mainVisitorScore);
      expect(modalProjection.completedGames).toHaveLength(shareCardInput.periodStats.length);
      expect(modalProjection.summary.isTie).toBe(true); // 1-1 series tie
      expect(shareCardInput.isFinished).toBe(true);
    });

    it('12. Uso de finishedAt únicamente cuando el juego realmente terminó (nunca fabricado en juegos activos)', () => {
      const activeMatch: Match = {
        id: 112,
        localTeamId: 1,
        visitorTeamId: 2,
        status: 'playing',
        createdAt: new Date('2026-03-02T12:00:00.000Z'),
        localScore: 14,
        visitorScore: 11,
        localFouls: 0,
        visitorFouls: 0,
        localTimeouts: 0,
        visitorTimeouts: 0,
        config: {
          mode: 'race',
          race: { targetScore: 21, winByTwo: false, hasRematches: false, currentGame: 1 },
        },
        gameHistory: [],
      };

      const activeProjection = buildRaceReportProjection(activeMatch, []);
      expect(activeProjection.activeGame).not.toBeNull();
      expect(activeProjection.activeGame?.finishedAt).toBeUndefined();
      expect(activeProjection.projectedGames[0].finishedAt).toBeUndefined();

      const explicitEnd = new Date('2026-03-02T12:30:00.000Z');
      const finishedLegacyMatchWithoutHistory: Match = {
        ...activeMatch,
        status: 'finished',
        finishedAt: explicitEnd,
        localScore: 21,
        visitorScore: 11,
      };

      const finishedProjection = buildRaceReportProjection(finishedLegacyMatchWithoutHistory, []);
      expect(finishedProjection.activeGame).toBeNull();
      expect(finishedProjection.completedGames).toHaveLength(1);
      expect(finishedProjection.completedGames[0].finishedAt).toEqual(explicitEnd);
    });
  });
});
