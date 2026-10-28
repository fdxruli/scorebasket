// src/components/matches/MatchHistoryModal.tsx
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { X, Calendar, BarChart2, Users, Target, Layers, Trash2 } from 'lucide-react';
import { formatPeriodLabel, deleteMatchCascade } from '../../utils/matchHelpers';

interface MatchHistoryModalProps {
    matchId: number;
    onClose: () => void;
}

interface PlayerStat {
    id: number;
    name: string;
    number?: number;
    points: number;
    fouls: number;
}

export function MatchHistoryModal({ matchId, onClose }: MatchHistoryModalProps) {

    // --- 1. CARGA DE DATOS ---
    const data = useLiveQuery(async () => {
        const match = await db.matches.get(matchId);
        if (!match) return null;

        const [localTeam, visitorTeam, scores, fouls, players] = await Promise.all([
            db.teams.get(match.localTeamId),
            db.teams.get(match.visitorTeamId),
            db.scores.where({ matchId }).toArray(),
            db.fouls.where({ matchId }).toArray(),
            db.players.where('teamId').anyOf([match.localTeamId, match.visitorTeamId]).toArray()
        ]);

        return {
            match,
            localTeam,
            visitorTeam,
            scores: scores || [],
            fouls: fouls || [],
            players: players || []
        };
    }, [matchId]);

    const handleDeleteMatch = async () => {
        if (!window.confirm('¿Eliminar permanentemente este partido y todas sus estadísticas?')) return;
        try {
            await deleteMatchCascade(matchId);
            onClose();
        } catch (err) {
            console.error('Error al eliminar partido:', err);
            window.alert('No se pudo eliminar el partido.');
        }
    };

    // --- 2. CÁLCULOS Y LÓGICA DE MODO ---
    const stats = useMemo(() => {
        if (!data) return null;
        const { match, scores, fouls, players } = data;
        const mode = match.config?.mode || 'traditional';

        // A. Totales de Puntos (Siempre útil para stats de jugador)
        const localPointsTotal = scores.filter(s => s.teamId === match.localTeamId).reduce((a, b) => a + b.points, 0);
        const visitorPointsTotal = scores.filter(s => s.teamId === match.visitorTeamId).reduce((a, b) => a + b.points, 0);

        // B. Lógica de Marcador Principal (Big Score)
        let mainLocalScore = localPointsTotal;
        let mainVisitorScore = visitorPointsTotal;

        // Si es SERIES, el marcador principal son los SETS GANADOS
        if (mode === 'best-of-series') {
            mainLocalScore = match.config.bestOf?.wins?.local || 0;
            mainVisitorScore = match.config.bestOf?.wins?.visitor || 0;
        }

        // C. Lógica de la Tabla (Cuartos / Sets)
        const safeScores = scores || [];
        const safeFouls = fouls || [];

        const quartersSet = new Set([
            ...safeScores.map(s => s.quarter),
            ...safeFouls.map(f => f.quarter)
        ]);
        const maxDataQuarter = Math.max(...Array.from(quartersSet), 0);

        const totalQuarters = match.config?.traditional?.totalQuarters || match.totalQuarters || 4;

        let maxDisplayPeriod = maxDataQuarter;

        if (mode === 'traditional') {
            maxDisplayPeriod = Math.max(maxDataQuarter, totalQuarters);
        }

        let periodStats: { period: number; local: number; visitor: number }[] = [];
        for (let q = 1; q <= maxDisplayPeriod; q++) {
            periodStats.push({
                period: q,
                local: safeScores.filter(s => s.teamId === match.localTeamId && s.quarter === q).reduce((a, b) => a + b.points, 0),
                visitor: safeScores.filter(s => s.teamId === match.visitorTeamId && s.quarter === q).reduce((a, b) => a + b.points, 0),
            });
        }

        // C2. Reta con revanchas o juegos guardados en gameHistory
        const gameHistory = match.gameHistory || [];
        const hasRematchesPlayed = (match.config?.race?.currentGame || 1) > 1 || gameHistory.length > 1;
        const isCurrentScoreZero = (match.localScore || 0) === 0 && (match.visitorScore || 0) === 0;
        const isRaceWithGames =
            mode === 'race' &&
            gameHistory.length >= 1 &&
            (hasRematchesPlayed || isCurrentScoreZero);

        let localTotalCell: number = localPointsTotal;
        let visitorTotalCell: number = visitorPointsTotal;
        let totalHeader = 'Total';

        if (isRaceWithGames) {
            const sortedGames = [...gameHistory].sort((a, b) => a.gameNumber - b.gameNumber);
            mainLocalScore = sortedGames.filter(g => g.winner === 'local').length;
            mainVisitorScore = sortedGames.filter(g => g.winner === 'visitor').length;
            periodStats = sortedGames.map(g => ({
                period: g.gameNumber,
                local: g.localScore,
                visitor: g.visitorScore
            }));
            localTotalCell = mainLocalScore;
            visitorTotalCell = mainVisitorScore;
            totalHeader = 'Ganados';
        } else if (mode === 'race' && gameHistory.length === 1 && localPointsTotal === 0 && visitorPointsTotal === 0) {
            // Fallback por si el partido se guardó en gameHistory sin scores individuales
            mainLocalScore = gameHistory[0].localScore;
            mainVisitorScore = gameHistory[0].visitorScore;
            localTotalCell = mainLocalScore;
            visitorTotalCell = mainVisitorScore;
        }

        if (mode === 'best-of-series') {
            if (gameHistory.length > 0 && periodStats.length === 0) {
                const sortedSets = [...gameHistory].sort((a, b) => a.gameNumber - b.gameNumber);
                periodStats = sortedSets.map(g => ({
                    period: g.gameNumber,
                    local: g.localScore,
                    visitor: g.visitorScore
                }));
            }
            totalHeader = 'Sets';
            localTotalCell = mainLocalScore;
            visitorTotalCell = mainVisitorScore;
        }

        // D. Estadísticas por Jugador
        const processTeamStats = (teamId: number): PlayerStat[] => {
            if (!players) return [];
            const teamPlayers = players.filter(p => p.teamId === teamId);

            return teamPlayers.map(p => {
                const pPoints = safeScores
                    .filter(s => s.playerId === p.id)
                    .reduce((acc, curr) => acc + curr.points, 0);

                const pFouls = safeFouls
                    .filter(f => f.playerId === p.id)
                    .length;

                return {
                    id: p.id!,
                    name: p.name,
                    number: p.number,
                    points: pPoints,
                    fouls: pFouls
                };
            })
                .filter(p => p.points > 0 || p.fouls > 0)
                .sort((a, b) => b.points - a.points);
        };

        return {
            mainLocalScore,
            mainVisitorScore,
            localPointsTotal,
            visitorPointsTotal,
            localTotalCell,
            visitorTotalCell,
            totalHeader,
            isRaceWithGames,
            totalQuarters,
            periodStats,
            localStats: processTeamStats(match.localTeamId),
            visitorStats: processTeamStats(match.visitorTeamId),
            mode
        };
    }, [data]);

    if (!data || !stats) return null;
    const { match, localTeam, visitorTeam } = data;

    const localWon = stats.mainLocalScore > stats.mainVisitorScore;
    const visitorWon = stats.mainVisitorScore > stats.mainLocalScore;

    const formatDate = (date: Date) => {
        try {
            return new Intl.DateTimeFormat('es-MX', {
                weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
            }).format(date);
        } catch { return ""; }
    };

    const getPeriodLabel = (p: number) => {
        if (stats.mode === 'best-of-series') return `Set ${p}`;
        if (stats.mode === 'race') return `Juego ${p}`;
        return formatPeriodLabel(p, stats.totalQuarters);
    };

    const getModeIcon = () => {
        if (stats.mode === 'best-of-series') return <Layers size={15} />;
        if (stats.mode === 'race') return <Target size={15} />;
        return <BarChart2 size={15} />;
    };

    const getModeTitle = () => {
        if (stats.mode === 'best-of-series') return 'Desglose por Sets';
        if (stats.mode === 'race') return stats.isRaceWithGames ? 'Desglose por Juegos' : 'Puntuación Final';
        return 'Desglose por Periodos';
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content variant-report" onClick={e => e.stopPropagation()}>

                {/* 1. HEADER */}
                <div className="modal-header">
                    <div className="flex-col">
                        <span
                            className="flex-gap text-muted uppercase font-bold"
                            style={{ fontSize: '0.72rem', letterSpacing: '0.1em' }}
                        >
                            <Calendar size={12} color="var(--primary)" />
                            {formatDate(match.createdAt)}
                        </span>
                        <h2 className="modal-title" style={{ marginTop: '0.15rem' }}>
                            Acta Oficial del Partido
                        </h2>
                    </div>
                    <div className="flex-gap" style={{ gap: '0.5rem' }}>
                        <button
                            type="button"
                            onClick={handleDeleteMatch}
                            className="btn btn-sm btn-secondary"
                            style={{
                                color: 'var(--danger)',
                                borderColor: 'rgba(244, 63, 94, 0.35)',
                                backgroundColor: 'rgba(244, 63, 94, 0.08)',
                                padding: '0.4rem 0.65rem',
                                fontSize: '0.75rem'
                            }}
                            title="Eliminar Partido"
                        >
                            <Trash2 size={14} />
                            Eliminar Partido
                        </button>
                        <button onClick={onClose} className="btn-icon">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* 2. MARCADOR PRINCIPAL */}
                <div className="report-score-panel">
                    <div className={`report-team ${localWon ? 'is-winner' : ''}`}>
                        <span className="report-team-name">{localTeam?.name || 'Local'}</span>
                        <span className="report-score-big">{stats.mainLocalScore}</span>
                    </div>

                    <div className="report-vs">
                        {stats.mode === 'best-of-series' ? 'SETS' : stats.isRaceWithGames ? 'JUEGOS' : 'FINAL'}
                    </div>

                    <div className={`report-team ${visitorWon ? 'is-winner' : ''}`}>
                        <span className="report-team-name">{visitorTeam?.name || 'Visita'}</span>
                        <span className="report-score-big">{stats.mainVisitorScore}</span>
                    </div>
                </div>

                {/* 3. CUERPO SCROLLABLE */}
                <div className="modal-body" style={{ padding: 0 }}>
                    <div className="report-section">

                        {/* TABLA DINÁMICA DE PERIODOS / SETS */}
                        {stats.periodStats.length > 0 && (
                            <>
                                <div className="report-subtitle">
                                    {getModeIcon()} {getModeTitle()}
                                </div>

                                <div style={{ overflowX: 'auto', paddingBottom: '0.5rem' }}>
                                    <div
                                        className="report-quarters-grid"
                                        style={{
                                            gridTemplateColumns: `minmax(130px, 1.8fr) repeat(${stats.periodStats.length}, minmax(44px, 1fr)) minmax(68px, 0.8fr)`
                                        }}
                                    >
                                        <div className="q-cell head" style={{ textAlign: 'left', paddingLeft: '0.75rem' }}>Equipo</div>
                                        {stats.periodStats.map(qs => (
                                            <div key={qs.period} className="q-cell head">
                                                {getPeriodLabel(qs.period)}
                                            </div>
                                        ))}
                                        <div className="q-cell head">{stats.totalHeader}</div>

                                        <div className="q-cell team-name local">
                                            {localTeam?.name || 'Local'}
                                        </div>
                                        {stats.periodStats.map(qs => (
                                            <div key={`l-${qs.period}`} className="q-cell score-val">
                                                {qs.local}
                                            </div>
                                        ))}
                                        <div className="q-cell total-val">{stats.localTotalCell}</div>

                                        <div className="q-cell team-name visitor">
                                            {visitorTeam?.name || 'Visita'}
                                        </div>
                                        {stats.periodStats.map(qs => (
                                            <div key={`v-${qs.period}`} className="q-cell score-val">
                                                {qs.visitor}
                                            </div>
                                        ))}
                                        <div className="q-cell total-val">{stats.visitorTotalCell}</div>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* ESTADÍSTICAS JUGADORES (BOX SCORE) */}
                        <div className="report-subtitle" style={{ marginTop: '1.75rem' }}>
                            <Users size={15} /> Box Score de Jugadores
                        </div>

                        <div className="report-boxscore-columns">
                            <TeamStatsGroup teamName={localTeam?.name} stats={stats.localStats} color="var(--secondary)" />
                            <TeamStatsGroup teamName={visitorTeam?.name} stats={stats.visitorStats} color="var(--primary)" />
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}

const TeamStatsGroup = ({ teamName, stats, color }: { teamName?: string, stats: PlayerStat[], color: string }) => (
    <div className="stats-group">
        <h4
            style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.05rem',
                fontWeight: 800,
                color: color,
                borderBottom: `1px solid ${color}33`,
                paddingBottom: '0.4rem',
                marginBottom: '0.5rem'
            }}
        >
            {teamName}
        </h4>
        <div className="stats-header-row">
            <span>Jugador</span>
            <div className="flex-gap" style={{ gap: '1rem' }}>
                <span className="text-center" style={{ width: '42px' }}>FAL</span>
                <span className="text-center" style={{ width: '42px' }}>PTS</span>
            </div>
        </div>
        {stats.length === 0 ? (
            <p className="text-muted" style={{ fontSize: '0.8rem', padding: '0.75rem 0.5rem', fontStyle: 'italic' }}>
                Sin estadísticas individuales registradas.
            </p>
        ) : stats.map(p => (
            <div key={p.id} className="stat-player-row">
                <div className="player-info">
                    <span className="player-num">{p.number ?? '-'}</span>
                    <span className="player-name">{p.name}</span>
                </div>
                <div className="stat-numbers">
                    <span className="stat-col fls" style={{
                        color: p.fouls >= 5 ? 'var(--danger)' : 'inherit',
                        fontWeight: p.fouls >= 5 ? 700 : 400
                    }}>
                        {p.fouls > 0 ? '●'.repeat(p.fouls) : '-'}
                    </span>
                    <span className="stat-col pts">{p.points}</span>
                </div>
            </div>
        ))}
    </div>
);
