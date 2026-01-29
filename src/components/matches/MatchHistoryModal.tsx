import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db'; // Ajusta la ruta según tu estructura
import { X, Calendar, BarChart2, Trophy } from 'lucide-react';

interface MatchHistoryModalProps {
    matchId: number;
    onClose: () => void;
}

export function MatchHistoryModal({ matchId, onClose }: MatchHistoryModalProps) {
    
    // --- CARGA DE DATOS COMPLETA ---
    const data = useLiveQuery(async () => {
        const match = await db.matches.get(matchId);
        if (!match) return null;

        const [localTeam, visitorTeam, scores, players] = await Promise.all([
            db.teams.get(match.localTeamId),
            db.teams.get(match.visitorTeamId),
            db.scores.where({ matchId }).toArray(),
            db.players.where('teamId').anyOf([match.localTeamId, match.visitorTeamId]).toArray()
        ]);

        return { match, localTeam, visitorTeam, scores, players };
    }, [matchId]);

    // --- CÁLCULOS (MEMOIZED) ---
    const stats = useMemo(() => {
        if (!data) return null;
        const { match, scores, players } = data;

        // 1. Puntos por Equipo
        const localPoints = scores.filter(s => s.teamId === match.localTeamId).reduce((a, b) => a + b.points, 0);
        const visitorPoints = scores.filter(s => s.teamId === match.visitorTeamId).reduce((a, b) => a + b.points, 0);

        // 2. Desglose por Cuartos
        const quarters = Array.from(new Set(scores.map(s => s.quarter))).sort();
        
        // 🔧 CORRECCIÓN: Respetar la configuración real del partido
        // Usamos el mayor entre: cuartos configurados, cuarto actual, o cuartos con datos
        const maxQuarter = Math.max(
            match.totalQuarters,           // Cuartos configurados originalmente
            match.currentQuarter,          // Cuarto en el que terminó
            ...quarters,                   // Cuartos con anotaciones
            0                              // Fallback seguro
        );
        
        const quarterStats = [];
        
        for (let q = 1; q <= maxQuarter; q++) {
            quarterStats.push({
                q,
                local: scores.filter(s => s.teamId === match.localTeamId && s.quarter === q).reduce((a, b) => a + b.points, 0),
                visitor: scores.filter(s => s.teamId === match.visitorTeamId && s.quarter === q).reduce((a, b) => a + b.points, 0),
            });
        }

        // 3. Top Anotadores (Map player ID to details)
        const playerMap = new Map(players.map(p => [p.id, p]));
        const playerScores: Record<number, number> = {};
        
        scores.forEach(s => {
            if (s.playerId) {
                playerScores[s.playerId] = (playerScores[s.playerId] || 0) + s.points;
            }
        });

        const topScorers = Object.entries(playerScores)
            .map(([id, points]) => ({
                name: playerMap.get(Number(id))?.name || 'Desconocido',
                teamId: playerMap.get(Number(id))?.teamId,
                points
            }))
            .sort((a, b) => b.points - a.points)
            .slice(0, 5); // Top 5

        return { localPoints, visitorPoints, quarterStats, topScorers };
    }, [data]);

    if (!data || !stats) return null;
    const { match, localTeam, visitorTeam } = data;
    
    const formatDate = (date: Date) => {
        return new Intl.DateTimeFormat('es-MX', { 
            dateStyle: 'full', 
            timeStyle: 'short' 
        }).format(date);
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                
                {/* HEADER */}
                <div className="modal-header">
                    <div>
                        <div className="flex gap-2 items-center text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
                            <Calendar size={12} />
                            {formatDate(match.createdAt)}
                        </div>
                        <h2 className="modal-title">Resumen del Partido</h2>
                    </div>
                    <button onClick={onClose} className="btn-icon">
                        <X size={24} />
                    </button>
                </div>

                {/* BODY */}
                <div className="flex-col gap-lg overflow-y-auto">
                    
                    {/* 1. MARCADOR FINAL */}
                    <div className="history-score-panel">
                        <div className="history-team">
                            <span className="history-team-name">{localTeam?.name}</span>
                            <span className={`history-score-big ${stats.localPoints > stats.visitorPoints ? 'text-green-400' : 'text-gray-400'}`}>
                                {stats.localPoints}
                            </span>
                        </div>

                        <div className="history-vs">VS</div>

                        <div className="history-team">
                            <span className="history-team-name">{visitorTeam?.name}</span>
                            <span className={`history-score-big ${stats.visitorPoints > stats.localPoints ? 'text-green-400' : 'text-gray-400'}`}>
                                {stats.visitorPoints}
                            </span>
                        </div>
                    </div>

                    {/* 2. DESGLOSE POR CUARTOS */}
                    <div>
                        <div className="section-label">
                            <BarChart2 size={14} />
                            Evolución por Cuartos
                        </div>
                        <div className="bg-white/5 rounded-lg overflow-hidden border border-white/10">
                            <table className="history-table">
                                <thead>
                                    <tr>
                                        <th style={{textAlign: 'left', paddingLeft: '1rem'}}>Equipo</th>
                                        {stats.quarterStats.map(qs => <th key={qs.q}>Q{qs.q}</th>)}
                                        <th>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td className="team-col" style={{color: '#60a5fa'}}>{localTeam?.name}</td>
                                        {stats.quarterStats.map(qs => <td key={qs.q}>{qs.local}</td>)}
                                        <td className="total-col">{stats.localPoints}</td>
                                    </tr>
                                    <tr>
                                        <td className="team-col" style={{color: '#fb923c'}}>{visitorTeam?.name}</td>
                                        {stats.quarterStats.map(qs => <td key={qs.q}>{qs.visitor}</td>)}
                                        <td className="total-col">{stats.visitorPoints}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* 3. MVP / TOP SCORERS */}
                    {stats.topScorers.length > 0 && (
                        <div>
                            <div className="section-label">
                                <Trophy size={14} />
                                Máximos Anotadores
                            </div>
                            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                                {stats.topScorers.map((player, idx) => (
                                    <div key={idx} className="stat-row">
                                        <div className="flex items-center gap-2">
                                            <span className={`w-2 h-2 rounded-full ${player.teamId === match.localTeamId ? 'bg-blue-400' : 'bg-orange-400'}`}></span>
                                            <span className="stat-name text-gray-200">{player.name}</span>
                                        </div>
                                        <span className="stat-value text-white">{player.points} pts</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}