import { db } from './db';
import type { Foul } from './models';

type AddFoulInput = {
    matchId: number;
    teamId: number;
    quarter: number;
    playerId?: number;
};

export const FoulsRepository = {
    /**
     * Registra una falta
     */
    async add(input: AddFoulInput): Promise<number> {
        // Usamos transacción para leer el match con seguridad
        return db.transaction('rw', db.fouls, db.matches, async () => {
            const match = await db.matches.get(input.matchId);

            if (!match) throw new Error('El partido no existe');

            if (match.status === 'finished') {
                throw new Error('El partido ha finalizado');
            }

            // Validar equipo
            if (input.teamId !== match.localTeamId && input.teamId !== match.visitorTeamId) {
                throw new Error('El equipo no corresponde a este partido');
            }

            // 🛑 NUEVA VALIDACIÓN: Reloj detenido
            if (!match.timerLastStart) {
                throw new Error('Debes reanudar el reloj para marcar faltas.');
            }

            return db.fouls.add({
                matchId: input.matchId,
                teamId: input.teamId,
                playerId: input.playerId,
                quarter: input.quarter,
                createdAt: new Date()
            });
        });
    },

    /**
     * Faltas por partido
     */
    async getByMatch(matchId: number): Promise<Foul[]> {
        return db.fouls
            .where('matchId')
            .equals(matchId)
            .toArray();
    },

    /**
     * Faltas por partido y cuarto
     */
    async getByMatchAndQuarter(
        matchId: number,
        quarter: number
    ): Promise<Foul[]> {
        return db.fouls
            .where('[matchId+quarter]')
            .equals([matchId, quarter])
            .toArray();
    },

    /**
     * Conteo de faltas por equipo en un cuarto
     */
    async countTeamFouls(
        matchId: number,
        teamId: number,
        quarter: number
    ): Promise<number> {
        return db.fouls
            .where('[matchId+teamId+quarter]')
            .equals([matchId, teamId, quarter])
            .count();
    },

    /**
     * Conteo de faltas por jugador (todo el partido)
     */
    async countPlayerFouls(
        matchId: number,
        playerId: number
    ): Promise<number> {
        return db.fouls
            .where('[matchId+playerId]')
            .equals([matchId, playerId])
            .count();
    },

    /**
     * Elimina la última falta
     */
    async removeLast(matchId: number): Promise<void> {
        const last = await db.fouls
            .where('matchId')
            .equals(matchId)
            .reverse()
            .sortBy('createdAt');

        if (last.length > 0) {
            await db.fouls.delete(last[0].id!);
        }
    }
};
