import { db } from './db';

type AddScoreInput = {
    matchId: number;
    teamId: number;
    points: 1 | 2 | 3;
    quarter: number;
    playerId?: number;
};

export const ScoresRepository = {
    async add(input: AddScoreInput): Promise<number> {
        return db.transaction('rw', db.scores, db.matches, async () => {
            const match = await db.matches.get(input.matchId);

            if (!match) throw new Error('El partido no existe');
            if (match.status === 'finished') throw new Error('El partido ha finalizado');

            // 1. Validar que el equipo pertenezca al partido
            if (input.teamId !== match.localTeamId && input.teamId !== match.visitorTeamId) {
                throw new Error('El equipo no corresponde a este partido');
            }

            // 2. 🛡️ CORRECCIÓN: Validar reloj y tiempo restante (con fallback a 0)
            if (!match.timerLastStart || (match.timerSecondsRemaining ?? 0) <= 0) {
                throw new Error('Debes reanudar el reloj para anotar puntos.');
            }

            // 3. Agregar el Score
            const scoreId = await db.scores.add({
                matchId: input.matchId,
                teamId: input.teamId,
                playerId: input.playerId,
                points: input.points,
                quarter: input.quarter,
                createdAt: new Date()
            });

            // 4. 🟢 ACTUALIZAR MATCH (Marcador acumulado)
            // Esto es vital para que Matches.tsx muestre el score sin recalcular todo
            const isLocal = input.teamId === match.localTeamId;
            const updatePayload = isLocal
                ? { localScore: (match.localScore || 0) + input.points }
                : { visitorScore: (match.visitorScore || 0) + input.points };

            await db.matches.update(input.matchId, updatePayload);

            return scoreId;
        });
    },

    async removeLast(matchId: number): Promise<void> {
        return db.transaction('rw', db.scores, db.matches, async () => {
            const lastArray = await db.scores
                .where('matchId')
                .equals(matchId)
                .reverse()
                .sortBy('createdAt');

            if (lastArray.length === 0) return;
            const lastScore = lastArray[0];

            // 1. Borrar de la tabla Scores
            await db.scores.delete(lastScore.id!);

            // 2. 🟢 RESTAR DEL MATCH (Para mantener sincronía)
            const match = await db.matches.get(matchId);
            if (match) {
                const isLocal = lastScore.teamId === match.localTeamId;
                const currentScore = isLocal ? (match.localScore || 0) : (match.visitorScore || 0);

                const updatePayload = isLocal
                    ? { localScore: Math.max(0, currentScore - lastScore.points) }
                    : { visitorScore: Math.max(0, currentScore - lastScore.points) };

                await db.matches.update(matchId, updatePayload);
            }
        });
    }
};
