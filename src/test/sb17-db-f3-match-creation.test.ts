// src/test/sb17-db-f3-match-creation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db/db';
import { MatchesRepository, buildInitialMatchData } from '../db/matches.repository';
import { startQuickPickupMatch, deleteMatchCascade } from '../utils/matchHelpers';
import { SeriesService } from '../db/series.service';
import { LocalBackupService } from '../db/localBackup.service';
import type { MatchConfig } from '../db/models/MatchConfig';

describe('DB-F3: Integridad de creación de partidos y organización de repositorios (QA-01 a QA-15)', () => {
  let localTeamId: number;
  let visitorTeamId: number;

  beforeEach(async () => {
    await db.matches.clear();
    await db.teams.clear();
    await db.players.clear();
    await db.scores.clear();
    await db.fouls.clear();

    localTeamId = Number(
      await db.teams.add({
        name: 'Halcones Locales',
        createdAt: new Date(),
        isArchived: false
      })
    );

    visitorTeamId = Number(
      await db.teams.add({
        name: 'Toros Visitantes',
        createdAt: new Date(),
        isArchived: false
      })
    );
  });

  // QA-01: Creación de partido Traditional
  it('QA-01: crea un partido Traditional con configuración, cronómetro e indicadores limpios', async () => {
    const config: MatchConfig = {
      mode: 'traditional',
      traditional: {
        totalQuarters: 4,
        minutesPerQuarter: 10,
        timeoutsPerTeam: 3
      }
    };

    const matchId = await MatchesRepository.create({
      localTeamId,
      visitorTeamId,
      config
    });

    expect(matchId).toBeGreaterThan(0);
    const match = await MatchesRepository.getById(matchId);
    expect(match).toBeDefined();
    expect(match?.status).toBe('created');
    expect(match?.localTeamId).toBe(localTeamId);
    expect(match?.visitorTeamId).toBe(visitorTeamId);
    expect(match?.eventsProvenance).toBe('live_session');
    expect(match?.currentQuarter).toBe(1);
    expect(match?.timerSecondsRemaining).toBe(600);
    expect(match?.timerLastStart).toBeUndefined();
    expect(match?.totalQuarters).toBe(4);
    expect(match?.quarterDuration).toBe(10);
    expect(match?.localScore).toBe(0);
    expect(match?.visitorScore).toBe(0);
    expect(match?.localFouls).toBe(0);
    expect(match?.visitorFouls).toBe(0);
    expect(match?.localTimeouts).toBe(0);
    expect(match?.visitorTimeouts).toBe(0);

    // Sin autoridades temporales obsoletas ni leases
    expect(match?.timerEpoch).toBeUndefined();
    expect(match?.timerOwnerTabId).toBeUndefined();
    expect(match?.timerLeaseExpiresAt).toBeUndefined();
    expect(match?.timerLockMode).toBeUndefined();
    expect(match?.timerRecoveryState).toBeUndefined();
  });

  // QA-02: Creación de partido Race
  it('QA-02: crea un partido Race con historial inicial vacío y currentGame = 1', async () => {
    const config: MatchConfig = {
      mode: 'race',
      race: {
        targetScore: 21,
        hasRematches: true,
        currentGame: 1,
        winByTwo: true,
        scoringSystem: 'standard'
      }
    };

    const matchId = await MatchesRepository.create({
      localTeamId,
      visitorTeamId,
      config
    });

    const match = await MatchesRepository.getById(matchId);
    expect(match).toBeDefined();
    expect(match?.status).toBe('created');
    expect(match?.config.mode).toBe('race');
    expect(match?.config.race?.targetScore).toBe(21);
    expect(match?.config.race?.currentGame).toBe(1);
    expect(match?.config.race?.winByTwo).toBe(true);
    expect(match?.gameHistory).toEqual([]);
    expect(match?.localScore).toBe(0);
    expect(match?.visitorScore).toBe(0);
  });

  // QA-03: Creación de Best-of-Series y resolución de set
  it('QA-03: crea un partido Best-of-Series con currentQuarter = 1 y compatibilidad para confirmSet', async () => {
    const config: MatchConfig = {
      mode: 'best-of-series',
      bestOf: {
        totalGames: 3,
        targetScorePerGame: 15,
        currentGame: 1,
        wins: { local: 0, visitor: 0 },
        winByTwo: false,
        scoringSystem: 'standard'
      }
    };

    const matchId = await MatchesRepository.create({
      localTeamId,
      visitorTeamId,
      config
    });

    const match = await MatchesRepository.getById(matchId);
    expect(match).toBeDefined();
    // Invariante crítico: currentQuarter debe existir y ser igual a currentGame (1)
    expect(match?.currentQuarter).toBe(1);
    expect(match?.config.bestOf?.currentGame).toBe(1);
    expect(match?.config.bestOf?.wins).toEqual({ local: 0, visitor: 0 });
    expect(match?.gameHistory).toEqual([]);

    // Simular que el equipo local gana el set 1 (15 - 10)
    await db.scores.bulkAdd([
      { matchId, teamId: localTeamId, quarter: 1, points: 3, createdAt: new Date() },
      { matchId, teamId: localTeamId, quarter: 1, points: 3, createdAt: new Date() },
      { matchId, teamId: localTeamId, quarter: 1, points: 3, createdAt: new Date() },
      { matchId, teamId: localTeamId, quarter: 1, points: 3, createdAt: new Date() },
      { matchId, teamId: localTeamId, quarter: 1, points: 3, createdAt: new Date() },
      { matchId, teamId: visitorTeamId, quarter: 1, points: 2, createdAt: new Date() },
      { matchId, teamId: visitorTeamId, quarter: 1, points: 2, createdAt: new Date() },
      { matchId, teamId: visitorTeamId, quarter: 1, points: 2, createdAt: new Date() },
      { matchId, teamId: visitorTeamId, quarter: 1, points: 2, createdAt: new Date() },
      { matchId, teamId: visitorTeamId, quarter: 1, points: 2, createdAt: new Date() }
    ]);
    await db.matches.update(matchId, { localScore: 15, visitorScore: 10, status: 'playing' });

    // Confirmar set mediante SeriesService (demuestra que el partido creado no es rechazado por falta de currentQuarter)
    const result = await SeriesService.confirmSet({
      matchId,
      setNumber: 1,
      expectedWinnerId: localTeamId,
      expectedScore: { local: 15, visitor: 10 }
    });

    expect(result.status).toBe('confirmed');
    if (result.status === 'confirmed') {
      expect(result.newWins).toEqual({ local: 1, visitor: 0 });
      expect(result.seriesFinished).toBe(false);
    }

    const updatedMatch = await MatchesRepository.getById(matchId);
    expect(updatedMatch?.currentQuarter).toBe(2);
    expect(updatedMatch?.config.bestOf?.currentGame).toBe(2);
    expect(updatedMatch?.localScore).toBe(0);
    expect(updatedMatch?.visitorScore).toBe(0);
    expect(updatedMatch?.gameHistory?.length).toBe(1);
  });

  // QA-04: Creación rápida (Reta Rápida)
  it('QA-04: startQuickPickupMatch genera equipos genéricos y partido en modo playing', async () => {
    const matchId = await startQuickPickupMatch(21);
    expect(matchId).toBeGreaterThan(0);

    const match = await MatchesRepository.getById(matchId);
    expect(match).toBeDefined();
    expect(match?.status).toBe('playing');
    expect(match?.config.mode).toBe('race');
    expect(match?.config.race?.targetScore).toBe(21);
    expect(match?.config.race?.hasRematches).toBe(true);

    const local = await db.teams.get(match!.localTeamId);
    const visitor = await db.teams.get(match!.visitorTeamId);
    expect(local?.name).toBe('Local');
    expect(visitor?.name).toBe('Visitante');
    expect(local?.isArchived).toBe(false);
    expect(visitor?.isArchived).toBe(false);
  });

  // QA-05: Persistencia de equipos participantes
  it('QA-05: asegura que los IDs de equipos participantes apuntan a registros reales en Dexie', async () => {
    const config: MatchConfig = {
      mode: 'traditional',
      traditional: { totalQuarters: 4, minutesPerQuarter: 12, timeoutsPerTeam: 3 }
    };

    const matchId = await MatchesRepository.create({
      localTeamId,
      visitorTeamId,
      config
    });

    const match = (await MatchesRepository.getById(matchId))!;
    const teamA = await db.teams.get(match.localTeamId);
    const teamB = await db.teams.get(match.visitorTeamId);

    expect(teamA?.name).toBe('Halcones Locales');
    expect(teamB?.name).toBe('Toros Visitantes');
  });

  // QA-06: Relación correcta con jugadores
  it('QA-06: preserva la relación de jugadores pertenecientes a los equipos participantes', async () => {
    const p1 = await db.players.add({
      teamId: localTeamId,
      name: 'Michael Jordan',
      number: 23,
      createdAt: new Date(),
      isArchived: false
    });
    const p2 = await db.players.add({
      teamId: visitorTeamId,
      name: 'Stephen Curry',
      number: 30,
      createdAt: new Date(),
      isArchived: false
    });

    const matchId = await MatchesRepository.create({
      localTeamId,
      visitorTeamId,
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 }
      }
    });

    const match = (await MatchesRepository.getById(matchId))!;
    const localPlayers = await db.players.where('teamId').equals(match.localTeamId).toArray();
    const visitorPlayers = await db.players.where('teamId').equals(match.visitorTeamId).toArray();

    expect(localPlayers.some(p => p.id === p1 && p.name === 'Michael Jordan')).toBe(true);
    expect(visitorPlayers.some(p => p.id === p2 && p.name === 'Stephen Curry')).toBe(true);
  });

  // QA-07: Configuración inicial de cada modalidad
  it('QA-07: preserva configuraciones personalizadas de tiempos, puntos y reglas deportivas', async () => {
    // Caso 1: Traditional corto
    const idTrad = await MatchesRepository.create({
      localTeamId,
      visitorTeamId,
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 2, minutesPerQuarter: 5, timeoutsPerTeam: 2 }
      }
    });
    const mTrad = (await MatchesRepository.getById(idTrad))!;
    expect(mTrad.totalQuarters).toBe(2);
    expect(mTrad.quarterDuration).toBe(5);
    expect(mTrad.timerSecondsRemaining).toBe(300);

    // Caso 2: Race street
    const idRace = await MatchesRepository.create({
      localTeamId,
      visitorTeamId,
      config: {
        mode: 'race',
        race: { targetScore: 50, hasRematches: false, currentGame: 1, winByTwo: true, scoringSystem: 'street' }
      }
    });
    const mRace = (await MatchesRepository.getById(idRace))!;
    expect(mRace.config.race?.scoringSystem).toBe('street');
    expect(mRace.config.race?.winByTwo).toBe(true);

    // Caso 3: Best of 5
    const idBestOf = await MatchesRepository.create({
      localTeamId,
      visitorTeamId,
      config: {
        mode: 'best-of-series',
        bestOf: { totalGames: 5, targetScorePerGame: 25, currentGame: 1, wins: { local: 0, visitor: 0 } }
      }
    });
    const mBestOf = (await MatchesRepository.getById(idBestOf))!;
    expect(mBestOf.config.bestOf?.totalGames).toBe(5);
    expect(mBestOf.config.bestOf?.targetScorePerGame).toBe(25);
  });

  // QA-08: Inicialización correcta de marcadores y faltas
  it('QA-08: inicializa marcadores y faltas rigurosamente en cero sin valores nulos ni indefinidos', async () => {
    const matchId = await MatchesRepository.create({
      localTeamId,
      visitorTeamId,
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 }
      }
    });

    const match = (await MatchesRepository.getById(matchId))!;
    expect(match.localScore).toBe(0);
    expect(match.visitorScore).toBe(0);
    expect(match.localFouls).toBe(0);
    expect(match.visitorFouls).toBe(0);
  });

  // QA-09: Rechazo de configuraciones inválidas y referencialidad
  it('QA-09: rechaza configuraciones inválidas, equipos no existentes, archivados o idénticos', async () => {
    const validConfig: MatchConfig = {
      mode: 'traditional',
      traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 }
    };

    // 1. Equipos idénticos
    await expect(
      MatchesRepository.create({
        localTeamId,
        visitorTeamId: localTeamId,
        config: validConfig
      })
    ).rejects.toThrow('El equipo local y visitante no pueden ser el mismo.');

    // 2. IDs inválidos
    await expect(
      MatchesRepository.create({
        localTeamId: 0,
        visitorTeamId,
        config: validConfig
      })
    ).rejects.toThrow('Los identificadores de equipos deben ser enteros positivos válidos.');

    // 3. Equipo inexistente
    await expect(
      MatchesRepository.create({
        localTeamId: 99999,
        visitorTeamId,
        config: validConfig
      })
    ).rejects.toThrow('El equipo local (ID: 99999) no existe.');

    // 4. Equipo archivado
    await db.teams.update(visitorTeamId, { isArchived: true });
    await expect(
      MatchesRepository.create({
        localTeamId,
        visitorTeamId,
        config: validConfig
      })
    ).rejects.toThrow(/está archivado y no puede disputar partidos nuevos/);

    // 5. Configuración deportiva inválida (ej. minutos negativos)
    await db.teams.update(visitorTeamId, { isArchived: false });
    await expect(
      MatchesRepository.create({
        localTeamId,
        visitorTeamId,
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: -5, timeoutsPerTeam: 3 }
        }
      })
    ).rejects.toThrow(/Los minutos deben ser un número entero/);

    // 6. Best of con número par de partidos
    await expect(
      MatchesRepository.create({
        localTeamId,
        visitorTeamId,
        config: {
          mode: 'best-of-series',
          bestOf: { totalGames: 4, targetScorePerGame: 15, currentGame: 1, wins: { local: 0, visitor: 0 } }
        }
      })
    ).rejects.toThrow(/El número de partidos debe ser impar/);

    // 7. Reta rápida con targetScore inválido
    await expect(MatchesRepository.createQuickPickup(0)).rejects.toThrow(/puntaje objetivo/);
    await expect(MatchesRepository.createQuickPickup(150)).rejects.toThrow(/puntaje objetivo/);
  });

  // QA-10: Comportamiento ante errores de escritura y atomicidad
  it('QA-10: una operación fallida no deja registros huérfanos ni altera el conteo de partidos', async () => {
    const initialMatchesCount = await db.matches.count();

    try {
      await MatchesRepository.create({
        localTeamId: 99999,
        visitorTeamId,
        config: {
          mode: 'traditional',
          traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 }
        }
      });
    } catch {
      // Ignorar fallo esperado
    }

    const afterMatchesCount = await db.matches.count();
    expect(afterMatchesCount).toBe(initialMatchesCount);
  });

  // QA-11: Ausencia de registros incompletos
  it('QA-11: buildInitialMatchData garantiza que todos los campos requeridos estén presentes según modalidad', () => {
    const dataBestOf = buildInitialMatchData({
      localTeamId: 1,
      visitorTeamId: 2,
      config: {
        mode: 'best-of-series',
        bestOf: { totalGames: 3, targetScorePerGame: 21, currentGame: 1, wins: { local: 0, visitor: 0 } }
      }
    });

    expect(dataBestOf.currentQuarter).toBe(1);
    expect(dataBestOf.gameHistory).toEqual([]);
    expect(dataBestOf.config.bestOf?.currentGame).toBe(1);
    expect(dataBestOf.config.bestOf?.wins).toEqual({ local: 0, visitor: 0 });
    expect(dataBestOf.eventsProvenance).toBe('live_session');
    expect(dataBestOf.status).toBe('created');
  });

  // QA-12: Prevención de duplicados en Reta Rápida
  it('QA-12: Reta Rápida reutiliza equipos limpios y archiva de forma segura si ya tienen historial', async () => {
    // Primer partido rápido: crea Local y Visitante limpios
    const m1 = await MatchesRepository.createQuickPickup(21);
    const match1 = (await MatchesRepository.getById(m1))!;
    const localId1 = match1.localTeamId;
    const visitorId1 = match1.visitorTeamId;

    // Segundo partido rápido: detecta que Local y Visitante anteriores ya tienen un partido asociado,
    // por lo tanto los archiva y crea un par nuevo sin perder los anteriores.
    const m2 = await MatchesRepository.createQuickPickup(21);
    const match2 = (await MatchesRepository.getById(m2))!;
    const localId2 = match2.localTeamId;
    const visitorId2 = match2.visitorTeamId;

    expect(localId2).not.toBe(localId1);
    expect(visitorId2).not.toBe(visitorId1);

    const oldLocal = await db.teams.get(localId1);
    const oldVisitor = await db.teams.get(visitorId1);
    expect(oldLocal?.isArchived).toBe(true);
    expect(oldVisitor?.isArchived).toBe(true);

    const newLocal = await db.teams.get(localId2);
    const newVisitor = await db.teams.get(visitorId2);
    expect(newLocal?.isArchived).toBe(false);
    expect(newVisitor?.isArchived).toBe(false);
  });

  // QA-13: Compatibilidad de eliminación en cascada
  it('QA-13: deleteCascade elimina atómicamente el partido, sus anotaciones y faltas asociadas', async () => {
    const matchId = await MatchesRepository.create({
      localTeamId,
      visitorTeamId,
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 }
      }
    });

    await db.scores.add({ matchId, teamId: localTeamId, quarter: 1, points: 2, createdAt: new Date() });
    await db.fouls.add({ matchId, teamId: visitorTeamId, quarter: 1, createdAt: new Date() });

    expect(await MatchesRepository.exists(matchId)).toBe(true);
    expect(await db.scores.where('matchId').equals(matchId).count()).toBe(1);
    expect(await db.fouls.where('matchId').equals(matchId).count()).toBe(1);

    await deleteMatchCascade(matchId);

    expect(await MatchesRepository.exists(matchId)).toBe(false);
    expect(await db.scores.where('matchId').equals(matchId).count()).toBe(0);
    expect(await db.fouls.where('matchId').equals(matchId).count()).toBe(0);
  });

  // QA-14: Compatibilidad con respaldos DB-F1
  it('QA-14: los partidos creados por el repositorio son compatibles y verificables por LocalBackupService', async () => {
    await MatchesRepository.create({
      localTeamId,
      visitorTeamId,
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 }
      }
    });

    await MatchesRepository.createQuickPickup(21);

    const json = await LocalBackupService.exportJson();
    const backup = JSON.parse(json);
    expect(backup.app).toBe('ScoreBasket');
    expect(backup.metadata.counts.matches).toBe(2);
    expect(backup.data.matches.length).toBe(2);
    expect(backup.metadata.checksumAlgorithm).toBe('SHA-256');
    expect(typeof backup.metadata.checksum).toBe('string');
    expect(backup.metadata.checksum.startsWith('sha256:')).toBe(true);
  });

  // QA-15: Ausencia de regresiones en consultas indexadas DB-F2
  it('QA-15: los partidos creados aprovechan los índices de status y createdAt de DB-F2', async () => {
    const m1 = await MatchesRepository.create({
      localTeamId,
      visitorTeamId,
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 }
      }
    });

    const m2 = await MatchesRepository.createQuickPickup(21);

    // Consulta de activos tal como la realiza Matches.tsx
    const active = await db.matches
      .where('status')
      .anyOf(['created', 'playing', 'paused'])
      .reverse()
      .sortBy('createdAt');

    expect(active.length).toBe(2);
    const activeIds = active.map(m => m.id);
    expect(activeIds).toContain(m1);
    expect(activeIds).toContain(m2);
  });
});
