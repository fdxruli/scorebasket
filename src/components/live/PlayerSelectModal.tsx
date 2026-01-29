// src/components/live/PlayerSelectModal.tsx
import type { Player } from '../../db/models';
import { Trophy, AlertCircle, UserX, Shirt } from 'lucide-react'; // Importamos iconos

export type GameAction =
    | { type: 'score'; points: 1 | 2 | 3 }
    | { type: 'foul' };

interface PlayerSelectModalProps {
    teamName: string;
    players: Player[];
    action: GameAction;
    onSelect: (playerId: number | null) => void;
    onCancel: () => void;
}

export function PlayerSelectModal({ teamName, players, action, onSelect, onCancel }: PlayerSelectModalProps) {
    const isFoul = action.type === 'foul';

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div
                className={`modal-content variant-game ${isFoul ? 'is-foul' : 'is-score'}`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* CABECERA */}
                <div className="modal-header">
                    {/* Icono Grande */}
                    <div className={`mb-2 p-3 rounded-full ${isFoul ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'}`}>
                        {isFoul ? <AlertCircle size={32} /> : <Trophy size={32} />}
                    </div>

                    <h3 className={`modal-title ${isFoul ? 'text-red-500' : 'text-green-500'}`}>
                        {isFoul ? 'Falta Personal' : `+${action.points} Puntos`}
                    </h3>
                    <p className="modal-subtitle text-zinc-400">
                        ¿Quién de <span className="text-white font-bold">{teamName}</span>?
                    </p>
                </div>

                {/* GRID DE JUGADORES */}
                <div className="player-grid">
                    {players.map(p => (
                        <button
                            key={p.id}
                            onClick={() => onSelect(p.id!)}
                            className="pm-player-btn group" // group para efectos hover
                        >
                            {/* Número Grande (Estilo Jersey) */}
                            <span className="player-jersey-num">
                                {p.number !== undefined ? p.number : '-'}
                            </span>
                            
                            {/* Nombre */}
                            <span className="player-name-label">
                                {p.name}
                            </span>
                        </button>
                    ))}

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
                    <button onClick={onCancel} className="btn btn-ghost w-full py-3 text-zinc-500 hover:text-white">
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
    );
}