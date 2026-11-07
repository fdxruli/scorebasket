// src/utils/haptics.ts

export type HapticFeedbackType =
  | 'initial_prompt'
  | 'score'
  | 'turnover'
  | 'shot_clock_expired';

/**
 * Emite vibraciones táctiles discretas y no invasivas cuando la API está disponible
 * y el usuario no ha solicitado reducción de movimiento.
 */
export function triggerHaptic(type: HapticFeedbackType, enabled: boolean = true): void {
  if (!enabled) return;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;

  // Respetar preferencia de accesibilidad prefers-reduced-motion
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
  } catch {
    // Silencioso ante entornos sin matchMedia
  }

  try {
    switch (type) {
      case 'initial_prompt':
        navigator.vibrate(50);
        break;
      case 'score':
        navigator.vibrate([35, 30, 35]);
        break;
      case 'turnover':
        navigator.vibrate(45);
        break;
      case 'shot_clock_expired':
        navigator.vibrate([120, 60, 120]);
        break;
    }
  } catch {
    // Silencioso ante restricciones de políticas del navegador (e.g. iframes o falta de user gesture)
  }
}
