// src/pages/NewMatch.tsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom'; // Importamos Link
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Play, Settings, AlertCircle, Trophy } from 'lucide-react';

// Importamos los estilos específicos
import './NewMatch.css';

export function NewMatch() {
  const navigate = useNavigate();

  // --- ESTADO ---
  const [localTeamId, setLocalTeamId] = useState<string>('');
  const [visitorTeamId, setVisitorTeamId] = useState<string>('');
  
  const [config, setConfig] = useState({
    minutesPerQuarter: 10,
    totalQuarters: 4
  });

  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // --- DATOS ---
  const teams = useLiveQuery(() => db.teams.toArray());

  // --- LÓGICA ---
  const handleStartMatch = async () => {
    setError(null);

    // Validaciones
    if (!localTeamId || !visitorTeamId) {
      setError("Debes seleccionar ambos equipos.");
      return;
    }

    if (localTeamId === visitorTeamId) {
      setError("El equipo local y visitante no pueden ser el mismo.");
      return;
    }

    setIsCreating(true);

    try {
      const matchId = await db.matches.add({
        localTeamId: Number(localTeamId),
        visitorTeamId: Number(visitorTeamId),
        currentQuarter: 1,
        status: 'created',
        createdAt: new Date(),
        quarterDuration: config.minutesPerQuarter,
        timerSecondsRemaining: config.minutesPerQuarter * 60,
        timerLastStart: undefined
      });

      navigate(`/live/${matchId}`);

    } catch (err) {
      console.error(err);
      setError("Hubo un error al crear el partido.");
      setIsCreating(false);
    }
  };

  if (!teams) return null;

  return (
    <div className="page-container">
      <h1 className="title-header">
        <Trophy color="var(--primary)" />
        Nuevo Partido
      </h1>

      {/* --- ERROR FEEDBACK --- */}
      {error && (
        <div className="error-banner">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {/* --- SELECCIÓN DE EQUIPOS (Faceoff) --- */}
      <div className="match-faceoff">
        
        {/* Local */}
        <div className="team-select-wrapper">
          <label className="team-select-label">Equipo Local</label>
          <select
            value={localTeamId}
            onChange={(e) => setLocalTeamId(e.target.value)}
            className="input"
            style={{ fontSize: '1.1rem', padding: '1rem' }}
          >
            <option value="" disabled>Seleccionar...</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* VS Badge */}
        <div className="vs-badge">VS</div>

        {/* Visitante */}
        <div className="team-select-wrapper">
          <label className="team-select-label" style={{ textAlign: 'right' }}>
            Equipo Visitante
          </label>
          <select
            value={visitorTeamId}
            onChange={(e) => setVisitorTeamId(e.target.value)}
            className="input"
            style={{ fontSize: '1.1rem', padding: '1rem', textAlign: 'right', direction: 'rtl' }}
          >
            <option value="" disabled>...Seleccionar</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* --- CONFIGURACIÓN --- */}
      <div className="card">
        <div className="flex-gap mb-4" style={{ marginBottom: '1rem' }}>
          <Settings size={20} color="var(--text-muted)" />
          <h3 style={{ fontSize: '1rem', color: 'var(--text-main)' }}>Reglas del Juego</h3>
        </div>

        <div className="config-grid">
          <div>
            <label className="label">Periodos</label>
            <input 
              type="number" 
              min="1" 
              max="6"
              className="input input-number"
              value={config.totalQuarters}
              onChange={(e) => setConfig({...config, totalQuarters: Number(e.target.value)})}
            />
          </div>
          <div>
            <label className="label">Minutos / Periodo</label>
            <input 
              type="number" 
              min="1" 
              max="20"
              className="input input-number"
              value={config.minutesPerQuarter}
              onChange={(e) => setConfig({...config, minutesPerQuarter: Number(e.target.value)})}
            />
          </div>
        </div>
      </div>

      {/* --- BOTÓN DE ACCIÓN --- */}
      <button
        onClick={handleStartMatch}
        disabled={isCreating}
        className="btn btn-primary w-full"
        style={{ padding: '1rem', fontSize: '1.1rem' }}
      >
        {isCreating ? (
          'Creando...'
        ) : (
          <>
            <Play fill="currentColor" size={20} />
            Iniciar Partido
          </>
        )}
      </button>

      {/* Info extra si no hay equipos */}
      {teams.length < 2 && (
        <p className="warning-banner">
          Necesitas al menos 2 equipos para jugar. <br/>
          <Link to="/teams" style={{ color: 'var(--primary)', fontWeight: 'bold', textDecoration: 'underline' }}>
            Crear equipos aquí
          </Link>.
        </p>
      )}
    </div>
  );
}