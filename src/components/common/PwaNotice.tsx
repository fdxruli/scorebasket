// Aviso discreto de PWA: una sola línea, sin modal. Solo se monta en Layout,
// por lo que nunca aparece en /live/:id (partido en curso).
import { useSyncExternalStore } from 'react';
import { applyUpdate, dismissOfflineReady, getPwaStatus, subscribePwa } from '../../pwa/pwaStatus';

export function PwaNotice() {
  const { needRefresh, offlineReady } = useSyncExternalStore(subscribePwa, getPwaStatus);

  if (!needRefresh && !offlineReady) return null;

  return (
    <div
      role="status"
      data-testid="pwa-notice"
      style={{
        position: 'fixed',
        right: '0.75rem',
        bottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
        zIndex: 40,
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center',
        padding: '0.4rem 0.75rem',
        borderRadius: '999px',
        background: 'var(--surface-2, #1a1c25)',
        color: 'var(--text-secondary, #cbd5e1)',
        fontSize: '0.75rem',
      }}
    >
      {needRefresh ? (
        <>
          <span>Nueva versión disponible</span>
          <button type="button" className="btn btn-xs btn-primary" onClick={() => void applyUpdate()}>
            Actualizar
          </button>
        </>
      ) : (
        <>
          <span>Lista para usar sin conexión</span>
          <button type="button" className="btn btn-xs" onClick={dismissOfflineReady} aria-label="Cerrar aviso">
            OK
          </button>
        </>
      )}
    </div>
  );
}
