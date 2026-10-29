// src/pages/NewMatch.tsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Match } from '../db/models';
import { TeamsRepository } from '../db/teams.repository';
import { Play, AlertCircle, Trophy, Zap, Shield } from 'lucide-react';
import { GameModeSelector } from '../features/match-creations/components/GameModeSelector';
import { TraditionalConfigComponent } from '../features/match-creations/components/TraditionalConfig';
import { RaceConfigComponent } from '../features/match-creations/components/RaceConfig';
import { BestOfConfigComponent } from '../features/match-creations/components/BestOfConfig';
import { ConfigSummary } from '../features/match-creations/components/ConfigSummary';
import { useMatchConfig } from '../features/match-creations/hooks/useMatchConfig';
import { startQuickPickupMatch } from '../utils/matchHelpers';

export function NewMatch() {
  const navigate = useNavigate();
  const [localTeamId, setLocalTeamId] = useState<string>('');
  const [visitorTeamId, setVisitorTeamId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleQuickMatch = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const matchId = await startQuickPickupMatch(21);
      navigate(`/live/${matchId}`);
    } catch (err) {
      console.error(err);
      setError('No se pudo iniciar la Reta Rápida.');
      setIsCreating(false);
    }
  };

  const {
    config,
    changeMode,
    updateTraditional,
    updateRace,
    updateBestOf,
    validation,
    isValid
  } = useMatchConfig('traditional');

  const teams = useLiveQuery(async () => {
    try {
      return await TeamsRepository.getAll();
    } catch (err) {
      console.error("Error cargando equipos:", err);
      return [];
    }
  });

  const handleStartMatch = async () => {
    setError(null);

    if (!localTeamId || !visitorTeamId) {
      setError("Debes seleccionar ambos equipos.");
      return;
    }
    if (localTeamId === visitorTeamId) {
      setError("El equipo local y visitante no pueden ser el mismo.");
      return;
    }

    if (!isValid) {
      setError(validation.errors[0] || "Configuración inválida");
      return;
    }

    setIsCreating(true);

    try {
      const matchData: Omit<Match, 'id'> = {
        localTeamId: Number(localTeamId),
        visitorTeamId: Number(visitorTeamId),
        status: 'created',
        createdAt: new Date(),
        eventsProvenance: 'live_session',
        config: config,
        localScore: 0,
        visitorScore: 0,
        localFouls: 0,
        visitorFouls: 0
      };

      if (config.mode === 'traditional' && config.traditional) {
        matchData.currentQuarter = 1;
        matchData.timerSecondsRemaining = config.traditional.minutesPerQuarter * 60;
        matchData.timerLastStart = undefined;
        matchData.totalQuarters = config.traditional.totalQuarters;
        matchData.quarterDuration = config.traditional.minutesPerQuarter;
        matchData.localTimeouts = 0;
        matchData.visitorTimeouts = 0;
      }

      if (config.mode === 'race' || config.mode === 'best-of-series') {
        matchData.gameHistory = [];
      }

      const matchId = await db.matches.add(matchData);
      navigate(`/live/${matchId}`);
    } catch (err) {
      console.error(err);
      setError("Hubo un error al crear el partido.");
      setIsCreating(false);
    }
  };

  if (teams === undefined) return null;

  const selectedLocalName = teams.find(t => String(t.id) === localTeamId)?.name || 'Equipo Local';
  const selectedVisitorName = teams.find(t => String(t.id) === visitorTeamId)?.name || 'Equipo Visitante';

  return (
    <div className="page-container">
      {/* --- CABECERA --- */}
      <header className="page-header-wrapper">
        <div className="page-title-group">
          <span className="page-eyebrow">
            <Trophy size={13} />
            Arena Setup
          </span>
          <h1 className="title-header">Configurar Partido</h1>
          <p className="page-subtitle">
            Elige las franquicias que se enfrentan, selecciona el formato de competencia y salta a la cancha.
          </p>
        </div>

        <button
          type="button"
          onClick={handleQuickMatch}
          disabled={isCreating}
          className="btn btn-sm btn-primary"
          title="Crear equipos Local vs Visitante y jugar a 21 puntos de inmediato"
        >
          <Zap size={16} fill="currentColor" />
          Reta Rápida (21 pts)
        </button>
      </header>

      {/* Banner de Error */}
      {error && (
        <div className="error-banner">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {/* --- GRID PRINCIPAL DE 2 COLUMNAS EN DESKTOP --- */}
      <div className="new-match-layout">
        {/* COLUMNA IZQUIERDA: CONFIGURACIÓN */}
        <div className="new-match-main-col">
          {/* 1. SELECCIÓN DE EQUIPOS (Faceoff) */}
          <div className="match-faceoff">
            <div className="team-select-wrapper is-local">
              <label className="team-select-label">
                <span className="flex-gap">
                  <Shield size={13} color="var(--secondary)" />
                  Equipo Local
                </span>
                <span className="team-select-badge">HOME</span>
              </label>
              <select
                value={localTeamId}
                onChange={(e) => setLocalTeamId(e.target.value)}
                className="input"
                style={{ fontSize: '1rem', fontWeight: 700 }}
              >
                <option value="" disabled>Seleccionar franquicia...</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div className="vs-badge">VS</div>

            <div className="team-select-wrapper is-visitor">
              <label className="team-select-label">
                <span className="flex-gap">
                  <Shield size={13} color="var(--primary)" />
                  Equipo Visitante
                </span>
                <span className="team-select-badge">AWAY</span>
              </label>
              <select
                value={visitorTeamId}
                onChange={(e) => setVisitorTeamId(e.target.value)}
                className="input"
                style={{ fontSize: '1rem', fontWeight: 700 }}
              >
                <option value="" disabled>Seleccionar franquicia...</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 2. SELECTOR DE MODO DE JUEGO */}
          <GameModeSelector
            selectedMode={config.mode}
            onModeChange={changeMode}
          />

          {/* 3. CONFIGURACIÓN ESPECÍFICA */}
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
        </div>

        {/* COLUMNA DERECHA (STICKY EN DESKTOP): PREVIEW + RESUMEN + ACCIÓN */}
        <aside className="new-match-side-col">
          {/* Matchup Preview Ticket */}
          <div className="matchup-preview-banner">
            <div className="preview-team-pill">
              <span className="preview-team-role" style={{ color: 'var(--secondary-light)' }}>Local</span>
              <span className="preview-team-name">{selectedLocalName}</span>
            </div>
            <span className="ticket-vs">VS</span>
            <div className="preview-team-pill right">
              <span className="preview-team-role" style={{ color: 'var(--primary-light)' }}>Visita</span>
              <span className="preview-team-name">{selectedVisitorName}</span>
            </div>
          </div>

          {/* Resumen de Reglas */}
          <ConfigSummary config={config} />

          {/* Error de validación */}
          {!isValid && validation.errors.length > 0 && (
            <div className="error-banner">
              <AlertCircle size={20} />
              {validation.errors[0]}
            </div>
          )}

          {/* Botón de Inicio */}
          <button
            onClick={handleStartMatch}
            disabled={isCreating || !isValid}
            className="btn btn-primary btn-lg btn-full"
          >
            {isCreating ? (
              'Abriendo Cancha...'
            ) : (
              <>
                <Play fill="currentColor" size={20} />
                Iniciar Partido Oficial
              </>
            )}
          </button>

          {/* Warning si no hay equipos suficientes */}
          {teams.length < 2 && (
            <p className="warning-banner">
              Necesitas al menos 2 equipos activos para configurar un partido personalizado, o usa <strong>Reta Rápida (21 pts)</strong> arriba. <br />
              <Link to="/teams" style={{ color: 'var(--primary-light)', fontWeight: 800, textDecoration: 'underline' }}>
                Registrar equipos aquí →
              </Link>
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
