import { MatchesRepository } from '../db/matches.repository';
import { TeamsRepository } from '../db/teams.repository';
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
 * Renombra un equipo validando nombre vacío, igualdad con el rival del partido
 * y duplicados contra otros equipos activos (case-insensitive).
 * Centralizado a través de TeamsRepository.rename.
 */
export async function renameTeamSafely(
  teamId: number,
  newName: string,
  rivalTeamId?: number
): Promise<{ ok: boolean; error?: string }> {
  try {
    await TeamsRepository.rename(teamId, newName, rivalTeamId);
    return { ok: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'No se pudo renombrar el equipo.';
    return { ok: false, error };
  }
}

/**
 * Crea e inicia en 1 clic una "Reta Rápida" (modo race, con revanchas).
 * Delega de forma centralizada en MatchesRepository.createQuickPickup.
 */
export async function startQuickPickupMatch(targetScore = 21): Promise<number> {
  return MatchesRepository.createQuickPickup(targetScore);
}

/**
 * Elimina en cascada un partido y todas sus acciones (scores y fouls) asociadas.
 * Delega de forma centralizada en MatchesRepository.deleteCascade.
 */
export async function deleteMatchCascade(matchId: number): Promise<void> {
  return MatchesRepository.deleteCascade(matchId);
}
