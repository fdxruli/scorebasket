import { MatchesRepository } from '../db/matches.repository';
import { TeamsRepository } from '../db/teams.repository';
import type { Match } from '../db/models/Match';
import type { MatchConfig } from '../db/models/MatchConfig';
import type { Score } from '../db/models/Score';
import type { Foul } from '../db/models/Foul';
import type { Player } from '../db/models/Player';
import { buildRaceReportProjection } from './raceLogicHelpers';

export type ReportStatAvailability = 'confirmed' | 'partial' | 'unavailable';

export interface PlayerReportStat {
  id: number;
  name: string;
  number?: number;
  points: number;
  baskets1: number;
  baskets2: number;
  baskets3: number;
  totalBaskets: number;
  fouls: number;
}

export interface UnassignedReportStat {
  points: number;
  baskets1: number;
  baskets2: number;
  baskets3: number;
  totalBaskets: number;
  fouls: number;
  hasData: boolean;
}

export interface TeamReportStats {
  teamId: number;
  /** Puntos oficiales del equipo en el partido (null solo si serie histórica sin marcador de sets ni eventos) */
  officialPoints: number | null;
  /** Suma de puntos confirmados en eventos db.scores */
  eventPoints: number;
  /** Estado de integridad de los eventos de anotación de este equipo */
  scoreAvailability: ReportStatAvailability;
  /** Cantidad de canastas de 1 punto (null si no hay información suficiente / eventos incompletos) */
  baskets1: number | null;
  /** Cantidad de canastas de 2 puntos (null si no hay información suficiente / eventos incompletos) */
  baskets2: number | null;
  /** Cantidad de canastas de 3 puntos (null si no hay información suficiente / eventos incompletos) */
  baskets3: number | null;
  /** Total de anotaciones (canastas) registradas (null si eventos incompletos) */
  totalBaskets: number | null;
  /** Conteo parcial de canastas en eventos cuando scoreAvailability === 'partial' */
  partialBaskets: {
    baskets1: number;
    baskets2: number;
    baskets3: number;
    totalBaskets: number;
  };
  /** Faltas registradas del equipo (null si partido histórico sin eventos y sin faltas guardadas) */
  fouls: number | null;
  /** Faltas contadas en eventos db.fouls */
  eventFouls: number;
  /** Faltas almacenadas en match.localFouls / match.visitorFouls */
  storedFouls: number;
  /** Estado de disponibilidad de faltas */
  foulAvailability: 'confirmed' | 'stored_only' | 'unavailable';
  /** Jugadores con actividad (puntos > 0 o faltas > 0) ordenados por mayor puntuación */
  players: PlayerReportStat[];
  /** Jugadas sin jugador asignado (nunca atribuidas a un jugador arbitrario) */
  unassigned: UnassignedReportStat;
}

export interface ReportPeriodRow {
  period: number;
  label: string;
  local: number | null;
  visitor: number | null;
  available: boolean;
}

export interface MatchReportStats {
  mode: 'traditional' | 'race' | 'best-of-series';
  modeLabel: string;
  modeRuleSummary: string;
  isFinished: boolean;
  localWon: boolean;
  visitorWon: boolean;
  isTie: boolean;
  mainLocalScore: number;
  mainVisitorScore: number;
  scoreUnitLabel: string;
  totalHeader: string;
  localTotalCell: number;
  visitorTotalCell: number;
  isRaceWithGames: boolean;
  totalQuarters: number;
  periodAvailability: ReportStatAvailability;
  periodStats: ReportPeriodRow[];
  localTeamStats: TeamReportStats;
  visitorTeamStats: TeamReportStats;
  localStats: PlayerReportStat[];
  visitorStats: PlayerReportStat[];
  hasCompleteEvents: boolean;
  hasAnyEvents: boolean;
  integrityNotice: string | null;
}

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
 * Calcula de forma centralizada las estadísticas del reporte deportivo y de la tarjeta compartible.
 * - Preserva el marcador oficial del partido sin reemplazarlo con sumas parciales de eventos.
 * - No duplica puntos al combinar eventos con gameHistory en Race o Best-of-Series.
 * - Distingue entre valor confirmado por eventos, marcador guardado, estadística no disponible y cero real.
 * - Agrupa las jugadas sin jugador en "Sin jugador asignado" sin atribuirlas a ningún jugador arbitrario.
 */
