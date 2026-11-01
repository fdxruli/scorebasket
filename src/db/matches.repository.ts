// src/db/matches.repository.ts
import { db } from './db';
import type { Match, MatchStatus } from './models/Match';
import type { MatchConfig } from './models/MatchConfig';
import { validateMatchConfig, VALIDATION_RULES } from '../config/validations';

export interface CreateMatchParams {
  localTeamId: number;
  visitorTeamId: number;
  config: MatchConfig;
  status?: MatchStatus;
}

/**
 * Validador de identificadores enteros positivos (>= 1).
 */
function isValidId(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && Number.isInteger(val) && val >= 1;
}

/**
 * Construye el objeto de datos inicial para un partido, garantizando:
 * - Marcadores y faltas en cero.
 * - Procedencia de eventos live_session.
 * - Coherencia estricta de periodos y subconfiguraciones según modalidad.
 * - Omisión intencional de autoridades y leases temporales previos.
 */
export function buildInitialMatchData(params: CreateMatchParams): Omit<Match, 'id'> {
  const { localTeamId, visitorTeamId, config, status = 'created' } = params;

  // Normalizar y blindar configuraciones por modalidad
  const normalizedConfig: MatchConfig = {
    ...config,
    ...(config.mode === 'best-of-series' && config.bestOf
      ? {
          bestOf: {
            ...config.bestOf,
            currentGame: 1,
            wins: { local: 0, visitor: 0 },
            winByTwo: config.bestOf.winByTwo ?? false,
            scoringSystem: config.bestOf.scoringSystem || 'standard'
          }
        }
      : {}),
    ...(config.mode === 'race' && config.race
      ? {
          race: {
            ...config.race,
            currentGame: 1,
            hasRematches: config.race.hasRematches ?? false,
            winByTwo: config.race.winByTwo ?? false,
            scoringSystem: config.race.scoringSystem || 'standard'
          }
        }
      : {}),
    ...(config.mode === 'traditional' && config.traditional
      ? {
          traditional: {
            ...config.traditional,
            timeoutsPerTeam: config.traditional.timeoutsPerTeam ?? 3
          }
        }
      : {})
  };

  const base: Omit<Match, 'id'> = {
    localTeamId,
    visitorTeamId,
    status,
    createdAt: new Date(),
    eventsProvenance: 'live_session',
    config: normalizedConfig,
    localScore: 0,
    visitorScore: 0,
    localFouls: 0,
    visitorFouls: 0
  };

  switch (normalizedConfig.mode) {
    case 'traditional': {
      const trad = normalizedConfig.traditional!;
      return {
        ...base,
        currentQuarter: 1,
        timerSecondsRemaining: trad.minutesPerQuarter * 60,
        timerLastStart: undefined,
        totalQuarters: trad.totalQuarters,
        quarterDuration: trad.minutesPerQuarter,
        localTimeouts: 0,
        visitorTimeouts: 0
      };
    }
    case 'race': {
      return {
        ...base,
        gameHistory: []
      };
    }
    case 'best-of-series': {
      return {
        ...base,
        currentQuarter: 1,
        gameHistory: []
      };
    }
  }
}

/**
 * Validador síncrono previo a transacciones para detectar configuraciones o IDs erróneos.
 */
function validateCreationParams(params: CreateMatchParams): void {
  if (!isValidId(params.localTeamId) || !isValidId(params.visitorTeamId)) {
    throw new Error('Los identificadores de equipos deben ser enteros positivos válidos.');
  }

  if (params.localTeamId === params.visitorTeamId) {
    throw new Error('El equipo local y visitante no pueden ser el mismo.');
  }

  if (params.status !== undefined && params.status !== 'created' && params.status !== 'playing') {
    throw new Error('El estado inicial de un nuevo partido debe ser "created" o "playing".');
  }

  const validation = validateMatchConfig(params.config);
  if (!validation.isValid) {
    throw new Error(validation.errors[0] || 'Configuración de partido inválida.');
  }
}

