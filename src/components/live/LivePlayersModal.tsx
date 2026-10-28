// src/components/live/LivePlayersModal.tsx
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { renameTeamSafely } from '../../utils/matchHelpers';
import { useLiveMatch, type TeamWithPlayers } from '../../features/match-creations/components/context/LiveMatchContext';
import { useGameActions } from '../../features/match-creations/hooks/useGameActions';
import { X, Users, UserPlus, AlertCircle, Check, Pencil } from 'lucide-react';

interface LivePlayersModalProps {
  onClose: () => void;
  foulLimit?: number;
  scoringOptions?: (1 | 2 | 3)[];
}

export function LivePlayersModal({
  onClose,
  foulLimit = 5,
  scoringOptions = [1, 2, 3]
}: LivePlayersModalProps) {
  const { match, localTeam, visitorTeam } = useLiveMatch();
  const { addScore, addFoul } = useGameActions();

  const [activeTab, setActiveTab] = useState<'local' | 'visitor'>('local');
  const [addingForTeamId, setAddingForTeamId] = useState<number | null>(null);
  const [newNumber, setNewNumber] = useState('');
  const [newName, setNewName] = useState('');
  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [teamNameDraft, setTeamNameDraft] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const matchId = match?.id;

  const statsData = useLiveQuery(async () => {
    const foulsMap = new Map<number, number>();
    const pointsMap = new Map<number, number>();
    if (!matchId) return { foulsMap, pointsMap };

    const [fouls, scores] = await Promise.all([
      db.fouls.where({ matchId }).toArray(),
      db.scores.where({ matchId }).toArray()
    ]);

    for (const f of fouls) {
      if (f.playerId !== undefined) {
        foulsMap.set(f.playerId, (foulsMap.get(f.playerId) || 0) + 1);
      }
    }
    for (const s of scores) {
      if (s.playerId !== undefined) {
        pointsMap.set(s.playerId, (pointsMap.get(s.playerId) || 0) + s.points);
      }
    }

    return { foulsMap, pointsMap };
  }, [matchId]) ?? { foulsMap: new Map<number, number>(), pointsMap: new Map<number, number>() };

  if (!match || !localTeam || !visitorTeam) return null;

  const showToast = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => {
      setFeedbackMsg(prev => (prev === msg ? null : prev));
    }, 1800);
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => {
      setErrorMsg(prev => (prev === msg ? null : prev));
    }, 3500);
  };

  const handleQuickScore = async (teamId: number, playerId: number, playerName: string, pts: 1 | 2 | 3) => {
    await addScore(teamId, pts, playerId);
    showToast(`+${pts} PTS para ${playerName}`);
  };

  const handleQuickFoul = async (teamId: number, playerId: number, playerName: string) => {
    await addFoul(teamId, playerId);
    showToast(`Falta asignada a ${playerName}`);
  };

  const handleAddPlayer = async (teamId: number) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const parsedNum = newNumber.trim() !== '' ? parseInt(newNumber.trim(), 10) : undefined;

    if (parsedNum !== undefined && !isNaN(parsedNum)) {
      const duplicated = await db.players
        .where({ teamId })
        .filter(p => !p.isArchived && p.number === parsedNum)
        .first();
      if (duplicated) {
        showError(`El dorsal #${parsedNum} ya lo tiene ${duplicated.name} en este equipo.`);
        return;
      }
    }

    await db.players.add({
      name: trimmed,
      number: parsedNum !== undefined && !isNaN(parsedNum) ? parsedNum : undefined,
      teamId,
      createdAt: new Date(),
      isArchived: false
    });

    setNewName('');
    setNewNumber('');
    setAddingForTeamId(null);
    showToast(`Jugador ${trimmed} agregado`);
  };

  const handleSaveTeamName = async (teamId: number) => {
    const rivalTeamId = teamId === match?.localTeamId ? match?.visitorTeamId : match?.localTeamId;
    const result = await renameTeamSafely(teamId, teamNameDraft, rivalTeamId);
    if (!result.ok) {
      showError(result.error ?? 'No se pudo renombrar el equipo.');
      return;
    }
    setEditingTeamId(null);
    showToast('Nombre de equipo actualizado');
  };

  const renderTeamRoster = (team: TeamWithPlayers, side: 'local' | 'visitor') => {
    const isLocal = side === 'local';
    const accentColor = isLocal ? 'var(--secondary-light)' : 'var(--primary-light)';
    const isAddingHere = addingForTeamId === team.id;
    const isEditingName = editingTeamId === team.id;

    return (
      <div className={`live-roster-column ${side}`}>
        {/* Cabecera del Equipo */}
        <div className="live-roster-team-header">
          <div className="flex-gap" style={{ minWidth: 0, flex: 1 }}>
            <span className={`live-roster-side-tag ${side}`}>
              {isLocal ? 'LOCAL' : 'VISITA'}
            </span>

            {isEditingName ? (
              <div className="flex-gap" style={{ flex: 1 }}>
                <input
                  type="text"
                  value={teamNameDraft}
                  onChange={e => setTeamNameDraft(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveTeamName(team.id!)}
                  className="input"
                  style={{ padding: '0.35rem 0.6rem', fontSize: '0.9rem', height: 'auto' }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => handleSaveTeamName(team.id!)}
                  className="btn btn-xs btn-primary"
                >
                  <Check size={14} />
                </button>
              </div>
            ) : (
              <h4
                className="live-roster-team-title"
                style={{ color: accentColor }}
                onClick={() => {
                  setEditingTeamId(team.id!);
                  setTeamNameDraft(team.name);
                }}
                title="Toca para renombrar el equipo"
              >
                <span>{team.name}</span>
                <Pencil size={13} style={{ opacity: 0.5, flexShrink: 0 }} />
              </h4>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setAddingForTeamId(isAddingHere ? null : team.id!);
              setNewName('');
              setNewNumber('');
            }}
            className="btn btn-xs btn-secondary"
            style={{ borderColor: `${accentColor}44`, color: accentColor }}
          >
            <UserPlus size={14} />
            <span>+ Jugador</span>
          </button>
        </div>

        {/* Formulario inline para agregar jugador */}
        {isAddingHere && (
          <div className="pm-quick-add-bar" style={{ margin: '0 0 0.75rem 0', borderRadius: 'var(--radius-sm)' }}>
            <div className="pm-quick-add-inputs">
              <input
                type="number"
                min="0"
                max="99"
                placeholder="#"
                value={newNumber}
                onChange={e => setNewNumber(e.target.value)}
                className="input pm-input-num"
              />
              <input
                type="text"
                placeholder="Nombre del jugador..."
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddPlayer(team.id!)}
                className="input pm-input-name"
                autoFocus
              />
              <button
                type="button"
                disabled={!newName.trim()}
                onClick={() => handleAddPlayer(team.id!)}
                className="btn btn-sm btn-primary"
              >
                <Check size={16} />
                Guardar
              </button>
            </div>
          </div>
        )}

        {/* Lista de Jugadores con Botones de Acción Directa */}
        {team.players.length === 0 ? (
          <div className="live-roster-empty">
            <Users size={32} strokeWidth={1.3} />
            <p>Sin jugadores registrados en {team.name}.</p>
            <button
              type="button"
              onClick={() => setAddingForTeamId(team.id!)}
              className="btn btn-sm btn-secondary"
            >
              <UserPlus size={15} />
              Agregar primer jugador
            </button>
          </div>
        ) : (
          <div className="live-roster-cards">
            {team.players.map(player => {
              const pts = statsData.pointsMap.get(player.id!) || 0;
              const fouls = statsData.foulsMap.get(player.id!) || 0;
              const isExpelled = foulLimit !== undefined && fouls >= foulLimit;
              const isWarning = !isExpelled && foulLimit !== undefined && fouls === foulLimit - 1;

              return (
                <div
                  key={player.id}
                  className={`live-roster-player-card ${side} ${isExpelled ? 'is-expelled' : ''}`}
                >
                  <div className="live-roster-player-main">
                    <div className={`live-roster-jersey ${side}`}>
                      <span>#{player.number !== undefined ? player.number : '—'}</span>
                    </div>

                    <div className="live-roster-player-info">
                      <span className="live-roster-player-name">{player.name}</span>
                      <div className="live-roster-player-badges">
                        <span className={`pm-stat-chip pts ${pts > 0 ? 'has-pts' : ''}`}>
                          {pts} PTS
                        </span>
                        <span
                          className={`pm-stat-chip fouls ${
                            isExpelled ? 'expelled' : isWarning ? 'warning' : fouls > 0 ? 'has-fouls' : ''
                          }`}
                        >
                          {isExpelled ? `${fouls} FAL (EXP)` : `${fouls} FAL`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Acciones rápidas en 1 toque directamente sobre el jugador */}
                  <div className="live-roster-quick-actions">
                    {scoringOptions.map(pt => (
                      <button
                        key={pt}
                        type="button"
                        disabled={isExpelled}
                        onClick={() => handleQuickScore(team.id!, player.id!, player.name, pt)}
                        className={`roster-quick-btn score-${side}`}
                        title={`Sumar +${pt} a ${player.name}`}
                      >
                        +{pt}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={isExpelled}
                      onClick={() => handleQuickFoul(team.id!, player.id!, player.name)}
                      className="roster-quick-btn foul"
                      title={`Registrar falta a ${player.name}`}
                    >
                      <AlertCircle size={13} />
                      FAL
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content variant-live-roster"
        onClick={e => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="modal-header">
          <div>
            <h3 className="modal-title flex-gap">
              <Users size={22} color="var(--primary)" />
              Jugadores en Cancha y Estadísticas
            </h3>
            <p className="modal-subtitle">
              Anota directo por jugador, revisa faltas/puntos o agrega jugadores al partido.
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-icon" aria-label="Cerrar">
            <X size={22} />
          </button>
        </div>

        {/* TABS MÓVILES PARA ALTERNAR EQUIPO (En Desktop se ven ambos lado a lado) */}
        <div className="live-roster-mobile-tabs">
          <button
            type="button"
            onClick={() => setActiveTab('local')}
            className={`roster-tab-btn local ${activeTab === 'local' ? 'active' : ''}`}
          >
            <span>LOCAL • {localTeam.name}</span>
            <span className="roster-tab-count">{localTeam.players.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('visitor')}
            className={`roster-tab-btn visitor ${activeTab === 'visitor' ? 'active' : ''}`}
          >
            <span>VISITA • {visitorTeam.name}</span>
            <span className="roster-tab-count">{visitorTeam.players.length}</span>
          </button>
        </div>

        {/* TOAST DE CONFIRMACIÓN RÁPIDA */}
        {feedbackMsg && (
          <div className="live-roster-toast">
            <Check size={15} />
            <span>{feedbackMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="live-roster-toast" role="alert" style={{ background: 'var(--danger)', color: '#fff' }}>
            <AlertCircle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* CUERPO: 1 COLUMNA EN MÓVIL (SEGÚN TAB), 2 COLUMNAS EN DESKTOP */}
        <div className="modal-body live-roster-body">
          <div className={`live-roster-grid active-${activeTab}`}>
            {renderTeamRoster(localTeam, 'local')}
            {renderTeamRoster(visitorTeam, 'visitor')}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" onClick={onClose} className="btn btn-secondary btn-full">
            Volver al Partido
          </button>
        </div>
      </div>
    </div>
  );
}
