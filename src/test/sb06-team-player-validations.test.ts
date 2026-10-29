import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db';
import { TeamsRepository } from '../db/teams.repository';
import { PlayersRepository } from '../db/players.repository';

describe('SB-06: Team and Player Validations', () => {
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
      const newTeam = await TeamsRepository.getById(newTeamId);
      expect(newTeam?.name).toBe('warriors');
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

      const roster = await db.players.where({ teamId }).filter(p => !p.isArchived).toArray();
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
});
