// src/pages/Teams.tsx
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Trash2, UserPlus, Save, Users as UsersIcon } from 'lucide-react';

export function Teams() {
  const [teamName, setTeamName] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [tempPlayers, setTempPlayers] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const teams = useLiveQuery(() => db.teams.toArray());

  const handleAddTempPlayer = () => {
    if (!playerName.trim()) return;
    setTempPlayers([...tempPlayers, playerName.trim()]);
    setPlayerName('');
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
        const playersToSave = tempPlayers.map(name => ({
          name,
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
    if(!confirm("¿Borrar equipo y sus jugadores?")) return;
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

      {/* --- CARD: FORMULARIO --- */}
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
          <div className="flex-gap">
            <input 
              type="text" 
              className="input"
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
                {p}
                <button 
                  onClick={() => setTempPlayers(tempPlayers.filter((_, i) => i !== idx))}
                  style={{ color: 'inherit', marginLeft: '4px', display:'flex' }}
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
              <span style={{ fontWeight: 600 }}>{team.name}</span>
              <button 
                  onClick={() => handleDeleteTeam(team.id!)}
                  className="btn-icon danger"
              >
                  <Trash2 size={18} />
              </button>
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