// src/features/match-creations/components/engines/SeriesEarlyFinishModal.tsx
import React, { useEffect } from 'react';
import { Flag } from 'lucide-react';
import { ModalLiveStatusPill } from '../../../../components/live/ModalLiveStatusPill';
import type { Match, Team } from '../../../../db/models';

export interface SeriesEarlyFinishModalProps {
  isOpen: boolean;
  isProcessing: boolean;
  errorMessage: string | null;
  match: Match;
  localTeam: Team;
  visitorTeam: Team;
  localSetsWon: number;
  visitorSetsWon: number;
  onConfirmFinish: (countCurrentSet: boolean) => void | Promise<void> | Promise<unknown>;
  onDismiss: () => void;
}

/**
 * Modal de confirmación para el cierre anticipado de Best-of-Series (C-05 y C-07).
 * Protege estrictamente su ciclo de vida durante operaciones pendientes (isProcessing === true):
 * - El clic en el backdrop no desmonta el modal si la operación está en curso.
 * - La tecla Escape queda bloqueada durante el procesamiento.
 * - Los botones de acción se deshabilitan para evitar doble clic o acciones contradictorias.
 * - Los rechazos o excepciones de dominio mantienen visible el modal con el mensaje de error.
 */
export const SeriesEarlyFinishModal: React.FC<SeriesEarlyFinishModalProps> = ({
  isOpen,
  isProcessing,
  errorMessage,
  match,
  localTeam,
  visitorTeam,
  localSetsWon,
  visitorSetsWon,
  onConfirmFinish,
  onDismiss,
}) => {
  // C-07: Bloqueo de teclado (Escape) durante operaciones en curso
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isProcessing) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isProcessing, onDismiss]);

  if (!isOpen) return null;

  // C-07: Bloqueo de backdrop click durante operaciones en curso
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (isProcessing) return;
    onDismiss();
  };

  const isTiedCurrentSet = match.localScore === match.visitorScore;

  return (
    <div
      className="game-modal-overlay"
      onClick={handleBackdropClick}
      data-testid="early-finish-backdrop"
    >
      <div
        className="game-modal-card is-exit"
        onClick={e => e.stopPropagation()}
        data-testid="early-finish-card"
      >
        <div className="game-modal-status-header">
          <ModalLiveStatusPill />
        </div>
        <div className="modal-icon-wrapper">
          <Flag size={34} color="var(--danger)" />
        </div>
        <h3>¿Finalizar la Serie?</h3>
        {errorMessage && (
          <div
            data-testid="early-finish-error"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid var(--danger, #ef4444)',
              color: '#fca5a5',
              padding: '0.5rem 0.75rem',
              borderRadius: '0.375rem',
              fontSize: '0.85rem',
              marginBottom: '1rem',
              textAlign: 'left',
            }}
          >
            {errorMessage}
          </div>
        )}
        <p>
          La serie aún no concluye (Sets: {localSetsWon} - {visitorSetsWon} • Set actual: {match.localScore} - {match.visitorScore}).
        </p>
        <div className="modal-actions" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {!isTiedCurrentSet && (
            <button
              type="button"
              data-testid="btn-finish-count-set"
              onClick={() => {
                if (isProcessing) return;
                onConfirmFinish(true);
              }}
              disabled={isProcessing}
              className="btn-modal-primary"
              style={{ background: 'var(--primary-accent, #3b82f6)' }}
            >
              {isProcessing
                ? 'Procesando...'
                : `Cerrar y Contabilizar Set Actual (${match.localScore > match.visitorScore ? localTeam.name : visitorTeam.name} +1)`}
            </button>
          )}
          <button
            type="button"
            data-testid="btn-finish-no-count"
            onClick={() => {
              if (isProcessing) return;
              onConfirmFinish(false);
            }}
            disabled={isProcessing}
            className="btn-modal-primary btn-finish"
          >
            {isProcessing
              ? 'Procesando...'
              : (!isTiedCurrentSet
                ? 'Cerrar sin Contabilizar Set Actual'
                : 'Sí, Guardar y Cerrar Serie')}
          </button>
          <button
            type="button"
            data-testid="btn-cancel-finish"
            onClick={() => {
              if (isProcessing) return;
              onDismiss();
            }}
            disabled={isProcessing}
            className="btn-modal-secondary"
          >
            Seguir Jugando
          </button>
        </div>
      </div>
    </div>
  );
};
