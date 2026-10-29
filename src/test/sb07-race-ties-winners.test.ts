import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db';
import type { Match } from '../db/models';
import {
  calculateRaceWinner,
  resolveRaceGameResult,
  getRaceDisplaySummary,
} from '../utils/raceLogicHelpers';

describe('SB-07: Race Mode Ties and Winners Adjudication', () => {
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
      // 21-20: target reached but difference is only 1
      const winner = calculateRaceWinner(21, 20, 21, true);
      expect(winner).toBeNull();

      // 20-21: visitor leads by 1
      const visitorWinner = calculateRaceWinner(20, 21, 21, true);
      expect(visitorWinner).toBeNull();
    });

    it('declares winner with valid 2-point difference when winByTwo=true', () => {
      // 22-20
      const localWinner = calculateRaceWinner(22, 20, 21, true);
      expect(localWinner).toBe('local');

      // 21-23
      const visitorWinner = calculateRaceWinner(21, 23, 21, true);
      expect(visitorWinner).toBe('visitor');
    });
  });

  describe('resolveRaceGameResult()', () => {
    it('returns "unresolved" for an ongoing match with no target reached', () => {
      const res = resolveRaceGameResult(5, 7, 21, false, false);
      expect(res).toBe('unresolved');
    });

    it('returns "tie" when explicitly finished with equal scores (0-0, 10-10)', () => {
      const res10 = resolveRaceGameResult(10, 10, 21, false, true);
      expect(res10).toBe('tie');

      const res0 = resolveRaceGameResult(0, 0, 21, false, true);
      expect(res0).toBe('tie');
    });

    it('returns "local" when local reaches target or leads on early close', () => {
      const regularWin = resolveRaceGameResult(21, 14, 21, false, false);
      expect(regularWin).toBe('local');

      const earlyWin = resolveRaceGameResult(14, 9, 21, false, true);
      expect(earlyWin).toBe('local');
    });

    it('returns "visitor" when visitor reaches target or leads on early close', () => {
      const regularWin = resolveRaceGameResult(10, 21, 21, false, false);
      expect(regularWin).toBe('visitor');

      const earlyWin = resolveRaceGameResult(8, 12, 21, false, true);
      expect(earlyWin).toBe('visitor');
    });
  });

  describe('getRaceDisplaySummary() and Rematches Calculations', () => {
    it('calculates correct games won and ties across a series of rematches', () => {
      const mockMatch: Partial<Match> = {
        id: 1,
        localTeamId: 10,
        visitorTeamId: 20,
        status: 'finished',
        localScore: 21,
        visitorScore: 19,
        config: {
          mode: 'race',
          race: {
            targetScore: 21,
            winByTwo: false,
            hasRematches: true,
            currentGame: 4,
          },
        },
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 15, winner: 'local', finishedAt: new Date() },
          { gameNumber: 2, localScore: 18, visitorScore: 21, winner: 'visitor', finishedAt: new Date() },
          { gameNumber: 3, localScore: 12, visitorScore: 12, winner: 'tie', finishedAt: new Date() }, // Tied rematch!
          { gameNumber: 4, localScore: 21, visitorScore: 19, winner: 'local', finishedAt: new Date() },
        ],
      };

      const summary = getRaceDisplaySummary(mockMatch as Match);

      // Game 1: local, Game 2: visitor, Game 3: tie, Game 4: local
      // Local games won: 2
      // Visitor games won: 1
      // Ties count: 1
      expect(summary.isMultiGame).toBe(true);
      expect(summary.localGamesWon).toBe(2);
      expect(summary.visitorGamesWon).toBe(1);
      expect(summary.tiesCount).toBe(1);
      expect(summary.localWon).toBe(true);
      expect(summary.visitorWon).toBe(false);
      expect(summary.isTie).toBe(false);
      expect(summary.localDisplayScore).toBe(2);
      expect(summary.visitorDisplayScore).toBe(1);
    });

    it('correctly handles series finishing in an overall tie', () => {
      const mockMatch: Partial<Match> = {
        id: 2,
        localTeamId: 10,
        visitorTeamId: 20,
        status: 'finished',
        localScore: 10,
        visitorScore: 10,
        config: {
          mode: 'race',
          race: {
            targetScore: 21,
            winByTwo: false,
            hasRematches: true,
            currentGame: 2,
          },
        },
        gameHistory: [
          { gameNumber: 1, localScore: 21, visitorScore: 10, winner: 'local', finishedAt: new Date() },
          { gameNumber: 2, localScore: 10, visitorScore: 21, winner: 'visitor', finishedAt: new Date() },
        ],
      };

      const summary = getRaceDisplaySummary(mockMatch as Match);

      expect(summary.isMultiGame).toBe(true);
      expect(summary.localGamesWon).toBe(1);
      expect(summary.visitorGamesWon).toBe(1);
      expect(summary.tiesCount).toBe(0);
      expect(summary.localWon).toBe(false);
      expect(summary.visitorWon).toBe(false);
      expect(summary.isTie).toBe(true);
      expect(summary.localDisplayScore).toBe(1);
      expect(summary.visitorDisplayScore).toBe(1);
    });

    it('does not show a winner label during active in-progress single match (no false premature winner)', () => {
      const inProgressMatch: Partial<Match> = {
        id: 3,
        localTeamId: 10,
        visitorTeamId: 20,
        status: 'playing',
        localScore: 8,
        visitorScore: 6,
        config: {
          mode: 'race',
          race: {
            targetScore: 21,
            winByTwo: false,
            hasRematches: false,
            currentGame: 1,
          },
        },
        gameHistory: [],
      };

      const summary = getRaceDisplaySummary(inProgressMatch as Match);

      expect(summary.isMultiGame).toBe(false);
      expect(summary.localDisplayScore).toBe(8);
      expect(summary.visitorDisplayScore).toBe(6);
      expect(summary.localWon).toBe(false);
      expect(summary.visitorWon).toBe(false);
      expect(summary.isTie).toBe(false);
    });

    it('does not award false win to local when match is tied (e.g. 0-0 or 15-15)', () => {
      const finishedTie: Partial<Match> = {
        id: 4,
        localTeamId: 10,
        visitorTeamId: 20,
        status: 'finished',
        localScore: 15,
        visitorScore: 15,
        config: {
          mode: 'race',
          race: {
            targetScore: 21,
            winByTwo: false,
            hasRematches: false,
            currentGame: 1,
          },
        },
        gameHistory: [
          { gameNumber: 1, localScore: 15, visitorScore: 15, winner: 'tie', finishedAt: new Date() },
        ],
      };

      const summary = getRaceDisplaySummary(finishedTie as Match);

      expect(summary.localWon).toBe(false);
      expect(summary.visitorWon).toBe(false);
      expect(summary.isTie).toBe(true);
      expect(summary.localDisplayScore).toBe(15);
      expect(summary.visitorDisplayScore).toBe(15);
    });
  });
});
