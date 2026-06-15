import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LiveMatchProvider, useLiveMatch } from '../features/match-creations/componets/context/LiveMatchContext';
import { TraditionalEngine } from '../features/match-creations/componets/engines/TraditionalEngine';
import { RaceEngine } from '../features/match-creations/componets/engines/RaceEngine';
import { SeriesEngine } from '../features/match-creations/componets/engines/SeriesEngine';

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
      <div className="min-h-screen w-full flex flex-col items-center justify-center gap-4 bg-black p-6 text-center">
        <h2 className="text-2xl text-red-500 font-bold">No se pudo abrir el partido</h2>
        <p className="text-gray-400 max-w-sm">{this.state.message}</p>
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
      <div className="min-h-screen w-full flex items-center justify-center bg-black p-6 text-center">
        <div className="text-xl text-gray-400 animate-pulse">Cargando configuración del partido...</div>
      </div>
    );
  }

  // 2. Estado de Error / No encontrado.
  if (error || !match || !localTeam || !visitorTeam) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-black p-6 text-center gap-4">
        <h2 className="text-2xl text-red-500 font-bold">Partido no encontrado</h2>
        <p className="text-gray-400 max-w-sm">
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
      <div className="min-h-screen w-full flex items-center justify-center bg-black p-8 text-center text-red-400">
        ID de partido inválido
      </div>
    );
  }

  return (
    <LiveMatchProvider matchId={matchId}>
      <LiveMatchErrorBoundary>
        <div className="min-h-screen w-full bg-black">
          <EngineDispatcher />
        </div>
      </LiveMatchErrorBoundary>
    </LiveMatchProvider>
  );
};

export default LiveMatch;