export const MatchesRepository = {
  /**
   * Obtiene un partido por su ID.
   */
  async getById(matchId: number): Promise<Match | undefined> {
    if (!isValidId(matchId)) return undefined;
    return db.matches.get(matchId);
  },

  /**
   * Verifica la existencia de un partido por su ID.
   */
  async exists(matchId: number): Promise<boolean> {
    if (!isValidId(matchId)) return false;
    const count = await db.matches.where('id').equals(matchId).count();
    return count > 0;
  },

  /**
   * Crea un partido nuevo en la base de datos de manera atómica,
   * validando existencia e integridad de los equipos y coherencia de la modalidad.
   */
  async create(params: CreateMatchParams): Promise<number> {
    // 1. Validaciones de esquema y parámetros
    validateCreationParams(params);

    // 2. Transacción de lectura y escritura para garantizar atomicidad y referencialidad
    return db.transaction('rw', db.matches, db.teams, async () => {
      const [localTeam, visitorTeam] = await Promise.all([
        db.teams.get(params.localTeamId),
        db.teams.get(params.visitorTeamId)
      ]);

      if (!localTeam) {
        throw new Error(`El equipo local (ID: ${params.localTeamId}) no existe.`);
      }
      if (!visitorTeam) {
        throw new Error(`El equipo visitante (ID: ${params.visitorTeamId}) no existe.`);
      }
      if (localTeam.isArchived) {
        throw new Error(`El equipo local "${localTeam.name}" está archivado y no puede disputar partidos nuevos.`);
      }
      if (visitorTeam.isArchived) {
        throw new Error(`El equipo visitante "${visitorTeam.name}" está archivado y no puede disputar partidos nuevos.`);
      }

      const matchData = buildInitialMatchData(params);
      const matchId = await db.matches.add(matchData);
      return Number(matchId);
    });
  },

  /**
   * Crea e inicia en 1 clic una Reta Rápida (Race a 21 pts por defecto con revanchas):
   * Reutiliza equipos genéricos 'Local' y 'Visitante' si están limpios (sin jugadores ni partidos),
   * o los archiva de forma segura si ya fueron disputados antes de crear nuevos.
   */
  async createQuickPickup(targetScore = 21): Promise<number> {
    const rules = VALIDATION_RULES.race;
    if (
      typeof targetScore !== 'number' ||
      !Number.isInteger(targetScore) ||
      targetScore < rules.minScore ||
      targetScore > rules.maxScore
    ) {
      throw new Error(
        `El puntaje objetivo para la Reta Rápida debe ser un número entero entre ${rules.minScore} y ${rules.maxScore}.`
      );
    }

    return db.transaction('rw', db.teams, db.matches, db.players, async () => {
      const ensurePickupTeam = async (teamName: string): Promise<number> => {
        const existing = await db.teams
          .where('name')
          .equalsIgnoreCase(teamName)
          .and(t => !t.isArchived)
          .first();

        if (existing?.id !== undefined) {
          const teamId = existing.id;
          const [playersCount, localMatchesCount, visitorMatchesCount] = await Promise.all([
            db.players.where({ teamId }).count(),
            db.matches.where('localTeamId').equals(teamId).count(),
            db.matches.where('visitorTeamId').equals(teamId).count()
          ]);
          const matchesCount = localMatchesCount + visitorMatchesCount;

          if (playersCount === 0 && matchesCount === 0) {
            return teamId;
          }

          await db.teams.update(teamId, { isArchived: true });
        }

        const newId = await db.teams.add({
          name: teamName,
          createdAt: new Date(),
          isArchived: false
        });

        return Number(newId);
      };

      const localTeamId = await ensurePickupTeam('Local');
      const visitorTeamId = await ensurePickupTeam('Visitante');

      const config: MatchConfig = {
        mode: 'race',
        race: {
          targetScore,
          hasRematches: true,
          currentGame: 1,
          winByTwo: false,
          scoringSystem: 'standard'
        }
      };

      return this.create({
        localTeamId,
        visitorTeamId,
        config,
        status: 'playing'
      });
    });
  },

  /**
   * Elimina en cascada un partido y todas sus anotaciones y faltas asociadas
   * dentro de una transacción atómica.
   */
  async deleteCascade(matchId: number): Promise<void> {
    if (!isValidId(matchId)) {
      throw new Error('Identificador de partido inválido.');
    }

    await db.transaction('rw', db.matches, db.scores, db.fouls, async () => {
      await db.scores.where('matchId').equals(matchId).delete();
      await db.fouls.where('matchId').equals(matchId).delete();
      await db.matches.delete(matchId);
    });
  }
};