export function computeMatchReportStats(params: {
  match: Match;
  scores?: Score[];
  fouls?: Foul[];
  players?: Player[];
}): MatchReportStats {
  const { match, scores = [], fouls = [], players = [] } = params;
  const mode = match.config?.mode || 'traditional';
  const isFinished = match.status === 'finished';
  const isUnverifiedProvenance = match.eventsProvenance === 'unverified';

  const safeScores = (scores || []).filter(
    s =>
      (s.matchId === undefined || match.id === undefined || s.matchId === match.id) &&
      (s.points === 1 || s.points === 2 || s.points === 3)
  );
  const safeFouls = (fouls || []).filter(
    f => f.matchId === undefined || match.id === undefined || f.matchId === match.id
  );
  const safePlayers = players || [];

  const localScoreEvents = safeScores.filter(s => s.teamId === match.localTeamId);
  const visitorScoreEvents = safeScores.filter(s => s.teamId === match.visitorTeamId);
  const localFoulEvents = safeFouls.filter(f => f.teamId === match.localTeamId);
  const visitorFoulEvents = safeFouls.filter(f => f.teamId === match.visitorTeamId);

  const localEventPoints = localScoreEvents.reduce((acc, s) => acc + s.points, 0);
  const visitorEventPoints = visitorScoreEvents.reduce((acc, s) => acc + s.points, 0);

  const quartersSet = new Set([
    ...safeScores.map(s => s.quarter),
    ...safeFouls.map(f => f.quarter)
  ]);
  const maxDataQuarter = Math.max(...Array.from(quartersSet), 0);
  const totalQuarters = match.config?.traditional?.totalQuarters || match.totalQuarters || 4;
  const minutesPerQuarter = match.config?.traditional?.minutesPerQuarter || match.quarterDuration || 10;

  let modeRuleSummary = `${totalQuarters} periodos × ${minutesPerQuarter} min`;
  if (mode === 'race') {
    const targetScore = match.config?.race?.targetScore || 21;
    const winByTwo = match.config?.race?.winByTwo ?? false;
    modeRuleSummary = `Meta: ${targetScore} pts${winByTwo ? ' · Dif +2' : ''}`;
  } else if (mode === 'best-of-series') {
    const totalGames = match.config?.bestOf?.totalGames || 3;
    const targetPerSet = match.config?.bestOf?.targetScorePerGame || 21;
    const winByTwo = match.config?.bestOf?.winByTwo ?? false;
    modeRuleSummary = `Al mejor de ${totalGames} sets · A ${targetPerSet} pts${winByTwo ? ' (+2)' : ''}`;
  }

  const storedLocalScore = Math.max(0, match.localScore ?? 0);
  const storedVisitorScore = Math.max(0, match.visitorScore ?? 0);

  // En modo tradicional, el marcador oficial es match.localScore / match.visitorScore si está presente (> 0 o unverified).
  // Nunca se reemplaza automáticamente por una suma parcial de eventos menor.
  let mainLocalScore =
    storedLocalScore > 0 || storedVisitorScore > 0 || isUnverifiedProvenance
      ? storedLocalScore
      : localEventPoints;
  let mainVisitorScore =
    storedLocalScore > 0 || storedVisitorScore > 0 || isUnverifiedProvenance
      ? storedVisitorScore
      : visitorEventPoints;

  let officialLocalPoints: number | null = mainLocalScore;
  let officialVisitorPoints: number | null = mainVisitorScore;

  let isRaceWithGames = false;
  let localTotalCell = mainLocalScore;
  let visitorTotalCell = mainVisitorScore;
  let totalHeader = 'Total';
  let scoreUnitLabel = isFinished ? 'FINAL' : 'EN CURSO';
  let localWon = isFinished && mainLocalScore > mainVisitorScore;
  let visitorWon = isFinished && mainVisitorScore > mainLocalScore;
  let isTie = isFinished && mainLocalScore === mainVisitorScore;
  let periodAvailability: ReportStatAvailability = 'confirmed';
  let periodStats: ReportPeriodRow[] = [];

  if (mode === 'traditional') {
    const maxDisplayPeriod = Math.max(maxDataQuarter, totalQuarters, match.currentQuarter || 1);
    const isConsistent =
      !isUnverifiedProvenance &&
      localEventPoints === officialLocalPoints &&
      visitorEventPoints === officialVisitorPoints;
    const hasNoScoreEvents = localScoreEvents.length === 0 && visitorScoreEvents.length === 0;

    if (isConsistent) {
      periodAvailability = 'confirmed';
    } else if (hasNoScoreEvents && (officialLocalPoints > 0 || officialVisitorPoints > 0 || isUnverifiedProvenance)) {
      periodAvailability = 'unavailable';
    } else {
      periodAvailability = 'partial';
    }

    for (let q = 1; q <= maxDisplayPeriod; q++) {
      const qLocal = localScoreEvents
        .filter(s => s.quarter === q)
        .reduce((a, b) => a + b.points, 0);
      const qVisitor = visitorScoreEvents
        .filter(s => s.quarter === q)
        .reduce((a, b) => a + b.points, 0);

      periodStats.push({
        period: q,
        label: formatPeriodLabel(q, totalQuarters),
        local: periodAvailability === 'unavailable' ? null : qLocal,
        visitor: periodAvailability === 'unavailable' ? null : qVisitor,
        available: periodAvailability !== 'unavailable'
      });
    }
  } else if (mode === 'race') {
    const raceProjection = buildRaceReportProjection(match, safeScores);
    mainLocalScore = raceProjection.mainLocalScore;
    mainVisitorScore = raceProjection.mainVisitorScore;
    localTotalCell = raceProjection.localTotalCell;
    visitorTotalCell = raceProjection.visitorTotalCell;
    totalHeader = raceProjection.totalHeader;
    scoreUnitLabel = raceProjection.scoreUnitLabel;
    isRaceWithGames = raceProjection.isRaceWithGames;
    localWon = raceProjection.localWon;
    visitorWon = raceProjection.visitorWon;
    isTie = raceProjection.isTie;

    periodStats = raceProjection.periodStats.map(p => ({
      period: p.period,
      label: p.label,
      local: p.local,
      visitor: p.visitor,
      available: true
    }));

    if (raceProjection.projectedGames.length > 0) {
      officialLocalPoints = raceProjection.projectedGames.reduce((acc, g) => acc + g.localScore, 0);
      officialVisitorPoints = raceProjection.projectedGames.reduce((acc, g) => acc + g.visitorScore, 0);
      if (
        officialLocalPoints === 0 &&
        officialVisitorPoints === 0 &&
        !isUnverifiedProvenance &&
        raceProjection.projectedGames.length === 1 &&
        (localEventPoints > 0 || visitorEventPoints > 0)
      ) {
        officialLocalPoints = localEventPoints;
        officialVisitorPoints = visitorEventPoints;
      }
    } else {
      officialLocalPoints = storedLocalScore;
      officialVisitorPoints = storedVisitorScore;
    }

    periodAvailability = periodStats.length > 0 ? 'confirmed' : isFinished ? 'unavailable' : 'confirmed';
  } else if (mode === 'best-of-series') {
    const storedSets = [...(match.gameHistory || [])];
    const historyBySet = new Map<number, { local: number; visitor: number }>();
    for (const g of storedSets) {
      historyBySet.set(g.gameNumber, { local: g.localScore, visitor: g.visitorScore });
    }

    const currentSetNum = match.currentQuarter || match.config?.bestOf?.currentGame || 1;
    const hasLiveSetScore = storedLocalScore > 0 || storedVisitorScore > 0;
    const maxSetNum = Math.max(
      maxDataQuarter,
      ...storedSets.map(g => g.gameNumber),
      hasLiveSetScore ? currentSetNum : 0
    );

    const mergedSets: ReportPeriodRow[] = [];
    for (let sNum = 1; sNum <= maxSetNum; sNum++) {
      const fromHist = historyBySet.get(sNum);
      const fromScoresLocal = localScoreEvents
        .filter(s => s.quarter === sNum)
        .reduce((a, b) => a + b.points, 0);
      const fromScoresVisitor = visitorScoreEvents
        .filter(s => s.quarter === sNum)
        .reduce((a, b) => a + b.points, 0);

      let setLocal = fromHist ? fromHist.local : fromScoresLocal;
      let setVisitor = fromHist ? fromHist.visitor : fromScoresVisitor;

      if (setLocal === 0 && setVisitor === 0 && (fromScoresLocal > 0 || fromScoresVisitor > 0)) {
        setLocal = fromScoresLocal;
        setVisitor = fromScoresVisitor;
      }

      if (
        sNum === currentSetNum &&
        !fromHist &&
        (!isFinished || storedSets.length === 0) &&
        hasLiveSetScore
      ) {
        setLocal = storedLocalScore;
        setVisitor = storedVisitorScore;
      }

      if (setLocal > 0 || setVisitor > 0 || fromHist) {
        mergedSets.push({
          period: sNum,
          label: `Set ${sNum}`,
          local: setLocal,
          visitor: setVisitor,
          available: true
        });
      }
    }

    periodStats = mergedSets;
    const histLocalWins = storedSets.filter(g => g.winner === 'local').length;
    const histVisitorWins = storedSets.filter(g => g.winner === 'visitor').length;
    mainLocalScore = Math.max(match.config?.bestOf?.wins?.local || 0, histLocalWins);
    mainVisitorScore = Math.max(match.config?.bestOf?.wins?.visitor || 0, histVisitorWins);
    totalHeader = 'Sets';
    localTotalCell = mainLocalScore;
    visitorTotalCell = mainVisitorScore;
    scoreUnitLabel = 'SETS';
    localWon = isFinished && mainLocalScore > mainVisitorScore;
    visitorWon = isFinished && mainVisitorScore > mainLocalScore;
    isTie = isFinished && mainLocalScore === mainVisitorScore;

    if (mergedSets.length > 0) {
      officialLocalPoints = mergedSets.reduce((acc, s) => acc + (s.local ?? 0), 0);
      officialVisitorPoints = mergedSets.reduce((acc, s) => acc + (s.visitor ?? 0), 0);
      periodAvailability = 'confirmed';
    } else if (mainLocalScore > 0 || mainVisitorScore > 0) {
      // Serie con sets ganados pero sin detalle de marcador por set ni eventos
      officialLocalPoints = null;
      officialVisitorPoints = null;
      periodAvailability = 'unavailable';
    } else {
      officialLocalPoints = storedLocalScore;
      officialVisitorPoints = storedVisitorScore;
      periodAvailability = isUnverifiedProvenance ? 'unavailable' : 'confirmed';
    }
  }

  const buildTeamStats = (
    teamId: number,
    side: 'local' | 'visitor',
    officialPts: number | null,
    teamScoreList: Score[],
    teamFoulList: Foul[]
  ): TeamReportStats => {
    const eventPoints = teamScoreList.reduce((acc, s) => acc + s.points, 0);
    const rawB1 = teamScoreList.filter(s => s.points === 1).length;
    const rawB2 = teamScoreList.filter(s => s.points === 2).length;
    const rawB3 = teamScoreList.filter(s => s.points === 3).length;
    const rawTotalBaskets = rawB1 + rawB2 + rawB3;

    // Verificar también concordancia por periodo en Race/Series cuando existen periodos cerrados
    let periodsMatchEvents = true;
    if ((mode === 'race' || mode === 'best-of-series') && periodStats.length > 0) {
      for (const pRow of periodStats) {
        const expectedPeriodPts = side === 'local' ? pRow.local : pRow.visitor;
        if (expectedPeriodPts === null) {
          periodsMatchEvents = false;
          break;
        }
        const periodEventPts = teamScoreList
          .filter(s => s.quarter === pRow.period)
          .reduce((acc, s) => acc + s.points, 0);
        if (periodEventPts !== expectedPeriodPts) {
          periodsMatchEvents = false;
          break;
        }
      }
    }

    let scoreAvailability: ReportStatAvailability;
    if (
      !isUnverifiedProvenance &&
      officialPts !== null &&
      eventPoints === officialPts &&
      periodsMatchEvents
    ) {
      scoreAvailability = 'confirmed';
    } else if (eventPoints === 0) {
      scoreAvailability = 'unavailable';
    } else {
      scoreAvailability = 'partial';
    }

    const eventFouls = teamFoulList.length;
    const storedFouls = Math.max(0, side === 'local' ? (match.localFouls ?? 0) : (match.visitorFouls ?? 0));

    let fouls: number | null;
    let foulAvailability: 'confirmed' | 'stored_only' | 'unavailable';

    if (!isUnverifiedProvenance && (eventFouls > 0 || scoreAvailability === 'confirmed')) {
      if (eventFouls >= storedFouls) {
        fouls = eventFouls;
        foulAvailability = 'confirmed';
      } else {
        fouls = storedFouls;
        foulAvailability = 'stored_only';
      }
    } else if (storedFouls > 0) {
      fouls = storedFouls;
      foulAvailability = 'stored_only';
    } else if (eventFouls > 0) {
      fouls = eventFouls;
      foulAvailability = 'stored_only';
    } else {
      fouls = null;
      foulAvailability = 'unavailable';
    }

    // Jugadores conocidos de este equipo (incluyendo archivados o referenciados por jugadas de este equipo)
    const knownPlayerMap = new Map<number, Player>();
    for (const p of safePlayers) {
      if (p.teamId === teamId && p.id !== undefined) {
        knownPlayerMap.set(p.id, p);
      }
    }
    for (const s of teamScoreList) {
      if (s.playerId !== undefined && !knownPlayerMap.has(s.playerId)) {
        const found = safePlayers.find(p => p.id === s.playerId);
        if (found && found.id !== undefined) knownPlayerMap.set(found.id, found);
      }
    }
    for (const f of teamFoulList) {
      if (f.playerId !== undefined && !knownPlayerMap.has(f.playerId)) {
        const found = safePlayers.find(p => p.id === f.playerId);
        if (found && found.id !== undefined) knownPlayerMap.set(found.id, found);
      }
    }

    const playerStatsList: PlayerReportStat[] = Array.from(knownPlayerMap.values())
      .map(p => {
        const pScores = teamScoreList.filter(s => s.playerId === p.id);
        const pFouls = teamFoulList.filter(f => f.playerId === p.id);
        const b1 = pScores.filter(s => s.points === 1).length;
        const b2 = pScores.filter(s => s.points === 2).length;
        const b3 = pScores.filter(s => s.points === 3).length;
        const totalB = b1 + b2 + b3;
        const pts = pScores.reduce((acc, s) => acc + s.points, 0);

        return {
          id: p.id!,
          name: p.name,
          number: p.number,
          points: pts,
          baskets1: b1,
          baskets2: b2,
          baskets3: b3,
          totalBaskets: totalB,
          fouls: pFouls.length
        };
      })
      .filter(p => p.points > 0 || p.fouls > 0)
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.totalBaskets !== a.totalBaskets) return b.totalBaskets - a.totalBaskets;
        if (a.fouls !== b.fouls) return a.fouls - b.fouls;
        return (a.number ?? 9999) - (b.number ?? 9999);
      });

    // Jugadas sin jugador asignado (o con playerId huérfano inexistente)
    const unassignedScores = teamScoreList.filter(
      s => s.playerId === undefined || s.playerId === null || !knownPlayerMap.has(s.playerId)
    );
    const unassignedFouls = teamFoulList.filter(
      f => f.playerId === undefined || f.playerId === null || !knownPlayerMap.has(f.playerId)
    );
    const uB1 = unassignedScores.filter(s => s.points === 1).length;
    const uB2 = unassignedScores.filter(s => s.points === 2).length;
    const uB3 = unassignedScores.filter(s => s.points === 3).length;
    const uTotalB = uB1 + uB2 + uB3;
    const uPts = unassignedScores.reduce((acc, s) => acc + s.points, 0);
    const uFoulsCount = unassignedFouls.length;

    return {
      teamId,
      officialPoints: officialPts,
      eventPoints,
      scoreAvailability,
      baskets1: scoreAvailability === 'confirmed' ? rawB1 : null,
      baskets2: scoreAvailability === 'confirmed' ? rawB2 : null,
      baskets3: scoreAvailability === 'confirmed' ? rawB3 : null,
      totalBaskets: scoreAvailability === 'confirmed' ? rawTotalBaskets : null,
      partialBaskets: {
        baskets1: rawB1,
        baskets2: rawB2,
        baskets3: rawB3,
        totalBaskets: rawTotalBaskets
      },
      fouls,
      eventFouls,
      storedFouls,
      foulAvailability,
      players: playerStatsList,
      unassigned: {
        points: uPts,
        baskets1: uB1,
        baskets2: uB2,
        baskets3: uB3,
        totalBaskets: uTotalB,
        fouls: uFoulsCount,
        hasData: uPts > 0 || uFoulsCount > 0
      }
    };
  };

  const localTeamStats = buildTeamStats(
    match.localTeamId,
    'local',
    officialLocalPoints,
    localScoreEvents,
    localFoulEvents
  );
  const visitorTeamStats = buildTeamStats(
    match.visitorTeamId,
    'visitor',
    officialVisitorPoints,
    visitorScoreEvents,
    visitorFoulEvents
  );

  // Si un equipo tiene eventos incompletos/no disponibles y el otro equipo tenía 0 puntos sin eventos en un partido sin eventos,
  // evitar mostrar 0 confirmado unilateral cuando el partido entero carece de eventos registrados.
  const hasAnyEvents = safeScores.length > 0 || safeFouls.length > 0;
  if (!hasAnyEvents && (localTeamStats.scoreAvailability === 'unavailable' || visitorTeamStats.scoreAvailability === 'unavailable')) {
    for (const ts of [localTeamStats, visitorTeamStats]) {
      if (ts.scoreAvailability === 'confirmed') {
        ts.scoreAvailability = 'unavailable';
        ts.baskets1 = null;
        ts.baskets2 = null;
        ts.baskets3 = null;
        ts.totalBaskets = null;
        if (ts.storedFouls === 0) {
          ts.fouls = null;
          ts.foulAvailability = 'unavailable';
        }
      }
    }
  }

  const hasCompleteEvents =
    localTeamStats.scoreAvailability === 'confirmed' &&
    visitorTeamStats.scoreAvailability === 'confirmed';

  let integrityNotice: string | null = null;
  if (!hasCompleteEvents) {
    if (!hasAnyEvents) {
      integrityNotice =
        'Partido histórico con marcador oficial guardado sin desglose de eventos individuales.';
    } else {
      integrityNotice =
        'Se conserva el marcador oficial del partido. Los eventos individuales registrados están incompletos.';
    }
  }

  return {
    mode,
    modeLabel: getModeName(mode),
    modeRuleSummary,
    isFinished,
    localWon,
    visitorWon,
    isTie,
    mainLocalScore,
    mainVisitorScore,
    scoreUnitLabel,
    totalHeader,
    localTotalCell,
    visitorTotalCell,
    isRaceWithGames,
    totalQuarters,
    periodAvailability,
    periodStats,
    localTeamStats,
    visitorTeamStats,
    localStats: localTeamStats.players,
    visitorStats: visitorTeamStats.players,
    hasCompleteEvents,
    hasAnyEvents,
    integrityNotice
  };
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
