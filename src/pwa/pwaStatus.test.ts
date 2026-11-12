import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers: { onNeedRefresh?: () => void; onOfflineReady?: () => void } = {};
const updateSW = vi.fn(async () => {});
let browserEvents: Map<string, EventListener>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };

vi.mock('virtual:pwa-register', () => ({
  registerSW: (opts: typeof handlers) => {
    Object.assign(handlers, opts);
    return updateSW;
  },
}));

describe('pwaStatus (actualización controlada e instalación)', () => {
  beforeEach(() => {
    vi.resetModules();
    updateSW.mockClear();
    browserEvents = new Map();
    storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    vi.stubGlobal('sessionStorage', storage);
    vi.stubGlobal('window', {
      addEventListener: (name: string, listener: EventListener) => browserEvents.set(name, listener),
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal('navigator', {
      serviceWorker: {},
      userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    });
  });

  it('una versión nueva solo marca needRefresh y NO activa ni recarga sola', async () => {
    const pwa = await import('./pwaStatus');
    pwa.registerPwa();
    handlers.onNeedRefresh?.();
    expect(pwa.getPwaStatus().needRefresh).toBe(true);
    expect(updateSW).not.toHaveBeenCalled();
  });

  it('applyUpdate (acción del usuario) activa el SW con recarga', async () => {
    const pwa = await import('./pwaStatus');
    pwa.registerPwa();
    await pwa.applyUpdate();
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('offlineReady se puede descartar y notifica a los suscriptores', async () => {
    const pwa = await import('./pwaStatus');
    pwa.registerPwa();
    const listener = vi.fn();
    pwa.subscribePwa(listener);
    handlers.onOfflineReady?.();
    expect(pwa.getPwaStatus().offlineReady).toBe(true);
    pwa.dismissOfflineReady();
    expect(pwa.getPwaStatus().offlineReady).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ofrece instrucciones en Chrome Android aunque no llegue el evento nativo', async () => {
    const pwa = await import('./pwaStatus');
    pwa.registerPwa();
    expect(pwa.getPwaStatus().installMode).toBe('android');
  });

  it('usa el prompt nativo solo tras instalar desde el botón', async () => {
    const pwa = await import('./pwaStatus');
    pwa.registerPwa();
    const prompt = vi.fn(async () => {});
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    browserEvents.get('beforeinstallprompt')?.(event);
    expect(event.defaultPrevented).toBe(true);
    expect(pwa.getPwaStatus().installMode).toBe('native');
    expect(prompt).not.toHaveBeenCalled();

    await pwa.installPwa();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(pwa.getPwaStatus().installMode).toBe(null);
  });

  it('deja de ofrecer instalación si se descarta o se instala', async () => {
    const pwa = await import('./pwaStatus');
    pwa.registerPwa();
    pwa.dismissInstallNotice();
    expect(pwa.getPwaStatus().installDismissed).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith('scorebasket:pwa-install-dismissed', '1');

    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    browserEvents.get('beforeinstallprompt')?.(event);
    expect(pwa.getPwaStatus().installMode).toBe(null);

    browserEvents.get('appinstalled')?.(new Event('appinstalled'));
    expect(pwa.getPwaStatus().installDismissed).toBe(true);
    expect(pwa.getPwaStatus().installMode).toBe(null);
  });

  it('no ofrece instalar cuando ya se abrió como app instalada', async () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      matchMedia: () => ({ matches: true }),
    });
    const pwa = await import('./pwaStatus');
    pwa.registerPwa();
    expect(pwa.getPwaStatus().installMode).toBe(null);
  });
});
