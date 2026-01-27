// src/pages/Teams.tsx
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Trash2, UserPlus, Save, Users as UsersIcon, Edit2 } from 'lucide-react';
import { TeamEditorModal } from '../components/teams/TeamEditorModal'; // <--- Importamos el modal

interface TempPlayer {
    name: string;
    number: string;
}

export function Teams() {
    const [teamName, setTeamName] = useState('');
    const [playerName, setPlayerName] = useState('');
    const [playerNumber, setPlayerNumber] = useState('');
    const [tempPlayers, setTempPlayers] = useState<TempPlayer[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    // Estado para controlar qué equipo se está editando
    const [editingTeamId, setEditingTeamId] = useState<number | null>(null);

    const teams = useLiveQuery(() => db.teams.toArray());

    // --- LÓGICA DE CREACIÓN (Ya existente) ---
    const handleAddTempPlayer = () => {
        if (!playerName.trim()) return;
        // Agregamos objeto con nombre y número
        setTempPlayers([...tempPlayers, {
            name: playerName.trim(),
            number: playerNumber.trim()
        }]);
        setPlayerName('');
        setPlayerNumber(''); // Limpiamos el número también
    };

    const handleSaveTeam = async () => {
        if (!teamName.trim()) return alert("El equipo necesita un nombre");
        if (tempPlayers.length === 0) return alert("Agrega al menos un jugador");

        setIsSaving(true);
        try {
            await db.transaction('rw', db.teams, db.players, async () => {
                const teamId = await db.teams.add({
                    name: teamName,
                    createdAt: new Date()
                });

                // Guardamos los jugadores con su número
                const playersToSave = tempPlayers.map(p => ({
                    name: p.name,
                    number: p.number ? parseInt(p.number) : undefined, // Convertimos a número
                    teamId: Number(teamId),
                    createdAt: new Date()
                }));

                await db.players.bulkAdd(playersToSave);
            });
            setTeamName('');
            setTempPlayers([]);
        } catch (error) {
            console.error("Error al guardar:", error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteTeam = async (id: number) => {
        if (!confirm("¿Borrar equipo y sus jugadores?")) return;
        await db.transaction('rw', db.teams, db.players, async () => {
            await db.players.where({ teamId: id }).delete();
            await db.teams.delete(id);
        });
    };

    return (
        <div className="page-container">
            <h1 className="title-header">
                <UsersIcon color="var(--primary)" />
                Gestión de Equipos
            </h1>

            {/* --- MODAL DE EDICIÓN --- */}
            {/* Si hay un ID seleccionado, mostramos el modal */}
            {editingTeamId && (
                <TeamEditorModal
                    teamId={editingTeamId}
                    onClose={() => setEditingTeamId(null)}
                />
            )}

            {/* --- CARD: FORMULARIO DE CREACIÓN --- */}
            <div className="card">
                <h2 className="label" style={{ fontSize: '1.1rem', color: 'var(--text-main)', marginBottom: '1rem' }}>
                    Registrar Nuevo Equipo
                </h2>

                <div className="form-group">
                    <label className="label">Nombre del Equipo</label>
                    <input
                        type="text"
                        className="input"
                        placeholder="Ej. Los Toros"
                        value={teamName}
                        onChange={e => setTeamName(e.target.value)}
                    />
                </div>

                <div className="form-group">
                    <label className="label">Agregar Jugadores</label>
                    <div className="flex gap-2 mb-2">
                        <input
                            type="number"
                            className="input"
                            placeholder="#"
                            style={{ width: '80px', textAlign: 'center' }}
                            value={playerNumber}
                            onChange={e => setPlayerNumber(e.target.value)}
                        />

                        <input
                            type="text"
                            className="input flex-1" // flex-1 para que ocupe el resto
                            placeholder="Nombre del jugador"
                            value={playerName}
                            onChange={e => setPlayerName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAddTempPlayer()}
                        />

                        <button onClick={handleAddTempPlayer} className="btn" style={{ background: 'var(--bg-surface-hover)', border: '1px solid var(--border-color)' }}>
                            <UserPlus size={20} />
                        </button>
                    </div>
                </div>

                {/* Lista de Pills */}
                {tempPlayers.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
                        {tempPlayers.map((p, idx) => (
                            <span key={idx} className="pill">
                                {/* Mostramos el número si existe */}
                                {p.number && <span className="mr-1 font-bold text-white/50">#{p.number}</span>}
                                {p.name}
                                <button
                                    onClick={() => setTempPlayers(tempPlayers.filter((_, i) => i !== idx))}
                                    style={{ color: 'inherit', marginLeft: '4px', display: 'flex' }}
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                )}

                <button
                    onClick={handleSaveTeam}
                    disabled={isSaving}
                    className="btn btn-primary w-full"
                >
                    <Save size={20} />
                    {isSaving ? 'Guardando...' : 'Guardar Equipo'}
                </button>
            </div>

            {/* --- LISTA DE EQUIPOS --- */}
            <div>
                <h3 className="label" style={{ textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.5rem' }}>
                    Equipos Registrados ({teams?.length || 0})
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {teams?.map(team => (
                        <div key={team.id} className="card flex-between" style={{ padding: '1rem' }}>
                            <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>{team.name}</span>

                            <div className="flex-gap">
                                {/* Botón EDITAR */}
                                <button
                                    onClick={() => setEditingTeamId(team.id!)}
                                    className="btn-icon"
                                    style={{ color: 'var(--secondary)' }}
                                    title="Editar equipo y jugadores"
                                >
                                    <Edit2 size={18} />
                                </button>

                                {/* Botón BORRAR */}
                                <button
                                    onClick={() => handleDeleteTeam(team.id!)}
                                    className="btn-icon danger"
                                    title="Borrar equipo"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {teams?.length === 0 && (
                    <p className="text-center text-muted" style={{ marginTop: '2rem' }}>
                        No hay equipos registrados aún.
                    </p>
                )}
            </div>
        </div>
    );
}