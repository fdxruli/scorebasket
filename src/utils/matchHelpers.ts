import { db } from '../db/db';
import type { Match } from '../db/models/Match';
import type { MatchConfig } from '../db/models/MatchConfig';

/**
 * Helper para obtener la configuración tradicional de forma segura
 * (Útil durante la transición)
 */
export function getTraditionalConfig(match: Match) {
  if (match.config?.mode === 'traditional' && match.config.traditional) {
    return match.config.traditional;
  }
  
  // Fallback a campos legacy
  return {
    totalQuarters: match.totalQuarters ?? 4,
    minutesPerQuarter: match.quarterDuration ?? 10
  };
}

/**
 * Verifica si un partido es del modo especificado
 */
export function isMatchMode(match: Match, mode: MatchConfig['mode']): boolean {
  return match.config?.mode === mode;
}

/**
 * Obtiene el nombre legible del modo de juego
 */
export function getModeName(mode: MatchConfig['mode']): string {
  const names = {
    'traditional': 'Tradicional',
    'race': 'Race to Score',
    'best-of-series': 'Best of Series'
  };
  return names[mode] ?? 'Desconocido';
}

/**
 * Etiqueta del periodo: Q1..Qn en tiempo regular, OT1, OT2... en tiempo extra.
 */
export function formatPeriodLabel(currentQuarter: number, totalQuarters: number): string {
  return currentQuarter <= totalQuarters
    ? `Q${currentQuarter}`
    : `OT${currentQuarter - totalQuarters}`;
}

/**
 * Crea e inicia en 1 clic una "Reta Rápida" (modo race, con revanchas):
 * a) Busca equipos activos "Local" y "Visitante"; si no existen, los crea sin jugadores.
 * b) Crea el partido en db.matches en modo 'race' con status 'playing'.
 * c) Retorna el matchId recién creado.
 */
export async function startQuickPickupMatch(targetScore = 21): Promise<number> {
  return db.transaction('rw', db.teams, db.matches, async () => {
    const ensurePickupTeam = async (teamName: string): Promise<number> => {
      const existing = await db.teams
        .where('name')
        .equalsIgnoreCase(teamName)
        .and(t => !t.isArchived)
        .first();

      if (existing?.id !== undefined) {
        return existing.id;
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

    const matchId = await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'race',
        race: {
          targetScore,
          hasRematches: true,
          currentGame: 1,
          winByTwo: false,
          scoringSystem: 'standard'
        }
      },
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      gameHistory: []
    });

    return Number(matchId);
  });
}

/**
 * Elimina en cascada un partido y todas sus acciones (scores y fouls) asociadas.
 */
export async function deleteMatchCascade(matchId: number): Promise<void> {
  await db.transaction('rw', db.matches, db.scores, db.fouls, async () => {
    await db.scores.where('matchId').equals(matchId).delete();
    await db.fouls.where('matchId').equals(matchId).delete();
    await db.matches.delete(matchId);
  });
}
