// src/components/teams/TeamEditorModal.tsx
import { useState, useEffect, useRef } from 'react';
import { db } from '../../db/db';
import type { Player } from '../../db/models';
import { PlayersRepository, validateJerseyNumber } from '../../db/players.repository';
import { X, Save, Trash2, Plus, User, Users, Shield } from 'lucide-react';

interface TeamEditorModalProps {
    teamId: number;
    onClose: () => void;
}

const isActivePlayer = (player: Player) => !player.isArchived;

export function TeamEditorModal({ teamId, onClose }: TeamEditorModalProps) {
    const [teamName, setTeamName] = useState('');
    const [players, setPlayers] = useState<Player[]>([]);

    // Estados para el nuevo jugador
    const [newPlayerName, setNewPlayerName] = useState('');
    const [newPlayerNumber, setNewPlayerNumber] = useState('');

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Referencia para hacer focus al input de nombre al agregar
    const newPlayerInputRef = useRef<HTMLInputElement>(null);

    // 1. Cargar datos
    useEffect(() => {
        const loadData = async () => {
            try {
                const team = await db.teams.get(teamId);
                const teamPlayers = await db.players
                    .where({ teamId })
                    .sortBy('number');

                if (team) {
                    setTeamName(team.name);
                    setPlayers(teamPlayers.filter(isActivePlayer));
                }
            } catch (err) {
                console.error("Error cargando equipo", err);
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, [teamId]);

    const handlePlayerChange = (index: number, field: 'name' | 'number', value: string) => {
        setPlayers(prev => prev.map((p, i) => {
            if (i === index) {
                if (field === 'number') {
                    const parsed = validateJerseyNumber(value);
                    return {
                        ...p,
                        number: parsed.isValid ? parsed.normalizedNumber : (value.trim() === '' ? undefined : p.number)
                    };
                }
                return {
                    ...p,
                    name: value
                };
            }
            return p;
        }));
    };

    const handleDeletePlayer = (indexToDelete: number) => {
        setPlayers(prev => prev.filter((_, idx) => idx !== indexToDelete));
    };

    const handleAddPlayer = () => {
        if (!newPlayerName.trim()) return;

        const jerseyVal = validateJerseyNumber(newPlayerNumber);
        if (!jerseyVal.isValid) {
            alert(jerseyVal.error || "Dorsal no válido.");
            return;
        }

        if (jerseyVal.normalizedNumber !== undefined) {
            const hasDuplicate = players.some(p => p.number === jerseyVal.normalizedNumber);
            if (hasDuplicate) {
                alert(`El dorsal #${jerseyVal.normalizedNumber} ya está en la lista de esta plantilla.`);
                return;
            }
        }

        const tempPlayer: Player = {
            name: newPlayerName.trim(),
            number: jerseyVal.normalizedNumber,
            teamId: teamId,
            createdAt: new Date(),
            isArchived: false
        };

        setPlayers([...players, tempPlayer]);
        setNewPlayerName('');
        setNewPlayerNumber('');

        // Mantener el foco en el nombre para agregar otro rápido
        newPlayerInputRef.current?.focus();
    };

    const handleSave = async () => {
        if (!teamName.trim()) return alert("El nombre del equipo no puede estar vacío");
        setIsSaving(true);

        try {
            await PlayersRepository.saveTeamAndRoster({
                teamId,
                teamName: teamName.trim(),
                players
            });
            onClose();
        } catch (err: unknown) {
            console.error("Error al guardar", err);
            const msg = err instanceof Error ? err.message : "Hubo un error al guardar los cambios.";
            alert(msg);
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content variant-admin">

                {/* --- HEADER --- */}
                <div className="modal-header">
                    <div className="flex-col">
                        <h2 className="modal-title flex-gap">
                            <Shield size={20} color="var(--primary)" />
                            Editar Equipo
                        </h2>
                        <span
                            className="text-muted uppercase font-bold"
                            style={{ fontSize: '0.75rem', letterSpacing: '0.05em', marginTop: '0.25rem' }}
                        >
                            ID: {teamId}
                        </span>
                    </div>
                    <button onClick={onClose} className="btn-icon">
                        <X size={24} />
                    </button>
                </div>

                {/* --- BODY --- */}
                <div className="modal-body">

                    {/* SECCIÓN 1: DATOS DEL EQUIPO */}
                    <div className="form-group">
                        <label className="label">Nombre del Equipo</label>
                        <input
                            type="text"
                            className="input"
                            value={teamName}
                            onChange={(e) => setTeamName(e.target.value)}
                            placeholder="Ej. Chicago Bulls"
                            autoFocus
                        />
                    </div>

                    <div className="separator" style={{ height: '1px', background: 'var(--border-color)', margin: '0.5rem 0' }} />

                    {/* SECCIÓN 2: ROSTER */}
                    <div>
                        <div className="flex-between" style={{ marginBottom: '0.5rem' }}>
                            <label className="label flex-gap">
                                <Users size={14} />
                                Plantilla ({players.length})
                            </label>
                        </div>

                        {/* LISTA DE JUGADORES */}
                        <div className="roster-section">
                            {players.length === 0 && (
                                <div
                                    className="text-center text-muted"
                                    style={{
                                        padding: '1rem 0',
                                        fontSize: '0.875rem',
                                        border: '1px dashed var(--border-color)',
                                        borderRadius: '0.5rem'
                                    }}
                                >
                                    Sin jugadores asignados
                                </div>
                            )}

                            {players.map((p, idx) => (
                                <div key={p.id || `temp-${idx}`} className="player-edit-row">
                                    {/* Icono decorativo */}
                                    <User size={16} color="var(--text-muted)" />

                                    {/* Input Número */}
                                    <div style={{ position: 'relative' }}>
                                        <span
                                            style={{
                                                position: 'absolute',
                                                left: '0.5rem',
                                                top: '50%',
                                                transform: 'translateY(-50%)',
                                                color: '#52525b',
                                                fontSize: '0.625rem'
                                            }}
                                        >
                                            #
                                        </span>
                                        <input
                                            type="number"
                                            className="player-edit-input player-number-input"
                                            style={{ width: '50px', paddingLeft: '1rem' }}
                                            placeholder="00"
                                            value={p.number ?? ''}
                                            onChange={(e) => handlePlayerChange(idx, 'number', e.target.value)}
                                        />
                                    </div>

                                    {/* Input Nombre */}
                                    <input
                                        type="text"
                                        className="player-edit-input"
                                        value={p.name}
                                        onChange={(e) => handlePlayerChange(idx, 'name', e.target.value)}
                                        placeholder="Nombre del jugador"
                                    />

                                    {/* Botón Quitar de plantilla */}
                                    <button
                                        onClick={() => handleDeletePlayer(idx)}
                                        className="btn-icon danger"
                                        style={{ padding: '0.375rem', borderRadius: '0.25rem' }}
                                        title="Quitar de la plantilla activa sin borrar historial"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* CAJA DE AGREGAR JUGADOR */}
                        <div className="add-player-box">
                            <div className="add-player-header flex-gap">
                                <Plus size={12} />
                                Agregar Nuevo Jugador
                            </div>
                            <div className="add-player-controls">
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type="number"
                                        className="input"
                                        style={{ width: '70px', paddingLeft: '1.5rem', fontSize: '0.9rem' }}
                                        placeholder="Numero"
                                        value={newPlayerNumber}
                                        onChange={(e) => setNewPlayerNumber(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && newPlayerInputRef.current?.focus()}
                                    />
                                </div>

                                <input
                                    ref={newPlayerInputRef}
                                    type="text"
                                    className="input"
                                    style={{ flex: 1, fontSize: '0.9rem' }}
                                    placeholder="Nombre jugador"
                                    value={newPlayerName}
                                    onChange={(e) => setNewPlayerName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddPlayer()}
                                />

                                <button
                                    onClick={handleAddPlayer}
                                    className="btn btn-primary"
                                    disabled={!newPlayerName.trim()}
                                    style={{ padding: '0.5rem 0.75rem' }}
                                >
                                    <Plus size={18} />
                                </button>
                            </div>
                        </div>

                    </div>
                </div>

                {/* --- FOOTER --- */}
                <div className="modal-footer">
                    <button onClick={onClose} className="btn btn-ghost">
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="btn btn-primary"
                    >
                        <Save size={18} />
                        {isSaving ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                </div>

            </div>
        </div>
    );
}
