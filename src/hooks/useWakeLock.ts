import { useEffect, useRef } from 'react';

/**
 * Mantiene la pantalla encendida usando la Screen Wake Lock API mientras `enabled` sea true.
 * Re-adquiere el lock cuando la pestaña vuelve a ser visible y lo libera al desmontar.
 */
export function useWakeLock(enabled = true) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let cancelled = false;

    const requestLock = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          await sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // Silencioso en navegadores no compatibles o cuando el sistema deniega el permiso
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestLock();
      }
    };

    void requestLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sentinelRef.current) {
        void sentinelRef.current.release().catch(() => {});
        sentinelRef.current = null;
      }
    };
  }, [enabled]);
}
