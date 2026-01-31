import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { TeamsRepository } from '../db/teams.repository';
import { Play, AlertCircle, Trophy } from 'lucide-react';
import type { Match } from '../db/models';

// --- 1. Importamos tus nuevos componentes de "features" ---
// Nota: Ajusta 'componets' a 'components' si corriges el nombre de la carpeta en el futuro.
import { GameModeSelector } from '../features/match-creations/componets/GameModeSelector';
import { TraditionalConfigComponent } from '../features/match-creations/componets/TraditionalConfig';
import { RaceConfigComponent } from '../features/match-creations/componets/RaceConfig';
import { BestOfConfigComponent } from '../features/match-creations/componets/BestOfConfig';
import { ConfigSummary } from '../features/match-creations/componets/ConfigSummary';
import { useMatchConfig } from '../features/match-creations/hooks/useMatchConfig';

export function NewMatch() {
  const navigate = useNavigate();
  const [localTeamId, setLocalTeamId] = useState<string>('');
  const [visitorTeamId, setVisitorTeamId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // --- 2. Usamos el Hook de Configuración que creaste ---
  const {
    config,
    changeMode,
    updateTraditional,
    updateRace,
    updateBestOf,
    validation,
    isValid
  } = useMatchConfig('traditional');

  // Cargar equipos
  const teams = useLiveQuery(async () => {
    try {
      return await TeamsRepository.getAll();
    } catch (err) {
      console.error("Error cargando equipos:", err);
      return [];
    }
  });

  // --- 3. Lógica para Guardar el Partido según el Modo ---
  const handleStartMatch = async () => {
    setError(null);

    // Validaciones Básicas
    if (!localTeamId || !visitorTeamId) {
      setError("Debes seleccionar ambos equipos.");
      return;
    }
    if (localTeamId === visitorTeamId) {
      setError("El equipo local y visitante no pueden ser el mismo.");
      return;
    }

    // Validar Configuración del Modo
    if (!isValid) {
      setError(validation.errors[0] || "Configuración inválida");
      return;
    }

    setIsCreating(true);

    try {
      // Objeto base del partido
      // Usamos 'any' temporalmente o 'Partial<Match>' para construirlo dinámicamente
      const matchData: any = {
        localTeamId: Number(localTeamId),
        visitorTeamId: Number(visitorTeamId),
        status: 'created',
        createdAt: new Date(),
        
        // Aquí guardamos la configuración completa que viene del hook
        config: config, 

        // Inicializamos marcadores en 0
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0
      };

      // --- LOGICA ESPECÍFICA POR MODO ---
      
      // A. MODO TRADICIONAL (Necesita tiempo y cuartos)
      if (config.mode === 'traditional' && config.traditional) {
        matchData.currentQuarter = 1;
        // Convertimos minutos a segundos para el timer
        matchData.timerSecondsRemaining = config.traditional.minutesPerQuarter * 60;
        matchData.timerLastStart = undefined;
        
        // Campos legacy para compatibilidad (opcional, pero recomendado por ahora)
        matchData.totalQuarters = config.traditional.totalQuarters;
        matchData.quarterDuration = config.traditional.minutesPerQuarter;
      }

      // B. MODOS SIN RELOJ (Race / Best Of)
      if (config.mode === 'race' || config.mode === 'best-of-series') {
        // Inicializamos historial de juegos/sets vacío
        matchData.gameHistory = [];
        // No definimos timerSecondsRemaining, el sistema entenderá que no hay reloj
      }

      // Guardar en BD
      const matchId = await db.matches.add(matchData);
      
      // Redirigir a la pantalla de juego
      navigate(`/live/${matchId}`);

    } catch (err) {
      console.error(err);
      setError("Hubo un error al crear el partido.");
      setIsCreating(false);
    }
  };

  // Evitar render si cargando
  if (teams === undefined) return null;

  return (
    <div className="page-container">
      <h1 className="title-header">
        <Trophy color="var(--primary)" />
        Nuevo Partido
      </h1>

      {/* Banner de Error */}
      {error && (
        <div className="error-banner">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {/* --- SELECCIÓN DE EQUIPOS (Faceoff) --- */}
      <div className="match-faceoff">
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

        <div className="vs-badge">VS</div>

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

      {/* --- SELECTOR DE MODO DE JUEGO --- */}
      <GameModeSelector 
        selectedMode={config.mode} 
        onModeChange={changeMode} 
      />

      {/* --- CONFIGURACIÓN ESPECÍFICA (Render Condicional) --- */}
      {config.mode === 'traditional' && config.traditional && (
        <TraditionalConfigComponent
          config={config.traditional}
          onChange={updateTraditional}
        />
      )}

      {config.mode === 'race' && config.race && (
        <RaceConfigComponent
          config={config.race}
          onChange={updateRace}
        />
      )}

      {config.mode === 'best-of-series' && config.bestOf && (
        <BestOfConfigComponent
          config={config.bestOf}
          onChange={updateBestOf}
        />
      )}

      {/* --- RESUMEN --- */}
      <ConfigSummary config={config} />

      {/* Mostrar error de validación específico si existe */}
      {!isValid && validation.errors.length > 0 && (
        <div className="error-banner" style={{marginBottom: '1rem'}}>
          <AlertCircle size={20} />
          {validation.errors[0]}
        </div>
      )}

      {/* --- BOTÓN DE INICIO --- */}
      <button
        onClick={handleStartMatch}
        disabled={isCreating || !isValid}
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

      {/* Warning si no hay equipos suficientes */}
      {teams.length < 2 && (
        <p className="warning-banner">
          Necesitas al menos 2 equipos activos para jugar. <br/>
          <Link to="/teams" style={{ color: 'var(--primary)', fontWeight: 'bold', textDecoration: 'underline' }}>
            Crear equipos aquí
          </Link>.
        </p>
      )}
    </div>
  );
}