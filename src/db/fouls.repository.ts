// src/db/fouls.repository.ts
import { db } from './db';

type AddFoulInput = {
    matchId: number;
    teamId: number;
    quarter: number;
    playerId?: number;
};

export const FoulsRepository = {
    async add(input: AddFoulInput): Promise<number> {
        return db.transaction('rw', db.fouls, db.matches, async () => {
            const match = await db.matches.get(input.matchId);
            if (!match) throw new Error('El partido no existe');
            if (match.status === 'finished') throw new Error('El partido ha finalizado');
            if (input.teamId !== match.localTeamId && input.teamId !== match.visitorTeamId) {
                throw new Error('El equipo no corresponde a este partido');
            }
            if (!match.timerLastStart) {
                throw new Error('Debes reanudar el reloj para marcar faltas.');
            }

            // 1. Agregar Falta
            const foulId = await db.fouls.add({
                matchId: input.matchId,
                teamId: input.teamId,
                playerId: input.playerId,
                quarter: input.quarter,
                createdAt: new Date()
            });

            // 2. 🟢 Actualizar Match
            const isLocal = input.teamId === match.localTeamId;
            const updatePayload = isLocal 
                ? { localFouls: (match.localFouls || 0) + 1 }
                : { visitorFouls: (match.visitorFouls || 0) + 1 };
            
            await db.matches.update(input.matchId, updatePayload);

            return foulId;
        });
    },

    // ... (Mantén los métodos de lectura iguales) ...

    async removeLast(matchId: number): Promise<void> {
        return db.transaction('rw', db.fouls, db.matches, async () => {
            const lastArray = await db.fouls
                .where('matchId')
                .equals(matchId)
                .reverse()
                .sortBy('createdAt');

            if (lastArray.length === 0) return;
            const lastFoul = lastArray[0];

            // 1. Borrar Falta
            await db.fouls.delete(lastFoul.id!);

            // 2. 🟢 Restar del Match
            const match = await db.matches.get(matchId);
            if (match) {
                const isLocal = lastFoul.teamId === match.localTeamId;
                const currentFouls = isLocal ? (match.localFouls || 0) : (match.visitorFouls || 0);
                const newFouls = Math.max(0, currentFouls - 1);

                const updatePayload = isLocal 
                    ? { localFouls: newFouls }
                    : { visitorFouls: newFouls };

                await db.matches.update(matchId, updatePayload);
            }
        });
    }
};