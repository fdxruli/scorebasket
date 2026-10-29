// src/components/teams/TeamEditorModal.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../../db/db';
import type { Player } from '../../db/models';
import {
    PlayersRepository,
    validateJerseyNumber,
    createTeamRosterSnapshot,
    type TeamRosterSnapshot
} from '../../db/players.repository';
import {
    toEditablePlayerRows,
    updateEditablePlayerRow,
    revalidateEditableRows,
    validateNewPlayerDraft,
    prepareEditableRosterForSave,
    type EditablePlayerRow
} from './teamEditorHelpers';
import { X, Save, Trash2, Plus, User, Users, Shield, AlertCircle, RefreshCw } from 'lucide-react';

interface TeamEditorModalProps {
    teamId: number;
    onClose: () => void;
}

const isActivePlayer = (player: Player) => !player.isArchived;

export function TeamEditorModal({ teamId, onClose }: TeamEditorModalProps) {
    const [teamName, setTeamName] = useState('');
    const [players, setPlayers] = useState<EditablePlayerRow[]>([]);
    const [initialSnapshot, setInitialSnapshot] = useState<TeamRosterSnapshot | undefined>(undefined);
    const [removedPlayerIds, setRemovedPlayerIds] = useState<number[]>([]);

    // Estados para el nuevo jugador
    const [newPlayerName, setNewPlayerName] = useState('');
    const [newPlayerNumber, setNewPlayerNumber] = useState('');
    const [newPlayerError, setNewPlayerError] = useState<string | null>(null);

    // Mensajes de error general y de conflicto de concurrencia
    const [formError, setFormError] = useState<string | null>(null);
    const [isConcurrencyConflict, setIsConcurrencyConflict] = useState(false);

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Referencias para mantener el foco y facilitar la corrección (C-05)
    const newPlayerInputRef = useRef<HTMLInputElement>(null);
    const newPlayerNumberRef = useRef<HTMLInputElement>(null);
    const rowNumberRefs = useRef<Record<number, HTMLInputElement | null>>({});
    const rowNameRefs = useRef<Record<number, HTMLInputElement | null>>({});

    // 1. Cargar datos y capturar snapshot inicial (C-02)
    const loadData = useCallback(async () => {
        setIsLoading(true);
        try {
            const team = await db.teams.get(teamId);
            const teamPlayers = await db.players
                .where({ teamId })
                .sortBy('number');

            if (team) {
                const activePlayers = teamPlayers.filter(isActivePlayer);
                setTeamName(team.name);
                setPlayers(toEditablePlayerRows(activePlayers));
                setInitialSnapshot(createTeamRosterSnapshot(team.name, activePlayers));
                setRemovedPlayerIds([]);
                setFormError(null);
                setIsConcurrencyConflict(false);
            }
        } catch (err) {
            console.error('Error cargando equipo', err);
            setFormError('No se pudo cargar la información del equipo.');
        } finally {
            setIsLoading(false);
        }
    }, [teamId]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handlePlayerChange = (index: number, field: 'name' | 'number', value: string) => {
        setFormError(null);
        setPlayers(prev => updateEditablePlayerRow(prev, index, field, value));
    };

    const handleDeletePlayer = (indexToDelete: number) => {
        setFormError(null);
        setPlayers(prev => {
            const target = prev[indexToDelete];
            if (target?.id !== undefined) {
                setRemovedPlayerIds(old => (old.includes(target.id!) ? old : [...old, target.id!]));
            }
            const remaining = prev.filter((_, idx) => idx !== indexToDelete);
            return revalidateEditableRows(remaining);
        });
    };

    const handleNewPlayerNumberChange = (value: string) => {
        setNewPlayerNumber(value);
        if (value.trim() === '') {
            setNewPlayerError(null);
            return;
        }
        const parsed = validateJerseyNumber(value);
        if (!parsed.isValid) {
            setNewPlayerError(parsed.error || 'Dorsal no válido.');
        } else {
            setNewPlayerError(null);
        }
    };

    const handleAddPlayer = () => {
        if (!newPlayerName.trim()) return;

        const draftResult = validateNewPlayerDraft(players, newPlayerName, newPlayerNumber);
        if (!draftResult.isValid || !draftResult.row) {
            setNewPlayerError(draftResult.error || 'Dorsal no válido.');
            // Mantener el valor escrito y enfocar el campo de dorsal para corrección inmediata (C-05)
            newPlayerNumberRef.current?.focus();
            return;
        }

        setPlayers(prev => revalidateEditableRows([...prev, draftResult.row!]));
        setNewPlayerName('');
        setNewPlayerNumber('');
        setNewPlayerError(null);
        setFormError(null);

        // Mantener el foco en el nombre para agregar otro rápido
        newPlayerInputRef.current?.focus();
    };

    const handleSave = async () => {
        if (!teamName.trim()) {
            setFormError('El nombre del equipo no puede estar vacío.');
            return;
        }

        // Si el usuario dejó un dorsal inválido escrito en la caja de "Agregar Nuevo Jugador"
        if (newPlayerNumber.trim() !== '') {
            const pendingJerseyVal = validateJerseyNumber(newPlayerNumber);
            if (!pendingJerseyVal.isValid) {
                setNewPlayerError(pendingJerseyVal.error || 'Dorsal no válido.');
                setFormError(
                    pendingJerseyVal.error || 'Corrige el dorsal inválido antes de guardar.'
                );
                newPlayerNumberRef.current?.focus();
                return;
            }
        }

        // Validar todas las filas editables antes de persistir (C-05)
        const prepared = prepareEditableRosterForSave(players);
        setPlayers(prepared.validatedRows);

        if (!prepared.isValid) {
            setFormError(
                prepared.errorSummary || 'Corrige los errores en la plantilla antes de guardar.'
            );
            if (prepared.firstInvalidIndex >= 0) {
                if (prepared.firstInvalidField === 'name') {
                    rowNameRefs.current[prepared.firstInvalidIndex]?.focus();
                } else {
                    rowNumberRefs.current[prepared.firstInvalidIndex]?.focus();
                }
            }
            return;
        }

        setIsSaving(true);
        setFormError(null);
        setIsConcurrencyConflict(false);

        try {
            await PlayersRepository.saveTeamAndRoster({
                teamId,
                teamName: teamName.trim(),
                players: prepared.payload,
                initialSnapshot,
                removedPlayerIds
            });
            onClose();
        } catch (err: unknown) {
            console.error('Error al guardar', err);
            const msg =
                err instanceof Error ? err.message : 'Hubo un error al guardar los cambios.';
            setFormError(msg);
            if (msg.toLowerCase().includes('conflicto de concurrencia')) {
                setIsConcurrencyConflict(true);
            }
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content variant-admin">

                {/* --- HEADER --- */}
                <div className="modal-header">
                    <div className="flex-col">
                        <h2 className="modal-title flex-gap">
                            <Shield size={20} color="var(--primary)" />
                            Editar Equipo
                        </h2>
                        <span
                            className="text-muted uppercase font-bold"
                            style={{ fontSize: '0.75rem', letterSpacing: '0.05em', marginTop: '0.25rem' }}
                        >
                            ID: {teamId}
                        </span>
                    </div>
                    <button onClick={onClose} className="btn-icon">
                        <X size={24} />
                    </button>
                </div>

                {/* --- BODY --- */}
                <div className="modal-body">

                    {formError && (
                        <div
                            role="alert"
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.5rem',
                                padding: '0.75rem',
                                marginBottom: '0.75rem',
                                borderRadius: '0.5rem',
                                backgroundColor: 'rgba(244, 63, 94, 0.12)',
                                border: '1px solid rgba(244, 63, 94, 0.4)',
                                color: '#fda4af',
                                fontSize: '0.825rem'
                            }}
                        >
                            <div className="flex-gap" style={{ alignItems: 'center', gap: '0.5rem' }}>
                                <AlertCircle size={16} color="#f43f5e" />
                                <span>{formError}</span>
                            </div>
                            {isConcurrencyConflict && (
                                <button
                                    type="button"
                                    onClick={loadData}
                                    className="btn btn-sm btn-secondary"
                                    style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}
                                >
                                    <RefreshCw size={14} />
                                    Actualizar plantilla desde la base de datos
                                </button>
                            )}
                        </div>
                    )}

                    {/* SECCIÓN 1: DATOS DEL EQUIPO */}
                    <div className="form-group">
                        <label className="label">Nombre del Equipo</label>
                        <input
                            type="text"
                            className="input"
                            value={teamName}
                            onChange={(e) => {
                                setFormError(null);
                                setTeamName(e.target.value);
                            }}
                            placeholder="Ej. Chicago Bulls"
                            autoFocus
                        />
                    </div>

                    <div className="separator" style={{ height: '1px', background: 'var(--border-color)', margin: '0.5rem 0' }} />

                    {/* SECCIÓN 2: ROSTER */}
                    <div>
                        <div className="flex-between" style={{ marginBottom: '0.5rem' }}>
                            <label className="label flex-gap">
                                <Users size={14} />
                                Plantilla ({players.length})
                            </label>
                        </div>

                        {/* LISTA DE JUGADORES */}
                        <div className="roster-section">
                            {players.length === 0 && (
                                <div
                                    className="text-center text-muted"
                                    style={{
                                        padding: '1rem 0',
                                        fontSize: '0.875rem',
                                        border: '1px dashed var(--border-color)',
                                        borderRadius: '0.5rem'
                                    }}
                                >
                                    Sin jugadores asignados
                                </div>
                            )}

                            {players.map((p, idx) => (
                                <div key={p.id || `temp-${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                    <div className="player-edit-row">
                                        {/* Icono decorativo */}
                                        <User size={16} color="var(--text-muted)" />

                                        {/* Input Número (separado el valor editable numberInput del persistido) */}
                                        <div style={{ position: 'relative' }}>
                                            <span
                                                style={{
                                                    position: 'absolute',
                                                    left: '0.5rem',
                                                    top: '50%',
                                                    transform: 'translateY(-50%)',
                                                    color: '#52525b',
                                                    fontSize: '0.625rem'
                                                }}
                                            >
                                                #
                                            </span>
                                            <input
                                                ref={(el) => {
                                                    rowNumberRefs.current[idx] = el;
                                                }}
                                                type="text"
                                                inputMode="numeric"
                                                className="player-edit-input player-number-input"
                                                style={{
                                                    width: '56px',
                                                    paddingLeft: '1rem',
                                                    borderColor: p.numberError ? 'var(--danger)' : undefined
                                                }}
                                                placeholder="00"
                                                value={p.numberInput}
                                                aria-invalid={Boolean(p.numberError)}
                                                onChange={(e) => handlePlayerChange(idx, 'number', e.target.value)}
                                            />
                                        </div>

                                        {/* Input Nombre */}
                                        <input
                                            ref={(el) => {
                                                rowNameRefs.current[idx] = el;
                                            }}
                                            type="text"
                                            className="player-edit-input"
                                            style={{
                                                borderColor: p.nameError ? 'var(--danger)' : undefined
                                            }}
                                            value={p.name}
                                            aria-invalid={Boolean(p.nameError)}
                                            onChange={(e) => handlePlayerChange(idx, 'name', e.target.value)}
                                            placeholder="Nombre del jugador"
                                        />

                                        {/* Botón Quitar de plantilla */}
                                        <button
                                            onClick={() => handleDeletePlayer(idx)}
                                            className="btn-icon danger"
                                            style={{ padding: '0.375rem', borderRadius: '0.25rem' }}
                                            title="Quitar de la plantilla activa sin borrar historial"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                    {(p.numberError || p.nameError) && (
                                        <span
                                            role="alert"
                                            style={{
                                                color: '#f43f5e',
                                                fontSize: '0.75rem',
                                                paddingLeft: '1.75rem'
                                            }}
                                        >
                                            {p.numberError || p.nameError}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* CAJA DE AGREGAR JUGADOR */}
                        <div className="add-player-box">
                            <div className="add-player-header flex-gap">
                                <Plus size={12} />
                                Agregar Nuevo Jugador
                            </div>
                            <div className="add-player-controls">
                                <div style={{ position: 'relative' }}>
                                    <input
                                        ref={newPlayerNumberRef}
                                        type="text"
                                        inputMode="numeric"
                                        className="input"
                                        style={{
                                            width: '74px',
                                            paddingLeft: '1.25rem',
                                            fontSize: '0.9rem',
                                            borderColor: newPlayerError ? 'var(--danger)' : undefined
                                        }}
                                        placeholder="Número"
                                        value={newPlayerNumber}
                                        aria-invalid={Boolean(newPlayerError)}
                                        onChange={(e) => handleNewPlayerNumberChange(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && newPlayerInputRef.current?.focus()}
                                    />
                                </div>

                                <input
                                    ref={newPlayerInputRef}
                                    type="text"
                                    className="input"
                                    style={{ flex: 1, fontSize: '0.9rem' }}
                                    placeholder="Nombre jugador"
                                    value={newPlayerName}
                                    onChange={(e) => setNewPlayerName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddPlayer()}
                                />

                                <button
                                    onClick={handleAddPlayer}
                                    className="btn btn-primary"
                                    disabled={!newPlayerName.trim()}
                                    style={{ padding: '0.5rem 0.75rem' }}
                                >
                                    <Plus size={18} />
                                </button>
                            </div>
                            {newPlayerError && (
                                <div
                                    role="alert"
                                    style={{
                                        color: '#f43f5e',
                                        fontSize: '0.75rem',
                                        marginTop: '0.35rem'
                                    }}
                                >
                                    {newPlayerError}
                                </div>
                            )}
                        </div>

                    </div>
                </div>

                {/* --- FOOTER --- */}
                <div className="modal-footer">
                    <button onClick={onClose} className="btn btn-ghost">
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="btn btn-primary"
                    >
                        <Save size={18} />
                        {isSaving ? 'Guardando...' : 'Guardar Cambios'}
                    </button>
                </div>

            </div>
        </div>
    );
}
