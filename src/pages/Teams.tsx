// src/pages/Teams.tsx
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { TeamsRepository } from '../db/teams.repository';
// CAMBIO: Usamos RotateCcw en lugar de ArchiveRestore para evitar errores de versión
import { Trash2, UserPlus, Save, Users as UsersIcon, Edit2, Archive, RotateCcw, AlertCircle } from 'lucide-react';
import { TeamEditorModal } from '../components/teams/TeamEditorModal';

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
    const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
    const [showArchived, setShowArchived] = useState(false);

    // Consulta segura
    const teams = useLiveQuery(async () => {
        try {
            if (showArchived) {
                return await TeamsRepository.getAllIncludingArchived();
            } else {
                return await TeamsRepository.getAll();
            }
        } catch (err) {
            console.error("Error cargando equipos:", err);
            return []; // Retornar array vacío en caso de error para evitar crash
        }
    }, [showArchived]);

    // --- LÓGICA DE CREACIÓN ---
    const handleAddTempPlayer = () => {
        if (!playerName.trim()) return;
        setTempPlayers([...tempPlayers, {
            name: playerName.trim(),
            number: playerNumber.trim()
        }]);
        setPlayerName('');
        setPlayerNumber('');
    };

    const handleSaveTeam = async () => {
        if (!teamName.trim()) return alert("El equipo necesita un nombre");
        if (tempPlayers.length === 0) return alert("Agrega al menos un jugador");

        setIsSaving(true);
        try {
            await db.transaction('rw', db.teams, db.players, async () => {
                const teamId = await TeamsRepository.create(teamName);

                const playersToSave = tempPlayers.map(p => ({
                    name: p.name,
                    number: p.number ? parseInt(p.number) : undefined,
                    teamId: Number(teamId),
                    createdAt: new Date()
                }));

                await db.players.bulkAdd(playersToSave);
            });
            setTeamName('');
            setTempPlayers([]);
        } catch (error: any) {
            console.error("Error al guardar:", error);
            alert(error.message || "Error al guardar el equipo");
        } finally {
            setIsSaving(false);
        }
    };

    // Archivar equipo (Soft Delete)
    const handleArchiveTeam = async (id: number, teamName: string) => {
        const confirmMsg = `¿Archivar "${teamName}"?\n\nEl equipo dejará de aparecer en la lista activa, pero su historial de partidos se mantendrá intacto.`;
        
        if (!confirm(confirmMsg)) return;
        
        try {
            await TeamsRepository.archive(id);
        } catch (error: any) {
            alert(error.message || "Error al archivar el equipo");
        }
    };

    // Restaurar equipo archivado
    const handleUnarchiveTeam = async (id: number, teamName: string) => {
        const confirmMsg = `¿Restaurar "${teamName}"?\n\nEl equipo volverá a aparecer en la lista activa y podrá usarse en nuevos partidos.`;
        
        if (!confirm(confirmMsg)) return;
        
        try {
            await TeamsRepository.unarchive(id);
        } catch (error: any) {
            alert(error.message || "Error al restaurar el equipo");
        }
    };

    // Hard Delete
    const handleDeleteTeam = async (id: number, teamName: string) => {
        const confirmMsg = `⚠️ BORRADO PERMANENTE\n\n¿Borrar permanentemente "${teamName}" y todos sus jugadores?\n\nEsta acción NO SE PUEDE DESHACER.\n\nSi el equipo tiene partidos registrados, usa "Archivar" en su lugar.`;
        
        if (!confirm(confirmMsg)) return;
        
        try {
            await TeamsRepository.remove(id);
        } catch (error: any) {
            alert(error.message || "Error al eliminar el equipo");
        }
    };

    return (
        <div className="page-container">
            <h1 className="title-header">
                <UsersIcon color="var(--primary)" />
                Gestión de Equipos
            </h1>

            {/* --- MODAL DE EDICIÓN --- */}
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
                            className="input flex-1"
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

            {/* TOGGLE PARA MOSTRAR ARCHIVADOS */}
            <div className="flex-between" style={{ marginBottom: '1rem' }}>
                <h3 className="label" style={{ textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>
                    Equipos Registrados ({teams?.length || 0})
                </h3>
                
                <button
                    onClick={() => setShowArchived(!showArchived)}
                    className="btn-icon"
                    style={{ 
                        color: showArchived ? 'var(--primary)' : 'var(--text-muted)',
                        fontSize: '0.85rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}
                    title={showArchived ? 'Ocultar archivados' : 'Mostrar archivados'}
                >
                    <Archive size={16} />
                    {showArchived ? 'Ver Activos' : 'Ver Archivados'}
                </button>
            </div>

            {/* --- LISTA DE EQUIPOS --- */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {teams?.map(team => {
                    const isArchived = team.isArchived === true;
                    
                    return (
                        <div 
                            key={team.id} 
                            className="card flex-between" 
                            style={{ 
                                padding: '1rem',
                                opacity: isArchived ? 0.6 : 1,
                                borderStyle: isArchived ? 'dashed' : 'solid'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                                    {team.name}
                                </span>
                                
                                {isArchived && (
                                    <span style={{
                                        fontSize: '0.7rem',
                                        padding: '0.25rem 0.5rem',
                                        borderRadius: '4px',
                                        background: 'rgba(161, 161, 170, 0.2)',
                                        color: 'var(--text-muted)',
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.5px'
                                    }}>
                                        Archivado
                                    </span>
                                )}
                            </div>

                            <div className="flex-gap">
                                {!isArchived ? (
                                    <>
                                        {/* Botón EDITAR */}
                                        <button
                                            onClick={() => setEditingTeamId(team.id!)}
                                            className="btn-icon"
                                            style={{ color: 'var(--secondary)' }}
                                            title="Editar equipo y jugadores"
                                        >
                                            <Edit2 size={18} />
                                        </button>

                                        {/* Botón ARCHIVAR */}
                                        <button
                                            onClick={() => handleArchiveTeam(team.id!, team.name)}
                                            className="btn-icon"
                                            style={{ color: 'var(--text-muted)' }}
                                            title="Archivar equipo (mantener historial)"
                                        >
                                            <Archive size={18} />
                                        </button>

                                        {/* Botón BORRAR */}
                                        <button
                                            onClick={() => handleDeleteTeam(team.id!, team.name)}
                                            className="btn-icon danger"
                                            title="Eliminar permanentemente (solo si no tiene partidos)"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        {/* Botón RESTAURAR (USANDO RotateCcw) */}
                                        <button
                                            onClick={() => handleUnarchiveTeam(team.id!, team.name)}
                                            className="btn-icon"
                                            style={{ color: 'var(--success)' }}
                                            title="Restaurar equipo"
                                        >
                                            <RotateCcw size={18} />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {teams?.length === 0 && (
                <p className="text-center text-muted" style={{ marginTop: '2rem' }}>
                    {showArchived 
                        ? 'No hay equipos archivados.'
                        : 'No hay equipos registrados aún.'
                    }
                </p>
            )}

            {!showArchived && (
                <div style={{
                    marginTop: '2rem',
                    padding: '1rem',
                    background: 'rgba(59, 130, 246, 0.05)',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    gap: '0.75rem',
                    alignItems: 'flex-start'
                }}>
                    <AlertCircle size={16} style={{ color: 'var(--secondary)', flexShrink: 0, marginTop: '2px' }} />
                    <div>
                        <strong style={{ color: 'var(--text-main)' }}>Sobre eliminar equipos:</strong>
                        <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem', lineHeight: '1.6' }}>
                            <li><strong>Archivar:</strong> Oculta el equipo pero mantiene su historial completo. Recomendado.</li>
                            <li><strong>Eliminar:</strong> Borra permanentemente. Solo funciona si no tiene partidos ni jugadores.</li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}