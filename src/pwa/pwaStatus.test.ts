import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers: { onNeedRefresh?: () => void; onOfflineReady?: () => void } = {};
const updateSW = vi.fn(async () => {});

vi.mock('virtual:pwa-register', () => ({
  registerSW: (opts: typeof handlers) => {
    Object.assign(handlers, opts);
    return updateSW;
  },
}));

describe('pwaStatus (actualización controlada por el usuario)', () => {
  beforeEach(() => {
    vi.resetModules();
    updateSW.mockClear();
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { serviceWorker: {} });
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
});
