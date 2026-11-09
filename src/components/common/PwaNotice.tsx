// Aviso pequeño y no modal. Solo se monta en Layout, nunca durante /live/:id.
import { useSyncExternalStore } from 'react';
import {
  applyUpdate,
  dismissInstallNotice,
  dismissOfflineReady,
  getPwaStatus,
  installPwa,
  subscribePwa,
} from '../../pwa/pwaStatus';

export function PwaNotice() {
  const { needRefresh, offlineReady, installMode, installDismissed } =
    useSyncExternalStore(subscribePwa, getPwaStatus);
  const showInstall = !installDismissed && installMode !== null;

  if (!needRefresh && !offlineReady && !showInstall) return null;

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
        flexWrap: 'wrap',
        gap: '0.5rem',
        alignItems: 'center',
        maxWidth: 'calc(100vw - 1.5rem)',
        padding: '0.55rem 0.75rem',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-surface-2, #1a1c25)',
        color: 'var(--text-secondary, #cbd5e1)',
        boxShadow: 'var(--shadow-md)',
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
      ) : showInstall ? (
        <>
          <span>
            {installMode === 'native'
              ? 'Instala ScoreBasket para acceder desde tu pantalla de inicio'
              : installMode === 'android'
                ? 'Instala ScoreBasket: en Chrome abre ⋮ y elige «Instalar aplicación» o «Añadir a pantalla principal»'
                : 'Instala ScoreBasket: en Safari pulsa Compartir y «Añadir a pantalla de inicio»'}
          </span>
          {installMode === 'native' && (
            <button type="button" className="btn btn-xs btn-primary" onClick={() => void installPwa()}>
              Instalar
            </button>
          )}
          <button type="button" className="btn btn-xs" onClick={dismissInstallNotice} aria-label="Cerrar aviso de instalación">
            Ahora no
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
