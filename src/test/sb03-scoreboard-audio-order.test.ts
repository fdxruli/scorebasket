// src/test/sb03-scoreboard-audio-order.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db } from '../db/db';
import { TimeoutService } from '../db/timeout.service';
import * as soundEffects from '../utils/soundEffects';

describe('R1.3-A: Secuencia de Audio en Tiempos Fuera y Activación Directa', () => {
  let localTeamId: number;
  let visitorTeamId: number;
  let matchId: number;

  beforeEach(async () => {
    await db.matches.clear();
    await db.teams.clear();

    localTeamId = (await db.teams.add({
      name: 'Local Team',
      createdAt: new Date(),
      isArchived: false,
    })) as number;

    visitorTeamId = (await db.teams.add({
      name: 'Visitor Team',
      createdAt: new Date(),
      isArchived: false,
    })) as number;

    matchId = (await db.matches.add({
      localTeamId,
      visitorTeamId,
      status: 'playing',
      createdAt: new Date(),
      config: {
        mode: 'traditional',
        traditional: { totalQuarters: 4, minutesPerQuarter: 10, timeoutsPerTeam: 3 },
      },
      localScore: 0,
      visitorScore: 0,
      localFouls: 0,
      visitorFouls: 0,
      localTimeouts: 0,
      visitorTimeouts: 0,
      timerSecondsRemaining: 600,
      timerLastStart: new Date(),
    })) as number;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Orden estricto: unlockAudioContext se invoca síncronamente antes de la transacción IndexedDB y playWhistle solo tras onGranted', async () => {
    const executionLog: string[] = [];

    const unlockSpy = vi.spyOn(soundEffects, 'unlockAudioContext').mockImplementation(() => {
      executionLog.push('1:unlockAudioContext');
    });

    const whistleSpy = vi.spyOn(soundEffects, 'playWhistle').mockImplementation(() => {
      executionLog.push('3:playWhistle');
    });

    // Simular el controlador de clic síncrono de Scoreboard.tsx
    const timeoutInFlightRef = { current: false };
    const maxTimeouts = 3;

    const handleTimeoutClick = async (side: 'local' | 'visitor') => {
      const match = await db.matches.get(matchId);
      if (!match?.id || timeoutInFlightRef.current) return;

      const currentCount = (side === 'local' ? match.localTimeouts : match.visitorTimeouts) ?? 0;
      if (currentCount >= maxTimeouts || match.status === 'finished') {
        return;
      }

      // R1.3-A: Desbloqueo síncrono en el hilo directo del clic
      soundEffects.unlockAudioContext();

      timeoutInFlightRef.current = true;
      executionLog.push('2:transactionStart');
      try {
        await TimeoutService.requestTimeout(match.id, side, {
          onGranted: () => {
            soundEffects.playWhistle();
          },
        });
      } finally {
        timeoutInFlightRef.current = false;
        executionLog.push('4:transactionEnd');
      }
    };

    await handleTimeoutClick('local');

    // Verificar orden secuencial exacto
    expect(executionLog).toEqual([
      '1:unlockAudioContext',
      '2:transactionStart',
      '3:playWhistle',
      '4:transactionEnd',
    ]);

    expect(unlockSpy).toHaveBeenCalledTimes(1);
    expect(whistleSpy).toHaveBeenCalledTimes(1);

    const updatedMatch = await db.matches.get(matchId);
    expect(updatedMatch?.localTimeouts).toBe(1);
    expect(updatedMatch?.timerLastStart).toBeUndefined(); // Reloj pausado
  });

  it('2. Solicitud rechazada por límites no emite playWhistle ni modifica el contador ni reanuda el reloj', async () => {
    // Configurar partido con tiempos fuera agotados
    await db.matches.update(matchId, {
      localTimeouts: 3,
      timerLastStart: undefined, // ya estaba pausado
      timerSecondsRemaining: 300,
    });

    const unlockSpy = vi.spyOn(soundEffects, 'unlockAudioContext');
    const whistleSpy = vi.spyOn(soundEffects, 'playWhistle');

    const timeoutInFlightRef = { current: false };
    const maxTimeouts = 3;

    const handleTimeoutClick = async (side: 'local' | 'visitor') => {
      const match = await db.matches.get(matchId);
      if (!match?.id || timeoutInFlightRef.current) return;

      const currentCount = (side === 'local' ? match.localTimeouts : match.visitorTimeouts) ?? 0;
      if (currentCount >= maxTimeouts || match.status === 'finished') {
        return;
      }

      soundEffects.unlockAudioContext();
      timeoutInFlightRef.current = true;
      try {
        await TimeoutService.requestTimeout(match.id, side, {
          onGranted: () => {
            soundEffects.playWhistle();
          },
        });
      } finally {
        timeoutInFlightRef.current = false;
      }
    };

    await handleTimeoutClick('local');

    // El guard inicial debió abortar sin desbloquear ni silbar
    expect(unlockSpy).not.toHaveBeenCalled();
    expect(whistleSpy).not.toHaveBeenCalled();

    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localTimeouts).toBe(3); // NO reinicia a 0
    expect(matchAfter?.timerLastStart).toBeUndefined(); // Sigue pausado
    expect(matchAfter?.timerSecondsRemaining).toBe(300);
  });

  it('3. Partido finalizado: clic no ejecuta desbloqueo ni emite silbato', async () => {
    await db.matches.update(matchId, {
      status: 'finished',
      localTimeouts: 1,
      visitorTimeouts: 2,
    });

    const unlockSpy = vi.spyOn(soundEffects, 'unlockAudioContext');
    const whistleSpy = vi.spyOn(soundEffects, 'playWhistle');

    const timeoutInFlightRef = { current: false };
    const maxTimeouts = 3;

    const handleTimeoutClick = async (side: 'local' | 'visitor') => {
      const match = await db.matches.get(matchId);
      if (!match?.id || timeoutInFlightRef.current) return;

      const currentCount = (side === 'local' ? match.localTimeouts : match.visitorTimeouts) ?? 0;
      if (currentCount >= maxTimeouts || match.status === 'finished') {
        return;
      }

      soundEffects.unlockAudioContext();
      timeoutInFlightRef.current = true;
      try {
        await TimeoutService.requestTimeout(match.id, side, {
          onGranted: () => {
            soundEffects.playWhistle();
          },
        });
      } finally {
        timeoutInFlightRef.current = false;
      }
    };

    await handleTimeoutClick('visitor');

    expect(unlockSpy).not.toHaveBeenCalled();
    expect(whistleSpy).not.toHaveBeenCalled();

    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.visitorTimeouts).toBe(2);
  });

  it('4. Protección de doble clic en vuelo (inFlight): solo procesa una solicitud', async () => {
    const whistleSpy = vi.spyOn(soundEffects, 'playWhistle').mockImplementation(() => {});
    const unlockSpy = vi.spyOn(soundEffects, 'unlockAudioContext').mockImplementation(() => {});

    const timeoutInFlightRef = { current: false };
    const maxTimeouts = 3;

    const handleTimeoutClick = async (side: 'local' | 'visitor') => {
      const match = await db.matches.get(matchId);
      if (!match?.id || timeoutInFlightRef.current) return;

      const currentCount = (side === 'local' ? match.localTimeouts : match.visitorTimeouts) ?? 0;
      if (currentCount >= maxTimeouts || match.status === 'finished') {
        return;
      }

      soundEffects.unlockAudioContext();
      timeoutInFlightRef.current = true;
      try {
        await TimeoutService.requestTimeout(match.id, side, {
          onGranted: () => {
            soundEffects.playWhistle();
          },
        });
      } finally {
        timeoutInFlightRef.current = false;
      }
    };

    // Lanzar dos clics concurrentes
    await Promise.all([
      handleTimeoutClick('local'),
      handleTimeoutClick('local'),
    ]);

    // Solo uno debió proceder
    expect(unlockSpy).toHaveBeenCalledTimes(1);
    expect(whistleSpy).toHaveBeenCalledTimes(1);
    const matchAfter = await db.matches.get(matchId);
    expect(matchAfter?.localTimeouts).toBe(1);
  });

  it('5. Rechazo interno en TimeoutService no invoca onGranted ni genera silbato', async () => {
    const whistleSpy = vi.spyOn(soundEffects, 'playWhistle');

    // Intentar solicitar timeout sobre partido inexistente
    const res = await TimeoutService.requestTimeout(99999, 'local', {
      onGranted: () => {
        soundEffects.playWhistle();
      },
    });

    expect(res.success).toBe(false);
    expect(whistleSpy).not.toHaveBeenCalled();
  });

  it('6. AudioContext unlocking sintetiza un buffer silencioso sin errores en entornos con Web Audio', () => {
    const mockResume = vi.fn().mockResolvedValue(undefined);
    const mockStart = vi.fn();
    const mockConnect = vi.fn();

    const mockBufferSource = {
      buffer: null,
      connect: mockConnect,
      start: mockStart,
    };

    const mockCreateBuffer = vi.fn().mockReturnValue({});
    const mockCreateBufferSource = vi.fn().mockReturnValue(mockBufferSource);

    class MockAudioContext {
      state = 'suspended';
      destination = {};
      resume = mockResume;
      createBuffer = mockCreateBuffer;
      createBufferSource = mockCreateBufferSource;
    }

    // Polyfill temporal de window y AudioContext
    const origWindow = globalThis.window;
    globalThis.window = {
      AudioContext: MockAudioContext,
      localStorage: { getItem: () => null, setItem: () => {} },
    } as unknown as Window & typeof globalThis;

    try {
      soundEffects.unlockAudioContext();

      expect(mockResume).toHaveBeenCalled();
      expect(mockCreateBuffer).toHaveBeenCalledWith(1, 1, 22050);
      expect(mockCreateBufferSource).toHaveBeenCalled();
      expect(mockStart).toHaveBeenCalledWith(0);
    } finally {
      globalThis.window = origWindow;
    }
  });
});
