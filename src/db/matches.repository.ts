import { db } from './db';

export const MatchesRepository = {
    async create(localTeamId: number, visitorTeamId: number, quarterDuration: number = 10, totalQuarters: number = 4) {
        return db.matches.add({
            localTeamId,
            visitorTeamId,
            currentQuarter: 1,
            status: 'created',
            createdAt: new Date(),
            quarterDuration,
            totalQuarters, // 🆕 Guardamos la configuración
            timerSecondsRemaining: quarterDuration * 60
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

    // 🟢 NUEVO — iniciar reloj
    async startTimer(matchId: number) {
        const match = await db.matches.get(matchId);
        if (!match) return;

        if (match.timerSecondsRemaining <= 0) return;

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
                match.timerSecondsRemaining - elapsed
            )
        });
    },

    // 🆕 MEJORADO — avanzar de cuarto con validación
    async nextQuarter(matchId: number) {
        const match = await db.matches.get(matchId);
        if (!match) return;

        // Validar que no excedamos el número de cuartos configurados
        if (match.currentQuarter >= match.totalQuarters) {
            throw new Error(`Ya se completaron los ${match.totalQuarters} cuartos reglamentarios`);
        }

        await db.matches.update(matchId, {
            currentQuarter: match.currentQuarter + 1,
            timerSecondsRemaining: match.quarterDuration * 60,
            timerLastStart: undefined
        });
    },

    // 🆕 NUEVO — iniciar tiempo extra
    async startOvertime(matchId: number, overtimeDuration: number = 5) {
        const match = await db.matches.get(matchId);
        if (!match) return;

        await db.matches.update(matchId, {
            currentQuarter: match.currentQuarter + 1,
            timerSecondsRemaining: overtimeDuration * 60,
            quarterDuration: overtimeDuration, // Actualizar duración para overtime
            timerLastStart: undefined
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