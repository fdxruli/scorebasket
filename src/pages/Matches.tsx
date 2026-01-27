// src/pages/Matches.tsx
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { ChevronRight, Clock, Trophy } from 'lucide-react';

// Importamos estilos específicos
import './Matches.css';

export function Matches() {
  // --- DATA FETCHING (Sin cambios en la lógica) ---
  const matchesWithData = useLiveQuery(async () => {
    const matches = await db.matches.orderBy('createdAt').reverse().toArray();
    const teams = await db.teams.toArray();
    const teamMap = new Map(teams.map(t => [t.id, t.name]));
    const allScores = await db.scores.toArray();

    return matches.map(m => {
      const matchScores = allScores.filter(s => s.matchId === m.id);
      return {
        ...m,
        localName: teamMap.get(m.localTeamId) || '???',
        visitorName: teamMap.get(m.visitorTeamId) || '???',
        localPoints: matchScores.filter(s => s.teamId === m.localTeamId).reduce((a, b) => a + b.points, 0),
        visitorPoints: matchScores.filter(s => s.teamId === m.visitorTeamId).reduce((a, b) => a + b.points, 0),
      };
    });
  }, []);

  // Loading simple
  if (!matchesWithData) return <div className="text-center p-4 text-muted">Cargando partidos...</div>;

  const activeMatches = matchesWithData.filter(m => m.status !== 'finished');
  const finishedMatches = matchesWithData.filter(m => m.status === 'finished');

  return (
    <div className="page-container">
      
      {/* HEADER */}
      <header className="flex-between mb-4">
        <h1 className="title-header" style={{ marginBottom: 0 }}>
          Mis Partidos
        </h1>
        {/* Podríamos poner un botón mini de "+" aquí si quisiéramos */}
      </header>

      {/* --- ESTADO VACÍO --- */}
      {matchesWithData.length === 0 && (
        <div className="empty-state">
          <Clock size={48} strokeWidth={1.5} />
          <p>No hay partidos registrados aún.</p>
          <Link to="/matches/new" className="btn btn-primary">
            Crear Primer Partido
          </Link>
        </div>
      )}

      {/* --- EN JUEGO (ACTIVE) --- */}
      {activeMatches.length > 0 && (
        <section>
          <h2 className="section-title" style={{ color: 'var(--primary)' }}>
            <span className="live-indicator-dot"></span>
            En Vivo
          </h2>
          
          {activeMatches.map(m => (
            <Link key={m.id} to={`/live/${m.id}`} className="card match-card is-live">
              <div className="match-card-content">
                
                {/* Marcador Izquierda */}
                <div style={{ flex: 1 }}>
                   <div className="score-row">
                      <span className="score-num">{m.localPoints}</span>
                      <span className="team-name">{m.localName}</span>
                   </div>
                   <div className="score-row">
                      <span className="score-num">{m.visitorPoints}</span>
                      <span className="team-name">{m.visitorName}</span>
                   </div>
                </div>

                {/* Info Derecha (Cuarto + Flecha) */}
                <div style={{ textAlign: 'right' }}>
                    <span className="quarter-badge">Q{m.currentQuarter}</span>
                    <div className="btn-icon" style={{ display: 'inline-flex', background: '#27272a' }}>
                        <ChevronRight size={16} color="#fff" />
                    </div>
                </div>

              </div>
            </Link>
          ))}
        </section>
      )}

      {/* --- HISTORIAL (FINISHED) --- */}
      {finishedMatches.length > 0 && (
        <section style={{ marginTop: '2rem' }}>
          <h2 className="section-title">
            <Trophy size={14} /> Historial Reciente
          </h2>

          {finishedMatches.map(m => {
             const localWon = m.localPoints > m.visitorPoints;
             const visitorWon = m.visitorPoints > m.localPoints;
             
             return (
              <div key={m.id} className="card match-card is-finished">
                 <div className="match-card-content">
                    <div className="finished-layout">
                       
                       {/* Local */}
                       <div className="finished-team-col">
                          <span className={`score-big ${localWon ? 'score-winner' : 'score-loser'}`}>
                            {m.localPoints}
                          </span>
                          <span className="team-name-small">{m.localName}</span>
                       </div>

                       {/* Badge Central */}
                       <span className="final-badge">FINAL</span>

                       {/* Visitante */}
                       <div className="finished-team-col">
                          <span className={`score-big ${visitorWon ? 'score-winner' : 'score-loser'}`}>
                            {m.visitorPoints}
                          </span>
                          <span className="team-name-small">{m.visitorName}</span>
                       </div>

                    </div>
                 </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}