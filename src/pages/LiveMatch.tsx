import { useParams } from 'react-router-dom';
// Eliminamos la importación de Layout porque ya se usa a nivel de rutas
import { LiveMatchProvider, useLiveMatch } from '../features/match-creations/componets/context/LiveMatchContext';
import { TraditionalEngine } from '../features/match-creations/componets/engines/TraditionalEngine';
import { RaceEngine } from '../features/match-creations/componets/engines/RaceEngine';
import { SeriesEngine } from '../features/match-creations/componets/engines/SeriesEngine';

/**
 * EngineDispatcher:
 * Componente interno que "escucha" el contexto y decide qué motor pintar.
 */
const EngineDispatcher = () => {
  const { match, isLoading } = useLiveMatch();

  // 1. Estado de Carga
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh]">
        <div className="text-xl text-gray-400 animate-pulse">Cargando configuración del partido...</div>
      </div>
    );
  }

  // 2. Estado de Error / No encontrado
  if (!match) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[50vh] gap-4">
        <h2 className="text-2xl text-red-500 font-bold">Partido no encontrado</h2>
        <p className="text-gray-400">El ID proporcionado no existe en la base de datos.</p>
      </div>
    );
  }

  // 3. Selección de Motor (Strategy Pattern)
  const mode = match.config?.mode || 'traditional';

  switch (mode) {
    case 'race':
      return <RaceEngine />;
      
    case 'best-of-series':
      return <SeriesEngine />;
      
    case 'traditional':
    default:
      return <TraditionalEngine />;
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
      <div className="p-8 text-center text-red-400">
        ID de partido inválido
      </div>
    );
  }

  return (
    // Proveemos el contexto a todo el árbol de componentes de LiveMatch
    <LiveMatchProvider matchId={matchId}>
      {/* Eliminamos <Layout> aquí para evitar el error de duplicidad y props inválidas */}
      <div className="h-full w-full">
         <EngineDispatcher />
      </div>
    </LiveMatchProvider>
  );
};

export default LiveMatch;