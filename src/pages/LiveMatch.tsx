import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LiveMatchProvider, useLiveMatch } from '../features/match-creations/components/context/LiveMatchContext';
import { TraditionalEngine } from '../features/match-creations/components/engines/TraditionalEngine';
import { RaceEngine } from '../features/match-creations/components/engines/RaceEngine';
import { SeriesEngine } from '../features/match-creations/components/engines/SeriesEngine';

// Layout de pantalla completa centrado (sustituye clases utilitarias que no existen en src/styles)
const fullScreenCenter: CSSProperties = {
  minHeight: '100vh',
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#000',
  textAlign: 'center'
};

type LiveMatchErrorBoundaryProps = {
  children: ReactNode;
};

type LiveMatchErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class LiveMatchErrorBoundary extends Component<LiveMatchErrorBoundaryProps, LiveMatchErrorBoundaryState> {
  state: LiveMatchErrorBoundaryState = {
    hasError: false,
    message: ''
  };

  static getDerivedStateFromError(error: Error): LiveMatchErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Ocurrió un error al cargar el partido en vivo.'
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error en pantalla LiveMatch:', error, errorInfo);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{ ...fullScreenCenter, flexDirection: 'column', gap: '1rem', padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', color: '#ef4444', fontWeight: 700 }}>No se pudo abrir el partido</h2>
        <p style={{ color: '#9ca3af', maxWidth: '24rem' }}>{this.state.message}</p>
        <button
          className="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          Recargar partido
        </button>
      </div>
    );
  }
}

/**
 * EngineDispatcher:
 * Componente interno que escucha el contexto y decide qué motor pintar.
 */
const EngineDispatcher = () => {
  const { match, localTeam, visitorTeam, isLoading, error } = useLiveMatch();
  const navigate = useNavigate();

  // 1. Estado de Carga visible y con altura completa.
  if (isLoading) {
    return (
      <div style={{ ...fullScreenCenter, padding: '1.5rem' }}>
        <div style={{ fontSize: '1.25rem', color: '#9ca3af' }}>Cargando configuración del partido...</div>
      </div>
    );
  }

  // 2. Estado de Error / No encontrado.
  if (error || !match || !localTeam || !visitorTeam) {
    return (
      <div style={{ ...fullScreenCenter, flexDirection: 'column', gap: '1rem', padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', color: '#ef4444', fontWeight: 700 }}>Partido no encontrado</h2>
        <p style={{ color: '#9ca3af', maxWidth: '24rem' }}>
          {error || 'No se pudieron cargar todos los datos del partido.'}
        </p>
        <button
          className="btn btn-secondary"
          onClick={() => navigate('/matches')}
        >
          Volver a partidos
        </button>
      </div>
    );
  }

  // 3. Selección de Motor (Strategy Pattern).
  // La key fuerza un remount limpio cuando cambia partido o modo y evita estados colgados.
  const mode = match.config?.mode || 'traditional';
  const engineKey = `${match.id}-${mode}`;

  switch (mode) {
    case 'race':
      return <RaceEngine key={engineKey} />;
      
    case 'best-of-series':
      return <SeriesEngine key={engineKey} />;
      
    case 'traditional':
    default:
      return <TraditionalEngine key={engineKey} />;
  }
};

/**
 * LiveMatch (Main Page):
 * Punto de entrada principal.
 */
export const LiveMatch = () => {
  const { id } = useParams<{ id: string }>();
  const matchId = Number(id);

  if (isNaN(matchId)) {
    return (
      <div style={{ ...fullScreenCenter, color: '#f87171', padding: '2rem' }}>
        ID de partido inválido
      </div>
    );
  }

  return (
    <LiveMatchProvider matchId={matchId}>
      <LiveMatchErrorBoundary>
        <div style={{ minHeight: '100vh', width: '100%', background: '#000' }}>
          <EngineDispatcher />
        </div>
      </LiveMatchErrorBoundary>
    </LiveMatchProvider>
  );
};

export default LiveMatch;