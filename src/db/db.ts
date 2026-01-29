// src/db/db.ts
import Dexie, { type Table } from 'dexie';
import type { Team, Player, Match, Score, Foul } from './models';

export class BasketControlDB extends Dexie {
    teams!: Table<Team>;
    players!: Table<Player>;
    matches!: Table<Match>;
    scores!: Table<Score>;
    fouls!: Table<Foul>;

    constructor() {
        super('basket_control_db');

        this.version(2).stores({
            teams: '++id, name, createdAt',
            players: '++id, teamId, name',
            matches: '++id, status, createdAt',
            scores: '++id, matchId, teamId, quarter, [matchId+quarter]',
            fouls: '++id, matchId, teamId, playerId, quarter, [matchId+quarter], [matchId+teamId+quarter], [matchId+playerId]'
        });

        this.version(3).stores({
            players: '++id, teamId, name, number'
        });

        this.version(4).stores({
            matches: '++id, status, createdAt, totalQuarters'
        }).upgrade(tx => {
            return tx.table('matches').toCollection().modify(match => {
                if (!match.totalQuarters) match.totalQuarters = 4;
            });
        });

        this.version(5).stores({
            teams: '++id, name, createdAt, isArchived'
        }).upgrade(tx => {
            return tx.table('teams').toCollection().modify(team => {
                if (team.isArchived === undefined) team.isArchived = false;
            });
        });

        // --- 🟢 VERSIÓN 6: Migración para Desnormalización ---
        this.version(6).stores({
            // No cambiamos índices, pero definimos la versión para ejecutar el upgrade
            matches: '++id, status, createdAt, totalQuarters' 
        }).upgrade(async tx => {
            // 1. Obtenemos todos los datos necesarios
            const matches = await tx.table('matches').toArray();
            const scores = await tx.table('scores').toArray();
            const fouls = await tx.table('fouls').toArray();

            // 2. Iteramos cada partido para calcular sus totales
            for (const m of matches) {
                // Filtrar scores y fouls de este partido
                const mScores = scores.filter((s: Score) => s.matchId === m.id);
                const mFouls = fouls.filter((f: Foul) => f.matchId === m.id);

                // Calcular totales
                const localScore = mScores
                    .filter((s: Score) => s.teamId === m.localTeamId)
                    .reduce((acc: number, curr: Score) => acc + curr.points, 0);
                
                const visitorScore = mScores
                    .filter((s: Score) => s.teamId === m.visitorTeamId)
                    .reduce((acc: number, curr: Score) => acc + curr.points, 0);

                const localFouls = mFouls
                    .filter((f: Foul) => f.teamId === m.localTeamId).length;
                
                const visitorFouls = mFouls
                    .filter((f: Foul) => f.teamId === m.visitorTeamId).length;

                // Actualizar el partido
                await tx.table('matches').update(m.id, {
                    localScore,
                    visitorScore,
                    localFouls,
                    visitorFouls
                });
            }
        });
    }
}

export const db = new BasketControlDB();