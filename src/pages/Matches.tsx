// src/pages/Matches.tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Activity, Clock, Trophy, Zap } from 'lucide-react';
import { MatchHistoryModal } from '../components/matches/MatchHistoryModal';
import { startQuickPickupMatch } from '../utils/matchHelpers';

import { ActiveMatchCard } from '../features/match-creations/components/ActiveMatchCard';
import { HistoryMatchTicket } from '../features/match-creations/components/HistoryMatchTicket';

export function Matches() {
  const navigate = useNavigate();
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [isStartingQuick, setIsStartingQuick] = useState(false);

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

  // QUERY: Se mantiene igual, la lógica es correcta
  const matchesWithData = useLiveQuery(async () => {
    const matches = await db.matches.orderBy('createdAt').reverse().toArray();
    const teams = await db.teams.toArray();
    const teamMap = new Map(teams.map(t => [t.id, t.name]));

    return matches.map(m => ({
      ...m,
      localName: teamMap.get(m.localTeamId) || '???',
      visitorName: teamMap.get(m.visitorTeamId) || '???',
    }));
  }, []);

  if (!matchesWithData) {
    return (
      <div className="flex-center text-muted" style={{ minHeight: '100vh' }}>
        Cargando...
      </div>
    );
  }

  const activeMatches = matchesWithData.filter(m => m.status !== 'finished');
  const finishedMatches = matchesWithData.filter(m => m.status === 'finished');

  return (
    <div className="page-container">

      <header className="page-header-wrapper" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 className="title-header">Mis Partidos</h1>
        <div className="flex-gap">
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
          {matchesWithData.length > 0 && (
            <Link to="/matches/new" className="btn btn-sm btn-secondary">+ Nuevo</Link>
          )}
        </div>
      </header>

      {selectedMatchId && (
        <MatchHistoryModal
          matchId={selectedMatchId}
          onClose={() => setSelectedMatchId(null)}
        />
      )}

      {matchesWithData.length === 0 && (
        <div className="empty-state">
          <div
            style={{
              padding: '1rem',
              backgroundColor: 'var(--bg-surface)',
              borderRadius: '9999px',
              border: '1px solid var(--border-color)',
              marginBottom: '0.5rem',
              display: 'inline-flex'
            }}
          >
            <Trophy size={40} color="var(--primary)" />
          </div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-main)' }}>¡Comienza el juego!</h2>
          <p style={{ fontSize: '0.875rem', maxWidth: '20rem', margin: '0 auto' }}>
            Inicia una reta callejera al instante o configura tu partido personalizado.
          </p>
          <div className="flex-col gap-sm w-full" style={{ maxWidth: '280px', marginTop: '0.75rem' }}>
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
              Configurar Partido
            </Link>
          </div>
        </div>
      )}

      {/* SECCIÓN EN VIVO */}
      {activeMatches.length > 0 && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 className="section-title" style={{ color: 'var(--primary)', borderBottomColor: 'var(--primary)' }}>
            <Activity size={16} /> En Vivo ({activeMatches.length})
          </h2>
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

      {/* SECCIÓN HISTORIAL */}
      {finishedMatches.length > 0 && (
        <section>
          <h2 className="section-title"><Clock size={16} /> Historial</h2>
          <div className="matches-grid">
            {finishedMatches.map(m => (
              <HistoryMatchTicket 
                key={m.id}
                match={m}
                localName={m.localName}
                visitorName={m.visitorName}
                onClick={() => setSelectedMatchId(m.id!)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
