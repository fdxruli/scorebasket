// src/pages/Matches.tsx
import { useState } from 'react'; // <--- Agregar useState
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Clock, Trophy, Pause, Play, Eye, CalendarCheck } from 'lucide-react';

import { useMatchTimer } from '../hooks/useMatchTimer';

import { MatchHistoryModal } from '../components/matches/MatchHistoryModal'; // <--- IMPORTAR MODAL

// ... (El componente ActiveMatchCard se mantiene igual) ...
// ... (Aquí copio ActiveMatchCard para referencia, no hace falta cambiarlo) ...
const ActiveMatchCard = ({ match, localName, visitorName, localPoints, visitorPoints }: any) => {
  // ... lógica del timer ...
  // ... render del active card ...
  // Solo para abreviar en esta respuesta, asumo que ya lo tienes
  const { timeLeft, isRunning } = useMatchTimer(match, false);
  const formatTime = (seconds: number) => {
    const s = Math.ceil(seconds);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  return (
    <Link to={`/live/${match.id}`} className="card match-card is-live">
      <div className="match-card-content">
        <div style={{ flex: 1 }}>
          <div className="score-row">
            <span className="score-num">{localPoints}</span>
            <span className="team-name">{localName}</span>
          </div>
          <div className="score-row">
            <span className="score-num">{visitorPoints}</span>
            <span className="team-name">{visitorName}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <span className="quarter-badge">Q{match.currentQuarter}</span>
          <div className={`text-xs font-mono font-bold py-1 px-2 rounded flex items-center gap-1 ${isRunning ? 'bg-green-900/30 text-green-400' : 'bg-yellow-900/30 text-yellow-500'
            }`}>
            {isRunning ? <Play size={10} fill="currentColor" /> : <Pause size={10} fill="currentColor" />}
            {formatTime(timeLeft)}
          </div>
        </div>
      </div>
    </Link>
  );
};

export function Matches() {
  // --- STATE ---
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null); // <--- Estado para el modal

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('es-MX', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date);
  };

  // --- DATA FETCHING ---
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

  if (!matchesWithData) return <div className="text-center p-4 text-muted">Cargando partidos...</div>;

  const activeMatches = matchesWithData.filter(m => m.status !== 'finished');
  const finishedMatches = matchesWithData.filter(m => m.status === 'finished');

  return (
    <div className="page-container">

      <header className="flex-between mb-4">
        <h1 className="title-header" style={{ marginBottom: 0 }}>
          Mis Partidos
        </h1>
      </header>

      {/* --- MODAL DE HISTORIAL --- */}
      {selectedMatchId && (
        <MatchHistoryModal
          matchId={selectedMatchId}
          onClose={() => setSelectedMatchId(null)}
        />
      )}

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
            <ActiveMatchCard
              key={m.id}
              match={m}
              localName={m.localName}
              visitorName={m.visitorName}
              localPoints={m.localPoints}
              visitorPoints={m.visitorPoints}
            />
          ))}
        </section>
      )}

      {/* --- HISTORIAL (FINISHED) --- */}
      {finishedMatches.length > 0 && (
        <section style={{ marginTop: '2rem' }}>
          <h2 className="section-title">
            <Trophy size={14} /> Historial Reciente
          </h2>

          {/* NUEVO: Contenedor Grid */}
          <div className="matches-grid">
            {finishedMatches.map(m => {
               const localWon = m.localPoints > m.visitorPoints;
               const visitorWon = m.visitorPoints > m.localPoints;
               const isTie = m.localPoints === m.visitorPoints;
               
               return (
                <div 
                  key={m.id} 
                  className="card match-ticket cursor-pointer" // CAMBIO DE CLASE
                  onClick={() => setSelectedMatchId(m.id!)}
                  role="button"
                  tabIndex={0}
                >
                   {/* Cabecera del Ticket: Fecha y Estado */}
                   <div className="ticket-header">
                      <span className="ticket-date">
                        <CalendarCheck size={12} />
                        {formatDate(m.createdAt)}
                      </span>
                      <span className="ticket-badge">FINALIZADO</span>
                   </div>

                   {/* Cuerpo del Ticket: Equipos y Marcador */}
                   <div className="ticket-body">
                      {/* Local */}
                      <div className={`ticket-team ${localWon ? 'winner' : ''}`}>
                          <span className="ticket-team-name">{m.localName}</span>
                          <span className="ticket-score">{m.localPoints}</span>
                      </div>

                      {/* Divisor VS */}
                      <div className="ticket-divider">
                        <span>-</span>
                      </div>

                      {/* Visitante */}
                      <div className={`ticket-team ${visitorWon ? 'winner' : ''}`}>
                          <span className="ticket-score">{m.visitorPoints}</span>
                          <span className="ticket-team-name">{m.visitorName}</span>
                      </div>
                   </div>

                   {/* Footer: Ver detalles */}
                   <div className="ticket-footer">
                      <span>Ver estadísticas completas</span>
                      <Eye size={14} />
                   </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}