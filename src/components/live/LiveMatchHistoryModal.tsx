import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db/db';
import { X, Trash2, Clock, AlertCircle, Trophy, History, Lock } from 'lucide-react';
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

  // 1. Obtenemos datos combinados
  const historyData = useLiveQuery(async () => {
    const [scores, fouls, players, teams] = await Promise.all([
      db.scores.where({ matchId }).toArray(),
      db.fouls.where({ matchId }).toArray(),
      db.players.toArray(),
      db.teams.toArray()
    ]);

    const playerMap = new Map(players.map(p => [p.id!, p]));
    const teamMap = new Map(teams.map(t => [t.id!, t]));

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

    const matchData = await db.matches.get(matchId);
    const mode = matchData?.config?.mode || 'traditional';
    const totalQuarters = matchData?.config?.traditional?.totalQuarters || matchData?.totalQuarters || 4;

    let currentPeriod = matchData?.currentQuarter || 1;
    if (mode === 'race') {
      currentPeriod = matchData?.config?.race?.currentGame || 1;
    } else if (mode === 'best-of-series') {
      currentPeriod = matchData?.currentQuarter || matchData?.config?.bestOf?.currentGame || 1;
    }

    return { combined, playerMap, teamMap, mode, totalQuarters, currentPeriod };
  }, [matchId]);

  // 2. Función para eliminar acción
  const handleDelete = async (item: HistoryItem) => {
    if (!historyData) return;
    const isLockedPeriod =
      (historyData.mode === 'race' || historyData.mode === 'best-of-series') &&
      item.quarter !== historyData.currentPeriod;

    if (isLockedPeriod) return;
    if (!confirm("¿Eliminar esta acción?")) return;

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
      console.error("Error al eliminar", err);
      alert("No se pudo eliminar la acción");
    }
  };

  const handleDeleteMatch = async () => {
    if (!window.confirm('¿Eliminar permanentemente este partido y todas sus estadísticas?')) return;
    try {
      await deleteMatchCascade(matchId);
      onClose();
      navigate('/matches');
    } catch (err) {
      console.error("Error al eliminar el partido", err);
      alert("No se pudo eliminar el partido");
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  if (!historyData) return null;
  const { combined, playerMap, teamMap, mode, totalQuarters, currentPeriod } = historyData;

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
        style={{ height: '75vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 className="modal-title flex-gap">
              <History size={20} color="var(--primary)" />
              Historial del Partido
            </h3>
            <p className="modal-subtitle">
              Toca el icono de basura para deshacer una acción.
            </p>
          </div>
          <button onClick={onClose} className="btn-icon">
            <X size={24} />
          </button>
        </div>

        {/* Lista Scrollable */}
        <div className="history-scroll-area">
          {combined.length === 0 ? (
            <div className="history-empty">
              <Clock size={48} strokeWidth={1} />
              <p>No hay acciones registradas aún.</p>
            </div>
          ) : (
            <div className="history-list">
              {combined.map(item => {
                const team = teamMap.get(item.teamId);
                const player = item.playerId ? playerMap.get(item.playerId) : null;
                const isScore = item.type === 'score';
                const isClosedPeriod =
                  (mode === 'race' || mode === 'best-of-series') &&
                  item.quarter !== currentPeriod;

                return (
                  <div key={`${item.type}-${item.id}`} className={`history-item ${isScore ? 'is-score' : 'is-foul'}`}>

                    <div className="action-info">
                      {/* Título: Qué pasó y para qué equipo */}
                      <span className="action-title">
                        {isScore ? (
                          <span className="flex-gap text-success" style={{ gap: '0.25rem' }}>
                            <Trophy size={14} /> +{item.points} Pts
                          </span>
                        ) : (
                          <span className="flex-gap text-danger" style={{ gap: '0.25rem' }}>
                            <AlertCircle size={14} /> Falta
                          </span>
                        )}
                        <span className="text-muted" style={{ fontWeight: 400 }}>•</span>
                        <span
                          className="text-main font-bold uppercase"
                          style={{ fontSize: '0.75rem', letterSpacing: '0.025em' }}
                        >
                          {team?.name}
                        </span>
                      </span>

                      {/* Detalle: Quién y Cuándo */}
                      <span className="action-detail">
                        <span className="action-time">{getPeriodLabel(item.quarter)} • {formatTime(item.createdAt)}</span>
                        <span>
                          {player ? (
                            <span style={{ color: '#d4d4d8' }}>#{player.number} {player.name}</span>
                          ) : (
                            <span style={{ fontStyle: 'italic', opacity: 0.6 }}>Sin jugador asignado</span>
                          )}
                        </span>
                      </span>
                    </div>

                    {/* Botón Eliminar o Badge de periodo cerrado */}
                    <div className="flex-gap" style={{ gap: '0.5rem' }}>
                      {isClosedPeriod && (
                        <span
                          className="flex-gap text-muted"
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '0.2rem 0.5rem',
                            borderRadius: '999px',
                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid var(--border-color)',
                            gap: '0.25rem'
                          }}
                        >
                          <Lock size={11} />
                          Set/Juego cerrado
                        </span>
                      )}
                      <button
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
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer" style={{ justifyContent: 'space-between', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={handleDeleteMatch}
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
          <button onClick={onClose} className="btn btn-secondary" style={{ flex: 1 }}>
            Volver al Juego
          </button>
        </div>
      </div>
    </div>
  );
}
