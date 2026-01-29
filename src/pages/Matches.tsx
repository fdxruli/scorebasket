// src/pages/Matches.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { Clock, Trophy, Pause, Play, Activity, Calendar, ArrowRight } from 'lucide-react';
import { useMatchTimer } from '../hooks/useMatchTimer';
import { MatchHistoryModal } from '../components/matches/MatchHistoryModal';

// --- COMPONENTE: TARJETA EN VIVO CON INFO PRECISA ---
const ActiveMatchCard = ({ match, localName, visitorName, localPoints, visitorPoints, localFouls, visitorFouls }: any) => {
  const { timeLeft, isRunning } = useMatchTimer(match, false);

  const formatTime = (seconds: number) => {
    const s = Math.ceil(seconds);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  return (
    <Link to={`/live/${match.id}`} className="match-card is-live">

      {/* 1. Header: Reloj y Estado */}
      <div className="live-card-header">
        <div className={`live-badge-status ${isRunning ? 'text-primary border-orange-500/30' : 'text-muted'}`}>
          <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-primary animate-pulse' : 'bg-zinc-600'}`}></div>
          {isRunning ? 'EN JUEGO' : 'PAUSADO'}
        </div>

        <div className="flex items-center gap-2 font-mono text-sm font-bold text-main">
          <span className="text-muted text-xs uppercase tracking-widest mr-2">Q{match.currentQuarter}</span>
          {isRunning ? <Play size={10} className="text-primary" fill="currentColor" /> : <Pause size={10} className="text-muted" fill="currentColor" />}
          {formatTime(timeLeft)}
        </div>
      </div>

      {/* 2. Cuerpo: Equipos y Datos Precisos */}
      <div className="live-card-body">

        {/* Local */}
        <div className={`live-team-row ${localPoints > visitorPoints ? 'winning' : ''}`}>
          <div className="team-info-group">
            <div className="team-avatar-placeholder">{localName.substring(0, 1)}</div>
            <span className="live-team-name">{localName}</span>
          </div>
          <div className="stats-box">
            <div className="stat-fouls">
              <strong>{localFouls}</strong>
              <span>FAL</span>
            </div>
            <span className="live-team-score">{localPoints}</span>
          </div>
        </div>

        {/* Visitante */}
        <div className={`live-team-row ${visitorPoints > localPoints ? 'winning' : ''}`}>
          <div className="team-info-group">
            <div className="team-avatar-placeholder">{visitorName.substring(0, 1)}</div>
            <span className="live-team-name">{visitorName}</span>
          </div>
          <div className="stats-box">
            <div className="stat-fouls">
              <strong>{visitorFouls}</strong>
              <span>FAL</span>
            </div>
            <span className="live-team-score">{visitorPoints}</span>
          </div>
        </div>

      </div>
    </Link>
  );
};

export function Matches() {
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);

  const formatDate = (date: Date) => {
    try {
      return new Intl.DateTimeFormat('es-MX', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(date);
    } catch (e) { return ""; }
  };

  // QUERY CON MÁS DATOS (FALTAS)
  const matchesWithData = useLiveQuery(async () => {
    const matches = await db.matches.orderBy('createdAt').reverse().toArray();
    const teams = await db.teams.toArray();
    const teamMap = new Map(teams.map(t => [t.id, t.name]));

    // ¡Adiós a cargar db.scores.toArray() y db.fouls.toArray() aquí!

    return matches.map(m => {
      return {
        ...m,
        localName: teamMap.get(m.localTeamId) || '???',
        visitorName: teamMap.get(m.visitorTeamId) || '???',

        // Usamos los datos pre-calculados del modelo
        // (Nota: Estos serán "Totales", lo cual es perfecto para el historial.
        // Para la tarjeta en vivo, mostrará faltas totales en vez de por cuarto, 
        // lo cual es un compromiso aceptable para ganar este rendimiento masivo).
        localPoints: m.localScore || 0,
        visitorPoints: m.visitorScore || 0,
        localFouls: m.localFouls || 0,
        visitorFouls: m.visitorFouls || 0,
      };
    });
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

      {/* MODAL DE DETALLE */}
      {selectedMatchId && (
        <MatchHistoryModal
          matchId={selectedMatchId}
          onClose={() => setSelectedMatchId(null)}
        />
      )}

      {/* ESTADO VACÍO */}
      {matchesWithData.length === 0 && (
        <div className="empty-state">
          <div className="p-4 bg-zinc-900 rounded-full border border-zinc-800 shadow-xl mb-2">
            <Trophy size={40} className="text-primary opacity-80" />
          </div>
          <h2 className="text-lg font-bold text-main">¡Comienza el juego!</h2>
          <p className="text-sm max-w-xs mx-auto">Crea equipos y registra tu primer partido para ver las estadísticas aquí.</p>
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
                localPoints={m.localPoints}
                visitorPoints={m.visitorPoints}
                localFouls={m.localFouls}
                visitorFouls={m.visitorFouls}
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
            {finishedMatches.map(m => {
              const localWon = m.localPoints > m.visitorPoints;
              const visitorWon = m.visitorPoints > m.localPoints;

              return (
                <div key={m.id} className="match-ticket cursor-pointer" onClick={() => setSelectedMatchId(m.id!)}>
                  <div className="ticket-header">
                    <span className="flex items-center gap-2"><Calendar size={12} />{formatDate(m.createdAt)}</span>
                    <ArrowRight size={12} />
                  </div>
                  <div className="ticket-body">
                    <div className={`ticket-team ${localWon ? 'winner' : ''}`}>
                      <span className="ticket-team-name">{m.localName}</span>
                      <span className="ticket-score">{m.localPoints}</span>
                    </div>
                    <div className="ticket-vs">VS</div>
                    <div className={`ticket-team ${visitorWon ? 'winner' : ''}`}>
                      <span className="ticket-team-name">{m.visitorName}</span>
                      <span className="ticket-score">{m.visitorPoints}</span>
                    </div>
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