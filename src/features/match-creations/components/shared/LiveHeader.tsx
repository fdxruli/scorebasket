// src/features/match-creations/components/shared/LiveHeader.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, RotateCcw, History, Users, Trophy, AlertCircle } from 'lucide-react';
import { useGameActions } from '../../hooks/useGameActions';
import { useLiveMatch } from '../context/LiveMatchContext';
import { LiveMatchHistoryModal } from '../../../../components/live/LiveMatchHistoryModal';
import { LivePlayersModal } from '../../../../components/live/LivePlayersModal';
import { formatPeriodLabel } from '../../../../utils/matchHelpers';
import { db } from '../../../../db/db';

export const LiveHeader: React.FC = () => {
  const navigate = useNavigate();
  const { undoLastAction } = useGameActions();
  const { match, localTeam, visitorTeam, setActionModalOpen } = useLiveMatch();
  const [showHistory, setShowHistory] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);

  useEffect(() => {
    setActionModalOpen('live-header-history', showHistory);
    return () => setActionModalOpen('live-header-history', false);
  }, [showHistory, setActionModalOpen]);

  useEffect(() => {
    setActionModalOpen('live-header-players', showPlayers);
    return () => setActionModalOpen('live-header-players', false);
  }, [showPlayers, setActionModalOpen]);

  const mode = match?.config?.mode || 'traditional';
  const currentQuarter = match?.currentQuarter || 1;
  const totalQuarters = match?.config?.traditional?.totalQuarters || match?.totalQuarters || 4;

  const scoringSystem =
    mode === 'race'
      ? match?.config?.race?.scoringSystem
      : mode === 'best-of-series'
        ? match?.config?.bestOf?.scoringSystem
        : 'standard';

  const scoringOptions: (1 | 2 | 3)[] = scoringSystem === 'street' ? [1, 2] : [1, 2, 3];

  const getStatusText = () => {
    if (mode === 'race') {
      return `RETA A ${match?.config?.race?.targetScore || 21} PTS`;
    }
    if (mode === 'best-of-series') {
      return `SERIE • SET ${currentQuarter}`;
    }
    return `EN CANCHA • ${formatPeriodLabel(currentQuarter, totalQuarters)}`;
  };

  // Consultar la última acción del periodo/juego actual para mostrar feedback inmediato
  const lastPlay = useLiveQuery(async () => {
    if (!match?.id) return null;

    let currentPeriod = match.currentQuarter || 1;
    if (mode === 'race') {
      currentPeriod = match.config?.race?.currentGame || 1;
    } else if (mode === 'best-of-series') {
      currentPeriod = match.currentQuarter || match.config?.bestOf?.currentGame || 1;
    }

    const [scores, fouls] = await Promise.all([
      db.scores.where('matchId').equals(match.id).toArray(),
      db.fouls.where('matchId').equals(match.id).toArray()
    ]);

    const periodScores = scores.filter(s => s.quarter === currentPeriod);
    const periodFouls = fouls.filter(f => f.quarter === currentPeriod);

    const latestScore = [...periodScores].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const latestFoul = [...periodFouls].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    if (!latestScore && !latestFoul) return null;

    const isScoreLatest =
      latestScore && (!latestFoul || latestScore.createdAt.getTime() >= latestFoul.createdAt.getTime());

    const item = isScoreLatest ? latestScore : latestFoul!;
    const player = item.playerId ? await db.players.get(item.playerId) : undefined;
    const isLocal = item.teamId === match.localTeamId;
    const teamName = isLocal ? localTeam?.name : visitorTeam?.name;

    return {
      type: isScoreLatest ? ('score' as const) : ('foul' as const),
      points: isScoreLatest ? latestScore.points : undefined,
      player,
      teamName,
      isLocal
    };
  }, [match?.id, match?.localScore, match?.visitorScore, match?.localFouls, match?.visitorFouls, match?.currentQuarter, localTeam?.name, visitorTeam?.name]);

  const totalPlayersCount = (localTeam?.players?.length || 0) + (visitorTeam?.players?.length || 0);

  return (
    <>
      <header className="live-header">
        {/* Botón Volver */}
        <button
          type="button"
          onClick={() => navigate('/matches')}
          className="live-btn-icon"
          title="Volver a Partidos"
          aria-label="Volver a Partidos"
        >
          <ChevronLeft size={24} />
        </button>

        {/* Indicador Central de Transmisión */}
        <div className="live-header-center">
          <div className="live-badge active">
            <span
              className="pulse-dot"
              style={{ backgroundColor: 'var(--success)', boxShadow: '0 0 8px var(--success)' }}
            />
            {getStatusText()}
          </div>
        </div>

        {/* Acciones Rápidas: Chicharra, Sonido, Jugadores, Historial, Deshacer */}
        <div className="live-header-actions">
          <button
            type="button"
            onClick={() => setShowPlayers(true)}
            className="live-btn-icon"
            title="Ver y gestionar jugadores y estadísticas en vivo"
            aria-label="Jugadores y estadísticas"
          >
            <Users size={20} />
            {totalPlayersCount > 0 && (
              <span className="live-btn-pill-count live-btn-badge">{totalPlayersCount}</span>
            )}
          </button>

          {match?.id && (
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              className="live-btn-icon"
              title="Historial y corrección de jugadas"
              aria-label="Historial de jugadas"
            >
              <History size={20} />
            </button>
          )}

          <button
            type="button"
            onClick={undoLastAction}
            className="live-btn-icon"
            title="Deshacer última acción"
            aria-label="Deshacer última acción"
          >
            <RotateCcw size={20} />
          </button>
        </div>
      </header>

      {/* BARRA DE ÚLTIMA JUGADA REGISTRADA (Confirmación visual inmediata + Deshacer en 1 toque) */}
      {lastPlay && (
        <div className="live-last-play-bar">
          <div className="last-play-content" onClick={() => setShowHistory(true)} title="Toca para abrir el historial y editar">
            <span className="last-play-tag">Última:</span>
            {lastPlay.type === 'score' ? (
              <span className="last-play-badge score">
                <Trophy size={12} /> +{lastPlay.points} PTS
              </span>
            ) : (
              <span className="last-play-badge foul">
                <AlertCircle size={12} /> FALTA
              </span>
            )}
            <span className={`last-play-team ${lastPlay.isLocal ? 'local' : 'visitor'}`}>
              {lastPlay.teamName}
            </span>
            {lastPlay.player ? (
              <span className="last-play-player">
                <strong>#{lastPlay.player.number ?? '—'}</strong> {lastPlay.player.name}
              </span>
            ) : (
              <span className="last-play-player muted">Sin jugador</span>
            )}
          </div>

          <button
            type="button"
            onClick={undoLastAction}
            className="last-play-undo-btn"
            title="Deshacer esta jugada"
            aria-label="Deshacer esta jugada"
          >
            <RotateCcw size={13} />
            <span>Deshacer</span>
          </button>
        </div>
      )}

      {showHistory && match?.id && (
        <LiveMatchHistoryModal
          matchId={match.id}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showPlayers && (
        <LivePlayersModal
          onClose={() => setShowPlayers(false)}
          foulLimit={mode === 'traditional' ? 5 : undefined}
          scoringOptions={scoringOptions}
        />
      )}
    </>
  );
};
