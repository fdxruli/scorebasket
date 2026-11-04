// Estado mínimo del service worker (registro en main.tsx, lectura en la UI).
// La actualización NUNCA se aplica sola: solo cuando el usuario llama applyUpdate().
import { registerSW } from 'virtual:pwa-register';

export interface PwaStatus {
  offlineReady: boolean;
  needRefresh: boolean;
}

let status: PwaStatus = { offlineReady: false, needRefresh: false };
const listeners = new Set<() => void>();
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;

function setStatus(patch: Partial<PwaStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function registerPwa() {
  if (updateSW || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  updateSW = registerSW({
    immediate: true,
    onOfflineReady: () => setStatus({ offlineReady: true }),
    onNeedRefresh: () => setStatus({ needRefresh: true }),
    onRegisterError: (err) => console.warn('PWA: error registrando service worker', err),
  });
}

export function subscribePwa(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPwaStatus(): PwaStatus {
  return status;
}

export function dismissOfflineReady() {
  setStatus({ offlineReady: false });
}

/** Activa el SW en espera y recarga. Solo se invoca por acción explícita del usuario. */
export async function applyUpdate() {
  if (updateSW) await updateSW(true);
}
