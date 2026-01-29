// src/components/matches/MatchHistoryModal.tsx
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { X, Calendar, BarChart2, Users } from 'lucide-react';

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

    // --- 2. CÁLCULOS ---
    const stats = useMemo(() => {
        if (!data) return null;
        const { match, scores, fouls, players } = data;

        // A. Totales
        const localPoints = scores.filter(s => s.teamId === match.localTeamId).reduce((a, b) => a + b.points, 0);
        const visitorPoints = scores.filter(s => s.teamId === match.visitorTeamId).reduce((a, b) => a + b.points, 0);

        // B. Cuartos
        const safeScores = scores || [];
        const safeFouls = fouls || [];
        
        const quartersSet = new Set([
            ...safeScores.map(s => s.quarter), 
            ...safeFouls.map(f => f.quarter)
        ]);

        const maxQuarter = Math.max(
            match.totalQuarters || 4, 
            match.currentQuarter || 1, 
            ...Array.from(quartersSet),
            0
        );
        
        const quarterStats = [];
        for (let q = 1; q <= maxQuarter; q++) {
            quarterStats.push({
                q,
                local: safeScores.filter(s => s.teamId === match.localTeamId && s.quarter === q).reduce((a, b) => a + b.points, 0),
                visitor: safeScores.filter(s => s.teamId === match.visitorTeamId && s.quarter === q).reduce((a, b) => a + b.points, 0),
            });
        }

        // C. Estadísticas por Jugador
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
            .filter(p => p.points > 0 || p.fouls > 0) // Mostrar solo si jugaron
            .sort((a, b) => b.points - a.points);
        };

        return { 
            localPoints, 
            visitorPoints, 
            quarterStats, 
            localStats: processTeamStats(match.localTeamId),
            visitorStats: processTeamStats(match.visitorTeamId)
        };
    }, [data]);

    if (!data || !stats) return null;
    const { match, localTeam, visitorTeam } = data;
    const localWon = stats.localPoints > stats.visitorPoints;
    const visitorWon = stats.visitorPoints > stats.localPoints;

    const formatDate = (date: Date) => {
        try {
            return new Intl.DateTimeFormat('es-MX', {
              weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
            }).format(date);
        } catch (e) {
            return date.toLocaleDateString();
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            {/* Se usa 'variant-report' definido en modals.css */}
            <div className="modal-content variant-report" onClick={e => e.stopPropagation()}>
                
                {/* 1. HEADER ESTÁNDAR (Usando clases de modals.css) */}
                <div className="modal-header">
                    <div className="flex flex-col">
                        <span style={{ 
                            fontSize: '0.75rem', 
                            fontWeight: 700, 
                            color: 'var(--text-muted)', 
                            textTransform: 'uppercase', 
                            letterSpacing: '1px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}>
                            <Calendar size={12} />
                            {formatDate(match.createdAt)}
                        </span>
                        <h2 className="modal-title" style={{ marginTop: '0.25rem' }}>
                            Resumen Oficial
                        </h2>
                    </div>
                    <button onClick={onClose} className="btn-icon">
                        <X size={24} />
                    </button>
                </div>

                {/* 2. MARCADOR GRANDE (Panel destacado) */}
                <div className="report-score-panel">
                    {/* Local (Azul - Secondary) */}
                    <div className={`report-team ${localWon ? 'is-winner' : ''}`}>
                        <span className="report-team-name">{localTeam?.name || 'Local'}</span>
                        <span className="report-score-big">{stats.localPoints}</span>
                    </div>

                    <div className="report-vs">VS</div>

                    {/* Visita (Naranja - Primary) */}
                    <div className={`report-team ${visitorWon ? 'is-winner' : ''}`}>
                        <span className="report-team-name">{visitorTeam?.name || 'Visita'}</span>
                        <span className="report-score-big">{stats.visitorPoints}</span>
                    </div>
                </div>

                {/* 3. CUERPO SCROLLABLE */}
                <div className="modal-body" style={{ padding: 0, paddingBottom: '2rem' }}>
                    <div className="report-section">
                        
                        {/* TABLA DE CUARTOS */}
                        <div className="report-subtitle">
                            <BarChart2 size={14} /> Desglose por Periodos
                        </div>
                        
                        <div 
                            className="report-quarters-grid" 
                            style={{ gridTemplateColumns: `100px repeat(${stats.quarterStats.length}, 1fr) 50px` }}
                        >
                            {/* Header Row */}
                            <div className="q-cell head">Equipo</div>
                            {stats.quarterStats.map(qs => <div key={qs.q} className="q-cell head">Q{qs.q}</div>)}
                            <div className="q-cell head">T</div>

                            {/* Local Row */}
                            <div className="q-cell team-name" style={{ color: 'var(--secondary)' }}>
                                {localTeam?.name?.substring(0,10)}
                            </div>
                            {stats.quarterStats.map(qs => <div key={`l-${qs.q}`} className="q-cell">{qs.local}</div>)}
                            <div className="q-cell total">{stats.localPoints}</div>

                            {/* Visitor Row */}
                            <div className="q-cell team-name" style={{ color: 'var(--primary)' }}>
                                {visitorTeam?.name?.substring(0,10)}
                            </div>
                            {stats.quarterStats.map(qs => <div key={`v-${qs.q}`} className="q-cell">{qs.visitor}</div>)}
                            <div className="q-cell total">{stats.visitorPoints}</div>
                        </div>


                        {/* ESTADÍSTICAS DETALLADAS (BOX SCORE) */}
                        <div className="report-subtitle" style={{ marginTop: '2rem' }}>
                            <Users size={14} /> Estadísticas de Jugadores
                        </div>

                        {/* GRUPO LOCAL (Usando variables CSS para bordes y colores) */}
                        <div className="stats-group">
                            <h4 
                                style={{ 
                                    fontSize: '0.85rem', 
                                    fontWeight: 700, 
                                    color: 'var(--secondary)', 
                                    borderBottom: '1px solid var(--secondary-bg)',
                                    paddingBottom: '0.25rem',
                                    marginBottom: '0.5rem',
                                    paddingLeft: '0.5rem'
                                }}
                            >
                                {localTeam?.name}
                            </h4>
                            <div className="stats-header-row">
                                <span>Jugador</span>
                                <div className="flex gap-4">
                                    <span style={{ width: '40px', textAlign: 'center' }} title="Faltas Personales">FAL</span>
                                    <span style={{ width: '40px', textAlign: 'center' }} title="Puntos">PTS</span>
                                </div>
                            </div>
                            {stats.localStats.length === 0 ? (
                                <p className="text-muted" style={{ fontSize: '0.8rem', padding: '0.5rem', fontStyle: 'italic' }}>Sin registros.</p>
                            ) : stats.localStats.map(p => (
                                <div key={p.id} className="stat-player-row">
                                    <div className="player-info">
                                        <span className="player-num">{p.number ?? '-'}</span>
                                        <span className="player-name">{p.name}</span>
                                    </div>
                                    <div className="stat-numbers">
                                        <span 
                                            className="stat-col fls"
                                            style={{ color: p.fouls >= 5 ? 'var(--danger)' : 'inherit', fontWeight: p.fouls >= 5 ? 700 : 400 }}
                                        >
                                            {p.fouls > 0 ? '●'.repeat(p.fouls) : '-'}
                                        </span>
                                        <span className="stat-col pts">{p.points}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* GRUPO VISITANTE */}
                        <div className="stats-group">
                             <h4 
                                style={{ 
                                    fontSize: '0.85rem', 
                                    fontWeight: 700, 
                                    color: 'var(--primary)', 
                                    borderBottom: '1px solid rgba(249, 115, 22, 0.2)', /* Primary con opacidad manual o var */
                                    paddingBottom: '0.25rem',
                                    marginBottom: '0.5rem',
                                    paddingLeft: '0.5rem'
                                }}
                            >
                                {visitorTeam?.name}
                            </h4>
                            <div className="stats-header-row">
                                <span>Jugador</span>
                                <div className="flex gap-4">
                                    <span style={{ width: '40px', textAlign: 'center' }}>FAL</span>
                                    <span style={{ width: '40px', textAlign: 'center' }}>PTS</span>
                                </div>
                            </div>
                            {stats.visitorStats.length === 0 ? (
                                <p className="text-muted" style={{ fontSize: '0.8rem', padding: '0.5rem', fontStyle: 'italic' }}>Sin registros.</p>
                            ) : stats.visitorStats.map(p => (
                                <div key={p.id} className="stat-player-row">
                                    <div className="player-info">
                                        <span className="player-num">{p.number ?? '-'}</span>
                                        <span className="player-name">{p.name}</span>
                                    </div>
                                    <div className="stat-numbers">
                                        <span 
                                            className="stat-col fls"
                                            style={{ color: p.fouls >= 5 ? 'var(--danger)' : 'inherit', fontWeight: p.fouls >= 5 ? 700 : 400 }}
                                        >
                                            {p.fouls > 0 ? '●'.repeat(p.fouls) : '-'}
                                        </span>
                                        <span className="stat-col pts">{p.points}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}