// src/components/matches/LocalBackupControls.tsx
import { useState, useEffect, useRef } from 'react';
import {
  Download,
  Upload,
  Shield,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  Database,
  ChevronDown,
  ChevronUp,
  HardDrive
} from 'lucide-react';
import {
  LocalBackupService,
  type StorageStatus,
  type BackupCounts
} from '../../db/localBackup.service';

export function LocalBackupControls() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showConfirmRestore, setShowConfirmRestore] = useState<{
    fileContent: string;
    fileName: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadStorageStatus = async () => {
    try {
      const status = await LocalBackupService.storageStatus();
      setStorageStatus(status);
    } catch {
      // Ignorar fallos de sondeo
    }
  };

  useEffect(() => {
    loadStorageStatus();
  }, []);

  const handleExport = async () => {
    setIsExporting(true);
    setErrorMessage(null);
    setInfoMessage(null);
    setSuccessMessage(null);
    try {
      const { filename, counts, downloadInitiated } = await LocalBackupService.exportToFile();
      if (downloadInitiated) {
        setSuccessMessage(
          `Respaldo generado exitosamente. Descarga iniciada como "${filename}" (${counts.teams} equipos, ${counts.players} jugadores, ${counts.matches} partidos, ${counts.scores} anotaciones, ${counts.fouls} faltas). Revisa tu bandeja de descargas.`
        );
      } else {
        setSuccessMessage(
          `Respaldo generado exitosamente (${counts.teams} equipos, ${counts.players} jugadores, ${counts.matches} partidos, ${counts.scores} anotaciones, ${counts.fouls} faltas).`
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido al generar el respaldo.';
      setErrorMessage(`No se pudo generar el respaldo: ${msg}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Resetear valor para permitir seleccionar el mismo archivo si fuese necesario
    e.target.value = '';
    setErrorMessage(null);
    setInfoMessage(null);
    setSuccessMessage(null);

    try {
      const isEmpty = await LocalBackupService.isDatabaseEmpty();
      if (!isEmpty) {
        const counts = await LocalBackupService.getDatabaseCounts();
        setErrorMessage(
          `Restauración bloqueada: la base de datos ya contiene datos (${counts.teams} equipos, ${counts.players} jugadores, ${counts.matches} partidos). ` +
          'Para proteger la integridad de tus registros y evitar sobreescritura accidental, la restauración requiere una base de datos completamente vacía.'
        );
        return;
      }

      let text: string;
      if (typeof file.text === 'function') {
        text = await file.text();
      } else {
        text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error || new Error('Error al leer el archivo.'));
          reader.readAsText(file);
        });
      }

      setShowConfirmRestore({ fileContent: text, fileName: file.name });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al leer el archivo.';
      setErrorMessage(`Error de lectura: ${msg}`);
    }
  };

  const executeRestore = async () => {
    if (!showConfirmRestore) return;
    setIsRestoring(true);
    setErrorMessage(null);
    setInfoMessage(null);
    setSuccessMessage(null);

    try {
      const counts: BackupCounts = await LocalBackupService.restoreIntoEmpty(showConfirmRestore.fileContent);
      setShowConfirmRestore(null);
      setSuccessMessage(
        `¡Restauración exitosa! Se cargaron ${counts.teams} equipos, ${counts.players} jugadores, ${counts.matches} partidos, ${counts.scores} anotaciones y ${counts.fouls} faltas.`
      );
      loadStorageStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error durante la restauración.';
      setErrorMessage(`Fallo en la restauración: ${msg}`);
      setShowConfirmRestore(null);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRequestPersistence = async () => {
    setErrorMessage(null);
    setInfoMessage(null);
    try {
      const granted = await LocalBackupService.requestPersistentStorage();
      await loadStorageStatus();
      if (granted) {
        setSuccessMessage('El navegador ha concedido almacenamiento persistente protegido contra desalojo automático.');
      } else {
        setInfoMessage(
          'El navegador no otorgó almacenamiento persistente en este momento (mantiene almacenamiento estándar). Tus registros continúan guardados normalmente en este dispositivo; te recomendamos descargar respaldos periódicos en JSON.'
        );
      }
    } catch {
      setErrorMessage('No se pudo solicitar la persistencia de almacenamiento.');
    }
  };

  return (
    <section className="card" style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none'
        }}
        onClick={() => setIsOpen(prev => !prev)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
          <Database size={20} color="var(--primary)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
                Respaldo y Seguridad de Datos Locales
              </h2>
              {storageStatus && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.45rem',
                    borderRadius: '9999px',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    backgroundColor: storageStatus.persisted
                      ? 'rgba(34, 197, 94, 0.15)'
                      : 'rgba(245, 158, 11, 0.15)',
                    color: storageStatus.persisted ? 'var(--success)' : 'var(--warning, #f59e0b)'
                  }}
                >
                  {storageStatus.persisted ? (
                    <>
                      <ShieldCheck size={11} /> Persistente
                    </>
                  ) : (
                    <>
                      <Shield size={11} /> Estándar
                    </>
                  )}
                </span>
              )}
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              Exporta copias de seguridad verificables o comprueba la persistencia de almacenamiento
            </p>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-sm btn-secondary"
          style={{ padding: '0.4rem 0.6rem' }}
          aria-expanded={isOpen}
          aria-label={isOpen ? 'Ocultar panel' : 'Mostrar panel'}
        >
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {isOpen && (
        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
          {/* Mensajes de éxito, aviso y error */}
          {successMessage && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: '8px',
                color: 'var(--success)',
                marginBottom: '1rem',
                fontSize: '0.85rem'
              }}
            >
              <CheckCircle size={18} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>{successMessage}</div>
              <button
                type="button"
                onClick={() => setSuccessMessage(null)}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          )}

          {infoMessage && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '8px',
                color: 'var(--warning, #f59e0b)',
                marginBottom: '1rem',
                fontSize: '0.85rem'
              }}
            >
              <Shield size={18} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>{infoMessage}</div>
              <button
                type="button"
                onClick={() => setInfoMessage(null)}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          )}

          {errorMessage && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                color: 'var(--danger, #ef4444)',
                marginBottom: '1rem',
                fontSize: '0.85rem'
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>{errorMessage}</div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Diálogo de confirmación para restauración */}
          {showConfirmRestore && (
            <div
              style={{
                padding: '1rem',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '8px',
                marginBottom: '1rem'
              }}
            >
              <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--warning, #f59e0b)', fontSize: '0.95rem' }}>
                Confirmar Restauración
              </h4>
              <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                Se restaurarán todos los datos del archivo <strong>{showConfirmRestore.fileName}</strong> en la base de datos local vacía.
                Esta operación es atómica e importará los equipos, jugadores, partidos y estadísticas con sus identificadores intactos.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={executeRestore}
                  disabled={isRestoring}
                  className="btn btn-sm btn-primary"
                >
                  {isRestoring ? 'Restaurando...' : 'Sí, Restaurar Datos'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirmRestore(null)}
                  disabled={isRestoring}
                  className="btn btn-sm btn-secondary"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Acciones principales: Exportar y Restaurar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="btn btn-sm btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Download size={15} />
              {isExporting ? 'Generando...' : 'Descargar Respaldo (JSON)'}
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isRestoring}
              className="btn btn-sm btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Upload size={15} />
              {isRestoring ? 'Procesando...' : 'Restaurar Respaldo'}
            </button>

            <input
              type="file"
              ref={fileInputRef}
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>

          {/* Estado de Persistencia del Navegador */}
          <div
            style={{
              padding: '0.75rem 0.85rem',
              backgroundColor: 'var(--bg-surface, #1e293b)',
              borderRadius: '6px',
              fontSize: '0.8rem',
              marginBottom: '0.75rem'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '0.5rem'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                {storageStatus?.supported ? (
                  storageStatus.persisted ? (
                    <ShieldCheck size={16} color="var(--success)" style={{ flexShrink: 0 }} />
                  ) : (
                    <Shield size={16} color="var(--warning, #f59e0b)" style={{ flexShrink: 0 }} />
                  )
                ) : (
                  <HardDrive size={16} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                )}
                <span>
                  {storageStatus?.supported
                    ? storageStatus.persisted
                      ? 'Almacenamiento persistente activo (protegido contra desalojo automático).'
                      : 'Almacenamiento estándar (el navegador podría limpiar datos si se queda sin espacio en disco).'
                    : 'API de persistencia de almacenamiento no disponible en este navegador o entorno (modo estándar activo).'}
                </span>
                {storageStatus?.usageFormatted && (
                  <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    <HardDrive size={13} />
                    {storageStatus.usageFormatted}
                    {storageStatus.quotaFormatted ? ` / ${storageStatus.quotaFormatted}` : ''}
                    {storageStatus.percentUsed !== undefined ? ` (${storageStatus.percentUsed}%)` : ''}
                  </span>
                )}
              </div>

              {storageStatus?.supported && !storageStatus.persisted && (
                <button
                  type="button"
                  onClick={handleRequestPersistence}
                  className="btn btn-xs btn-secondary"
                  style={{ padding: '0.2rem 0.5rem' }}
                >
                  Solicitar Persistencia
                </button>
              )}
            </div>

            {/* Explicación breve de la importancia del respaldo */}
            <div
              style={{
                marginTop: '0.5rem',
                paddingTop: '0.5rem',
                borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                lineHeight: 1.4
              }}
            >
              <strong>Nota sobre la protección de datos:</strong> El almacenamiento local o persistente previene la depuración automática por falta de espacio en disco, pero <em>no</em> protege ante borrado manual del historial, limpieza de datos del sitio o cambio de dispositivo. Te recomendamos descargar respaldos periódicos en formato JSON.
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
