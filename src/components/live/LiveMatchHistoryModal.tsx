// src/components/live/LiveMatchHistoryModal.tsx
import { useState, useEffect, useContext } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { LiveMatchContext } from '../../features/match-creations/components/context/LiveMatchContext';
import { ModalLiveStatusPill } from './ModalLiveStatusPill';
import { X, Trash2, Clock, AlertCircle, Trophy, History, Lock, UserCheck } from 'lucide-react';
import { formatPeriodLabel, deleteMatchCascade } from '../../utils/matchHelpers';

interface LiveMatchHistoryModalProps {
  matchId: number;
  onClose: () => void;
}

type HistoryItem = {
  id: number;
  type: 'score' | 'foul';
  teamId: number;
  playerId?: number;
  points?: number;
  quarter: number;
  createdAt: Date;
};

export function LiveMatchHistoryModal({ matchId, onClose }: LiveMatchHistoryModalProps) {
  const navigate = useNavigate();
  const liveContext = useContext(LiveMatchContext);
  const registerOpenModal = liveContext?.registerOpenModal;

  useEffect(() => {
    if (!registerOpenModal) return;
    return registerOpenModal('live-history-modal');
  }, [registerOpenModal]);

  const [filterType, setFilterType] = useState<'all' | 'score' | 'foul'>('all');
  const [reassigningKey, setReassigningKey] = useState<string | null>(null);
  const [confirmDeleteMatch, setConfirmDeleteMatch] = useState(false);

  // 1. Obtenemos datos combinados
  const historyData = useLiveQuery(async () => {
    const [scores, fouls, players, teams, matchData] = await Promise.all([
      db.scores.where({ matchId }).toArray(),
      db.fouls.where({ matchId }).toArray(),
      db.players.toArray(),
      db.teams.toArray(),
      db.matches.get(matchId)
    ]);

    const playerMap = new Map(players.map(p => [p.id!, p]));
    const teamMap = new Map(teams.map(t => [t.id!, t]));
    const activePlayersByTeam = new Map<number, typeof players>();

    for (const p of players) {
      if (p.isArchived) continue;
      const list = activePlayersByTeam.get(p.teamId) || [];
      list.push(p);
      activePlayersByTeam.set(p.teamId, list);
    }

    const normalizedScores: HistoryItem[] = scores.map(s => ({
      id: s.id!,
      type: 'score',
      teamId: s.teamId,
      playerId: s.playerId,
      points: s.points,
      quarter: s.quarter,
      createdAt: s.createdAt
    }));

    const normalizedFouls: HistoryItem[] = fouls.map(f => ({
      id: f.id!,
      type: 'foul',
      teamId: f.teamId,
      playerId: f.playerId,
      quarter: f.quarter,
      createdAt: f.createdAt
    }));

    // Ordenar: Lo más reciente primero
    const combined = [...normalizedScores, ...normalizedFouls].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    const foulsByPlayer = new Map<number, number>();
    for (const f of fouls) {
      if (f.playerId === undefined) continue;
      foulsByPlayer.set(f.playerId, (foulsByPlayer.get(f.playerId) || 0) + 1);
    }

    const mode = matchData?.config?.mode || 'traditional';
    const totalQuarters = matchData?.config?.traditional?.totalQuarters || matchData?.totalQuarters || 4;

    let currentPeriod = matchData?.currentQuarter || 1;
    if (mode === 'race') {
      currentPeriod = matchData?.config?.race?.currentGame || 1;
    } else if (mode === 'best-of-series') {
      currentPeriod = matchData?.currentQuarter || matchData?.config?.bestOf?.currentGame || 1;
    }

    return {
      combined,
      playerMap,
      teamMap,
      activePlayersByTeam,
      foulsByPlayer,
      mode,
      totalQuarters,
      currentPeriod,
      localTeamId: matchData?.localTeamId
    };
  }, [matchId]);

  // 2. Eliminar acción en 1 toque (sin bloquear con confirm nativo)
  const handleDelete = async (item: HistoryItem) => {
    if (!historyData) return;
    const isLockedPeriod =
      (historyData.mode === 'race' || historyData.mode === 'best-of-series') &&
      item.quarter !== historyData.currentPeriod;

    if (isLockedPeriod) return;

    try {
      await db.transaction('rw', db.scores, db.fouls, db.matches, async () => {
        if (item.type === 'score') {
          await db.scores.delete(item.id);

          const match = await db.matches.get(matchId);
          if (match) {
            const isLocal = item.teamId === match.localTeamId;
            const update = isLocal
              ? { localScore: Math.max(0, (match.localScore || 0) - (item.points || 0)) }
              : { visitorScore: Math.max(0, (match.visitorScore || 0) - (item.points || 0)) };
            await db.matches.update(matchId, update);
          }
        } else {
          await db.fouls.delete(item.id);

          const match = await db.matches.get(matchId);
          if (match) {
            const isLocal = item.teamId === match.localTeamId;
            const update = isLocal
              ? { localFouls: Math.max(0, (match.localFouls || 0) - 1) }
              : { visitorFouls: Math.max(0, (match.visitorFouls || 0) - 1) };
            await db.matches.update(matchId, update);
          }
        }
      });
    } catch (err) {
      console.error('Error al eliminar', err);
    }
  };

  // 3. Reasignar jugador de una acción ya registrada
  const handleReassignPlayer = async (item: HistoryItem, newPlayerId: number | undefined) => {
    try {
      if (item.type === 'score') {
        await db.scores.update(item.id, { playerId: newPlayerId });
      } else {
        await db.fouls.update(item.id, { playerId: newPlayerId });
      }
      setReassigningKey(null);
    } catch (err) {
      console.error('Error al cambiar jugador de la acción:', err);
    }
  };

  const handleDeleteMatch = async () => {
    try {
      await deleteMatchCascade(matchId);
      onClose();
      navigate('/matches');
    } catch (err) {
      console.error('Error al eliminar el partido', err);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  if (!historyData) return null;
  const {
    combined,
    playerMap,
    teamMap,
    activePlayersByTeam,
    foulsByPlayer,
    mode,
    totalQuarters,
    currentPeriod,
    localTeamId
  } = historyData;

  const filteredItems = combined.filter(item =>
    filterType === 'all' ? true : item.type === filterType
  );

  // Etiqueta según el modo: Set (serie), Juego (reta) o Q/OT (tradicional)
  const getPeriodLabel = (period: number) => {
    if (mode === 'best-of-series') return `Set ${period}`;
    if (mode === 'race') return `Juego ${period}`;
    return formatPeriodLabel(period, totalQuarters);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content variant-info"
        style={{ height: '82dvh', maxHeight: '86dvh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header modal-header-with-status">
          <div className="modal-header-top-row">
            <div>
              <h3 className="modal-title flex-gap">
                <History size={22} color="var(--primary)" />
                Historial y Corrección de Jugadas
              </h3>
              <p className="modal-subtitle">
                Elimina una jugada con el basurero o toca el jugador para reasignarlo.
              </p>
            </div>
            <button type="button" onClick={onClose} className="btn-icon" aria-label="Cerrar">
              <X size={24} />
            </button>
          </div>
          <ModalLiveStatusPill />
        </div>

        {/* Barra de Filtros */}
        <div className="history-filter-bar">
          <button
            type="button"
            onClick={() => setFilterType('all')}
            className={`filter-pill-btn ${filterType === 'all' ? 'active' : ''}`}
          >
            Todas ({combined.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('score')}
            className={`filter-pill-btn ${filterType === 'score' ? 'active' : ''}`}
          >
            Puntos ({combined.filter(i => i.type === 'score').length})
          </button>
          <button
            type="button"
            onClick={() => setFilterType('foul')}
            className={`filter-pill-btn ${filterType === 'foul' ? 'active' : ''}`}
          >
            Faltas ({combined.filter(i => i.type === 'foul').length})
          </button>
        </div>

        {/* Lista Scrollable */}
        <div className="history-scroll-area">
          {filteredItems.length === 0 ? (
            <div className="history-empty">
              <Clock size={48} strokeWidth={1.2} />
              <p>No hay jugadas registradas en esta vista.</p>
            </div>
          ) : (
            <div className="history-list">
              {filteredItems.map(item => {
                const itemKey = `${item.type}-${item.id}`;
                const team = teamMap.get(item.teamId);
                const isLocalTeam = item.teamId === localTeamId;
                const player = item.playerId ? playerMap.get(item.playerId) : null;
                const teamPlayers = activePlayersByTeam.get(item.teamId) || [];
                const isScore = item.type === 'score';
                const isClosedPeriod =
                  (mode === 'race' || mode === 'best-of-series') &&
                  item.quarter !== currentPeriod;
                const isReassigning = reassigningKey === itemKey;

                return (
                  <div key={itemKey} className={`history-item-wrapper ${isScore ? 'is-score' : 'is-foul'}`}>
                    <div className="history-item">
                      <div className="action-info">
                        {/* Título: Qué pasó y para qué equipo */}
                        <div className="action-title">
                          {isScore ? (
                            <span className="history-action-pill score">
                              <Trophy size={13} /> +{item.points} PTS
                            </span>
                          ) : (
                            <span className="history-action-pill foul">
                              <AlertCircle size={13} /> FALTA
                            </span>
                          )}

                          <span className={`history-team-badge ${isLocalTeam ? 'local' : 'visitor'}`}>
                            {team?.name}
                          </span>

                          <span className="action-time">
                            {getPeriodLabel(item.quarter)} • {formatTime(item.createdAt)}
                          </span>
                        </div>

                        {/* Detalle: Jugador asignado (tocable para cambiar) */}
                        <div className="action-detail" style={{ marginTop: '0.2rem' }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (teamPlayers.length > 0) {
                                setReassigningKey(isReassigning ? null : itemKey);
                              }
                            }}
                            className="history-player-trigger"
                            title={teamPlayers.length > 0 ? 'Toca para cambiar el jugador asignado' : undefined}
                          >
                            {player ? (
                              <>
                                <span className="history-jersey-tag">
                                  #{player.number ?? '—'}
                                </span>
                                <span className="history-player-name">{player.name}</span>
                              </>
                            ) : (
                              <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                                Sin jugador asignado
                              </span>
                            )}
                            {teamPlayers.length > 0 && (
                              <span className="history-change-hint">
                                <UserCheck size={12} /> Cambiar
                              </span>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Botón Eliminar o Badge de periodo cerrado */}
                      <div className="flex-gap" style={{ gap: '0.5rem' }}>
                        {isClosedPeriod && (
                          <span
                            className="flex-gap text-muted"
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              padding: '0.25rem 0.55rem',
                              borderRadius: '999px',
                              backgroundColor: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid var(--border-color)',
                              gap: '0.25rem'
                            }}
                          >
                            <Lock size={11} />
                            Cerrado
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(item)}
                          disabled={isClosedPeriod}
                          className="btn-delete-action"
                          style={isClosedPeriod ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}
                          title={isClosedPeriod ? 'Set/Juego cerrado' : 'Eliminar esta acción'}
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>

                    {/* Selector rápido para reasignar jugador */}
                    {isReassigning && (
                      <div className="history-reassign-drawer">
                        <span className="history-reassign-label">Asignar jugada a:</span>
                        <div className="history-reassign-pills">
                          {teamPlayers.map(tp => {
                            const playerFouls = foulsByPlayer.get(tp.id!) || 0;
                            // Un jugador ya expulsado (>= 5 faltas) no puede recibir otra falta distinta a la actual.
                            const isExpelledTarget =
                              mode === 'traditional' &&
                              item.type === 'foul' &&
                              item.playerId !== tp.id &&
                              playerFouls >= 5;

                            return (
                              <button
                                key={tp.id}
                                type="button"
                                disabled={isExpelledTarget}
                                onClick={() => handleReassignPlayer(item, tp.id!)}
                                className={`history-reassign-btn ${item.playerId === tp.id ? 'active' : ''}`}
                                style={isExpelledTarget ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                                title={isExpelledTarget ? 'Jugador expulsado (5 faltas)' : undefined}
                              >
                                <strong>#{tp.number ?? '—'}</strong> {tp.name}
                                {item.type === 'foul' && ` · ${playerFouls} FAL`}
                                {isExpelledTarget && ' (EXP)'}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => handleReassignPlayer(item, undefined)}
                            className={`history-reassign-btn ${item.playerId === undefined ? 'active' : ''}`}
                          >
                            Sin jugador
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer" style={{ justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          {confirmDeleteMatch ? (
            <div className="flex-gap" style={{ width: '100%', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--danger)', fontWeight: 700 }}>
                ¿Borrar todo el partido?
              </span>
              <div className="flex-gap">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteMatch(false)}
                  className="btn btn-sm btn-secondary"
                >
                  No, cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDeleteMatch}
                  className="btn btn-sm btn-danger"
                >
                  Sí, eliminar
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setConfirmDeleteMatch(true)}
                className="btn btn-secondary"
                style={{
                  color: 'var(--danger)',
                  borderColor: 'rgba(244, 63, 94, 0.35)',
                  backgroundColor: 'rgba(244, 63, 94, 0.08)'
                }}
              >
                <Trash2 size={16} />
                Eliminar Partido
              </button>
              <button type="button" onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>
                Volver al Juego
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
