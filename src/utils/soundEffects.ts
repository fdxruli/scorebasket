// src/utils/soundEffects.ts

const SOUND_MUTE_KEY = 'scorebasket_sound_muted';

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext || (window as WebkitWindow).webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();
  }

  return audioCtx;
}

/**
 * Desbloquea el AudioContext en iOS Safari y Chrome Android.
 * Debe invocarse dentro de un evento directo del usuario (click/touchstart),
 * como al presionar Play en el reloj, para que el buzzer automático al llegar
 * a 00:00 pueda sonar asíncronamente.
 */
export function unlockAudioContext(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    // Reproducir un buffer silencioso de 1 frame para desbloquear el canal en iOS
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // Ignorar errores si el navegador bloquea el audio
  }
}

/**
 * Indica si el sonido de cancha está silenciado (por defecto false = sonido ACTIVO).
 */
export function isSoundMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SOUND_MUTE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Alterna el estado de silencio y devuelve el nuevo valor de `isSoundMuted()`.
 */
export function toggleSoundMute(): boolean {
  const nextMuted = !isSoundMuted();
  try {
    window.localStorage.setItem(SOUND_MUTE_KEY, String(nextMuted));
  } catch {
    // Ignorar errores de almacenamiento
  }

  if (!nextMuted) {
    unlockAudioContext();
  }

  return nextMuted;
}

/**
 * Chicharra oficial de mesa (fin de cuarto / partido o activación manual).
 * Duración ~1.4s con 3 osciladores desafinados (sawtooth + square) y filtro paso bajo.
 */
export function playBuzzer(): void {
  try {
    navigator.vibrate?.([350, 100, 450]);
  } catch {
    // Ignorar si vibrate no está soportado
  }

  if (isSoundMuted()) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const duration = 1.4;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.Q.setValueAtTime(2.5, now);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.42, now + 0.025);
    masterGain.gain.setValueAtTime(0.42, now + duration - 0.15);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    filter.connect(masterGain);
    masterGain.connect(ctx.destination);

    const configs: Array<{ type: OscillatorType; freq: number; gain: number }> = [
      { type: 'sawtooth', freq: 145, gain: 0.45 },
      { type: 'sawtooth', freq: 148, gain: 0.45 },
      { type: 'square', freq: 290, gain: 0.28 },
    ];

    configs.forEach(({ type, freq, gain }) => {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      oscGain.gain.setValueAtTime(gain, now);

      osc.connect(oscGain);
      oscGain.connect(filter);

      osc.start(now);
      osc.stop(now + duration + 0.02);
    });
  } catch {
    // Ignorar errores de audio
  }
}

/**
 * Silbato corto de árbitro (para faltas o solicitud de Tiempo Fuera).
 * Duración ~0.45s con modulación LFO de trino (2750 Hz <-> 2950 Hz a ~45 Hz).
 */
export function playWhistle(): void {
  try {
    navigator.vibrate?.([120, 40, 120]);
  } catch {
    // Ignorar si vibrate no está soportado
  }

  if (isSoundMuted()) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const duration = 0.45;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2850, now);

    // LFO para el trino característico del silbato de árbitro (2750 Hz <-> 2950 Hz)
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(45, now);
    lfoGain.gain.setValueAtTime(100, now);

    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
    gain.gain.setValueAtTime(0.26, now + duration - 0.09);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    lfo.start(now);
    osc.stop(now + duration + 0.02);
    lfo.stop(now + duration + 0.02);
  } catch {
    // Ignorar errores de audio
  }
}

/**
 * Feedback auditivo corto y limpio al registrar puntos (+1, +2 o +3).
 */
export function playScorePop(points: 1 | 2 | 3): void {
  if (isSoundMuted()) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const baseFreq = points === 1 ? 520 : points === 2 ? 660 : 880;
    const duration = points === 3 ? 0.07 : 0.05;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.25, now + duration);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.01);

    // En triples (+3), añadir un segundo armónico brillante corto
    if (points === 3) {
      const harmonic = ctx.createOscillator();
      const harmonicGain = ctx.createGain();

      harmonic.type = 'triangle';
      harmonic.frequency.setValueAtTime(baseFreq * 1.5, now + 0.015);
      harmonic.frequency.exponentialRampToValueAtTime(baseFreq * 2, now + duration + 0.02);

      harmonicGain.gain.setValueAtTime(0.001, now + 0.015);
      harmonicGain.gain.exponentialRampToValueAtTime(0.12, now + 0.025);
      harmonicGain.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.025);

      harmonic.connect(harmonicGain);
      harmonicGain.connect(ctx.destination);

      harmonic.start(now + 0.015);
      harmonic.stop(now + duration + 0.03);
    }
  } catch {
    // Ignorar errores de audio
  }
}
