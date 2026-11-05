// src/db/lineups.service.ts
import { db } from './db';
import type { Match, MatchLineups } from './models/Match';
import type { Player } from './models/Player';

export const REQUIRED_ON_COURT_PLAYERS = 5;

export interface SaveStartingLineupsParams {
  matchId: number;
  localStarters: number[];
  visitorStarters: number[];
  expectedVersion?: number;
}

export interface SubstitutePlayerParams {
  matchId: number;
  teamId: number;
  playerOutId: number;
  playerInId: number;
  expectedVersion?: number;
  expectedOnCourt?: number[];
}

export interface LineupOperationResult {
  success: boolean;
  error?: string;
  inFlight?: boolean;
  lineups?: MatchLineups;
}

/**
 * Determina si un partido tiene activa y válida la gestión de quintetos en cancha (5 vs 5).
 * Exclusivo para partidos de modalidad Traditional.
 */
export function isLineupActive(match?: Match | null): boolean {
  if (!match) return false;
  const mode = match.config?.mode || 'traditional';
  if (mode !== 'traditional') return false;
  if (!match.lineups?.enabled) return false;

  const { localOnCourt, visitorOnCourt } = match.lineups;
  return (
    Array.isArray(localOnCourt) &&
    localOnCourt.length === REQUIRED_ON_COURT_PLAYERS &&
    Array.isArray(visitorOnCourt) &&
    visitorOnCourt.length === REQUIRED_ON_COURT_PLAYERS
  );
}

/**
 * Obtiene los IDs de los 5 jugadores en cancha para el lado indicado ('local' | 'visitor').
 */
export function getTeamOnCourtIds(
  match: Match | undefined | null,
  teamSide: 'local' | 'visitor'
): number[] {
  if (!isLineupActive(match)) return [];
  return teamSide === 'local'
    ? match!.lineups!.localOnCourt
    : match!.lineups!.visitorOnCourt;
}

/**
 * Separa la lista de jugadores activos de un equipo en jugadores EN CANCHA y en BANCA (suplentes).
 */
export function partitionTeamPlayersByLineup(
  players: Player[],
  onCourtIds: number[]
): { onCourt: Player[]; bench: Player[] } {
  const activePlayers = players.filter(p => !p.isArchived);
  const onCourtSet = new Set(onCourtIds);

  const onCourt = activePlayers.filter(p => p.id !== undefined && onCourtSet.has(p.id));
  const bench = activePlayers.filter(p => p.id !== undefined && !onCourtSet.has(p.id));

  return { onCourt, bench };
}

