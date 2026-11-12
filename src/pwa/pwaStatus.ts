// Estado compartido de la PWA: instalación, uso sin conexión y actualización manual.
// Las actualizaciones nunca se aplican sin una acción explícita del usuario.
import { registerSW } from 'virtual:pwa-register';

type InstallMode = 'native' | 'android' | 'ios' | null;

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaStatus {
  offlineReady: boolean;
  needRefresh: boolean;
  installMode: InstallMode;
  installDismissed: boolean;
}

const DISMISS_KEY = 'scorebasket:pwa-install-dismissed';
let status: PwaStatus = {
  offlineReady: false,
  needRefresh: false,
  installMode: null,
  installDismissed: false,
};
const listeners = new Set<() => void>();
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let deferredInstallPrompt: InstallPromptEvent | null = null;
let installListenersAttached = false;

function setStatus(patch: Partial<PwaStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((listener) => listener());
}

function isInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function fallbackInstallMode(): InstallMode {
  const ua = navigator.userAgent ?? '';
  if (/Android/i.test(ua) && /Chrome\//i.test(ua) && !/(EdgA|OPR|SamsungBrowser|; wv)/i.test(ua)) {
    return 'android';
  }
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return null;
}

function wasDismissed() {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function registerInstallListeners() {
  if (installListenersAttached || typeof window.addEventListener !== 'function') return;
  installListenersAttached = true;

  if (isInstalled()) return;

  setStatus({
    installMode: fallbackInstallMode(),
    installDismissed: wasDismissed(),
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    // Chrome solo ofrece esta acción si considera instalable la aplicación.
    event.preventDefault();
    if (status.installDismissed) return;
    deferredInstallPrompt = event as InstallPromptEvent;
    setStatus({ installMode: 'native' });
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    setStatus({ installMode: null, installDismissed: true });
  });
}

export function registerPwa() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  registerInstallListeners();
  if (updateSW) return;

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

export function dismissInstallNotice() {
  deferredInstallPrompt = null;
  setStatus({ installDismissed: true, installMode: null });
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Algunas configuraciones de privacidad impiden usar sessionStorage.
  }
}

/** La solicitud nativa solo se inicia como consecuencia del clic del usuario. */
export async function installPwa() {
  const event = deferredInstallPrompt;
  if (!event) return;
  deferredInstallPrompt = null;
  setStatus({ installMode: null });
  try {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === 'dismissed') dismissInstallNotice();
  } catch (error) {
    console.warn('PWA: no se pudo iniciar la instalación', error);
    setStatus({ installMode: fallbackInstallMode() });
  }
}

/** Activa el SW en espera y recarga. Solo se invoca por acción explícita del usuario. */
export async function applyUpdate() {
  if (updateSW) await updateSW(true);
}
