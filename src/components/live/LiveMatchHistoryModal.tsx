import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { X, Trash2, Clock, AlertCircle, Trophy } from 'lucide-react';

interface LiveMatchHistoryModalProps {
  matchId: number;
  onClose: () => void;
}

type HistoryItem = {
  id: number;
  type: 'score' | 'foul';
  teamId: number;
  playerId?: number;
  points?: number; // Solo para scores
  quarter: number;
  createdAt: Date;
};

export function LiveMatchHistoryModal({ matchId, onClose }: LiveMatchHistoryModalProps) {
  
  // 1. Obtenemos datos combinados
  const historyData = useLiveQuery(async () => {
    // Obtenemos scores y fouls
    const [scores, fouls, players, teams] = await Promise.all([
      db.scores.where({ matchId }).toArray(),
      db.fouls.where({ matchId }).toArray(),
      db.players.toArray(), // Traemos todos para mapear nombres rápido
      db.teams.toArray()
    ]);

    // Mapas para acceso rápido a nombres
    const playerMap = new Map(players.map(p => [p.id!, p]));
    const teamMap = new Map(teams.map(t => [t.id!, t]));

    // Normalizamos Scores
    const normalizedScores: HistoryItem[] = scores.map(s => ({
      id: s.id!,
      type: 'score',
      teamId: s.teamId,
      playerId: s.playerId,
      points: s.points,
      quarter: s.quarter,
      createdAt: s.createdAt
    }));

    // Normalizamos Fouls
    const normalizedFouls: HistoryItem[] = fouls.map(f => ({
      id: f.id!,
      type: 'foul',
      teamId: f.teamId,
      playerId: f.playerId,
      quarter: f.quarter,
      createdAt: f.createdAt
    }));

    // Unimos y ordenamos por fecha descendente (lo más nuevo arriba)
    const combined = [...normalizedScores, ...normalizedFouls].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );

    return { combined, playerMap, teamMap };
  }, [matchId]);

  // 2. Función para eliminar
  const handleDelete = async (item: HistoryItem) => {
    if (!confirm("¿Seguro que deseas eliminar esta acción?")) return;

    try {
      if (item.type === 'score') {
        await db.scores.delete(item.id);
      } else {
        await db.fouls.delete(item.id);
      }
      // Dexie y useLiveQuery actualizarán la lista automáticamente
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
        className="modal-content" 
        style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h3 className="modal-title flex-center gap-sm">
            <Clock size={20} className="text-primary" />
            Historial de Acciones
          </h3>
          <button onClick={onClose} className="btn-icon">
            <X size={24} />
          </button>
        </div>

        {/* Lista Scrollable */}
        <div style={{ overflowY: 'auto', paddingRight: '0.5rem' }}>
          {combined.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No hay acciones registradas aún.
            </div>
          ) : (
            <div className="history-action-list">
              {combined.map(item => {
                const team = teamMap.get(item.teamId);
                const player = item.playerId ? playerMap.get(item.playerId) : null;
                const isScore = item.type === 'score';

                return (
                  <div key={`${item.type}-${item.id}`} className={`history-item ${isScore ? 'is-score' : 'is-foul'}`}>
                    
                    <div className="action-info">
                      {/* Título: Qué pasó y para qué equipo */}
                      <span className="action-title flex items-center gap-2">
                        {isScore ? (
                          <span className="text-green-400 flex items-center gap-1">
                            <Trophy size={14} /> +{item.points} Pts
                          </span>
                        ) : (
                          <span className="text-red-400 flex items-center gap-1">
                            <AlertCircle size={14} /> Falta
                          </span>
                        )}
                        <span className="text-gray-500">•</span>
                        <span className="text-gray-300">{team?.name}</span>
                      </span>

                      {/* Detalle: Quién y Cuándo */}
                      <span className="action-detail">
                        <span className="action-time">Q{item.quarter} - {formatTime(item.createdAt)}</span>
                        <span>{player ? `#${player.number || ''} ${player.name}` : '(Jugador Desconocido)'}</span>
                      </span>
                    </div>

                    <button 
                      onClick={() => handleDelete(item)}
                      className="btn-delete-action"
                      title="Eliminar esta acción"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button onClick={onClose} className="modal-footer">
          Cerrar
        </button>
      </div>
    </div>
  );
}