export const LineupService = {
  isLineupActive,
  getTeamOnCourtIds,
  partitionTeamPlayersByLineup,

  /**
   * Activa y guarda el quinteto titular (5 jugadores en cancha por equipo) para un partido Traditional.
   * Valida atómicamente:
   * - Modalidad Traditional y partido no finalizado.
   * - Mínimo 5 jugadores activos en cada equipo.
   * - Exactamente 5 titulares únicos por equipo, activos y pertenecientes al equipo correcto.
   * - Control de concurrencia optimista mediante `version`.
   */
  async activateLineups(params: SaveStartingLineupsParams): Promise<LineupOperationResult> {
    const { matchId, localStarters, visitorStarters, expectedVersion } = params;

    if (!Number.isInteger(matchId) || matchId <= 0) {
      return { success: false, error: 'Identificador de partido inválido.' };
    }

    const preMatch = await db.matches.get(matchId);
    const targetVersion = expectedVersion ?? preMatch?.lineups?.version;

    try {
      return await db.transaction('rw', db.matches, db.players, db.teams, async () => {
        const currentMatch = await db.matches.get(matchId);
        if (!currentMatch) {
          return { success: false, error: 'El partido no existe.' };
        }

        if (currentMatch.status === 'finished') {
          return {
            success: false,
            error: 'No se puede configurar la alineación en un partido finalizado.'
          };
        }

        const mode = currentMatch.config?.mode || 'traditional';
        if (mode !== 'traditional') {
          return {
            success: false,
            error: 'La gestión de jugadores en cancha solo está disponible en partidos Traditional de 5 contra 5.'
          };
        }

        if (
          targetVersion !== undefined &&
          (currentMatch.lineups?.version ?? 0) !== targetVersion
        ) {
          return {
            success: false,
            error: 'Conflicto de concurrencia: la alineación fue modificada en otra pestaña. Revisa el estado actual antes de guardar.'
          };
        }

        const [localTeam, visitorTeam, localPlayersRaw, visitorPlayersRaw] = await Promise.all([
          db.teams.get(currentMatch.localTeamId),
          db.teams.get(currentMatch.visitorTeamId),
          db.players.where('teamId').equals(currentMatch.localTeamId).toArray(),
          db.players.where('teamId').equals(currentMatch.visitorTeamId).toArray()
        ]);

        const localName = localTeam?.name || 'Equipo Local';
        const visitorName = visitorTeam?.name || 'Equipo Visitante';

        const localActive = localPlayersRaw.filter(p => !p.isArchived);
        const visitorActive = visitorPlayersRaw.filter(p => !p.isArchived);

        if (localActive.length < REQUIRED_ON_COURT_PLAYERS && visitorActive.length < REQUIRED_ON_COURT_PLAYERS) {
          return {
            success: false,
            error: `Ambos equipos necesitan al menos 5 jugadores activos (${localName}: ${localActive.length}/5, ${visitorName}: ${visitorActive.length}/5).`
          };
        }

        if (localActive.length < REQUIRED_ON_COURT_PLAYERS) {
          return {
            success: false,
            error: `${localName} necesita al menos 5 jugadores activos para activar la alineación (tiene ${localActive.length}/5).`
          };
        }

        if (visitorActive.length < REQUIRED_ON_COURT_PLAYERS) {
          return {
            success: false,
            error: `${visitorName} necesita al menos 5 jugadores activos para activar la alineación (tiene ${visitorActive.length}/5).`
          };
        }

        if (!Array.isArray(localStarters) || !Array.isArray(visitorStarters)) {
          return {
            success: false,
            error: 'Formato de alineación inválido.'
          };
        }

        const uniqueLocal = new Set(localStarters);
        const uniqueVisitor = new Set(visitorStarters);

        if (
          uniqueLocal.size !== localStarters.length ||
          uniqueVisitor.size !== visitorStarters.length
        ) {
          return {
            success: false,
            error: 'No se permite seleccionar un jugador repetido en el quinteto titular.'
          };
        }

        if (
          localStarters.length !== REQUIRED_ON_COURT_PLAYERS ||
          visitorStarters.length !== REQUIRED_ON_COURT_PLAYERS
        ) {
          return {
            success: false,
            error: 'Debes seleccionar exactamente 5 titulares para cada equipo.'
          };
        }

        const localPlayerMap = new Map(localPlayersRaw.map(p => [p.id!, p]));
        const visitorPlayerMap = new Map(visitorPlayersRaw.map(p => [p.id!, p]));

        for (const id of localStarters) {
          if (typeof id !== 'number' || !Number.isInteger(id)) {
            return { success: false, error: 'Identificador de jugador titular inválido.' };
          }
          const player = localPlayerMap.get(id) ?? visitorPlayerMap.get(id) ?? (await db.players.get(id));
          if (!player) {
            return { success: false, error: `El jugador con ID #${id} no existe.` };
          }
          if (player.teamId !== currentMatch.localTeamId) {
            return {
              success: false,
              error: `El jugador "${player.name}" pertenece a otro equipo y no puede alinearse con ${localName}.`
            };
          }
          if (player.isArchived) {
            return {
              success: false,
              error: `El jugador "${player.name}" está retirado o archivado y no puede ingresar a cancha.`
            };
          }
        }

        for (const id of visitorStarters) {
          if (typeof id !== 'number' || !Number.isInteger(id)) {
            return { success: false, error: 'Identificador de jugador titular inválido.' };
          }
          const player = visitorPlayerMap.get(id) ?? localPlayerMap.get(id) ?? (await db.players.get(id));
          if (!player) {
            return { success: false, error: `El jugador con ID #${id} no existe.` };
          }
          if (player.teamId !== currentMatch.visitorTeamId) {
            return {
              success: false,
              error: `El jugador "${player.name}" pertenece a otro equipo y no puede alinearse con ${visitorName}.`
            };
          }
          if (player.isArchived) {
            return {
              success: false,
              error: `El jugador "${player.name}" está retirado o archivado y no puede ingresar a cancha.`
            };
          }
        }

        const nextLineups: MatchLineups = {
          enabled: true,
          localOnCourt: [...localStarters],
          visitorOnCourt: [...visitorStarters],
          version: (currentMatch.lineups?.version ?? 0) + 1
        };

        await db.matches.update(matchId, { lineups: nextLineups });

        return {
          success: true,
          lineups: nextLineups
        };
      });
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'No se pudo guardar la alineación.'
      };
    }
  },

  /**
   * Ejecuta una sustitución (jugador que sale por jugador que entra) como una única operación
   * transaccional y persistente sobre el partido actual.
   * Garantiza:
   * - 5 jugadores únicos en cancha.
   * - El reloj principal debe estar pausado (no modifica automáticamente el reloj).
   * - Jugadores activos y pertenecientes al equipo correcto.
   * - Ningún suplente simultáneamente en cancha.
   * - Rechazo explícito ante operaciones obsoletas desde otra pestaña.
   */
  async substitutePlayer(params: SubstitutePlayerParams): Promise<LineupOperationResult> {
    const {
      matchId,
      teamId,
      playerOutId,
      playerInId,
      expectedVersion,
      expectedOnCourt
    } = params;

    if (!Number.isInteger(matchId) || matchId <= 0) {
      return { success: false, error: 'Identificador de partido inválido.' };
    }

    const preMatch = await db.matches.get(matchId);
    const targetVersion = expectedVersion ?? preMatch?.lineups?.version;

    try {
      return await db.transaction('rw', db.matches, db.players, db.teams, async () => {
        const currentMatch = await db.matches.get(matchId);
        if (!currentMatch) {
          return { success: false, error: 'El partido no existe.' };
        }

        if (currentMatch.status === 'finished') {
          return {
            success: false,
            error: 'No se pueden realizar sustituciones en un partido finalizado.'
          };
        }

        const mode = currentMatch.config?.mode || 'traditional';
        if (mode !== 'traditional') {
          return {
            success: false,
            error: 'Las sustituciones solo están disponibles en partidos Traditional.'
          };
        }

        if (!currentMatch.lineups || !currentMatch.lineups.enabled) {
          return {
            success: false,
            error: 'La gestión de jugadores en cancha no está activa en este partido.'
          };
        }

        // Preferir sustituciones con el reloj principal pausado; no modificar el reloj automáticamente
        if (currentMatch.timerLastStart) {
          return {
            success: false,
            error: 'El reloj principal está corriendo. Detén o pausa el reloj primero antes de realizar la sustitución.'
          };
        }

        let side: 'local' | 'visitor';
        if (teamId === currentMatch.localTeamId) {
          side = 'local';
        } else if (teamId === currentMatch.visitorTeamId) {
          side = 'visitor';
        } else {
          return {
            success: false,
            error: 'El equipo seleccionado no corresponde a este partido.'
          };
        }

        if (
          typeof playerOutId !== 'number' ||
          !Number.isInteger(playerOutId) ||
          typeof playerInId !== 'number' ||
          !Number.isInteger(playerInId)
        ) {
          return {
            success: false,
            error: 'Debes seleccionar el jugador que sale y el jugador que entra.'
          };
        }

        if (playerOutId === playerInId) {
          return {
            success: false,
            error: 'No se puede sustituir a un jugador por sí mismo (jugador repetido).'
          };
        }

        // Control de concurrencia multi-pestaña: rechazar operación obsoleta sin sobrescribir silenciosamente
        const currentVersion = currentMatch.lineups.version ?? 1;
        if (targetVersion !== undefined && currentVersion !== targetVersion) {
          return {
            success: false,
            error: 'Conflicto de concurrencia: la alineación fue modificada en otra pestaña. Revisa el quinteto vigente e intenta nuevamente.'
          };
        }

        const currentOnCourt =
          side === 'local'
            ? currentMatch.lineups.localOnCourt
            : currentMatch.lineups.visitorOnCourt;

        if (!Array.isArray(currentOnCourt) || currentOnCourt.length !== REQUIRED_ON_COURT_PLAYERS) {
          return {
            success: false,
            error: 'La alineación actual del equipo es inválida.'
          };
        }

        if (expectedOnCourt !== undefined) {
          const matchesExpected =
            Array.isArray(expectedOnCourt) &&
            expectedOnCourt.length === currentOnCourt.length &&
            expectedOnCourt.every((id, idx) => currentOnCourt[idx] === id);
          if (!matchesExpected) {
            return {
              success: false,
              error: 'Conflicto de concurrencia: la alineación fue modificada en otra pestaña. Revisa el quinteto vigente e intenta nuevamente.'
            };
          }
        }

        const [playerOut, playerIn] = await Promise.all([
          db.players.get(playerOutId),
          db.players.get(playerInId)
        ]);

        if (!playerOut) {
          return { success: false, error: 'El jugador que sale no existe.' };
        }
        if (!playerIn) {
          return { success: false, error: 'El jugador que entra no existe.' };
        }

        if (playerOut.teamId !== teamId) {
          return {
            success: false,
            error: `El jugador "${playerOut.name}" pertenece a otro equipo.`
          };
        }
        if (playerIn.teamId !== teamId) {
          return {
            success: false,
            error: `El jugador "${playerIn.name}" pertenece a otro equipo.`
          };
        }

        if (playerOut.isArchived) {
          return {
            success: false,
            error: `El jugador "${playerOut.name}" ya fue retirado o archivado de la plantilla.`
          };
        }
        if (playerIn.isArchived) {
          return {
            success: false,
            error: `El jugador "${playerIn.name}" ya fue retirado o archivado de la plantilla.`
          };
        }

        if (!currentOnCourt.includes(playerOutId)) {
          return {
            success: false,
            error: `El jugador "${playerOut.name}" ya no está en cancha (fue sustituido previamente).`
          };
        }

        if (currentOnCourt.includes(playerInId)) {
          return {
            success: false,
            error: `El jugador "${playerIn.name}" ya se encuentra en cancha.`
          };
        }

        const nextOnCourt = currentOnCourt.map(id => (id === playerOutId ? playerInId : id));

        // Verificar invariantes estrictos: 5 jugadores únicos, sin el saliente y con el entrante
        if (
          nextOnCourt.length !== REQUIRED_ON_COURT_PLAYERS ||
          new Set(nextOnCourt).size !== REQUIRED_ON_COURT_PLAYERS ||
          nextOnCourt.includes(playerOutId) ||
          !nextOnCourt.includes(playerInId)
        ) {
          return {
            success: false,
            error: 'La sustitución produce una alineación inválida (deben permanecer exactamente 5 jugadores únicos en cancha).'
          };
        }

        const nextLineups: MatchLineups = {
          enabled: true,
          localOnCourt: side === 'local' ? nextOnCourt : [...currentMatch.lineups.localOnCourt],
          visitorOnCourt: side === 'visitor' ? nextOnCourt : [...currentMatch.lineups.visitorOnCourt],
          version: currentVersion + 1
        };

        await db.matches.update(matchId, { lineups: nextLineups });

        return {
          success: true,
          lineups: nextLineups
        };
      });
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'No se pudo completar la sustitución.'
      };
    }
  }
};
