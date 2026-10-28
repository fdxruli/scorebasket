// src/pages/Teams.tsx
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { TeamsRepository } from '../db/teams.repository';
import { Trash2, UserPlus, Save, Users as UsersIcon, Edit2, Archive, RotateCcw, AlertCircle, X, ShieldPlus } from 'lucide-react';
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

    // Consulta de equipos + jugadores activos por equipo para vista enriquecida
    const teamsWithRoster = useLiveQuery(async () => {
        try {
            const [rawTeams, allPlayers] = await Promise.all([
                showArchived
                    ? TeamsRepository.getAllIncludingArchived()
                    : TeamsRepository.getAll(),
                db.players.toArray()
            ]);

            return rawTeams.map(team => {
                const roster = allPlayers.filter(p => p.teamId === team.id && !p.isArchived);
                return {
                    ...team,
                    roster
                };
            });
        } catch (err) {
            console.error("Error cargando equipos:", err);
            return [];
        }
    }, [showArchived]);

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

        setIsSaving(true);
        try {
            await db.transaction('rw', db.teams, db.players, async () => {
                const teamId = await TeamsRepository.create(teamName);

                if (tempPlayers.length > 0) {
                    const playersToSave = tempPlayers.map(p => ({
                        name: p.name,
                        number: p.number ? parseInt(p.number) : undefined,
                        teamId: Number(teamId),
                        createdAt: new Date(),
                        isArchived: false
                    }));

                    await db.players.bulkAdd(playersToSave);
                }
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

    const handleArchiveTeam = async (id: number, name: string) => {
        const confirmMsg = `¿Archivar "${name}"?\n\nEl equipo dejará de aparecer en la lista activa, pero su historial de partidos se mantendrá intacto.`;
        if (!confirm(confirmMsg)) return;
        try {
            await TeamsRepository.archive(id);
        } catch (error: any) {
            alert(error.message || "Error al archivar el equipo");
        }
    };

    const handleUnarchiveTeam = async (id: number, name: string) => {
        const confirmMsg = `¿Restaurar "${name}"?\n\nEl equipo volverá a aparecer en la lista activa y podrá usarse en nuevos partidos.`;
        if (!confirm(confirmMsg)) return;
        try {
            await TeamsRepository.unarchive(id);
        } catch (error: any) {
            alert(error.message || "Error al restaurar el equipo");
        }
    };

    const handleDeleteTeam = async (id: number, name: string) => {
        const confirmMsg = `⚠️ BORRADO PERMANENTE\n\n¿Borrar permanentemente "${name}" y todos sus jugadores?\n\nEsta acción NO SE PUEDE DESHACER.\n\nSi el equipo tiene partidos registrados, usa "Archivar" en su lugar.`;
        if (!confirm(confirmMsg)) return;
        try {
            await TeamsRepository.remove(id);
        } catch (error: any) {
            alert(error.message || "Error al eliminar el equipo");
        }
    };

    return (
        <div className="page-container">
            {/* --- CABECERA --- */}
            <header className="page-header-wrapper">
                <div className="page-title-group">
                    <span className="page-eyebrow">
                        <UsersIcon size={13} />
                        Roster & Franquicias
                    </span>
                    <h1 className="title-header">Gestión de Equipos</h1>
                    <p className="page-subtitle">
                        Registra tus equipos, administra plantillas de jugadores con sus dorsales y mantén intactas las estadísticas históricas.
                    </p>
                </div>
            </header>

            {/* --- MODAL DE EDICIÓN --- */}
            {editingTeamId && (
                <TeamEditorModal
                    teamId={editingTeamId}
                    onClose={() => setEditingTeamId(null)}
                />
            )}

            {/* --- WORKSPACE DE 2 COLUMNAS EN DESKTOP --- */}
            <div className="teams-workspace">
                {/* COLUMNA IZQUIERDA: REGISTRO E INFORMACIÓN */}
                <div className="teams-left-panel">
                    <div className="card teams-form-card">
                        <h2 className="form-header-text">
                            <ShieldPlus size={20} color="var(--primary)" />
                            Registrar Nuevo Equipo
                        </h2>

                        <div className="form-group">
                            <label className="label">Nombre de la Franquicia</label>
                            <input
                                type="text"
                                className="input"
                                placeholder="Ej. Los Toros / Street Kings"
                                value={teamName}
                                onChange={e => setTeamName(e.target.value)}
                            />
                        </div>

                        <div className="form-group">
                            <label className="label">Plantilla Inicial (Opcional)</label>
                            <div className="add-player-row">
                                <input
                                    type="number"
                                    className="input input-player-number"
                                    placeholder="#00"
                                    value={playerNumber}
                                    onChange={e => setPlayerNumber(e.target.value)}
                                />

                                <input
                                    type="text"
                                    className="input"
                                    style={{ flex: 1 }}
                                    placeholder="Nombre del jugador"
                                    value={playerName}
                                    onChange={e => setPlayerName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleAddTempPlayer()}
                                />

                                <button
                                    type="button"
                                    onClick={handleAddTempPlayer}
                                    className="btn-add-player"
                                    title="Agregar jugador a la lista temporal"
                                >
                                    <UserPlus size={19} />
                                </button>
                            </div>
                        </div>

                        {tempPlayers.length > 0 && (
                            <div className="temp-players-list">
                                {tempPlayers.map((p, idx) => (
                                    <span key={idx} className="pill">
                                        {p.number && (
                                            <span style={{ fontWeight: 800, color: 'var(--text-main)' }}>
                                                #{p.number}
                                            </span>
                                        )}
                                        {p.name}
                                        <button
                                            type="button"
                                            onClick={() => setTempPlayers(tempPlayers.filter((_, i) => i !== idx))}
                                            className="pill-remove-btn"
                                        >
                                            <X size={14} />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={handleSaveTeam}
                            disabled={isSaving}
                            className="btn btn-primary btn-full"
                        >
                            <Save size={18} />
                            {isSaving ? 'Guardando...' : 'Guardar Equipo'}
                        </button>
                    </div>

                    {!showArchived && (
                        <div className="teams-info-box">
                            <AlertCircle size={18} style={{ color: 'var(--secondary-light)', flexShrink: 0, marginTop: '2px' }} />
                            <div className="info-content">
                                <strong>Protección de Historial:</strong>
                                <ul>
                                    <li><strong>Archivar:</strong> Oculta el equipo de nuevos partidos pero conserva todos sus marcadores pasados.</li>
                                    <li><strong>Eliminar:</strong> Borrado definitivo (solo permitido si aún no ha jugado partidos).</li>
                                </ul>
                            </div>
                        </div>
                    )}
                </div>

                {/* COLUMNA DERECHA: DIRECTORIO DE FRANQUICIAS */}
                <div className="teams-right-panel">
                    <div className="teams-list-header">
                        <h3 className="list-title">
                            Equipos Registrados ({teamsWithRoster?.length || 0})
                        </h3>

                        <button
                            type="button"
                            onClick={() => setShowArchived(!showArchived)}
                            className={`btn-archive-toggle ${showArchived ? 'active' : ''}`}
                            title={showArchived ? 'Ocultar archivados' : 'Mostrar archivados'}
                        >
                            <Archive size={15} />
                            <span>{showArchived ? 'Ocultar Archivados' : 'Ver Archivados'}</span>
                        </button>
                    </div>

                    {teamsWithRoster?.length === 0 ? (
                        <div className="empty-state" style={{ marginTop: 0 }}>
                            <UsersIcon size={36} color="var(--text-muted)" />
                            <h3 style={{ fontSize: '1.35rem', color: 'var(--text-main)' }}>
                                {showArchived ? 'Sin equipos archivados' : 'Aún no hay equipos registrados'}
                            </h3>
                            <p style={{ fontSize: '0.88rem', maxWidth: '22rem' }}>
                                Usa el formulario para crear tu primer equipo y asignarle jugadores con sus dorsales.
                            </p>
                        </div>
                    ) : (
                        <div className="teams-grid">
                            {teamsWithRoster?.map(team => {
                                const isArchived = team.isArchived === true;
                                const initials = team.name.trim().substring(0, 2).toUpperCase();

                                return (
                                    <div
                                        key={team.id}
                                        className={`card team-card ${isArchived ? 'is-archived' : ''}`}
                                    >
                                        <div className="team-card-top">
                                            <div className="team-info">
                                                <div className="team-monogram">{initials}</div>
                                                <div className="team-meta">
                                                    <span className="team-name">{team.name}</span>
                                                    <span className="team-roster-count">
                                                        {team.roster.length === 0
                                                            ? 'Sin plantilla registrada'
                                                            : `${team.roster.length} ${team.roster.length === 1 ? 'jugador activo' : 'jugadores activos'}`}
                                                    </span>
                                                </div>
                                            </div>

                                            {isArchived && (
                                                <span className="archived-badge">Archivado</span>
                                            )}
                                        </div>

                                        {/* Vista previa rápida de jugadores */}
                                        <div className="team-roster-preview">
                                            {team.roster.length > 0 ? (
                                                <>
                                                    {team.roster.slice(0, 4).map(p => (
                                                        <span key={p.id} className="roster-mini-chip">
                                                            {p.number !== undefined && <strong>#{p.number}</strong>}
                                                            {p.name}
                                                        </span>
                                                    ))}
                                                    {team.roster.length > 4 && (
                                                        <span className="roster-mini-chip">
                                                            +{team.roster.length - 4} más
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                                                    Toca editar para añadir jugadores
                                                </span>
                                            )}
                                        </div>

                                        <div className="team-card-footer">
                                            {!isArchived ? (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditingTeamId(team.id!)}
                                                        className="btn btn-xs btn-secondary"
                                                        title="Editar equipo y plantilla"
                                                    >
                                                        <Edit2 size={14} color="var(--secondary-light)" />
                                                        Editar Plantilla
                                                    </button>

                                                    <div className="flex-gap">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleArchiveTeam(team.id!, team.name)}
                                                            className="btn-icon"
                                                            title="Archivar equipo (mantener historial)"
                                                        >
                                                            <Archive size={16} />
                                                        </button>

                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteTeam(team.id!, team.name)}
                                                            className="btn-icon danger"
                                                            title="Eliminar permanentemente (solo si no tiene partidos)"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => handleUnarchiveTeam(team.id!, team.name)}
                                                    className="btn btn-xs btn-secondary w-full"
                                                    style={{ color: 'var(--success)', borderColor: 'rgba(16, 185, 129, 0.3)' }}
                                                >
                                                    <RotateCcw size={14} />
                                                    Restaurar Equipo
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
