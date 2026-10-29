import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db';
import { TeamsRepository } from '../db/teams.repository';
import { PlayersRepository, createTeamRosterSnapshot } from '../db/players.repository';
import {
  toEditablePlayerRows,
  updateEditablePlayerRow,
  validateNewPlayerDraft,
  prepareEditableRosterForSave,
} from '../components/teams/teamEditorHelpers';

describe('SB-06, C-01, C-02 & C-05: Team, Player Identity, Concurrency, and Form Validations', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  describe('Team Name Validations', () => {
    it('creates a team with valid trimmed name', async () => {
      const teamId = await TeamsRepository.create('  Lakers  ');
      const team = await TeamsRepository.getById(teamId);
      expect(team).toBeDefined();
      expect(team?.name).toBe('Lakers');
      expect(team?.isArchived).toBe(false);
    });

    it('rejects creation with empty or whitespace-only name', async () => {
      await expect(TeamsRepository.create('   ')).rejects.toThrow(
        /El nombre del equipo es obligatorio/i
      );
    });

    it('rejects creation when name already exists active (case-insensitive and trimmed)', async () => {
      await TeamsRepository.create('Celtics');

      // Exact duplicate
      await expect(TeamsRepository.create('Celtics')).rejects.toThrow(
        /Ya existe un equipo activo con ese nombre/i
      );

      // Case-insensitive duplicate
      await expect(TeamsRepository.create('celtics')).rejects.toThrow(
        /Ya existe un equipo activo con ese nombre/i
      );

      // Trimmed duplicate
      await expect(TeamsRepository.create('  CELTICS  ')).rejects.toThrow(
        /Ya existe un equipo activo con ese nombre/i
      );
    });

    it('allows updating an existing team preserving its own name', async () => {
      const teamId = await TeamsRepository.create('Bulls');
      // Renaming to same name should not throw duplicate error
      await expect(TeamsRepository.rename(teamId, 'Bulls')).resolves.not.toThrow();
    });

    it('allows creating a team with the same name as an archived team', async () => {
      const teamId = await TeamsRepository.create('Warriors');
      await TeamsRepository.archive(teamId);

      // Should be permitted because the existing one is archived
      const newTeamId = await TeamsRepository.create('warriors');
      expect(newTeamId).not.toBe(teamId);
      const newTeam = await TeamsRepository.getById(teamId);
      expect(newTeam?.isArchived).toBe(true);
      const activeTeam = await TeamsRepository.getById(newTeamId);
      expect(activeTeam?.name).toBe('warriors');
    });

    it('rejects unarchiving a team if its name collides with an active team', async () => {
      const oldTeamId = await TeamsRepository.create('Heat');
      await TeamsRepository.archive(oldTeamId);

      // Active team created with same name
      await TeamsRepository.create('heat');

      // Attempt to unarchive old team
      await expect(TeamsRepository.unarchive(oldTeamId)).rejects.toThrow(
        /Ya existe un equipo activo llamado "Heat"/i
      );
    });

    it('renames a team safely via rename() method', async () => {
      const teamId = await TeamsRepository.create('Nets');
      await TeamsRepository.rename(teamId, 'Brooklyn Nets');

      const fetched = await TeamsRepository.getById(teamId);
      expect(fetched?.name).toBe('Brooklyn Nets');
    });
  });

  describe('Player Jersey Number Validations', () => {
    it('accepts jersey number 0 and "0"', () => {
      expect(PlayersRepository.validateJerseyNumber(0)).toEqual({
        isValid: true,
        normalizedNumber: 0,
      });
      expect(PlayersRepository.validateJerseyNumber('0')).toEqual({
        isValid: true,
        normalizedNumber: 0,
      });
    });

    it('normalizes "00" to 0', () => {
      expect(PlayersRepository.validateJerseyNumber('00')).toEqual({
        isValid: true,
        normalizedNumber: 0,
      });
    });

    it('accepts valid integers between 0 and 99', () => {
      expect(PlayersRepository.validateJerseyNumber(23)).toEqual({
        isValid: true,
        normalizedNumber: 23,
      });
      expect(PlayersRepository.validateJerseyNumber('77')).toEqual({
        isValid: true,
        normalizedNumber: 77,
      });
      expect(PlayersRepository.validateJerseyNumber(99)).toEqual({
        isValid: true,
        normalizedNumber: 99,
      });
    });

    it('rejects non-numeric strings, negatives, decimals, and numbers > 99', () => {
      expect(PlayersRepository.validateJerseyNumber('12abc').isValid).toBe(false);
      expect(PlayersRepository.validateJerseyNumber(-1).isValid).toBe(false);
      expect(PlayersRepository.validateJerseyNumber(10.5).isValid).toBe(false);
      expect(PlayersRepository.validateJerseyNumber(100).isValid).toBe(false);
      expect(PlayersRepository.validateJerseyNumber('abc').isValid).toBe(false);
    });

    it('rejects duplicate jersey number in the same active team', async () => {
      const teamId = await TeamsRepository.create('Spurs');

      await PlayersRepository.create({
        name: 'Tim Duncan',
        number: 21,
        teamId,
      });

      await expect(
        PlayersRepository.create({
          name: 'Fake Duncan',
          number: 21,
          teamId,
        })
      ).rejects.toThrow(/El dorsal #21 ya está asignado/i);
    });

    it('allows the same jersey number in different teams', async () => {
      const team1Id = await TeamsRepository.create('Rockets');
      const team2Id = await TeamsRepository.create('Mavericks');

      const p1Id = await PlayersRepository.create({
        name: 'Player One',
        number: 11,
        teamId: team1Id,
      });

      const p2Id = await PlayersRepository.create({
        name: 'Player Two',
        number: 11,
        teamId: team2Id,
      });

      const p1 = await db.players.get(p1Id);
      const p2 = await db.players.get(p2Id);

      expect(p1?.number).toBe(11);
      expect(p2?.number).toBe(11);
      expect(p1?.teamId).not.toBe(p2?.teamId);
    });

    it('allows reusing jersey number of an archived player on the same team', async () => {
      const teamId = await TeamsRepository.create('Suns');

      const oldPlayerId = await PlayersRepository.create({
        name: 'Steve Nash',
        number: 13,
        teamId,
      });

      // Archive player
      await db.players.update(oldPlayerId, { isArchived: true, archivedAt: new Date() });

      // Now another active player can use #13
      const newPlayerId = await PlayersRepository.create({
        name: 'New Guard',
        number: 13,
        teamId,
      });

      const newPlayer = await db.players.get(newPlayerId);
      expect(newPlayer?.number).toBe(13);
      expect(newPlayerId).not.toBe(oldPlayerId);
    });

    it('allows updating a player preserving their own jersey number', async () => {
      const teamId = await TeamsRepository.create('Clippers');

      const playerId = await PlayersRepository.create({
        name: 'Kawhi',
        number: 2,
        teamId,
      });

      await PlayersRepository.update(playerId, {
        name: 'Kawhi Leonard',
        number: 2,
      });

      const updated = await db.players.get(playerId);
      expect(updated?.name).toBe('Kawhi Leonard');
      expect(updated?.number).toBe(2);
    });

    it('preserves player statistics when archived', async () => {
      const teamId = await TeamsRepository.create('Hawks');

      const playerId = await PlayersRepository.create({
        name: 'Trae Young',
        number: 11,
        teamId,
      });

      // Archive player
      await db.players.update(playerId, { isArchived: true, archivedAt: new Date() });

      const archived = await db.players.get(playerId);
      expect(archived?.isArchived).toBe(true);
      expect(archived?.name).toBe('Trae Young');
      expect(archived?.number).toBe(11);
    });

    it('saves team and roster atomically via saveTeamAndRoster()', async () => {
      const teamId = await TeamsRepository.create('Thunder');

      const p1Id = await PlayersRepository.create({
        name: 'Player A',
        number: 5,
        teamId,
      });

      // Save roster updating p1 and adding p2
      await PlayersRepository.saveTeamAndRoster({
        teamId,
        teamName: 'OKC Thunder',
        players: [
          { id: p1Id, name: 'Player A Updated', number: 5 },
          { name: 'Player B', number: 7 },
        ],
      });

      const updatedTeam = await TeamsRepository.getById(teamId);
      expect(updatedTeam?.name).toBe('OKC Thunder');

      const roster = await db.players.where({ teamId }).filter((p) => !p.isArchived).toArray();
      expect(roster.length).toBe(2);
      expect(roster.find((p) => p.number === 5)?.name).toBe('Player A Updated');
      expect(roster.find((p) => p.number === 7)?.name).toBe('Player B');
    });

    it('rejects duplicate jerseys in saveTeamAndRoster()', async () => {
      const teamId = await TeamsRepository.create('Nuggets');

      await expect(
        PlayersRepository.saveTeamAndRoster({
          teamId,
          teamName: 'Denver Nuggets',
          players: [
            { name: 'Player 1', number: 15 },
            { name: 'Player 2', number: 15 },
          ],
        })
      ).rejects.toThrow(/El dorsal #15 está duplicado/i);
    });
  });

  describe('C-01: Player Identity, Ownership & Atomic Rollback in saveTeamAndRoster()', () => {
    it('accepts valid player IDs belonging to the edited team', async () => {
      const teamId = await TeamsRepository.create('Bucks');
      const p1Id = await PlayersRepository.create({ name: 'Giannis', number: 34, teamId });
      const p2Id = await PlayersRepository.create({ name: 'Dame', number: 0, teamId });

      await PlayersRepository.saveTeamAndRoster({
        teamId,
        teamName: 'Milwaukee Bucks',
        players: [
          { id: p1Id, name: 'Giannis Antetokounmpo', number: 34 },
          { id: p2Id, name: 'Damian Lillard', number: 0 },
        ],
      });

      const p1 = await db.players.get(p1Id);
      const p2 = await db.players.get(p2Id);
      expect(p1?.name).toBe('Giannis Antetokounmpo');
      expect(p2?.name).toBe('Damian Lillard');
      expect(p2?.number).toBe(0);
    });

    it('rejects player ID belonging to another team without mutating either team or any players', async () => {
      const teamAId = await TeamsRepository.create('Team Alpha');
      const teamBId = await TeamsRepository.create('Team Beta');

      const alphaPlayerId = await PlayersRepository.create({
        name: 'Alpha Captain',
        number: 10,
        teamId: teamAId,
      });
      const betaPlayerId = await PlayersRepository.create({
        name: 'Beta Star',
        number: 23,
        teamId: teamBId,
      });

      // Seed historical score/foul stats on Beta Star
      await db.scores.add({
        matchId: 1,
        teamId: teamBId,
        playerId: betaPlayerId,
        points: 3,
        quarter: 1,
        createdAt: new Date(),
      });

      // Attempt to save Team Alpha while passing betaPlayerId
      await expect(
        PlayersRepository.saveTeamAndRoster({
          teamId: teamAId,
          teamName: 'Team Alpha Renamed',
          players: [
            { id: alphaPlayerId, name: 'Alpha Modified', number: 99 },
            { id: betaPlayerId, name: 'Hijacked Beta Star', number: 7 },
            { name: 'New Alpha Rookie', number: 1 },
          ],
        })
      ).rejects.toThrow(/pertenece a otro equipo/i);

      // Verify full rollback in IndexedDB
      const teamA = await db.teams.get(teamAId);
      expect(teamA?.name).toBe('Team Alpha'); // Not renamed!

      const alphaPlayer = await db.players.get(alphaPlayerId);
      expect(alphaPlayer?.name).toBe('Alpha Captain');
      expect(alphaPlayer?.number).toBe(10);
      expect(alphaPlayer?.isArchived).toBe(false);

      const betaPlayer = await db.players.get(betaPlayerId);
      expect(betaPlayer?.teamId).toBe(teamBId);
      expect(betaPlayer?.name).toBe('Beta Star');
      expect(betaPlayer?.number).toBe(23);
      const betaScores = await db.scores.where('matchId').equals(1).toArray();
      expect(betaScores).toHaveLength(1);
      expect(betaScores[0].playerId).toBe(betaPlayerId);
      expect(betaScores[0].points).toBe(3);

      const allPlayers = await db.players.toArray();
      expect(allPlayers).toHaveLength(2); // Rookie was not created
    });

    it('rejects non-existent player ID with complete rollback', async () => {
      const teamId = await TeamsRepository.create('Knicks');
      const existingId = await PlayersRepository.create({ name: 'Jalen Brunson', number: 11, teamId });

      await expect(
        PlayersRepository.saveTeamAndRoster({
          teamId,
          teamName: 'NY Knicks',
          players: [
            { id: existingId, name: 'Brunson Updated', number: 11 },
            { id: 999999, name: 'Ghost Player', number: 99 },
          ],
        })
      ).rejects.toThrow(/no existe/i);

      const team = await db.teams.get(teamId);
      expect(team?.name).toBe('Knicks');

      const existing = await db.players.get(existingId);
      expect(existing?.name).toBe('Jalen Brunson');
    });

    it('rejects duplicate player IDs within the same save request with complete rollback', async () => {
      const teamId = await TeamsRepository.create('Pacers');
      const p1Id = await PlayersRepository.create({ name: 'Haliburton', number: 0, teamId });

      await expect(
        PlayersRepository.saveTeamAndRoster({
          teamId,
          teamName: 'Indiana Pacers',
          players: [
            { id: p1Id, name: 'Tyrese Haliburton', number: 0 },
            { id: p1Id, name: 'Tyrese Clone', number: 10 },
          ],
        })
      ).rejects.toThrow(/identificador de jugador .* está duplicado/i);

      const team = await db.teams.get(teamId);
      expect(team?.name).toBe('Pacers');
      const p1 = await db.players.get(p1Id);
      expect(p1?.name).toBe('Haliburton');
    });

    it('rejects implicit reactivation of an archived player ID and preserves stats', async () => {
      const teamId = await TeamsRepository.create('Sixers');
      const activeId = await PlayersRepository.create({ name: 'Maxey', number: 0, teamId });
      const archivedId = await PlayersRepository.create({ name: 'Iverson', number: 3, teamId });

      await db.players.update(archivedId, {
        isArchived: true,
        archivedAt: new Date('2025-01-01T00:00:00.000Z'),
      });
      await db.scores.add({
        matchId: 10,
        teamId,
        playerId: archivedId,
        points: 3,
        quarter: 1,
        createdAt: new Date(),
      });

      await expect(
        PlayersRepository.saveTeamAndRoster({
          teamId,
          teamName: 'Philadelphia 76ers',
          players: [
            { id: activeId, name: 'Tyrese Maxey', number: 0 },
            { id: archivedId, name: 'Allen Iverson Reactivated', number: 3 },
          ],
        })
      ).rejects.toThrow(/No se permite reactivar implícitamente/i);

      // Verify state in IndexedDB
      const team = await db.teams.get(teamId);
      expect(team?.name).toBe('Sixers');

      const archivedPlayer = await db.players.get(archivedId);
      expect(archivedPlayer?.isArchived).toBe(true);
      expect(archivedPlayer?.name).toBe('Iverson');
      const archivedScores = await db.scores.where('matchId').equals(10).toArray();
      expect(archivedScores).toHaveLength(1);
      expect(archivedScores[0].playerId).toBe(archivedId);
      expect(archivedScores[0].points).toBe(3);

      const activePlayer = await db.players.get(activeId);
      expect(activePlayer?.name).toBe('Maxey');
    });

    it('rolls back all changes (team rename, archiving, updates, creations) when validation fails at the end of the list', async () => {
      const teamId = await TeamsRepository.create('Magic');
      const p1Id = await PlayersRepository.create({ name: 'Paolo Banchero', number: 5, teamId });
      const p2Id = await PlayersRepository.create({ name: 'Franz Wagner', number: 22, teamId });

      await db.scores.add({
        matchId: 20,
        teamId,
        playerId: p1Id,
        points: 2,
        quarter: 1,
        createdAt: new Date(),
      });

      // Attempt: rename team, archive p2 (omitted), update p1, add valid p3, and fail on last item (invalid jersey 150)
      await expect(
        PlayersRepository.saveTeamAndRoster({
          teamId,
          teamName: 'Orlando Magic Renamed',
          players: [
            { id: p1Id, name: 'Paolo Updated', number: 55 },
            { name: 'Jalen Suggs', number: 4 },
            { name: 'Invalid Last Player', number: 150 },
          ],
        })
      ).rejects.toThrow(/entre 0 y 99/i);

      const team = await db.teams.get(teamId);
      expect(team?.name).toBe('Magic');

      const p1 = await db.players.get(p1Id);
      expect(p1?.name).toBe('Paolo Banchero');
      expect(p1?.number).toBe(5);
      const p1Scores = await db.scores.where('matchId').equals(20).toArray();
      expect(p1Scores).toHaveLength(1);
      expect(p1Scores[0].playerId).toBe(p1Id);
      expect(p1Scores[0].points).toBe(2);

      const p2 = await db.players.get(p2Id);
      expect(p2?.isArchived).toBe(false);
      expect(p2?.name).toBe('Franz Wagner');
      expect(p2?.number).toBe(22);

      const allTeamPlayers = await db.players.where('teamId').equals(teamId).toArray();
      expect(allTeamPlayers).toHaveLength(2);
    });
  });

  describe('C-02: Optimistic Concurrency Control in saveTeamAndRoster() (Scenarios A–E)', () => {
    it('Scenario A: Opening editor with A and B, adding player C externally, then saving editor preserves C as active', async () => {
      const teamId = await TeamsRepository.create('Cavs');
      const playerAId = await PlayersRepository.create({ name: 'Player A', number: 1, teamId });
      const playerBId = await PlayersRepository.create({ name: 'Player B', number: 2, teamId });

      // Editor loads initial state (A and B)
      const teamOnLoad = (await TeamsRepository.getById(teamId))!;
      const playersOnLoad = await PlayersRepository.getActiveByTeam(teamId);
      const initialSnapshot = createTeamRosterSnapshot(teamOnLoad.name, playersOnLoad);

      // Concurrent external operation adds Player C (#3) while editor is open
      const playerCId = await PlayersRepository.create({ name: 'Player C', number: 3, teamId });

      // Original editor saves modifications to Player A (and keeps B)
      await PlayersRepository.saveTeamAndRoster({
        teamId,
        teamName: 'Cavs',
        players: [
          { id: playerAId, name: 'Player A Edited', number: 1 },
          { id: playerBId, name: 'Player B', number: 2 },
        ],
        initialSnapshot,
        removedPlayerIds: [],
      });

      // Verify in IndexedDB: A is updated, B is active, and C is STILL ACTIVE (not archived!)
      const activeRoster = await PlayersRepository.getActiveByTeam(teamId);
      expect(activeRoster).toHaveLength(3);
      expect(activeRoster.find((p) => p.id === playerAId)?.name).toBe('Player A Edited');
      expect(activeRoster.find((p) => p.id === playerBId)?.isArchived).toBe(false);
      expect(activeRoster.find((p) => p.id === playerCId)?.isArchived).toBe(false);
      expect(activeRoster.find((p) => p.id === playerCId)?.name).toBe('Player C');
    });

    it('Scenario B: Opening editor, modifying player A jersey externally, then saving editor rejects with conflict and preserves external change', async () => {
      const teamId = await TeamsRepository.create('Pistons');
      const playerAId = await PlayersRepository.create({ name: 'Cade Cunningham', number: 2, teamId });

      // Editor loads initial snapshot
      const teamOnLoad = (await TeamsRepository.getById(teamId))!;
      const playersOnLoad = await PlayersRepository.getActiveByTeam(teamId);
      const initialSnapshot = createTeamRosterSnapshot(teamOnLoad.name, playersOnLoad);

      // External operation changes Player A's jersey from #2 to #20
      await PlayersRepository.update(playerAId, { number: 20 });

      // Editor attempts to save with old snapshot (where A had #2)
      await expect(
        PlayersRepository.saveTeamAndRoster({
          teamId,
          teamName: 'Pistons',
          players: [{ id: playerAId, name: 'Cade Cunningham', number: 2 }],
          initialSnapshot,
        })
      ).rejects.toThrow(/Conflicto de concurrencia/i);

      // Verify external jersey #20 was NOT overwritten
      const playerA = await db.players.get(playerAId);
      expect(playerA?.number).toBe(20);
    });

    it('Scenario C: User explicitly removes player B without external conflicts -> only B is archived', async () => {
      const teamId = await TeamsRepository.create('Raptors');
      const playerAId = await PlayersRepository.create({ name: 'Scottie Barnes', number: 4, teamId });
      const playerBId = await PlayersRepository.create({ name: 'Gradey Dick', number: 1, teamId });

      const teamOnLoad = (await TeamsRepository.getById(teamId))!;
      const playersOnLoad = await PlayersRepository.getActiveByTeam(teamId);
      const initialSnapshot = createTeamRosterSnapshot(teamOnLoad.name, playersOnLoad);

      // User removes B intentionally and saves
      await PlayersRepository.saveTeamAndRoster({
        teamId,
        teamName: 'Raptors',
        players: [{ id: playerAId, name: 'Scottie Barnes', number: 4 }],
        initialSnapshot,
        removedPlayerIds: [playerBId],
      });

      const playerA = await db.players.get(playerAId);
      const playerB = await db.players.get(playerBId);
      expect(playerA?.isArchived).toBe(false);
      expect(playerB?.isArchived).toBe(true);
      expect(playerB?.archivedAt).toBeInstanceOf(Date);
    });

    it('Scenario D: Conflict during team rename + player creation rolls back the entire transaction', async () => {
      const teamId = await TeamsRepository.create('Hornets');
      const playerAId = await PlayersRepository.create({ name: 'LaMelo Ball', number: 1, teamId });

      const teamOnLoad = (await TeamsRepository.getById(teamId))!;
      const playersOnLoad = await PlayersRepository.getActiveByTeam(teamId);
      const initialSnapshot = createTeamRosterSnapshot(teamOnLoad.name, playersOnLoad);

      // External change renames the team while editor is open
      await TeamsRepository.rename(teamId, 'Charlotte Hornets Official');

      // Editor attempts to rename team and add a new player using stale snapshot
      await expect(
        PlayersRepository.saveTeamAndRoster({
          teamId,
          teamName: 'Stale Hornets Name',
          players: [
            { id: playerAId, name: 'LaMelo Ball', number: 1 },
            { name: 'Brandon Miller', number: 24 },
          ],
          initialSnapshot,
        })
      ).rejects.toThrow(/Conflicto de concurrencia/i);

      const teamAfter = await TeamsRepository.getById(teamId);
      expect(teamAfter?.name).toBe('Charlotte Hornets Official');

      const activePlayers = await PlayersRepository.getActiveByTeam(teamId);
      expect(activePlayers).toHaveLength(1);
      expect(activePlayers[0].name).toBe('LaMelo Ball');
    });

    it('Scenario E: Two editors load the same snapshot and perform incompatible changes -> first succeeds, second is rejected', async () => {
      const teamId = await TeamsRepository.create('Wizards');
      const playerAId = await PlayersRepository.create({ name: 'Jordan Poole', number: 13, teamId });
      const playerBId = await PlayersRepository.create({ name: 'Kyle Kuzma', number: 33, teamId });

      const teamOnLoad = (await TeamsRepository.getById(teamId))!;
      const playersOnLoad = await PlayersRepository.getActiveByTeam(teamId);
      const snapshotEditor1 = createTeamRosterSnapshot(teamOnLoad.name, playersOnLoad);
      const snapshotEditor2 = createTeamRosterSnapshot(teamOnLoad.name, playersOnLoad);

      // Editor 1 updates Player A's jersey to #3 and saves first
      await PlayersRepository.saveTeamAndRoster({
        teamId,
        teamName: 'Wizards',
        players: [
          { id: playerAId, name: 'Jordan Poole', number: 3 },
          { id: playerBId, name: 'Kyle Kuzma', number: 33 },
        ],
        initialSnapshot: snapshotEditor1,
        removedPlayerIds: [],
      });

      // Editor 2 tries to remove Player A and rename Player B using the original snapshot
      await expect(
        PlayersRepository.saveTeamAndRoster({
          teamId,
          teamName: 'Wizards',
          players: [{ id: playerBId, name: 'Kyle Kuzma Edited', number: 33 }],
          initialSnapshot: snapshotEditor2,
          removedPlayerIds: [playerAId],
        })
      ).rejects.toThrow(/Conflicto de concurrencia/i);

      // Verify Editor 1's state remained intact
      const pA = await db.players.get(playerAId);
      const pB = await db.players.get(playerBId);
      expect(pA?.isArchived).toBe(false);
      expect(pA?.number).toBe(3);
      expect(pB?.name).toBe('Kyle Kuzma');
    });
  });

  describe('C-05: Editable Jersey Form State (No Silent Reversion on Invalid Input)', () => {
    it('preserves raw invalid input string instead of reverting to previous valid jersey number', () => {
      const rows = toEditablePlayerRows([
        { id: 1, teamId: 1, name: 'Stephen Curry', number: 30, isArchived: false, createdAt: new Date() },
      ]);

      expect(rows[0].numberInput).toBe('30');
      expect(rows[0].normalizedNumber).toBe(30);
      expect(rows[0].numberError).toBeUndefined();

      // User types "-5" into the jersey input
      const afterNegative = updateEditablePlayerRow(rows, 0, 'number', '-5');
      expect(afterNegative[0].numberInput).toBe('-5'); // Raw input preserved, NOT reverted to '30'!
      expect(afterNegative[0].numberError).toBeDefined();

      // Attempting to prepare for save blocks submission with a clear error
      const prepared = prepareEditableRosterForSave(afterNegative);
      expect(prepared.isValid).toBe(false);
      expect(prepared.errorSummary).toBeDefined();
    });

    it('detects invalid decimals, letters, >99, and duplicate jerseys while allowing correction', () => {
      const rows = toEditablePlayerRows([
        { id: 1, teamId: 1, name: 'Player One', number: 10, isArchived: false, createdAt: new Date() },
        { id: 2, teamId: 1, name: 'Player Two', number: 20, isArchived: false, createdAt: new Date() },
      ]);

      // 1. Decimal "3.5"
      const withDecimal = updateEditablePlayerRow(rows, 0, 'number', '3.5');
      expect(withDecimal[0].numberInput).toBe('3.5');
      expect(withDecimal[0].numberError).toBeDefined();

      // 2. Alphanumeric "12abc"
      const withLetters = updateEditablePlayerRow(withDecimal, 0, 'number', '12abc');
      expect(withLetters[0].numberInput).toBe('12abc');
      expect(withLetters[0].numberError).toBeDefined();

      // 3. Out of range "100"
      const with100 = updateEditablePlayerRow(withLetters, 0, 'number', '100');
      expect(with100[0].numberInput).toBe('100');
      expect(with100[0].numberError).toBeDefined();

      // 4. Duplicate jersey "20" (collides with Player Two)
      const withDuplicate = updateEditablePlayerRow(with100, 0, 'number', '20');
      expect(withDuplicate[0].numberInput).toBe('20');
      expect(withDuplicate[0].numberError).toMatch(/El dorsal #20 está duplicado/i);
      expect(withDuplicate[1].numberError).toMatch(/El dorsal #20 está duplicado/i);
      expect(prepareEditableRosterForSave(withDuplicate).isValid).toBe(false);

      // 5. User corrects Player One to "00" (valid -> normalized to 0)
      const corrected = updateEditablePlayerRow(withDuplicate, 0, 'number', '00');
      expect(corrected[0].numberInput).toBe('00');
      expect(corrected[0].normalizedNumber).toBe(0);
      expect(corrected[0].numberError).toBeUndefined();
      expect(corrected[1].numberError).toBeUndefined();

      const prepared = prepareEditableRosterForSave(corrected);
      expect(prepared.isValid).toBe(true);
      expect(prepared.payload[0]).toEqual({ id: 1, name: 'Player One', number: 0 });
      expect(prepared.payload[1]).toEqual({ id: 2, name: 'Player Two', number: 20 });
    });

    it('supports empty/optional jersey, "0", "00", and validates new player draft before adding', () => {
      const rows = toEditablePlayerRows([
        { id: 1, teamId: 1, name: 'Existing Zero', number: 0, isArchived: false, createdAt: new Date() },
      ]);

      // Adding a new player with invalid jersey "999" fails validation
      const invalidDraft = validateNewPlayerDraft(rows, 'Rookie', '999');
      expect(invalidDraft.isValid).toBe(false);
      expect(invalidDraft.error).toBeDefined();

      // Adding a new player with duplicate jersey "00" (collides with #0) fails validation
      const duplicateZeroDraft = validateNewPlayerDraft(rows, 'Rookie Zero', '00');
      expect(duplicateZeroDraft.isValid).toBe(false);
      expect(duplicateZeroDraft.error).toMatch(/El dorsal #0 ya está en la lista/i);

      // Adding a new player without jersey ("") succeeds with number: undefined
      const noJerseyDraft = validateNewPlayerDraft(rows, 'Mystery Player', '   ');
      expect(noJerseyDraft.isValid).toBe(true);
      expect(noJerseyDraft.row?.normalizedNumber).toBeUndefined();
      expect(noJerseyDraft.row?.numberInput).toBe('');
    });
  });
});
