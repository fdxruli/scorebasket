import { db } from './db';
import type { Score } from './models';

type AddScoreInput = {
    matchId: number;
    teamId: number;
    points: 1 | 2 | 3;
    quarter: number;
    playerId?: number;
};

export const ScoresRepository = {
    /**
     * Agrega una anotación al partido
     * Esta operación es ultra frecuente → debe ser simple y rápida
     */
    async add(input: AddScoreInput): Promise<number> {
        return db.transaction('rw', db.scores, db.matches, async () => {
            const match = await db.matches.get(input.matchId);

            if (!match) throw new Error('El partido no existe');

            if (match.status === 'finished') {
                throw new Error('El partido ha finalizado');
            }

            // 4. Validar Equipo (Del paso anterior)
            if (input.teamId !== match.localTeamId && input.teamId !== match.visitorTeamId) {
                throw new Error('El equipo no corresponde a este partido');
            }

            // 5. 🛑 NUEVA VALIDACIÓN: Reloj detenido
            // Si timerLastStart es undefined, el reloj está en pausa.
            if (!match.timerLastStart || match.timerSecondsRemaining <= 0) {
                throw new Error('Debes reanudar el reloj para anotar puntos.');
            }

            return db.scores.add({
                matchId: input.matchId,
                teamId: input.teamId,
                playerId: input.playerId,
                points: input.points,
                quarter: input.quarter, // O usa match.currentQuarter para más seguridad
                createdAt: new Date()
            });
        });
    },

    /**
     * Obtiene todas las anotaciones de un partido
     * Útil para estadísticas y resumen
     */
    async getByMatch(matchId: number): Promise<Score[]> {
        return db.scores
            .where('matchId')
            .equals(matchId)
            .toArray();
    },

    /**
     * Obtiene anotaciones por partido y cuarto
     * Optimizado para marcador en vivo
     */
    async getByMatchAndQuarter(
        matchId: number,
        quarter: number
    ): Promise<Score[]> {
        return db.scores
            .where('[matchId+quarter]')
            .equals([matchId, quarter])
            .toArray();
    },

    /**
     * Calcula el marcador actual de un partido
     * 🔥 FUNCIÓN CLAVE
     */
    async getScoreboard(matchId: number): Promise<
        Record<number, number>
    > {
        const scores = await db.scores
            .where('matchId')
            .equals(matchId)
            .toArray();

        return scores.reduce((acc, score) => {
            acc[score.teamId] =
                (acc[score.teamId] || 0) + score.points;
            return acc;
        }, {} as Record<number, number>);
    },

    /**
     * Elimina la última anotación (UNDO)
     * Muy útil para errores humanos
     */
    async removeLast(matchId: number): Promise<void> {
        const last = await db.scores
            .where('matchId')
            .equals(matchId)
            .reverse()
            .sortBy('createdAt');

        if (last.length === 0) return;

        await db.scores.delete(last[0].id!);
    }
};
