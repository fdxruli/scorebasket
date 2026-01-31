import React, { createContext, useContext, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../../db/db';
import type { Match } from '../../../../db/models/Match';
import type { Team } from '../../../../db/models/Team';
import type { Player } from '../../../../db/models/Player';

// --- 1. Definición de Interfaces Extendidas ---

/**
 * Extensión de la interfaz Team estándar.
 * Incluye el array de jugadores cargado desde la BD.
 */
export interface TeamWithPlayers extends Team {
  players: Player[];
}

interface LiveMatchContextState {
  match: Match | undefined;
  localTeam: TeamWithPlayers | undefined;
  visitorTeam: TeamWithPlayers | undefined;
  isLoading: boolean;
  error: string | null;
}

interface LiveMatchProviderProps {
  matchId: number;
  children: ReactNode;
}

// --- 2. Creación del Contexto ---

const LiveMatchContext = createContext<LiveMatchContextState | undefined>(undefined);

// --- 3. Provider Component ---

export const LiveMatchProvider: React.FC<LiveMatchProviderProps> = ({ matchId, children }) => {

  // --- Carga de Datos Atómica (Reactive) ---
  const data = useLiveQuery(async () => {
    // a. Obtener el partido
    const matchData = await db.matches.get(matchId);
    
    // Si no existe el partido, retornamos null inmediatamente para manejarlo abajo
    if (!matchData) return null;

    // b. Obtener equipos y jugadores en paralelo (Promesas)
    // Usamos Promise.all para maximizar la velocidad de E/S
    const [localTeamData, visitorTeamData, localPlayersData, visitorPlayersData] = await Promise.all([
      db.teams.get(matchData.localTeamId),
      db.teams.get(matchData.visitorTeamId),
      db.players.where('teamId').equals(matchData.localTeamId).sortBy('number'), // Orden opcional por número
      db.players.where('teamId').equals(matchData.visitorTeamId).sortBy('number')
    ]);

    // c. Validar integridad referencial básica
    if (!localTeamData || !visitorTeamData) {
      throw new Error("Integridad de datos corrupta: Faltan equipos asociados al partido.");
    }

    // d. Construir objetos TeamWithPlayers
    const localTeamFull: TeamWithPlayers = {
      ...localTeamData,
      players: localPlayersData
    };

    const visitorTeamFull: TeamWithPlayers = {
      ...visitorTeamData,
      players: visitorPlayersData
    };

    // e. Retornar estructura completa
    return {
      match: matchData,
      localTeam: localTeamFull,
      visitorTeam: visitorTeamFull
    };

  }, [matchId]);

  // --- Lógica de Estado y Errores ---

  // Si data es undefined, Dexie está cargando inicialmente
  const isLoading = data === undefined;
  
  // Si data es null (retornado explícitamente), el partido no existe
  const notFound = !isLoading && data === null;

  // Manejo de error general (puede venir de la query o del estado null)
  let error: string | null = null;
  if (notFound) error = "El partido no fue encontrado.";
  // Nota: useLiveQuery captura excepciones internas y devuelve undefined o error en consola, 
  // para producción podrías agregar un estado de error explícito con try/catch dentro de la query si lo requieres.

  const value: LiveMatchContextState = {
    match: data?.match,
    localTeam: data?.localTeam,
    visitorTeam: data?.visitorTeam,
    isLoading,
    error
  };

  return (
    <LiveMatchContext.Provider value={value}>
      {children}
    </LiveMatchContext.Provider>
  );
};

// --- 4. Custom Hook ---

export const useLiveMatch = (): LiveMatchContextState => {
  const context = useContext(LiveMatchContext);
  
  if (context === undefined) {
    throw new Error('useLiveMatch debe ser usado dentro de un LiveMatchProvider');
  }
  
  return context;
};