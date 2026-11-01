import Dexie from 'dexie';
import { db } from './db';
import type { Match } from './models/Match';
import type { MatchConfig } from './models/MatchConfig';
import { validateMatchConfig } from '../config/validations';

// Única frontera de lectura/escritura para el tablero y la creación de partidos.
// La UI no necesita conocer índices ni reglas de inicialización de IndexedDB.
export type FinishedMatchFilter = 'all' | MatchConfig['mode'];
export type MatchWithTeamNames = Match & { localName: string; visitorName: string };
export const MATCH_HISTORY_PAGE_SIZE = 24;

export interface MatchDashboard {
  activeMatches: MatchWithTeamNames[];
  finishedMatches: MatchWithTeamNames[];
  totalMatches: number;
  totalFinished: number;
  filteredFinishedCount: number;
}

function finishedRange(mode: FinishedMatchFilter) {
  return mode === 'all'
    ? {
      key: '[status+createdAt]',
      lower: ['finished', Dexie.minKey],
      upper: ['finished', Dexie.maxKey]
    }
    : {
      key: '[status+config.mode+createdAt]',
      lower: ['finished', mode, Dexie.minKey],
      upper: ['finished', mode, Dexie.maxKey]
    };
}

function requirePositiveId(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} inválido.`);
  }
}

export const MatchesRepository = {
  async create(params: { localTeamId: number; visitorTeamId: number; config: MatchConfig }): Promise<number> {
    const { localTeamId, visitorTeamId, config } = params;
    requirePositiveId(localTeamId, 'Equipo local');
    requirePositiveId(visitorTeamId, 'Equipo visitante');
    if (localTeamId === visitorTeamId) {
      throw new Error('Los equipos local y visitante deben ser diferentes.');
    }

    const validation = validateMatchConfig(config);
    if (!validation.isValid) {
      throw new Error(validation.errors[0] ?? 'Configuración de partido inválida.');
    }

    return db.transaction('rw', db.teams, db.matches, async () => {
      const [local, visitor] = await Promise.all([
        db.teams.get(localTeamId),
        db.teams.get(visitorTeamId)
      ]);
      if (!local || !visitor || local.isArchived || visitor.isArchived) {
        throw new Error('Ambos equipos deben existir y estar activos.');
      }

      // Copia independiente de configuración: la UI no puede modificar un partido persistido.
      const normalizedConfig: MatchConfig =
        config.mode === 'traditional'
          ? { mode: 'traditional', traditional: { ...config.traditional! } }
          : config.mode === 'race'
            ? { mode: 'race', race: { ...config.race!, currentGame: 1 } }
            : { mode: 'best-of-series', bestOf: {
                ...config.bestOf!,
                currentGame: 1,
                wins: { local: 0, visitor: 0 }
              } };

      const match: Omit<Match, 'id'> = {
        localTeamId,
        visitorTeamId,
        createdAt: new Date(),
        status: 'created',
        eventsProvenance: 'live_session',
        config: normalizedConfig,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0
      };

      if (normalizedConfig.mode === 'traditional' && normalizedConfig.traditional) {
        match.currentQuarter = 1;
        match.timerSecondsRemaining = normalizedConfig.traditional.minutesPerQuarter * 60;
        match.timerLastStart = undefined;
        match.localTimeouts = 0;
        match.visitorTimeouts = 0;
        // Campos legacy todavía consumidos por registros antiguos.
        match.totalQuarters = normalizedConfig.traditional.totalQuarters;
        match.quarterDuration = normalizedConfig.traditional.minutesPerQuarter;
      } else {
        match.gameHistory = [];
        if (normalizedConfig.mode === 'best-of-series') {
          // Requerido por SeriesService.confirmSet(): ambos periodos deben coincidir.
          match.currentQuarter = 1;
        }
      }
      return Number(await db.matches.add(match));
    });
  },

  async getDashboard(
    filter: FinishedMatchFilter = 'all',
    finishedLimit = MATCH_HISTORY_PAGE_SIZE
  ): Promise<MatchDashboard> {
    const safeLimit = Number.isSafeInteger(finishedLimit)
      ? Math.min(Math.max(1, finishedLimit), 1000)
      : MATCH_HISTORY_PAGE_SIZE;
    const range = finishedRange(filter);

    return db.transaction('r', db.matches, db.teams, async () => {
      const finishedQuery = db.matches.where(range.key).between(range.lower, range.upper);
      const [created, playing, paused, finishedMatches, totalMatches, totalFinished, filteredFinishedCount] =
        await Promise.all([
          db.matches.where('status').equals('created').toArray(),
          db.matches.where('status').equals('playing').toArray(),
          db.matches.where('status').equals('paused').toArray(),
          finishedQuery.reverse().limit(safeLimit).toArray(),
          db.matches.count(),
          db.matches.where('status').equals('finished').count(),
          db.matches.where(range.key).between(range.lower, range.upper).count()
        ]);

      const active = [...created, ...playing, ...paused].sort((a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime());
      const ids = Array.from(new Set([...active, ...finishedMatches].flatMap(m =>
        [m.localTeamId, m.visitorTeamId])));
      const teams = await db.teams.bulkGet(ids);
      const names = new Map(ids.map((id, i) => [id, teams[i]?.name ?? '???']));
      const withNames = (items: Match[]): MatchWithTeamNames[] => items.map(m => ({
        ...m,
        localName: names.get(m.localTeamId) ?? '???',
        visitorName: names.get(m.visitorTeamId) ?? '???'
      }));
      return {
        activeMatches: withNames(active),
        finishedMatches: withNames(finishedMatches),
        totalMatches,
        totalFinished,
        filteredFinishedCount
      };
    });
  }
};
