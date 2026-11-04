// src/components/common/StorageErrorBoundary.tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, HardDrive, AlertCircle } from 'lucide-react';
import Dexie from 'dexie';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export function isStorageError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Dexie.DexieError) return true;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return (
      error.name === 'QuotaExceededError' ||
      error.name === 'InvalidStateError' ||
      error.name === 'AbortError' ||
      error.name === 'VersionError' ||
      error.name === 'UnknownError'
    );
  }
  if (error instanceof Error) {
    const text = `${error.name} ${error.message}`.toLowerCase();
    return (
      text.includes('indexeddb') ||
      text.includes('dexie') ||
      text.includes('database') ||
      text.includes('almacenamiento') ||
      text.includes('connectionfailed') ||
      text.includes('openfailed') ||
      text.includes('versionchange') ||
      text.includes('quota')
    );
  }
  return false;
}

export class StorageErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('StorageErrorBoundary capturó un fallo:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onRetry) {
      this.props.onRetry();
    }
  };

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const storageFault = isStorageError(this.state.error);
    const title =
      this.props.fallbackTitle ||
      (storageFault
        ? 'Problema de acceso al almacenamiento local'
        : 'Problema al cargar la vista');

    const defaultMessage = storageFault
      ? 'No fue posible acceder o leer los datos desde el almacenamiento local.'
      : 'Se produjo un error inesperado al renderizar este componente.';

    const message = this.state.error?.message || defaultMessage;

    return (
      <div
        className="card"
        style={{
          margin: '2rem auto',
          maxWidth: '560px',
          padding: '2rem 1.5rem',
          textAlign: 'center',
          borderColor: 'rgba(239, 68, 68, 0.4)',
          backgroundColor: 'var(--bg-surface, #1e293b)'
        }}
        role="alert"
        aria-live="assertive"
      >
        <div
          style={{
            display: 'inline-flex',
            padding: '1rem',
            borderRadius: '9999px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            color: 'var(--danger, #ef4444)',
            marginBottom: '1rem'
          }}
        >
          <AlertTriangle size={36} />
        </div>

        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 0.5rem 0', color: 'var(--text-main)' }}>
          {title}
        </h2>

        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: '0 0 1rem 0', lineHeight: 1.5 }}>
          {storageFault
            ? 'No fue posible leer o conectar con los datos locales en este momento.'
            : 'Ocurrió un problema de ejecución al presentar esta pantalla.'}
        </p>

        <div
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            borderRadius: '6px',
            marginBottom: '1.25rem',
            textAlign: 'left',
            fontSize: '0.8rem',
            color: 'var(--text-muted)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.25rem' }}>
            {storageFault ? <HardDrive size={14} /> : <AlertCircle size={14} />}
            {storageFault ? 'Protección de datos activa:' : 'Estado de la aplicación:'}
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', lineHeight: 1.4 }}>
            {storageFault ? (
              <>
                <li>ScoreBasket no aplica reinicializaciones ni borrados automáticos ante errores de lectura.</li>
                <li>El acceso puede estar restringido por el navegador, modo privado o concurrencia con otra pestaña.</li>
              </>
            ) : (
              <>
                <li>Se evitó el bloqueo general de la aplicación.</li>
                <li>Tus datos en almacenamiento local no han sido modificados por este fallo de interfaz.</li>
              </>
            )}
          </ul>
        </div>

        {message && (
          <div
            style={{
              padding: '0.5rem 0.75rem',
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: '4px',
              fontSize: '0.75rem',
              color: 'var(--danger, #ef4444)',
              marginBottom: '1.25rem',
              fontFamily: 'monospace',
              wordBreak: 'break-word'
            }}
          >
            {message}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={this.handleRetry}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <RefreshCw size={14} />
            {storageFault ? 'Reintentar lectura' : 'Reintentar'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={this.handleReload}
          >
            Recargar página
          </button>
        </div>
      </div>
    );
  }
}
