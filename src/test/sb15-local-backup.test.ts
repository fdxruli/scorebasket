import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { LocalBackupService } from '../db/localBackup.service';
import { getDefaultConfig } from '../config/validations';
import type { Score } from '../db/models/Score';

describe('SB-DB-BACKUP: exportación consistente y restauración vacía atómica', () => {
  beforeEach(async () => {
    await db.fouls.clear();
    await db.scores.clear();
    await db.matches.clear();
    await db.players.clear();
    await db.teams.clear();
  });

  it('exporta y restaura todas las tablas, IDs y fechas anidadas sin cambiar el marcador', async () => {
    const a = Number(await db.teams.add({name:'Local',createdAt:new Date('2026-01-01'),isArchived:false}));
    const b = Number(await db.teams.add({name:'Visitante',createdAt:new Date('2026-01-02'),isArchived:false}));
    const playerId = Number(await db.players.add({teamId:a,name:'Jugador',number:4,createdAt:new Date('2026-01-03')}));
    const matchId = Number(await db.matches.add({
      localTeamId:a,visitorTeamId:b,status:'finished',createdAt:new Date('2026-01-04'),
      finishedAt:new Date('2026-01-04T01:00:00Z'),
      eventsProvenance:'live_session',
      config:getDefaultConfig('race'),localScore:2,visitorScore:0,localFouls:1,visitorFouls:0,
      gameHistory:[{gameNumber:1,localScore:2,visitorScore:0,winner:'local',finishedAt:new Date('2026-01-04T01:00:00Z')}]
    }));
    const scoreId = Number(await db.scores.add({
      matchId,teamId:a,playerId,points:2,quarter:1,createdAt:new Date('2026-01-04T00:10:00Z')
    } as Score));
    await db.fouls.add({matchId,teamId:a,playerId,quarter:1,createdAt:new Date('2026-01-04T00:11:00Z')});

    const backup = await LocalBackupService.exportJson();
    const parsed = JSON.parse(backup);
    expect(parsed.format).toBe('scorebasket-local-backup');
    expect(parsed.sourceSchemaVersion).toBe(9);
    expect(parsed.data.scores[0].id).toBe(scoreId);

    await db.fouls.clear(); await db.scores.clear(); await db.matches.clear();
    await db.players.clear(); await db.teams.clear();
    const summary = await LocalBackupService.restoreIntoEmpty(backup);
    expect(summary).toEqual({teams:2,players:1,matches:1,scores:1,fouls:1});
    const match = await db.matches.get(matchId);
    expect(match?.localScore).toBe(2);
    expect(match?.finishedAt).toBeInstanceOf(Date);
    expect(match?.gameHistory?.[0].finishedAt).toBeInstanceOf(Date);
    expect((await db.scores.get(scoreId))?.createdAt).toBeInstanceOf(Date);
    expect((await db.players.get(playerId))?.teamId).toBe(a);
  });

  it('nunca sobreescribe una base con registros existentes', async () => {
    const backup = await LocalBackupService.exportJson();
    const id = await db.teams.add({name:'NO BORRAR',createdAt:new Date()});
    await expect(LocalBackupService.restoreIntoEmpty(backup)).rejects.toThrow('completamente vacía');
    expect((await db.teams.get(id))?.name).toBe('NO BORRAR');
  });

  it('rechaza JSON malformado, formato desconocido y relaciones huérfanas ANTES de escribir', async () => {
    await expect(LocalBackupService.restoreIntoEmpty('{')).rejects.toThrow('JSON válido');
    const backup = JSON.parse(await LocalBackupService.exportJson());
    backup.version = 999;
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(backup))).rejects.toThrow('no compatible');
    backup.version = 1;
    backup.data.scores.push({id:1,matchId:9,teamId:4,quarter:1,points:3,createdAt:new Date().toISOString()});
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(backup))).rejects.toThrow('otro partido/equipo');
    expect(await db.scores.count()).toBe(0);
  });

  it('rechaza IDs duplicados y versiones de esquema distintas sin cambiar la BD', async () => {
    const backup = JSON.parse(await LocalBackupService.exportJson());
    backup.data.teams.push({id:1,name:'A',createdAt:new Date().toISOString()});
    backup.data.teams.push({id:1,name:'B',createdAt:new Date().toISOString()});
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(backup))).rejects.toThrow('ID repetido');
    backup.data.teams = [];
    backup.sourceSchemaVersion = 8;
    await expect(LocalBackupService.restoreIntoEmpty(JSON.stringify(backup))).rejects.toThrow('otra versión');
    expect(await db.teams.count()).toBe(0);
  });
});
