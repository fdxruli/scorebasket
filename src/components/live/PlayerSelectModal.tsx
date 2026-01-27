// src/components/live/PlayerSelectModal.tsx
import type { Player } from '../../db/models';
import './PlayerSelectModal.css'; // <--- Importamos los nuevos estilos

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

    // Determinamos la clase variante según la acción
    const variantClass = isFoul ? 'is-foul' : 'is-score';

    return (
        <div className="pm-overlay" onClick={onCancel}>
            {/* e.stopPropagation() evita que el click dentro del modal lo cierre 
         (solo se cierra si clickeas el fondo oscuro)
      */}
            <div
                className={`pm-content ${variantClass}`}
                onClick={(e) => e.stopPropagation()}
            >

                {/* CABECERA */}
                <div className="pm-header">
                    <h3 className="pm-title">
                        {isFoul ? 'Falta Personal' : `¡${action.points} Puntos!`}
                    </h3>
                    <p className="pm-subtitle">
                        Selecciona quién de <strong>{teamName}</strong> realizó la acción
                    </p>
                </div>

                {/* GRID DE JUGADORES */}
                <div className="pm-grid">
                    {players.map(p => (
                        <button
                            key={p.id}
                            onClick={() => onSelect(p.id!)}
                            className="pm-player-btn"
                        >
                            {/* Mostramos el número si existe */}
                            {p.number !== undefined && (
                                <span style={{ opacity: 0.5, marginRight: '8px', fontWeight: 800 }}>
                                    #{p.number}
                                </span>
                            )}
                            {p.name}
                        </button>
                    ))}

                    {/* BOTÓN ESPECIAL (Al final, ancho completo) */}
                    <button
                        onClick={() => onSelect(null)}
                        className="pm-player-btn pm-special-btn"
                    >
                        {isFoul ? 'Falta Técnica / Banca' : 'Jugador Desconocido / Otro'}
                    </button>
                </div>

                {/* BOTÓN CANCELAR */}
                <button onClick={onCancel} className="pm-cancel-btn">
                    Cancelar
                </button>

            </div>
        </div>
    );
}