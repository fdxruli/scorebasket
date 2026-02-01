// src/components/matches/MatchHistoryModal.tsx
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { X, Calendar, BarChart2, Users, Target, Layers } from 'lucide-react';

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

        // Determinar qué periodos existen realmente en los datos
        const quartersSet = new Set([
            ...safeScores.map(s => s.quarter),
            ...safeFouls.map(f => f.quarter)
        ]);
        const maxDataQuarter = Math.max(...Array.from(quartersSet), 0);

        // Definir límite visual de la tabla según el modo
        let maxDisplayPeriod = maxDataQuarter;

        if (mode === 'traditional') {
            // En tradicional, mostramos al menos los configurados (ej: 4)
            const configQuarters = match.config?.traditional?.totalQuarters || match.totalQuarters || 4;
            maxDisplayPeriod = Math.max(maxDataQuarter, configQuarters);
        }
        // En 'best-of-series' y 'race', maxDisplayPeriod se basa puramente en los datos jugados (maxDataQuarter)
        // para evitar mostrar "Sets" vacíos que no ocurrieron.

        const periodStats = [];
        for (let q = 1; q <= maxDisplayPeriod; q++) {
            periodStats.push({
                period: q,
                local: safeScores.filter(s => s.teamId === match.localTeamId && s.quarter === q).reduce((a, b) => a + b.points, 0),
                visitor: safeScores.filter(s => s.teamId === match.visitorTeamId && s.quarter === q).reduce((a, b) => a + b.points, 0),
            });
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
                .filter(p => p.points > 0 || p.fouls > 0) // Mostrar solo si participaron
                .sort((a, b) => b.points - a.points);
        };

        return {
            mainLocalScore,
            mainVisitorScore,
            localPointsTotal,
            visitorPointsTotal,
            periodStats,
            localStats: processTeamStats(match.localTeamId),
            visitorStats: processTeamStats(match.visitorTeamId),
            mode
        };
    }, [data]);

    if (!data || !stats) return null;
    const { match, localTeam, visitorTeam } = data;

    // Determinar ganador visual
    const localWon = stats.mainLocalScore > stats.mainVisitorScore;
    const visitorWon = stats.mainVisitorScore > stats.mainLocalScore;

    const formatDate = (date: Date) => {
        try {
            return new Intl.DateTimeFormat('es-MX', {
                weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
            }).format(date);
        } catch (e) { return ""; }
    };

    // Helper para etiquetas de la tabla
    const getPeriodLabel = (p: number) => {
        if (stats.mode === 'best-of-series') return `Set ${p}`;
        if (stats.mode === 'race') return `Juego`;
        return `Q${p}`;
    };

    const getModeIcon = () => {
        if (stats.mode === 'best-of-series') return <Layers size={14} />;
        if (stats.mode === 'race') return <Target size={14} />;
        return <BarChart2 size={14} />;
    };

    const getModeTitle = () => {
        if (stats.mode === 'best-of-series') return 'Desglose por Sets';
        if (stats.mode === 'race') return 'Puntuación Final';
        return 'Desglose por Periodos';
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content variant-report" onClick={e => e.stopPropagation()}>

                {/* 1. HEADER */}
                <div className="modal-header">
                    <div className="flex flex-col">
                        <span className="text-xs font-bold text-muted uppercase tracking-widest flex items-center gap-2">
                            <Calendar size={12} />
                            {formatDate(match.createdAt)}
                        </span>
                        <h2 className="modal-title mt-1">
                            Resumen Oficial
                        </h2>
                    </div>
                    <button onClick={onClose} className="btn-icon">
                        <X size={24} />
                    </button>
                </div>

                {/* 2. MARCADOR PRINCIPAL (ADAPTABLE) */}
                <div className="report-score-panel">
                    {/* Local */}
                    <div className={`report-team ${localWon ? 'is-winner' : ''}`}>
                        <span className="report-team-name">{localTeam?.name || 'Local'}</span>
                        <span className="report-score-big">{stats.mainLocalScore}</span>
                    </div>

                    <div className="report-vs">
                        {stats.mode === 'best-of-series' ? 'SETS' : 'VS'}
                    </div>

                    {/* Visita */}
                    <div className={`report-team ${visitorWon ? 'is-winner' : ''}`}>
                        <span className="report-team-name">{visitorTeam?.name || 'Visita'}</span>
                        <span className="report-score-big">{stats.mainVisitorScore}</span>
                    </div>
                </div>

                {/* 3. CUERPO SCROLLABLE */}
                <div className="modal-body p-0 pb-8">
                    <div className="report-section">

                        {/* TABLA DINÁMICA DE PERIODOS / SETS */}
                        {stats.periodStats.length > 0 && (
                            <>
                                <div className="report-subtitle mb-4">
                                    {getModeIcon()} {getModeTitle()}
                                </div>

                                {/* CONTENEDOR CON SCROLL HORIZONTAL (por si hay muchos sets) */}
                                <div className="overflow-x-auto pb-2">
                                    <div
                                        className="report-quarters-grid"
                                        style={{
                                            // MEJORA CLAVE:
                                            // 1. Nombre: minmax(140px, 2fr) -> Mínimo 140px, pero puede crecer.
                                            // 2. Periodos: minmax(45px, 1fr) -> Ancho cómodo para números.
                                            // 3. Total: minmax(70px, 0.5fr) -> Espacio fijo para el total.
                                            gridTemplateColumns: `minmax(140px, 2fr) repeat(${stats.periodStats.length}, minmax(45px, 1fr)) minmax(70px, 0.5fr)`
                                        }}
                                    >
                                        {/* --- HEADER --- */}
                                        <div className="q-cell head text-left pl-2">Equipo</div>
                                        {stats.periodStats.map(qs => (
                                            <div key={qs.period} className="q-cell head">
                                                {getPeriodLabel(qs.period)}
                                            </div>
                                        ))}
                                        <div className="q-cell head">Total</div>

                                        {/* --- FILA LOCAL --- */}
                                        <div className="q-cell team-name local">
                                            {localTeam?.name || 'Local'}
                                        </div>
                                        {stats.periodStats.map(qs => (
                                            <div key={`l-${qs.period}`} className="q-cell score-val">
                                                {qs.local}
                                            </div>
                                        ))}
                                        <div className="q-cell total-val">{stats.localPointsTotal}</div>

                                        {/* --- FILA VISITANTE --- */}
                                        <div className="q-cell team-name visitor">
                                            {visitorTeam?.name || 'Visita'}
                                        </div>
                                        {stats.periodStats.map(qs => (
                                            <div key={`v-${qs.period}`} className="q-cell score-val">
                                                {qs.visitor}
                                            </div>
                                        ))}
                                        <div className="q-cell total-val">{stats.visitorPointsTotal}</div>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* ESTADÍSTICAS JUGADORES (BOX SCORE) */}
                        <div className="report-subtitle mt-8">
                            <Users size={14} /> Estadísticas de Jugadores
                        </div>

                        {/* GRUPO LOCAL */}
                        <TeamStatsGroup teamName={localTeam?.name} stats={stats.localStats} color="var(--secondary)" />

                        {/* GRUPO VISITANTE */}
                        <TeamStatsGroup teamName={visitorTeam?.name} stats={stats.visitorStats} color="var(--primary)" />

                    </div>
                </div>
            </div>
        </div>
    );
}

// Subcomponente para lista de jugadores (limpieza de código)
const TeamStatsGroup = ({ teamName, stats, color }: { teamName?: string, stats: PlayerStat[], color: string }) => (
    <div className="stats-group">
        <h4
            style={{
                fontSize: '0.85rem', fontWeight: 700, color: color,
                borderBottom: `1px solid ${color}33`, // 33 es aprox 20% opacity hex
                paddingBottom: '0.25rem', marginBottom: '0.5rem', paddingLeft: '0.5rem'
            }}
        >
            {teamName}
        </h4>
        <div className="stats-header-row">
            <span>Jugador</span>
            <div className="flex gap-4">
                <span className="w-10 text-center">FAL</span>
                <span className="w-10 text-center">PTS</span>
            </div>
        </div>
        {stats.length === 0 ? (
            <p className="text-muted text-xs p-2 italic">Sin registros.</p>
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