// src/components/live/PlayerSelectModal.tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Player } from '../../db/models';
import { Trophy, AlertCircle, UserX, Shirt } from 'lucide-react';

export type GameAction =
    | { type: 'score'; points: 1 | 2 | 3 }
    | { type: 'foul' };

interface PlayerSelectModalProps {
    teamName: string;
    players: Player[];
    action: GameAction;
    onSelect: (playerId: number | null) => void;
    onCancel: () => void;
    /** Partido actual: permite mostrar las faltas acumuladas de cada jugador */
    matchId?: number;
    /** Límite de faltas personales (5 en modo tradicional). Si se alcanza, se marca como expulsado */
    foulLimit?: number;
}

export function PlayerSelectModal({ teamName, players, action, onSelect, onCancel, matchId, foulLimit }: PlayerSelectModalProps) {
    const isFoul = action.type === 'foul';
    const accentColor = isFoul ? 'var(--danger)' : 'var(--success)';
    const accentBg = isFoul ? 'rgba(239, 68, 68, 0.12)' : 'rgba(34, 197, 94, 0.12)';

    // Faltas acumuladas por jugador en todo el partido
    const foulsByPlayer = useLiveQuery(async () => {
        const map = new Map<number, number>();
        if (matchId === undefined) return map;

        const fouls = await db.fouls.where({ matchId }).toArray();
        for (const foul of fouls) {
            if (foul.playerId === undefined) continue;
            map.set(foul.playerId, (map.get(foul.playerId) || 0) + 1);
        }
        return map;
    }, [matchId]) ?? new Map<number, number>();

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div
                className={`modal-content variant-game ${isFoul ? 'is-foul' : 'is-score'}`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* CABECERA */}
                <div className="modal-header">
                    {/* Icono Grande */}
                    <div
                        style={{
                            marginBottom: '0.5rem',
                            padding: '0.75rem',
                            borderRadius: '9999px',
                            backgroundColor: accentBg,
                            color: accentColor,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        {isFoul ? <AlertCircle size={32} /> : <Trophy size={32} />}
                    </div>

                    <h3 className="modal-title" style={{ color: accentColor }}>
                        {isFoul ? 'Falta Personal' : `+${action.points} Puntos`}
                    </h3>
                    <p className="modal-subtitle text-muted">
                        ¿Quién de <span style={{ color: 'var(--text-main)', fontWeight: 700 }}>{teamName}</span>?
                    </p>
                </div>

                {/* GRID DE JUGADORES */}
                <div className="player-grid">
                    {players.map(p => {
                        const fouls = foulsByPlayer.get(p.id!) || 0;
                        const isExpelled = foulLimit !== undefined && fouls >= foulLimit;

                        return (
                            <button
                                key={p.id}
                                disabled={isExpelled}
                                onClick={() => {
                                    if (!isExpelled) onSelect(p.id!);
                                }}
                                className="pm-player-btn"
                                style={isExpelled ? {
                                    borderColor: 'var(--danger)',
                                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                    opacity: 0.45,
                                    cursor: 'not-allowed'
                                } : undefined}
                            >
                                {/* Número Grande (Estilo Jersey) */}
                                <span className="player-jersey-num">
                                    {p.number !== undefined ? p.number : '-'}
                                </span>
                                
                                {/* Nombre */}
                                <span className="player-name-label">
                                    {p.name}
                                </span>

                                {/* Semáforo de faltas */}
                                {fouls > 0 && (
                                    <span
                                        style={{
                                            fontSize: '0.65rem',
                                            fontWeight: 800,
                                            letterSpacing: '0.03em',
                                            padding: '0.1rem 0.4rem',
                                            borderRadius: '999px',
                                            color: isExpelled || fouls >= 4 ? '#fff' : 'var(--text-muted)',
                                            backgroundColor: isExpelled
                                                ? 'var(--danger)'
                                                : fouls >= 4
                                                    ? '#f59e0b'
                                                    : 'rgba(255, 255, 255, 0.08)'
                                        }}
                                    >
                                        {isExpelled ? `${fouls} FAL (EXPULSADO)` : `${fouls} FAL`}
                                    </span>
                                )}
                            </button>
                        );
                    })}

                    {/* BOTÓN ESPECIAL (Banca / Otro) */}
                    <button
                        onClick={() => onSelect(null)}
                        className="pm-player-btn pm-special-btn"
                    >
                        {isFoul ? <Shirt size={18} /> : <UserX size={18} />}
                        <span>
                            {isFoul ? 'Falta Técnica / Banca' : 'Jugador Desconocido'}
                        </span>
                    </button>
                </div>

                {/* BOTÓN CANCELAR */}
                <div className="variant-game-footer">
                    <button onClick={onCancel} className="btn btn-ghost btn-full">
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
    );
}
