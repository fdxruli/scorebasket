// src/pages/Matches.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Activity, Clock, Trophy } from 'lucide-react';
import { MatchHistoryModal } from '../components/matches/MatchHistoryModal';

// --- CORRECCIÓN DE IMPORTACIONES ---
// Los archivos están en 'match-creations/componets' (nota el nombre de la carpeta 'componets')
import { ActiveMatchCard } from '../features/match-creations/componets/ActiveMatchCard';
import { HistoryMatchTicket } from '../features/match-creations/componets/HistoryMatchTicket';

export function Matches() {
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);

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

  if (!matchesWithData) return <div className="h-screen flex items-center justify-center text-muted">Cargando...</div>;

  const activeMatches = matchesWithData.filter(m => m.status !== 'finished');
  const finishedMatches = matchesWithData.filter(m => m.status === 'finished');

  return (
    <div className="page-container">

      <header className="page-header-wrapper">
        <h1 className="title-header">Mis Partidos</h1>
        {matchesWithData.length > 0 && (
          <Link to="/matches/new" className="btn btn-sm btn-primary">+ Nuevo</Link>
        )}
      </header>

      {selectedMatchId && (
        <MatchHistoryModal
          matchId={selectedMatchId}
          onClose={() => setSelectedMatchId(null)}
        />
      )}

      {matchesWithData.length === 0 && (
        <div className="empty-state">
          <div className="p-4 bg-zinc-900 rounded-full border border-zinc-800 shadow-xl mb-2">
            <Trophy size={40} className="text-primary opacity-80" />
          </div>
          <h2 className="text-lg font-bold text-main">¡Comienza el juego!</h2>
          <p className="text-sm max-w-xs mx-auto">Crea equipos y registra tu primer partido.</p>
          <Link to="/matches/new" className="btn btn-primary mt-4">
            Crear Partido
          </Link>
        </div>
      )}

      {/* SECCIÓN EN VIVO */}
      {activeMatches.length > 0 && (
        <section className="mb-8">
          <h2 className="section-title text-primary" style={{ borderBottomColor: 'var(--primary)' }}>
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