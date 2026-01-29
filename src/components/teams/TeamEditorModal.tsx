// src/components/teams/TeamEditorModal.tsx
import { useState, useEffect, useRef } from 'react';
import { db } from '../../db/db';
import type { Player } from '../../db/models';
import { X, Save, Trash2, Plus, User, Users, Shield } from 'lucide-react';

interface TeamEditorModalProps {
    teamId: number;
    onClose: () => void;
}

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
                const teamPlayers = await db.players.where({ teamId }).sortBy('number'); // Ordenar por número

                if (team) {
                    setTeamName(team.name);
                    setPlayers(teamPlayers);
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
            // Simplemente comparamos el índice del map (i) con el índice que recibimos (index)
            if (i === index) {
                return {
                    ...p,
                    [field]: field === 'number' ? parseInt(value) || undefined : value
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

        const tempPlayer: Player = {
            name: newPlayerName.trim(),
            number: newPlayerNumber ? parseInt(newPlayerNumber) : undefined,
            teamId: teamId,
            createdAt: new Date()
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
            await db.transaction('rw', db.teams, db.players, async () => {
                await db.teams.update(teamId, { name: teamName });

                const currentDbPlayers = await db.players.where({ teamId }).toArray();
                const currentDbIds = currentDbPlayers.map(p => p.id);
                const keptIds = players.filter(p => p.id !== undefined).map(p => p.id);
                const idsToDelete = currentDbIds.filter(id => !keptIds.includes(id));

                if (idsToDelete.length > 0) await db.players.bulkDelete(idsToDelete as number[]);

                const playersToUpdate = players.filter(p => p.id !== undefined);
                for (const p of playersToUpdate) await db.players.update(p.id!, { name: p.name, number: p.number });

                const playersToAdd = players.filter(p => p.id === undefined);
                if (playersToAdd.length > 0) await db.players.bulkAdd(playersToAdd);
            });
            onClose();
        } catch (err) {
            console.error("Error al guardar", err);
            alert("Hubo un error al guardar los cambios.");
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
                    <div className="flex flex-col">
                        <h2 className="modal-title flex items-center gap-2">
                            <Shield size={20} className="text-primary" />
                            Editar Equipo
                        </h2>
                        <span className="text-xs text-muted uppercase tracking-wider font-bold mt-1">
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

                    <div className="separator" style={{ height: '1px', background: 'var(--border-color)', margin: '0.5rem 0' }}></div>

                    {/* SECCIÓN 2: ROSTER */}
                    <div>
                        <div className="flex-between mb-2">
                            <label className="label flex items-center gap-2">
                                <Users size={14} />
                                Plantilla ({players.length})
                            </label>
                        </div>

                        {/* LISTA DE JUGADORES */}
                        <div className="roster-section">
                            {players.length === 0 && (
                                <div className="text-center py-4 text-muted text-sm border border-dashed border-zinc-800 rounded-lg">
                                    Sin jugadores asignados
                                </div>
                            )}

                            {players.map((p, idx) => (
                                <div key={p.id || `temp-${idx}`} className="player-edit-row">
                                    {/* Icono decorativo */}
                                    <User size={16} className="text-muted" />

                                    {/* Input Número */}
                                    <div className="relative">
                                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600 text-[10px]">#</span>
                                        <input
                                            type="number"
                                            className="player-edit-input player-number-input"
                                            style={{ width: '50px', paddingLeft: '1rem' }}
                                            placeholder="00"
                                            value={p.number || ''}
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

                                    {/* Botón Borrar */}
                                    <button
                                        onClick={() => handleDeletePlayer(idx)}
                                        className="btn-icon danger hover:bg-red-500/10 p-1.5 rounded"
                                        title="Quitar jugador"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* CAJA DE AGREGAR JUGADOR */}
                        <div className="add-player-box">
                            <div className="add-player-header flex items-center gap-2">
                                <Plus size={12} />
                                Agregar Nuevo Jugador
                            </div>
                            <div className="add-player-controls">
                                <div className="relative">
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
                                    className="input flex-1"
                                    style={{ fontSize: '0.9rem' }}
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