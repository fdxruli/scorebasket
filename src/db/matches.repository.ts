import { db } from './db';
import type { Match, MatchConfig } from './models';

export const MatchesRepository = {
    async create(localTeamId: number, visitorTeamId: number, quarterDuration: number = 10, totalQuarters: number = 4) {
        return db.matches.add({
            localTeamId,
            visitorTeamId,
            status: 'created',
            createdAt: new Date(),
            // 🆕 Nueva estructura de configuración
            config: {
                mode: 'traditional',
                traditional: {
                    totalQuarters,
                    minutesPerQuarter: quarterDuration
                }
            },
            localScore: 0,
            visitorScore: 0,
            localFouls: 0,
            visitorFouls: 0,
            currentQuarter: 1,
            timerSecondsRemaining: quarterDuration * 60,
            // Mantener temporalmente para compatibilidad si es necesario
            quarterDuration,
            totalQuarters
        });
    },

    async start(matchId: number) {
        await db.matches.update(matchId, {
            status: 'playing'
        });
    },

    async finish(matchId: number) {
        await db.matches.update(matchId, {
            status: 'finished',
            finishedAt: new Date(),
            timerLastStart: undefined
        });
    },

    async getById(matchId: number) {
        return db.matches.get(matchId);
    },

    // 🟢 NUEVO — iniciar reloj
    async startTimer(matchId: number) {
        const match = await db.matches.get(matchId);
        if (!match) return;

        if ((match.timerSecondsRemaining ?? 0) <= 0) return;

        await db.matches.update(matchId, {
            timerLastStart: new Date(),
            status: 'playing'
        });
    },

    // 🟢 NUEVO — pausar reloj
    async pauseTimer(matchId: number) {
        const match = await db.matches.get(matchId);
        if (!match || !match.timerLastStart) return;

        const elapsed =
            (Date.now() - match.timerLastStart.getTime()) / 1000;

        await db.matches.update(matchId, {
            timerLastStart: undefined,
            timerSecondsRemaining: Math.max(
                0,
                (match.timerSecondsRemaining ?? 0) - elapsed
            )
        });
    },

    // 🆕 MEJORADO — avanzar de cuarto con validación
    async nextQuarter(matchId: number) {
        const match = await db.matches.get(matchId);
        if (!match) return;

        // Usamos el helper o accedemos a la config de forma segura
        const totalQuarters = match.config?.traditional?.totalQuarters ?? match.totalQuarters ?? 4;
        const currentQuarter = match.currentQuarter ?? 1;
        const quarterDuration = match.config?.traditional?.minutesPerQuarter ?? match.quarterDuration ?? 10;

        if (currentQuarter >= totalQuarters) {
            throw new Error(`Ya se completaron los ${totalQuarters} cuartos reglamentarios`);
        }

        await db.matches.update(matchId, {
            currentQuarter: currentQuarter + 1,
            timerSecondsRemaining: quarterDuration * 60,
            timerLastStart: undefined
        });
    },

    // 🆕 NUEVO — iniciar tiempo extra
    async startOvertime(matchId: number, overtimeDuration: number = 5) {
        const match = await db.matches.get(matchId);
        if (!match) return;

        // Obtenemos el cuarto actual de forma segura (fallback a 1 si es undefined)
        const currentQuarter = match.currentQuarter ?? 1;

        await db.matches.update(matchId, {
            currentQuarter: currentQuarter + 1,
            timerSecondsRemaining: overtimeDuration * 60,
            timerLastStart: undefined,

            // 🆕 También actualizamos la configuración interna para que el timer 
            // sepa que la duración "reglamentaria" cambió en este periodo
            config: {
                ...match.config,
                traditional: match.config.traditional ? {
                    ...match.config.traditional,
                    minutesPerQuarter: overtimeDuration
                } : undefined
            },

            // Mantenemos este para compatibilidad si aún usas el campo legacy
            quarterDuration: overtimeDuration
        });
    },

    // 🟢 NUEVO: Lógica unificada de Deshacer
    async undoLastAction(matchId: number) {
        // 1. Buscamos la última anotación y la última falta
        const lastScore = await db.scores
            .where('matchId').equals(matchId)
            .reverse().sortBy('createdAt').then(r => r[0]);

        const lastFoul = await db.fouls
            .where('matchId').equals(matchId)
            .reverse().sortBy('createdAt').then(r => r[0]);

        // 2. Si no hay nada, salimos
        if (!lastScore && !lastFoul) return;

        // 3. Comparamos cuál es más reciente y la borramos
        if (lastScore && lastFoul) {
            if (lastScore.createdAt > lastFoul.createdAt) {
                await db.scores.delete(lastScore.id!);
            } else {
                await db.fouls.delete(lastFoul.id!);
            }
        } else if (lastScore) {
            // Solo hay scores
            await db.scores.delete(lastScore.id!);
        } else if (lastFoul) {
            // Solo hay faltas
            await db.fouls.delete(lastFoul.id!);
        }
    }
};