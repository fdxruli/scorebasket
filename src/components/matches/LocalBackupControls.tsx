import { useRef, useState, type ChangeEvent } from 'react';
import { DatabaseBackup } from 'lucide-react';
import { LocalBackupService } from '../../db/localBackup.service';

export function LocalBackupControls() {
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const download = async () => {
    if (working) return;
    setWorking(true);
    setMessage('');
    try {
      const payload = await LocalBackupService.exportJson();
      const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `scorebasket-respaldo-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage('Respaldo generado. Guárdalo fuera del navegador.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No fue posible generar el respaldo.');
    } finally {
      setWorking(false);
    }
  };

  const restore = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || working) return;
    setMessage('');
    if (inputRef.current) inputRef.current.value = '';
    if (!window.confirm('Solo se permite restaurar en una base vacía. ¿Deseas validar el archivo y continuar?')) return;
    setWorking(true);
    try {
      const summary = await LocalBackupService.restoreIntoEmpty(await file.text());
      setMessage(`Restaurado: ${summary.matches} partidos, ${summary.teams} equipos y ${summary.players} jugadores. Recarga la pantalla si es necesario.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo restaurar el respaldo.');
    } finally {
      setWorking(false);
    }
  };

  const persist = async () => {
    if (working) return;
    setWorking(true);
    setMessage('');
    try {
      const granted = await LocalBackupService.requestPersistentStorage();
      setMessage(granted
        ? 'El navegador concedió almacenamiento persistente para esta aplicación.'
        : 'El navegador no concedió persistencia. Conserva respaldos externos.');
    } catch {
      setMessage('No se pudo solicitar persistencia. Conserva respaldos externos.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <details className="card" style={{ padding:'0.75rem 1rem', marginBottom:'1rem' }}>
      <summary style={{ cursor:'pointer', fontWeight:700 }}>
        <DatabaseBackup size={16} style={{ verticalAlign:'middle', marginRight:'0.45rem' }} />
        Datos locales y respaldos
      </summary>
      <p className="text-muted" style={{ fontSize:'0.85rem', margin:'0.75rem 0' }}>
        Descarga una copia completa. El JSON no está cifrado; protégelo como un archivo privado.
        Restaurar solo funciona cuando las cinco tablas locales están vacías.
      </p>
      <div className="flex-gap" style={{ flexWrap:'wrap', alignItems:'center' }}>
        <button type="button" className="btn btn-sm btn-secondary" disabled={working} onClick={download}>
          Descargar respaldo
        </button>
        <label className="btn btn-sm btn-secondary" style={{ cursor: working ? 'not-allowed':'pointer' }}>
          Restaurar en base vacía
          <input ref={inputRef} type="file" accept=".json,application/json" disabled={working}
            onChange={restore} style={{ display:'none' }} />
        </label>
        <button type="button" className="btn btn-sm btn-secondary" disabled={working} onClick={persist}>
          Proteger almacenamiento
        </button>
      </div>
      {message && <p role="status" style={{ marginTop:'0.75rem', fontSize:'0.85rem' }}>{message}</p>}
    </details>
  );
}
