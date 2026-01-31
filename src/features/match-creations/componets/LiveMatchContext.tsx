import React, { createContext, useContext, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../db/db'; 

// Importar los repositorios
import { MatchesRepository } from '../../../db/matches.repository';
import { TeamsRepository } from '../../../db/teams.repository';

import type { Match } from '../../../db/models/Match';
import type { Team } from '../../../db/models/Team';
import type { Player } from '../../../db/models/Player';

export interface TeamWithPlayers extends Team {
  players: Player[];
}

export interface LiveMatchContextState {
  match: Match | undefined;
  localTeam: TeamWithPlayers | undefined;
  visitorTeam: TeamWithPlayers | undefined;
  isLoading: boolean;
  error: string | null;
}

const LiveMatchContext = createContext<LiveMatchContextState | undefined>(undefined);

export const LiveMatchProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { id } = useParams<{ id: string }>();
  const matchId = id ? parseInt(id, 10) : undefined;

  const matchData = useLiveQuery(async () => {
    if (!matchId || isNaN(matchId)) return null;

    // 1. CORREGIDO: Usar MatchesRepository.getById
    const match = await MatchesRepository.getById(matchId);
    
    if (!match) {
      throw new Error("Partido no encontrado");
    }

    // 2. CORREGIDO: Usar TeamsRepository.getById
    const [localTeamData, visitorTeamData] = await Promise.all([
      TeamsRepository.getById(match.localTeamId),
      TeamsRepository.getById(match.visitorTeamId)
    ]);

    if (!localTeamData || !visitorTeamData) {
       throw new Error("Datos de equipo corruptos o no encontrados");
    }

    // 3. Jugadores (Si aún no tienes repositorio de jugadores, usa db directamente o crea uno)
    const [localPlayers, visitorPlayers] = await Promise.all([
      db.players.where('teamId').equals(match.localTeamId).toArray(),
      db.players.where('teamId').equals(match.visitorTeamId).toArray()
    ]);

    const localTeam: TeamWithPlayers = {
      ...localTeamData,
      players: localPlayers
    };

    const visitorTeam: TeamWithPlayers = {
      ...visitorTeamData,
      players: visitorPlayers
    };

    return { match, localTeam, visitorTeam };

  }, [matchId]);

  const isLoading = matchData === undefined;
  
  const error = (!isLoading && !matchData) 
    ? "No se pudo cargar el partido. Verifica el ID." 
    : null;

  const value: LiveMatchContextState = {
    match: matchData?.match,
    localTeam: matchData?.localTeam,
    visitorTeam: matchData?.visitorTeam,
    isLoading,
    error
  };

  return (
    <LiveMatchContext.Provider value={value}>
      {children}
    </LiveMatchContext.Provider>
  );
};

export const useLiveMatch = (): LiveMatchContextState => {
  const context = useContext(LiveMatchContext);
  if (context === undefined) {
    throw new Error('useLiveMatch debe ser usado dentro de un LiveMatchProvider');
  }
  return context;
};