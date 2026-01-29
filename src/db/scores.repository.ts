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
            if (input.teamId !== match.localTeamId && input.teamId !== match.visitorTeamId) {
                throw new Error('El equipo no corresponde a este partido');
            }
            if (!match.timerLastStart || match.timerSecondsRemaining <= 0) {
                throw new Error('Debes reanudar el reloj para anotar puntos.');
            }

            // 1. Agregar Score
            const scoreId = await db.scores.add({
                matchId: input.matchId,
                teamId: input.teamId,
                playerId: input.playerId,
                points: input.points,
                quarter: input.quarter,
                createdAt: new Date()
            });

            // 2. 🟢 Actualizar Match (Desnormalización)
            const isLocal = input.teamId === match.localTeamId;
            const updatePayload = isLocal 
                ? { localScore: (match.localScore || 0) + input.points }
                : { visitorScore: (match.visitorScore || 0) + input.points };
            
            await db.matches.update(input.matchId, updatePayload);

            return scoreId;
        });
    },

    // ... (Mantén getByMatch, getByMatchAndQuarter, getScoreboard iguales) ...

    async removeLast(matchId: number): Promise<void> {
        return db.transaction('rw', db.scores, db.matches, async () => {
            const lastArray = await db.scores
                .where('matchId')
                .equals(matchId)
                .reverse()
                .sortBy('createdAt');

            if (lastArray.length === 0) return;
            const lastScore = lastArray[0];

            // 1. Borrar Score
            await db.scores.delete(lastScore.id!);

            // 2. 🟢 Restar del Match
            const match = await db.matches.get(matchId);
            if (match) {
                const isLocal = lastScore.teamId === match.localTeamId;
                const currentScore = isLocal ? (match.localScore || 0) : (match.visitorScore || 0);
                // Evitar negativos por seguridad
                const newScore = Math.max(0, currentScore - lastScore.points);

                const updatePayload = isLocal 
                    ? { localScore: newScore }
                    : { visitorScore: newScore };
                
                await db.matches.update(matchId, updatePayload);
            }
        });
    }
};
