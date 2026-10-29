// src/components/live/PlayerSelectModal.tsx
import { useState, useRef, useEffect, useContext } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Player } from '../../db/models';
import { PlayersRepository } from '../../db/players.repository';
import { LiveMatchContext } from '../../features/match-creations/components/context/LiveMatchContext';
import { ModalLiveStatusPill } from './ModalLiveStatusPill';
import { Trophy, AlertCircle, UserX, Shirt, Plus, X, Check, UserPlus } from 'lucide-react';

export type GameAction =
    | { type: 'score'; points: 1 | 2 | 3 }
    | { type: 'foul' };

interface PlayerSelectModalProps {
    teamId?: number;
    teamSide?: 'local' | 'visitor';
    teamName: string;
    players: Player[];
    action: GameAction;
    scoringOptions?: (1 | 2 | 3)[];
    onSelect: (playerId: number | null, overrideAction?: GameAction) => void;
    onCancel: () => void;
    /** Partido actual: permite mostrar puntos y faltas acumuladas de cada jugador */
    matchId?: number;
    /** Límite de faltas personales (5 en modo tradicional). Si se alcanza, se marca como expulsado */
    foulLimit?: number;
}

export function PlayerSelectModal({
    teamId,
    teamSide = 'local',
    teamName,
    players,
    action,
    scoringOptions = [1, 2, 3],
    onSelect,
    onCancel,
    matchId,
    foulLimit
}: PlayerSelectModalProps) {
    const liveContext = useContext(LiveMatchContext);
    const registerOpenModal = liveContext?.registerOpenModal;

    useEffect(() => {
        if (!registerOpenModal) return;
        return registerOpenModal('player-select-modal');
    }, [registerOpenModal]);

    // Permite cambiar rápido entre +1, +2, +3 o Falta sin cerrar el modal si se tocó el botón equivocado
    const [activeAction, setActiveAction] = useState<GameAction>(action);
    const [showQuickAdd, setShowQuickAdd] = useState(false);
    const [newNumber, setNewNumber] = useState('');
    const [newName, setNewName] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);

    const isFoul = activeAction.type === 'foul';
    const accentColor = isFoul ? 'var(--danger)' : 'var(--success)';
    const teamColor = teamSide === 'local' ? 'var(--secondary-light)' : 'var(--primary-light)';

    // Estadísticas en vivo por jugador (Puntos y Faltas en este partido)
    const playerStats = useLiveQuery(async () => {
        const foulsMap = new Map<number, number>();
        const pointsMap = new Map<number, number>();
        if (matchId === undefined) return { foulsMap, pointsMap };

        const [fouls, scores] = await Promise.all([
            db.fouls.where({ matchId }).toArray(),
            db.scores.where({ matchId }).toArray()
        ]);

        for (const foul of fouls) {
            if (foul.playerId === undefined) continue;
            foulsMap.set(foul.playerId, (foulsMap.get(foul.playerId) || 0) + 1);
        }
        for (const score of scores) {
            if (score.playerId === undefined) continue;
            pointsMap.set(score.playerId, (pointsMap.get(score.playerId) || 0) + score.points);
        }
        return { foulsMap, pointsMap };
    }, [matchId]) ?? { foulsMap: new Map<number, number>(), pointsMap: new Map<number, number>() };

    const resolvedTeamId = teamId ?? players[0]?.teamId;

    const handleQuickAddPlayer = async (assignImmediately: boolean) => {
        const trimmedName = newName.trim();
        if (!trimmedName || !resolvedTeamId || isAdding) return;

        setIsAdding(true);
        setAddError(null);
        try {
            const newId = await PlayersRepository.create({
                teamId: resolvedTeamId,
                name: trimmedName,
                number: newNumber
            });

            setNewName('');
            setNewNumber('');
            setShowQuickAdd(false);

            if (assignImmediately && typeof newId === 'number') {
                onSelect(newId, activeAction);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Error al agregar jugador rápido.';
            setAddError(msg);
        } finally {
            setIsAdding(false);
        }
    };

    const getPointLabel = (pts: 1 | 2 | 3) => {
        if (pts === 1) return '+1 Libre';
        if (pts === 2) return '+2 Doble';
        return '+3 Triple';
    };

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div
                className={`modal-content variant-game ${isFoul ? 'is-foul' : 'is-score'} team-${teamSide}`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* CABECERA COMPACTA Y CLARA CON SELECTOR RÁPIDO DE ACCIÓN + RELOJ/MARCADOR EN VIVO */}
                <div className="modal-header pm-header">
                    <div className="pm-header-top">
                        <div className="pm-team-pill" style={{ borderColor: `${teamColor}55`, color: teamColor }}>
                            <span className="pm-team-dot" style={{ backgroundColor: teamColor }} />
                            <span>{teamSide === 'local' ? 'LOCAL' : 'VISITA'} • {teamName}</span>
                        </div>

                        <button
                            type="button"
                            onClick={onCancel}
                            className="btn-icon pm-close-btn"
                            aria-label="Cerrar"
                        >
                            <X size={22} />
                        </button>
                    </div>

                    <ModalLiveStatusPill />

                    <div className="pm-title-row">
                        <div className="pm-action-badge" style={{ color: accentColor }}>
                            {isFoul ? <AlertCircle size={26} /> : <Trophy size={26} />}
                            <h3 className="modal-title" style={{ color: accentColor }}>
                                {isFoul ? 'Falta Personal' : getPointLabel(activeAction.points)}
                            </h3>
                        </div>
                        <p className="pm-instruction">
                            Toca al jugador para registrar la acción
                        </p>
                    </div>

                    {/* CAMBIADOR RÁPIDO DE ACCIÓN (Por si tocó el botón equivocado) */}
                    <div className="pm-action-switcher" role="group" aria-label="Cambiar tipo de acción">
                        {scoringOptions.map((pts) => {
                            const isSelected = activeAction.type === 'score' && activeAction.points === pts;
                            return (
                                <button
                                    key={pts}
                                    type="button"
                                    onClick={() => setActiveAction({ type: 'score', points: pts })}
                                    className={`pm-switch-pill ${isSelected ? 'active-score' : ''}`}
                                >
                                    +{pts} PTS
                                </button>
                            );
                        })}
                        <button
                            type="button"
                            onClick={() => setActiveAction({ type: 'foul' })}
                            className={`pm-switch-pill ${isFoul ? 'active-foul' : ''}`}
                        >
                            <AlertCircle size={13} />
                            FALTA
                        </button>
                    </div>
                </div>

                {/* GRID GRANDE DE JUGADORES */}
                <div className="player-grid">
                    {players.map(p => {
                        const fouls = playerStats.foulsMap.get(p.id!) || 0;
                        const points = playerStats.pointsMap.get(p.id!) || 0;
                        const isExpelled = foulLimit !== undefined && fouls >= foulLimit;
                        const isFoulTrouble = !isExpelled && foulLimit !== undefined && fouls === foulLimit - 1;

                        return (
                            <button
                                key={p.id}
                                type="button"
                                disabled={isExpelled}
                                onClick={() => {
                                    if (!isExpelled) onSelect(p.id!, activeAction);
                                }}
                                className={`pm-player-btn ${isExpelled ? 'is-expelled' : ''} ${isFoulTrouble ? 'is-warning' : ''}`}
                            >
                                {/* Dorsal Grande y Claro */}
                                <div className="pm-jersey-badge">
                                    <span className="pm-jersey-hash">#</span>
                                    <span className="player-jersey-num">
                                        {p.number !== undefined ? p.number : '—'}
                                    </span>
                                </div>

                                {/* Nombre Grande del Jugador */}
                                <span className="player-name-label">
                                    {p.name}
                                </span>

                                {/* Fila de Estadísticas en Vivo del Jugador (PTS y FAL) */}
                                <div className="pm-player-stats-row">
                                    <span className={`pm-stat-chip pts ${points > 0 ? 'has-pts' : ''}`}>
                                        {points} PTS
                                    </span>

                                    <span
                                        className={`pm-stat-chip fouls ${
                                            isExpelled
                                                ? 'expelled'
                                                : isFoulTrouble
                                                    ? 'warning'
                                                    : fouls > 0
                                                        ? 'has-fouls'
                                                        : ''
                                        }`}
                                    >
                                        {isExpelled ? `${fouls} FAL • EXP` : `${fouls} FAL`}
                                    </span>
                                </div>
                            </button>
                        );
                    })}

                    {/* TARJETA PARA AGREGAR JUGADOR AL VUELO */}
                    {resolvedTeamId && !showQuickAdd && (
                        <button
                            type="button"
                            onClick={() => {
                                setShowQuickAdd(true);
                                setTimeout(() => nameInputRef.current?.focus(), 50);
                            }}
                            className="pm-player-btn pm-add-player-card"
                        >
                            <div className="pm-add-icon-circle">
                                <UserPlus size={26} />
                            </div>
                            <span className="player-name-label" style={{ color: 'var(--text-secondary)' }}>
                                + Nuevo Jugador
                            </span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                Agregar a {teamName}
                            </span>
                        </button>
                    )}
                </div>

                {/* FORMULARIO RÁPIDO PARA AGREGAR JUGADOR EN PLENO PARTIDO */}
                {showQuickAdd && resolvedTeamId && (
                    <div className="pm-quick-add-bar">
                        <div className="pm-quick-add-header">
                            <span className="flex-gap" style={{ fontSize: '0.78rem', fontWeight: 800, color: teamColor, textTransform: 'uppercase' }}>
                                <Plus size={14} /> Agregar Jugador a {teamName}
                            </span>
                            <button
                                type="button"
                                onClick={() => setShowQuickAdd(false)}
                                className="btn-ghost"
                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                            >
                                Cancelar
                            </button>
                        </div>
                        <div className="pm-quick-add-inputs">
                            <input
                                type="number"
                                min="0"
                                max="99"
                                placeholder="# Dorsal"
                                value={newNumber}
                                onChange={(e) => {
                                    setNewNumber(e.target.value);
                                    setAddError(null);
                                }}
                                className="input pm-input-num"
                            />
                            <input
                                ref={nameInputRef}
                                type="text"
                                placeholder="Nombre del jugador..."
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleQuickAddPlayer(true);
                                }}
                                className="input pm-input-name"
                            />
                            <button
                                type="button"
                                disabled={!newName.trim() || isAdding}
                                onClick={() => handleQuickAddPlayer(true)}
                                className="btn btn-primary pm-quick-save-btn"
                                title="Guardar jugador y asignarle esta acción"
                            >
                                <Check size={18} />
                                <span>Guardar y Asignar</span>
                            </button>
                        </div>
                        {addError && (
                            <p role="alert" style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', fontWeight: 700, color: 'var(--danger)' }}>
                                {addError}
                            </p>
                        )}
                    </div>
                )}

                {/* FOOTER FIJO: OPCIÓN RÁPIDA SIN JUGADOR + CANCELAR */}
                <div className="variant-game-footer pm-footer-actions">
                    <button
                        type="button"
                        onClick={() => onSelect(null, activeAction)}
                        className="btn pm-unassigned-btn"
                    >
                        {isFoul ? <Shirt size={18} /> : <UserX size={18} />}
                        <span>
                            {isFoul ? 'Falta de Banca / Equipo' : 'Solo al Equipo (Sin jugador)'}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={onCancel}
                        className="btn btn-secondary pm-cancel-btn"
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
    );
}
