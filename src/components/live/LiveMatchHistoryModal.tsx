import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { X, Trash2, Clock, AlertCircle, Trophy, History } from 'lucide-react';

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

    return { combined, playerMap, teamMap };
  }, [matchId]);

  // 2. Función para eliminar y cerrar
  const handleDelete = async (item: HistoryItem) => {
    if (!confirm("¿Eliminar esta acción?")) return;

    try {
      await db.transaction('rw', db.scores, db.fouls, db.matches, async () => {
        // 1. Borrar la acción original
        if (item.type === 'score') {
          await db.scores.delete(item.id);

          // 🟢 NUEVO: Actualizar el Match restando los puntos
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

          // 🟢 NUEVO: Actualizar el Match restando la falta
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

      onClose();
    } catch (err) {
      console.error("Error al eliminar", err);
      alert("No se pudo eliminar la acción");
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  if (!historyData) return null;
  const { combined, playerMap, teamMap } = historyData;

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
            <h3 className="modal-title flex items-center gap-2">
              <History size={20} className="text-primary" />
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

        {/* Lista Scrollable con nuevas clases */}
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

                return (
                  <div key={`${item.type}-${item.id}`} className={`history-item ${isScore ? 'is-score' : 'is-foul'}`}>

                    <div className="action-info">
                      {/* Título: Qué pasó y para qué equipo */}
                      <span className="action-title">
                        {isScore ? (
                          <span className="text-green-400 flex items-center gap-1">
                            <Trophy size={14} /> +{item.points} Pts
                          </span>
                        ) : (
                          <span className="text-red-400 flex items-center gap-1">
                            <AlertCircle size={14} /> Falta
                          </span>
                        )}
                        <span className="text-muted font-normal">•</span>
                        <span className="text-main font-bold uppercase text-xs tracking-wide">
                          {team?.name}
                        </span>
                      </span>

                      {/* Detalle: Quién y Cuándo */}
                      <span className="action-detail">
                        <span className="action-time">Q{item.quarter} • {formatTime(item.createdAt)}</span>
                        <span>
                          {player ? (
                            <span className="text-gray-300">#{player.number} {player.name}</span>
                          ) : (
                            <span className="italic opacity-50">Desconocido</span>
                          )}
                        </span>
                      </span>
                    </div>

                    {/* Botón Eliminar */}
                    <button
                      onClick={() => handleDelete(item)}
                      className="btn-delete-action"
                      title="Eliminar esta acción"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer simple */}
        <div className="modal-footer">
          <button onClick={onClose} className="btn btn-secondary btn-full">
            Volver al Juego
          </button>
        </div>
      </div>
    </div>
  );
}