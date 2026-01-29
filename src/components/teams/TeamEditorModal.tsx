// src/components/TeamEditorModal.tsx
import { useState, useEffect } from 'react';
import { db } from '../../db/db';
import type { Player } from '../../db/models';
import { X, Save, Trash2, Plus, User } from 'lucide-react';

interface TeamEditorModalProps {
    teamId: number;
    onClose: () => void;
}

export function TeamEditorModal({ teamId, onClose }: TeamEditorModalProps) {
    // Estados locales para la edición
    const [teamName, setTeamName] = useState('');
    const [players, setPlayers] = useState<Player[]>([]);
    const [newPlayerName, setNewPlayerName] = useState('');
    const [newPlayerNumber, setNewPlayerNumber] = useState('');

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // 1. Cargar datos al montar
    useEffect(() => {
        const loadData = async () => {
            try {
                const team = await db.teams.get(teamId);
                const teamPlayers = await db.players.where({ teamId }).toArray();

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

    // 2. Manejadores de cambios locales (en memoria)
    const handlePlayerChange = (id: number | undefined, field: 'name' | 'number', value: string) => {
        setPlayers(prev => prev.map(p => {
            if (p.id === id) {
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
        // Agregamos un jugador temporal (sin ID aún)
        const tempPlayer: Player = {
            name: newPlayerName.trim(),
            number: newPlayerNumber ? parseInt(newPlayerNumber) : undefined,
            teamId: teamId,
            createdAt: new Date()
        };
        setPlayers([...players, tempPlayer]);
        setNewPlayerName('');
    };

    // 3. Guardar cambios en la BD
    const handleSave = async () => {
        if (!teamName.trim()) return alert("El nombre del equipo no puede estar vacío");
        setIsSaving(true);

        try {
            await db.transaction('rw', db.teams, db.players, async () => {
                // A. Actualizar nombre del equipo
                await db.teams.update(teamId, { name: teamName });

                // B. Gestionar Jugadores
                // 1. Obtener los IDs actuales en BD para este equipo
                const currentDbPlayers = await db.players.where({ teamId }).toArray();
                const currentDbIds = currentDbPlayers.map(p => p.id);

                // 2. Identificar qué borrar (estaban en BD pero ya no están en el estado local)
                // Nota: Los jugadores nuevos no tienen 'id', así que filtramos por los que sí tienen
                const keptIds = players.filter(p => p.id !== undefined).map(p => p.id);
                const idsToDelete = currentDbIds.filter(id => !keptIds.includes(id));

                if (idsToDelete.length > 0) {
                    await db.players.bulkDelete(idsToDelete as number[]);
                }

                // 3. Identificar qué actualizar (tienen ID y están en el estado)
                const playersToUpdate = players.filter(p => p.id !== undefined);
                for (const p of playersToUpdate) {
                    await db.players.update(p.id!, { name: p.name });
                }

                // 4. Identificar qué agregar (no tienen ID)
                const playersToAdd = players.filter(p => p.id === undefined);
                if (playersToAdd.length > 0) {
                    await db.players.bulkAdd(playersToAdd);
                }
            });

            onClose(); // Cerrar modal al terminar
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
            <div className="modal-content">

                {/* Header */}
                <div className="modal-header">
                    <h2 className="modal-title">Editar Equipo</h2>
                    <button onClick={onClose} className="btn-icon">
                        <X size={24} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-col gap-lg">

                    {/* Nombre del Equipo */}
                    <div className="form-group">
                        <label className="label">Nombre del Equipo</label>
                        <input
                            type="text"
                            className="input"
                            value={teamName}
                            onChange={(e) => setTeamName(e.target.value)}
                        />
                    </div>

                    <div className="separator" style={{ height: '1px', background: 'var(--border-color)', margin: '0.5rem 0' }}></div>

                    {/* Lista de Jugadores */}
                    <div>
                        <label className="label flex-between">
                            Jugadores ({players.length})
                        </label>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {players.map((p, idx) => (
                                <div key={p.id || `temp-${idx}`} className="player-edit-row">
                                    <User size={16} className="text-muted" />
                                    <input
                                        type="number"
                                        className="player-edit-input"
                                        style={{ width: '60px', textAlign: 'center', flex: 'none' }}
                                        placeholder="#"
                                        value={p.number || ''}
                                        onChange={(e) => handlePlayerChange(p.id, 'number', e.target.value)}
                                        disabled={isSaving}
                                    />

                                    {/* INPUT NOMBRE */}
                                    <input
                                        type="text"
                                        className="player-edit-input"
                                        value={p.name}
                                        onChange={(e) => handlePlayerChange(p.id, 'name', e.target.value)}
                                        disabled={isSaving}
                                    />
                                    <button
                                        onClick={() => handleDeletePlayer(idx)}
                                        className="btn-icon danger"
                                        title="Eliminar jugador"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Agregar nuevo jugador */}
                        <div className="flex-gap mt-2">
                            <input
                                type="number"
                                className="input"
                                style={{ width: '70px', textAlign: 'center' }}
                                placeholder="#"
                                value={newPlayerNumber}
                                onChange={(e) => setNewPlayerNumber(e.target.value)}
                            />

                            <input
                                type="text"
                                className="input"
                                placeholder="Nuevo jugador..."
                                value={newPlayerName}
                                onChange={(e) => setNewPlayerName(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddPlayer()}
                            />
                            <button onClick={handleAddPlayer} className="btn btn-secondary" style={{ background: '#27272a', border: '1px solid #3f3f46' }}>
                                <Plus size={20} />
                            </button>
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="modal-footer">
                    <button onClick={onClose} className="btn" style={{ color: 'var(--text-muted)' }}>
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