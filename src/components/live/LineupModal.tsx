// src/components/live/LineupModal.tsx
import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { PlayersRepository } from '../../db/players.repository';
import {
  LineupService,
  REQUIRED_ON_COURT_PLAYERS,
  isLineupActive,
  getTeamOnCourtIds,
  partitionTeamPlayersByLineup
} from '../../db/lineups.service';
import type { MatchLineups } from '../../db/models/Match';
import { useLiveMatch, type TeamWithPlayers } from '../../features/match-creations/components/context/LiveMatchContext';
import { ModalLiveStatusPill } from './ModalLiveStatusPill';
import {
  X,
  Shirt,
  UserPlus,
  AlertCircle,
  Check,
  ArrowLeftRight,
  Clock,
  Users
} from 'lucide-react';

interface LineupModalProps {
  onClose: () => void;
  isTimerRunning?: boolean;
  onLineupsActivated?: () => void;
  foulLimit?: number;
}

interface TeamSubDraft {
  outId: number | null;
  inId: number | null;
  capturedVersion?: number;
}

export function LineupModal({
  onClose,
  isTimerRunning = false,
  onLineupsActivated,
  foulLimit = 5
}: LineupModalProps) {
  const { match, localTeam, visitorTeam, registerOpenModal } = useLiveMatch();
  const inFlightRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return registerOpenModal('live-lineup-modal');
  }, [registerOpenModal]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    };
  }, []);

  const [activeTab, setActiveTab] = useState<'local' | 'visitor'>('local');
  const [addingForTeamId, setAddingForTeamId] = useState<number | null>(null);
  const [newNumber, setNewNumber] = useState('');
  const [newName, setNewName] = useState('');
  const [isAddingPlayer, setIsAddingPlayer] = useState(false);

  const [localSelectedStarters, setLocalSelectedStarters] = useState<number[]>([]);
  const [visitorSelectedStarters, setVisitorSelectedStarters] = useState<number[]>([]);
  const [starterCapturedVersion, setStarterCapturedVersion] = useState<number | undefined>(
    () => match?.lineups?.version
  );

  const [subDrafts, setSubDrafts] = useState<Record<'local' | 'visitor', TeamSubDraft>>({
    local: { outId: null, inId: null, capturedVersion: undefined },
    visitor: { outId: null, inId: null, capturedVersion: undefined }
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [committedLineups, setCommittedLineups] = useState<MatchLineups | undefined>(undefined);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const matchId = match?.id;

  const effectiveMatch =
    match && committedLineups && (committedLineups.version ?? 0) > (match.lineups?.version ?? 0)
      ? { ...match, lineups: committedLineups }
      : match;

  const lineupsActive = isLineupActive(effectiveMatch);

  const statsData = useLiveQuery(async () => {
    const foulsMap = new Map<number, number>();
    const pointsMap = new Map<number, number>();
    if (!matchId || !lineupsActive) return { foulsMap, pointsMap };

    const [fouls, scores] = await Promise.all([
      db.fouls.where('matchId').equals(matchId).toArray(),
      db.scores.where('matchId').equals(matchId).toArray()
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
  }, [matchId, lineupsActive]) ?? { foulsMap: new Map<number, number>(), pointsMap: new Map<number, number>() };

  if (!match || !localTeam || !visitorTeam || !effectiveMatch) return null;

  const clockRunning = Boolean(isTimerRunning || effectiveMatch.timerLastStart);

  const localActiveIds = new Set(localTeam.players.map(p => p.id!));
  const visitorActiveIds = new Set(visitorTeam.players.map(p => p.id!));

  const validLocalStarters = localSelectedStarters.filter(id => localActiveIds.has(id));
  const validVisitorStarters = visitorSelectedStarters.filter(id => visitorActiveIds.has(id));

  const localNeedsPlayers = localTeam.players.length < REQUIRED_ON_COURT_PLAYERS;
  const visitorNeedsPlayers = visitorTeam.players.length < REQUIRED_ON_COURT_PLAYERS;
  const anyTeamIncomplete = localNeedsPlayers || visitorNeedsPlayers;

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setErrorMsg(null);
    setFeedbackMsg(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setFeedbackMsg(prev => (prev === msg ? null : prev));
    }, 2400);
  };

  const showError = (msg: string) => {
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    setFeedbackMsg(null);
    setErrorMsg(msg);
    errorTimeoutRef.current = setTimeout(() => {
      setErrorMsg(prev => (prev === msg ? null : prev));
    }, 4500);
  };

  const handleAddPlayer = async (teamId: number) => {
    const trimmed = newName.trim();
    if (!trimmed || isAddingPlayer || inFlightRef.current) return;

    setIsAddingPlayer(true);
    try {
      await PlayersRepository.create({
        teamId,
        name: trimmed,
        number: newNumber
      });

      setNewName('');
      setNewNumber('');
      setAddingForTeamId(null);
      showToast(`Jugador ${trimmed} agregado`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al agregar jugador.';
      showError(msg);
    } finally {
      setIsAddingPlayer(false);
    }
  };

  const handleToggleStarter = (side: 'local' | 'visitor', playerId: number, teamName: string) => {
    if (inFlightRef.current || isSubmitting) return;
    setErrorMsg(null);

    if (starterCapturedVersion === undefined && match.lineups?.version !== undefined) {
      setStarterCapturedVersion(match.lineups.version);
    }

    const currentList = side === 'local' ? validLocalStarters : validVisitorStarters;
    const setList = side === 'local' ? setLocalSelectedStarters : setVisitorSelectedStarters;

    if (currentList.includes(playerId)) {
      setList(currentList.filter(id => id !== playerId));
      return;
    }

    if (currentList.length >= REQUIRED_ON_COURT_PLAYERS) {
      showError(
        `Ya seleccionaste ${REQUIRED_ON_COURT_PLAYERS} titulares para ${teamName}. Desmarca uno si deseas cambiarlo.`
      );
      return;
    }

    setList([...currentList, playerId]);
  };

  const handleSelectFirstFive = (side: 'local' | 'visitor', team: TeamWithPlayers) => {
    if (inFlightRef.current || isSubmitting) return;
    setErrorMsg(null);
    const firstFive = team.players
      .slice(0, REQUIRED_ON_COURT_PLAYERS)
      .map(p => p.id!)
      .filter((id): id is number => id !== undefined);

    if (side === 'local') {
      setLocalSelectedStarters(firstFive);
    } else {
      setVisitorSelectedStarters(firstFive);
    }
  };

  const handleSaveInitialLineups = async () => {
    if (inFlightRef.current || isSubmitting || !match.id) return;

    if (anyTeamIncomplete) {
      if (localNeedsPlayers && visitorNeedsPlayers) {
        showError(
          `Ambos equipos necesitan al menos 5 jugadores activos (${localTeam.name}: ${localTeam.players.length}/5, ${visitorTeam.name}: ${visitorTeam.players.length}/5).`
        );
      } else if (localNeedsPlayers) {
        showError(
          `${localTeam.name} necesita al menos 5 jugadores activos para activar la alineación (tiene ${localTeam.players.length}/5).`
        );
      } else {
        showError(
          `${visitorTeam.name} necesita al menos 5 jugadores activos para activar la alineación (tiene ${visitorTeam.players.length}/5).`
        );
      }
      return;
    }

    if (
      validLocalStarters.length !== REQUIRED_ON_COURT_PLAYERS ||
      validVisitorStarters.length !== REQUIRED_ON_COURT_PLAYERS
    ) {
      showError(
        `Selecciona exactamente 5 titulares por equipo (${localTeam.name}: ${validLocalStarters.length}/5, ${visitorTeam.name}: ${validVisitorStarters.length}/5).`
      );
      return;
    }

    inFlightRef.current = true;
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const result = await LineupService.activateLineups({
        matchId: match.id,
        localStarters: validLocalStarters,
        visitorStarters: validVisitorStarters,
        expectedVersion: starterCapturedVersion
      });

      if (!result.success) {
        if (!result.inFlight) {
          showError(result.error || 'No se pudo guardar la alineación.');
        }
        return;
      }

      if (result.lineups) {
        setCommittedLineups(result.lineups);
      }
      onLineupsActivated?.();
      showToast('Alineación guardada: 5 jugadores en cancha por equipo');
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSelectSubOut = (side: 'local' | 'visitor', playerId: number) => {
    if (inFlightRef.current || isSubmitting) return;
    setErrorMsg(null);
    setSubDrafts(prev => {
      const current = prev[side];
      const isDeselect = current.outId === playerId;
      const nextOut = isDeselect ? null : playerId;
      const nextIn = current.inId;
      const hasAnySelection = nextOut !== null || nextIn !== null;
      return {
        ...prev,
        [side]: {
          outId: nextOut,
          inId: nextIn,
          capturedVersion: hasAnySelection
            ? (current.capturedVersion ?? effectiveMatch.lineups?.version)
            : undefined
        }
      };
    });
  };

  const handleSelectSubIn = (side: 'local' | 'visitor', playerId: number) => {
    if (inFlightRef.current || isSubmitting) return;
    setErrorMsg(null);
    setSubDrafts(prev => {
      const current = prev[side];
      const isDeselect = current.inId === playerId;
      const nextIn = isDeselect ? null : playerId;
      const nextOut = current.outId;
      const hasAnySelection = nextOut !== null || nextIn !== null;
      return {
        ...prev,
        [side]: {
          outId: nextOut,
          inId: nextIn,
          capturedVersion: hasAnySelection
            ? (current.capturedVersion ?? effectiveMatch.lineups?.version)
            : undefined
        }
      };
    });
  };

  const handleConfirmSubstitution = async (side: 'local' | 'visitor', team: TeamWithPlayers) => {
    if (inFlightRef.current || isSubmitting || !match.id || !team.id) return;

    const draft = subDrafts[side];
    if (draft.outId === null || draft.inId === null) {
      showError('Selecciona el jugador que sale y el jugador que entra.');
      return;
    }

    if (clockRunning) {
      showError(
        'El reloj principal está corriendo. Detén o pausa el reloj primero antes de realizar la sustitución.'
      );
      return;
    }

    inFlightRef.current = true;
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const playerOut = team.players.find(p => p.id === draft.outId);
      const playerIn = team.players.find(p => p.id === draft.inId);

      const result = await LineupService.substitutePlayer({
        matchId: match.id,
        teamId: team.id,
        playerOutId: draft.outId,
        playerInId: draft.inId,
        expectedVersion: draft.capturedVersion ?? effectiveMatch.lineups?.version
      });

      if (!result.success) {
        if (!result.inFlight) {
          showError(result.error || 'No se pudo realizar la sustitución.');
          if (result.error?.includes('otra pestaña') || result.error?.includes('ya no está en cancha')) {
            setSubDrafts(prev => ({
              ...prev,
              [side]: { outId: null, inId: null, capturedVersion: undefined }
            }));
          }
        }
        return;
      }

      if (result.lineups) {
        setCommittedLineups(result.lineups);
      }

      setSubDrafts(prev => ({
        ...prev,
        [side]: { outId: null, inId: null, capturedVersion: undefined }
      }));

      showToast(
        `Cambio en ${team.name}: entró ${playerIn?.name || 'Jugador'} por ${playerOut?.name || 'Jugador'}`
      );
    } finally {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const renderQuickAddForm = (team: TeamWithPlayers) => {
    if (addingForTeamId !== team.id) return null;
    return (
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
            aria-label={`Dorsal nuevo jugador ${team.name}`}
          />
          <input
            type="text"
            placeholder="Nombre del jugador..."
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void handleAddPlayer(team.id!)}
            className="input pm-input-name"
            aria-label={`Nombre nuevo jugador ${team.name}`}
            autoFocus
          />
          <button
            type="button"
            disabled={!newName.trim() || isAddingPlayer}
            onClick={() => void handleAddPlayer(team.id!)}
            className="btn btn-sm btn-primary"
          >
            <Check size={16} />
            Guardar
          </button>
        </div>
      </div>
    );
  };

  const renderStarterSelectionColumn = (team: TeamWithPlayers, side: 'local' | 'visitor') => {
    const isLocal = side === 'local';
    const accentColor = isLocal ? 'var(--secondary-light)' : 'var(--primary-light)';
    const isAddingHere = addingForTeamId === team.id;
    const selectedIds = isLocal ? validLocalStarters : validVisitorStarters;
    const selectedSet = new Set(selectedIds);
    const needsMorePlayers = team.players.length < REQUIRED_ON_COURT_PLAYERS;
    const missingCount = Math.max(0, REQUIRED_ON_COURT_PLAYERS - team.players.length);

    const startersList = team.players.filter(p => p.id !== undefined && selectedSet.has(p.id));
    const benchList = team.players.filter(p => p.id !== undefined && !selectedSet.has(p.id));

    return (
      <div className={`live-roster-column ${side}`} data-testid={`starter-column-${side}`}>
        <div className="live-roster-team-header">
          <div className="flex-gap" style={{ minWidth: 0, flex: 1 }}>
            <span className={`live-roster-side-tag ${side}`}>
              {isLocal ? 'LOCAL' : 'VISITA'}
            </span>
            <h4 className="live-roster-team-title" style={{ color: accentColor, cursor: 'default' }}>
              <span>{team.name}</span>
            </h4>
          </div>

          <div className="flex-gap" style={{ gap: '0.4rem' }}>
            {!needsMorePlayers && selectedIds.length < REQUIRED_ON_COURT_PLAYERS && (
              <button
                type="button"
                onClick={() => handleSelectFirstFive(side, team)}
                className="btn btn-xs btn-secondary"
                data-testid={`btn-auto-select-starters-${side}`}
              >
                Elegir 5
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setAddingForTeamId(isAddingHere ? null : team.id!);
                setNewName('');
                setNewNumber('');
              }}
              className="btn btn-xs btn-secondary"
              style={{ borderColor: `${accentColor}44`, color: accentColor }}
              data-testid={`btn-add-player-${side}`}
            >
              <UserPlus size={14} />
              <span>+ Jugador</span>
            </button>
          </div>
        </div>

        {renderQuickAddForm(team)}

        {needsMorePlayers ? (
          <div
            className="lineup-missing-players-card"
            data-testid={`missing-players-${side}`}
          >
            <AlertCircle size={20} color="var(--warning)" style={{ flexShrink: 0 }} />
            <div>
              <strong>{team.name} necesita más jugadores</strong>
              <p>
                Tiene {team.players.length} de {REQUIRED_ON_COURT_PLAYERS} jugadores activos requeridos
                (faltan {missingCount}). Agrega jugadores para poder activar su quinteto.
              </p>
            </div>
          </div>
        ) : (
          <div className="lineup-selection-counter-bar">
            <span className={`lineup-counter-pill ${selectedIds.length === REQUIRED_ON_COURT_PLAYERS ? 'is-ready' : ''}`}>
              Titulares: {selectedIds.length} / {REQUIRED_ON_COURT_PLAYERS}
            </span>
            <span className="lineup-counter-sub">
              Suplentes en banca: {Math.max(0, team.players.length - selectedIds.length)}
            </span>
          </div>
        )}

        {team.players.length === 0 ? (
          <div className="live-roster-empty">
            <Users size={30} strokeWidth={1.3} />
            <p>Sin jugadores registrados en {team.name}.</p>
            <button
              type="button"
              onClick={() => setAddingForTeamId(team.id!)}
              className="btn btn-sm btn-secondary"
            >
              <UserPlus size={15} />
              Agregar jugador
            </button>
          </div>
        ) : (
          <div className="live-roster-cards">
            {team.players.map(player => {
              const isSelected = selectedSet.has(player.id!);
              const isComplete = selectedIds.length === REQUIRED_ON_COURT_PLAYERS;
              const roleLabel = isSelected
                ? 'TITULAR • EN CANCHA'
                : isComplete
                  ? 'SUPLENTE • BANCA'
                  : 'TOCA PARA TITULAR';

              return (
                <button
                  key={player.id}
                  type="button"
                  disabled={needsMorePlayers || isSubmitting}
                  onClick={() => handleToggleStarter(side, player.id!, team.name)}
                  data-testid={`starter-option-${player.id}`}
                  aria-pressed={isSelected}
                  className={`live-roster-player-card lineup-selectable-card ${side} ${
                    isSelected ? 'is-starter-selected' : isComplete ? 'is-bench-preview' : ''
                  }`}
                >
                  <div className="live-roster-player-main">
                    <div className={`live-roster-jersey ${side}`}>
                      <span>#{player.number !== undefined ? player.number : '—'}</span>
                    </div>
                    <div className="live-roster-player-info" style={{ textAlign: 'left' }}>
                      <span className="live-roster-player-name">{player.name}</span>
                      <div className="live-roster-player-badges">
                        <span
                          className={`lineup-role-badge ${
                            isSelected ? 'on-court' : isComplete ? 'bench' : 'neutral'
                          }`}
                        >
                          {roleLabel}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="lineup-check-indicator">
                    {isSelected ? <Check size={18} /> : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!needsMorePlayers && selectedIds.length === REQUIRED_ON_COURT_PLAYERS && (
          <div className="lineup-preview-summary" data-testid={`starter-preview-${side}`}>
            <div className="lineup-preview-row">
              <strong>EN CANCHA ({startersList.length}):</strong>{' '}
              {startersList.map(p => `#${p.number ?? '—'} ${p.name}`).join(', ')}
            </div>
            <div className="lineup-preview-row is-bench">
              <strong>BANCA ({benchList.length} suplentes):</strong>{' '}
              {benchList.length > 0
                ? benchList.map(p => `#${p.number ?? '—'} ${p.name}`).join(', ')
                : 'Sin suplentes'}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderActiveLineupColumn = (team: TeamWithPlayers, side: 'local' | 'visitor') => {
    const isLocal = side === 'local';
    const accentColor = isLocal ? 'var(--secondary-light)' : 'var(--primary-light)';
    const isAddingHere = addingForTeamId === team.id;

    const onCourtIds = getTeamOnCourtIds(effectiveMatch, side);
    const { onCourt, bench } = partitionTeamPlayersByLineup(team.players, onCourtIds);
    const draft = subDrafts[side];

    const selectedOutPlayer = onCourt.find(p => p.id === draft.outId);
    const selectedInPlayer = bench.find(p => p.id === draft.inId);

    return (
      <div className={`live-roster-column ${side}`} data-testid={`active-lineup-column-${side}`}>
        <div className="live-roster-team-header">
          <div className="flex-gap" style={{ minWidth: 0, flex: 1 }}>
            <span className={`live-roster-side-tag ${side}`}>
              {isLocal ? 'LOCAL' : 'VISITA'}
            </span>
            <h4 className="live-roster-team-title" style={{ color: accentColor, cursor: 'default' }}>
              <span>{team.name}</span>
            </h4>
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
            data-testid={`btn-add-player-${side}`}
          >
            <UserPlus size={14} />
            <span>+ Jugador</span>
          </button>
        </div>

        {renderQuickAddForm(team)}

        {/* BARRA DE CAMBIO RÁPIDO (SUSTITUCIÓN) */}
        <div className="lineup-sub-action-box" data-testid={`sub-box-${side}`}>
          <div className="lineup-sub-slots">
            <div className={`lineup-sub-slot out ${selectedOutPlayer ? 'is-filled' : ''}`}>
              <span className="slot-label">SALE (Cancha)</span>
              <span className="slot-value">
                {selectedOutPlayer
                  ? `#${selectedOutPlayer.number ?? '—'} ${selectedOutPlayer.name}`
                  : 'Toca jugador en cancha'}
              </span>
            </div>
            <ArrowLeftRight size={16} className="lineup-sub-arrow" />
            <div className={`lineup-sub-slot in ${selectedInPlayer ? 'is-filled' : ''}`}>
              <span className="slot-label">ENTRA (Banca)</span>
              <span className="slot-value">
                {selectedInPlayer
                  ? `#${selectedInPlayer.number ?? '—'} ${selectedInPlayer.name}`
                  : 'Toca suplente en banca'}
              </span>
            </div>
          </div>

          <button
            type="button"
            disabled={!selectedOutPlayer || !selectedInPlayer || isSubmitting}
            onClick={() => void handleConfirmSubstitution(side, team)}
            className="btn btn-sm btn-primary lineup-confirm-sub-btn"
            data-testid={`btn-confirm-sub-${side}`}
          >
            <ArrowLeftRight size={15} />
            <span>Confirmar cambio</span>
          </button>
        </div>

        {/* SECCIÓN: EN CANCHA (5) */}
        <div className="lineup-group-section on-court" data-testid={`on-court-section-${side}`}>
          <div className="lineup-group-header on-court">
            <span>EN CANCHA</span>
            <span className="lineup-group-count">{onCourt.length} titulares</span>
          </div>

          <div className="live-roster-cards">
            {onCourt.map(player => {
              const pts = statsData.pointsMap.get(player.id!) || 0;
              const fouls = statsData.foulsMap.get(player.id!) || 0;
              const isExpelled = foulLimit !== undefined && fouls >= foulLimit;
              const isWarning = !isExpelled && foulLimit !== undefined && fouls === foulLimit - 1;
              const isSelectedOut = draft.outId === player.id;

              return (
                <div
                  key={player.id}
                  data-testid={`on-court-player-${player.id}`}
                  onClick={() => handleSelectSubOut(side, player.id!)}
                  className={`live-roster-player-card lineup-player-row on-court ${side} ${
                    isSelectedOut ? 'is-sub-out-selected' : ''
                  } ${isExpelled ? 'is-expelled' : ''}`}
                >
                  <div className="live-roster-player-main">
                    <div className={`live-roster-jersey ${side}`}>
                      <span>#{player.number !== undefined ? player.number : '—'}</span>
                    </div>
                    <div className="live-roster-player-info">
                      <span className="live-roster-player-name">{player.name}</span>
                      <div className="live-roster-player-badges">
                        <span className="lineup-role-badge on-court">EN CANCHA</span>
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

                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={e => {
                      e.stopPropagation();
                      handleSelectSubOut(side, player.id!);
                    }}
                    aria-pressed={isSelectedOut}
                    data-testid={`btn-sub-out-${player.id}`}
                    className={`btn-lineup-sub out ${isSelectedOut ? 'active' : ''}`}
                  >
                    {isSelectedOut ? 'Sale ✓' : 'Sale'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* SECCIÓN: BANCA (SUPLENTES) */}
        <div className="lineup-group-section bench" data-testid={`bench-section-${side}`}>
          <div className="lineup-group-header bench">
            <span>BANCA</span>
            <span className="lineup-group-count">{bench.length} suplentes</span>
          </div>

          {bench.length === 0 ? (
            <div className="lineup-bench-empty">
              Sin suplentes disponibles en banca. Usa "+ Jugador" si necesitas registrar un suplente.
            </div>
          ) : (
            <div className="live-roster-cards">
              {bench.map(player => {
                const pts = statsData.pointsMap.get(player.id!) || 0;
                const fouls = statsData.foulsMap.get(player.id!) || 0;
                const isExpelled = foulLimit !== undefined && fouls >= foulLimit;
                const isWarning = !isExpelled && foulLimit !== undefined && fouls === foulLimit - 1;
                const isSelectedIn = draft.inId === player.id;

                return (
                  <div
                    key={player.id}
                    data-testid={`bench-player-${player.id}`}
                    onClick={() => handleSelectSubIn(side, player.id!)}
                    className={`live-roster-player-card lineup-player-row bench ${side} ${
                      isSelectedIn ? 'is-sub-in-selected' : ''
                    } ${isExpelled ? 'is-expelled' : ''}`}
                  >
                    <div className="live-roster-player-main">
                      <div className={`live-roster-jersey ${side}`}>
                        <span>#{player.number !== undefined ? player.number : '—'}</span>
                      </div>
                      <div className="live-roster-player-info">
                        <span className="live-roster-player-name">{player.name}</span>
                        <div className="live-roster-player-badges">
                          <span className="lineup-role-badge bench">SUPLENTE</span>
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

                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={e => {
                        e.stopPropagation();
                        handleSelectSubIn(side, player.id!);
                      }}
                      aria-pressed={isSelectedIn}
                      data-testid={`btn-sub-in-${player.id}`}
                      className={`btn-lineup-sub in ${isSelectedIn ? 'active' : ''}`}
                    >
                      {isSelectedIn ? 'Entra ✓' : 'Entra'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content variant-live-roster variant-lineup-modal"
        onClick={e => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="modal-header modal-header-with-status">
          <div className="modal-header-top-row">
            <div>
              <h3 className="modal-title flex-gap">
                <Shirt size={22} color="var(--primary)" />
                {lineupsActive
                  ? 'Jugadores en Cancha y Sustituciones'
                  : 'Gestionar jugadores en cancha'}
              </h3>
              <p className="modal-subtitle">
                {lineupsActive
                  ? 'Selecciona quién sale de cancha y quién entra desde la banca.'
                  : 'Elige los 5 titulares iniciales de cada equipo para activar el control de cancha.'}
              </p>
            </div>
            <button type="button" onClick={onClose} className="btn-icon" aria-label="Cerrar">
              <X size={22} />
            </button>
          </div>
          <ModalLiveStatusPill />
        </div>

        {/* AVISO SI EL RELOJ PRINCIPAL ESTÁ CORRIENDO DURANTE SUSTITUCIONES */}
        {lineupsActive && clockRunning && (
          <div
            className="lineup-clock-warning-banner"
            data-testid="lineup-clock-running-notice"
          >
            <Clock size={16} style={{ flexShrink: 0 }} />
            <span>
              El reloj principal está en marcha. Detén o pausa el reloj primero antes de realizar una sustitución.
            </span>
          </div>
        )}

        {/* AVISO SI FALTA COMPLETAR ALGÚN EQUIPO (< 5 JUGADORES) */}
        {!lineupsActive && anyTeamIncomplete && (
          <div
            className="lineup-incomplete-banner"
            data-testid="lineup-incomplete-warning"
            role="status"
          >
            <AlertCircle size={17} style={{ flexShrink: 0 }} />
            <span>
              {localNeedsPlayers && visitorNeedsPlayers
                ? `Para activar los quintetos se requieren al menos 5 jugadores activos por equipo. Faltan jugadores en ${localTeam.name} (${localTeam.players.length}/5) y ${visitorTeam.name} (${visitorTeam.players.length}/5).`
                : localNeedsPlayers
                  ? `Falta completar ${localTeam.name}: tiene ${localTeam.players.length} de 5 jugadores activos requeridos.`
                  : `Falta completar ${visitorTeam.name}: tiene ${visitorTeam.players.length} de 5 jugadores activos requeridos.`}
            </span>
          </div>
        )}

        {/* TABS MÓVILES PARA ALTERNAR EQUIPO */}
        <div className="live-roster-mobile-tabs">
          <button
            type="button"
            onClick={() => setActiveTab('local')}
            className={`roster-tab-btn local ${activeTab === 'local' ? 'active' : ''}`}
          >
            <span>LOCAL • {localTeam.name}</span>
            <span className="roster-tab-count">
              {lineupsActive
                ? '5v5'
                : `${validLocalStarters.length}/${REQUIRED_ON_COURT_PLAYERS}`}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('visitor')}
            className={`roster-tab-btn visitor ${activeTab === 'visitor' ? 'active' : ''}`}
          >
            <span>VISITA • {visitorTeam.name}</span>
            <span className="roster-tab-count">
              {lineupsActive
                ? '5v5'
                : `${validVisitorStarters.length}/${REQUIRED_ON_COURT_PLAYERS}`}
            </span>
          </button>
        </div>

        {/* TOASTS Y ERRORES */}
        {feedbackMsg && (
          <div className="live-roster-toast" data-testid="lineup-toast">
            <Check size={15} />
            <span>{feedbackMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div
            className="live-roster-toast"
            role="alert"
            data-testid="lineup-error"
            style={{ background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' }}
          >
            <AlertCircle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* CUERPO */}
        <div className="modal-body live-roster-body">
          <div className={`live-roster-grid active-${activeTab}`}>
            {lineupsActive ? (
              <>
                {renderActiveLineupColumn(localTeam, 'local')}
                {renderActiveLineupColumn(visitorTeam, 'visitor')}
              </>
            ) : (
              <>
                {renderStarterSelectionColumn(localTeam, 'local')}
                {renderStarterSelectionColumn(visitorTeam, 'visitor')}
              </>
            )}
          </div>
        </div>

        {/* FOOTER */}
        <div className="modal-footer" style={{ gap: '0.65rem' }}>
          {!lineupsActive && (
            <button
              type="button"
              disabled={
                anyTeamIncomplete ||
                validLocalStarters.length !== REQUIRED_ON_COURT_PLAYERS ||
                validVisitorStarters.length !== REQUIRED_ON_COURT_PLAYERS ||
                isSubmitting
              }
              onClick={() => void handleSaveInitialLineups()}
              className="btn btn-primary"
              style={{ flex: 1.4 }}
              data-testid="btn-save-lineup"
            >
              <Check size={18} />
              <span>Guardar alineación</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
            style={{ flex: 1 }}
          >
            {lineupsActive ? 'Volver al Partido' : 'Cancelar'}
          </button>
        </div>
      </div>
    </div>
  );
}
