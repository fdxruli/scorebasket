import { describe, expect, it, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { BasketControlDB, db } from '../db/db';
import { MatchesRepository } from '../db/matches.repository';
import { getDefaultConfig, validateMatchConfig } from '../config/validations';
import type { Match } from '../db/models/Match';

let sequence = 0;
const uniqueName = (label: string) => `sb_v9_${label}_${Date.now()}_${++sequence}`;

describe('SB-DB-V9: índices, migración no destructiva y repositorio local', () => {
  beforeEach(async () => {
    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();
  });

  it('crea los índices de dashboard y conserva índices históricos', async () => {
    const instance = new BasketControlDB(uniqueName('new'));
    try {
      await instance.open();
      expect(instance.verno).toBe(9);
      expect(instance.matches.schema.indexes.map(i => i.name)).toEqual(
        expect.arrayContaining([
          '[status+createdAt]', '[status+config.mode+createdAt]',
          'localTeamId', 'visitorTeamId'
        ])
      );
      expect(instance.scores.schema.indexes.map(i => i.name))
        .toContain('[matchId+quarter+createdAt]');
      expect(instance.fouls.schema.indexes.map(i => i.name))
        .toContain('[matchId+quarter+createdAt]');
    } finally {
      await instance.delete();
    }
  });

  it('migra una base v8 a v9 sin modificar IDs, puntuaciones, faltas ni historial', async () => {
    const name = uniqueName('migration');
    const legacy = new Dexie(name);
    legacy.version(8).stores({
      teams: '++id, name, createdAt, isArchived',
      players: '++id, teamId, name, number',
      matches: '++id, status, createdAt, config.mode, localTeamId, visitorTeamId',
      scores: '++id, matchId, teamId, quarter, [matchId+quarter]',
      fouls: '++id, matchId, teamId, playerId, quarter, [matchId+quarter], [matchId+teamId+quarter], [matchId+playerId]'
    });
    await legacy.open();
    const teamId = await legacy.table('teams').add({name:'Local',createdAt:new Date(),isArchived:false});
    const rivalId = await legacy.table('teams').add({name:'Visitante',createdAt:new Date(),isArchived:false});
    const matchId = await legacy.table('matches').add({
      localTeamId:teamId,visitorTeamId:rivalId,status:'finished',
      createdAt:new Date('2026-10-01T00:00:00.000Z'),
      config:getDefaultConfig('race'), localScore:3,visitorScore:0,localFouls:1,visitorFouls:0,
      gameHistory:[{gameNumber:1,localScore:3,visitorScore:0,winner:'local'}]
    });
    const scoreId = await legacy.table('scores').add({matchId,teamId,points:3,quarter:1,createdAt:new Date()});
    const foulId = await legacy.table('fouls').add({matchId,teamId,quarter:1,createdAt:new Date()});
    legacy.close();
    const upgraded = new BasketControlDB(name);
    try {
      await upgraded.open();
      expect(upgraded.verno).toBe(9);
      const match = await upgraded.matches.get(matchId);
      expect(match?.localScore).toBe(3);
      expect(match?.gameHistory).toEqual([{gameNumber:1,localScore:3,visitorScore:0,winner:'local'}]);
      expect((await upgraded.scores.get(scoreId))?.matchId).toBe(matchId);
      expect((await upgraded.fouls.get(foulId))?.matchId).toBe(matchId);
      expect((await upgraded.teams.get(teamId))?.name).toBe('Local');
    } finally {
      await upgraded.delete();
    }
  });

  it('centraliza la creación Best-of-Series con ambos periodos sincronizados', async () => {
    const a = Number(await db.teams.add({name:'Serie A',createdAt:new Date(),isArchived:false}));
    const b = Number(await db.teams.add({name:'Serie B',createdAt:new Date(),isArchived:false}));
    const id = await MatchesRepository.create({localTeamId:a,visitorTeamId:b,config:getDefaultConfig('best-of-series')});
    const match = await db.matches.get(id);
    expect(match?.currentQuarter).toBe(1);
    expect(match?.config.bestOf?.currentGame).toBe(1);
    expect(match?.config.bestOf?.wins).toEqual({local:0,visitor:0});
    expect(match?.gameHistory).toEqual([]);
    expect(match?.eventsProvenance).toBe('live_session');
  });

  it('rechaza equipos archivados, inexistentes y configura validación segura', async () => {
    const a = Number(await db.teams.add({name:'A',createdAt:new Date(),isArchived:false}));
    const b = Number(await db.teams.add({name:'B',createdAt:new Date(),isArchived:true}));
    await expect(MatchesRepository.create({localTeamId:a,visitorTeamId:b,config:getDefaultConfig('race')}))
      .rejects.toThrow('activos');
    await expect(MatchesRepository.create({localTeamId:a,visitorTeamId:99999,config:getDefaultConfig('race')}))
      .rejects.toThrow('activos');
    expect(await db.matches.count()).toBe(0);
    expect(validateMatchConfig({
      mode:'race',race:{...getDefaultConfig('race').race!,targetScore:Number.NaN}
    }).isValid).toBe(false);
    expect(validateMatchConfig({
      mode:'traditional',traditional:{totalQuarters:1.5,minutesPerQuarter:10}
    }).isValid).toBe(false);
  });

  it('consulta resultados paginados por modalidad, ordenados y con KPIs globales', async () => {
    const a = Number(await db.teams.add({name:'Raptors',createdAt:new Date(),isArchived:false}));
    const b = Number(await db.teams.add({name:'Lakers',createdAt:new Date(),isArchived:false}));
    const items: Omit<Match,'id'>[] = [];
    for (let i=0; i<45; i++) {
      items.push({
        localTeamId:a, visitorTeamId:b, status:'finished',
        createdAt:new Date(1760000000000+i*1000),
        config:getDefaultConfig(i%2===0?'race':'traditional'),
        localScore:i,visitorScore:0,localFouls:0,visitorFouls:0
      });
    }
    items.push({
      localTeamId:a,visitorTeamId:b,status:'playing',createdAt:new Date(),
      config:getDefaultConfig('traditional'),
      localScore:0,visitorScore:0,localFouls:0,visitorFouls:0
    });
    await db.matches.bulkAdd(items as Match[]);
    const page = await MatchesRepository.getDashboard('all',10);
    expect(page.totalMatches).toBe(46);
    expect(page.totalFinished).toBe(45);
    expect(page.filteredFinishedCount).toBe(45);
    expect(page.activeMatches).toHaveLength(1);
    expect(page.finishedMatches).toHaveLength(10);
    expect(page.finishedMatches[0].localScore).toBe(44);
    expect(page.finishedMatches[0].localName).toBe('Raptors');
    const race = await MatchesRepository.getDashboard('race',10);
    expect(race.filteredFinishedCount).toBe(23);
    expect(race.finishedMatches.map(m=>m.config.mode)).toEqual(Array(10).fill('race'));
    expect(race.finishedMatches[0].localScore).toBe(44);
  });
});
