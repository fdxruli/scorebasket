// src/pages/Matches.tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { MatchesRepository, MATCH_HISTORY_PAGE_SIZE, type FinishedMatchFilter } from '../db/matches.repository';
import { Activity, Clock, Trophy, Zap, PlusCircle, CheckCircle2, Flame } from 'lucide-react';
import { MatchHistoryModal } from '../components/matches/MatchHistoryModal';
import { startQuickPickupMatch } from '../utils/matchHelpers';

import { ActiveMatchCard } from '../features/match-creations/components/ActiveMatchCard';
import { HistoryMatchTicket } from '../features/match-creations/components/HistoryMatchTicket';
import { LocalBackupControls } from '../components/matches/LocalBackupControls';

export function Matches() {
  const navigate = useNavigate();
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [isStartingQuick, setIsStartingQuick] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<FinishedMatchFilter>('all');
  const [visibleFinished, setVisibleFinished] = useState(MATCH_HISTORY_PAGE_SIZE);
  const selectHistoryFilter = (mode: FinishedMatchFilter) => {
    setHistoryFilter(mode);
    setVisibleFinished(MATCH_HISTORY_PAGE_SIZE);
  };

  const handleQuickMatch = async () => {
    if (isStartingQuick) return;
    setIsStartingQuick(true);
    try {
      const matchId = await startQuickPickupMatch(21);
      navigate(`/live/${matchId}`);
    } catch (err) {
      console.error('Error iniciando reta rápida:', err);
      setIsStartingQuick(false);
    }
  };

  const dashboard = useLiveQuery(
    () => MatchesRepository.getDashboard(historyFilter, visibleFinished),
    [historyFilter, visibleFinished]
  );

  if (!dashboard) {
    return (
      <div className="flex-center text-muted" style={{ minHeight: '60vh' }}>
        Cargando tablero de partidos...
      </div>
    );
  }

  const { activeMatches, finishedMatches, totalMatches, totalFinished, filteredFinishedCount } = dashboard;
  const filteredFinished = finishedMatches;

  return (
    <div className="page-container">
      {/* --- CABECERA PRINCIPAL --- */}
      <header className="page-header-wrapper">
        <div className="page-title-group">
          <span className="page-eyebrow">
            <Flame size={13} fill="currentColor" />
            Tablero Oficial
          </span>
          <h1 className="title-header">Centro de Partidos</h1>
          <p className="page-subtitle">
            Controla marcadores en tiempo real, retas callejeras y el historial completo de enfrentamientos.
          </p>
        </div>

        <div className="flex-gap" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleQuickMatch}
            disabled={isStartingQuick}
            className="btn btn-sm btn-primary"
            title="Iniciar Reta Rápida a 21 puntos en 1 clic"
          >
            <Zap size={15} fill="currentColor" />
            Reta Rápida (21 pts)
          </button>
          <Link to="/matches/new" className="btn btn-sm btn-secondary">
            <PlusCircle size={15} />
            Configurar Partido
          </Link>
        </div>
      </header>

      <LocalBackupControls />

      {/* --- MODAL DE REPORTE / BOX SCORE --- */}
      {selectedMatchId && (
        <MatchHistoryModal
          matchId={selectedMatchId}
          onClose={() => setSelectedMatchId(null)}
        />
      )}

      {/* --- FRANJA DE INDICADORES (KPIs) --- */}
      {totalMatches > 0 && (
        <div className="matches-kpi-strip">
          <div className={`kpi-card ${activeMatches.length > 0 ? 'is-highlight' : ''}`}>
            <span className="kpi-label">
              <Activity size={13} color="var(--primary)" />
              En Cancha
            </span>
            <span className="kpi-value" style={{ color: activeMatches.length > 0 ? 'var(--primary-light)' : undefined }}>
              {activeMatches.length}
            </span>
          </div>

          <div className="kpi-card">
            <span className="kpi-label">
              <CheckCircle2 size={13} color="var(--success)" />
              Finalizados
            </span>
            <span className="kpi-value">{totalFinished}</span>
          </div>

          <div className="kpi-card">
            <span className="kpi-label">
              <Trophy size={13} color="var(--secondary-light)" />
              Total Juegos
            </span>
            <span className="kpi-value">{totalMatches}</span>
          </div>
        </div>
      )}

      {/* --- ESTADO VACÍO --- */}
      {totalMatches === 0 && (
        <div className="empty-state">
          <div
            style={{
              padding: '1.15rem',
              background: 'rgba(255, 95, 31, 0.14)',
              borderRadius: '9999px',
              border: '1px solid rgba(255, 95, 31, 0.35)',
              display: 'inline-flex',
              boxShadow: '0 0 30px rgba(255, 95, 31, 0.25)'
            }}
          >
            <Trophy size={42} color="var(--primary)" />
          </div>
          <h2 style={{ fontSize: '1.85rem', fontWeight: 900, color: 'var(--text-main)' }}>
            ¡La cancha está lista!
          </h2>
          <p style={{ fontSize: '0.92rem', maxWidth: '24rem', margin: '0 auto', lineHeight: 1.5 }}>
            Inicia una reta callejera a 21 puntos con un solo toque o configura un partido oficial por cuartos o series.
          </p>
          <div className="flex-col gap-sm w-full" style={{ maxWidth: '300px', marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={handleQuickMatch}
              disabled={isStartingQuick}
              className="btn btn-primary btn-full"
            >
              <Zap size={18} fill="currentColor" />
              Reta Rápida (21 pts)
            </button>
            <Link to="/matches/new" className="btn btn-secondary btn-full">
              Configurar Partido Personalizado
            </Link>
          </div>
        </div>
      )}

      {/* --- SECCIÓN EN VIVO --- */}
      {activeMatches.length > 0 && (
        <section>
          <div className="section-header-bar">
            <h2 className="section-title" style={{ color: 'var(--primary-light)' }}>
              <span className="pulse-dot" />
              Partidos en Vivo ({activeMatches.length})
            </h2>
          </div>
          <div className="live-matches-list">
            {activeMatches.map(m => (
              <ActiveMatchCard
                key={m.id}
                match={m}
                localName={m.localName}
                visitorName={m.visitorName}
              />
            ))}
          </div>
        </section>
      )}

      {/* --- SECCIÓN HISTORIAL --- */}
      {totalFinished > 0 && (
        <section>
          <div className="section-header-bar">
            <h2 className="section-title">
              <Clock size={17} color="var(--secondary-light)" />
              Historial de Resultados ({filteredFinishedCount})
            </h2>

            <div className="filter-pills">
              <button
                type="button"
                onClick={() => selectHistoryFilter('all')}
                className={`filter-pill-btn ${historyFilter === 'all' ? 'active' : ''}`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => selectHistoryFilter('traditional')}
                className={`filter-pill-btn ${historyFilter === 'traditional' ? 'active' : ''}`}
              >
                Tradicional
              </button>
              <button
                type="button"
                onClick={() => selectHistoryFilter('race')}
                className={`filter-pill-btn ${historyFilter === 'race' ? 'active' : ''}`}
              >
                Race / Reta
              </button>
              <button
                type="button"
                onClick={() => selectHistoryFilter('best-of-series')}
                className={`filter-pill-btn ${historyFilter === 'best-of-series' ? 'active' : ''}`}
              >
                Series
              </button>
            </div>
          </div>

          {filteredFinished.length === 0 ? (
            <div className="card text-center text-muted" style={{ padding: '2.5rem 1rem' }}>
              No hay partidos finalizados en esta modalidad todavía.
            </div>
          ) : (
            <div className="matches-grid">
              {filteredFinished.map(m => (
                <HistoryMatchTicket
                  key={m.id}
                  match={m}
                  localName={m.localName}
                  visitorName={m.visitorName}
                  onClick={() => setSelectedMatchId(m.id!)}
                />
              ))}
            </div>
          )}
          {filteredFinished.length < filteredFinishedCount && (
            <div className="flex-center" style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setVisibleFinished(current => current + MATCH_HISTORY_PAGE_SIZE)}
              >
                Ver más resultados ({filteredFinishedCount - filteredFinished.length} pendientes)
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
