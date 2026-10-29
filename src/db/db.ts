// src/db/db.ts
import Dexie, { type Table } from 'dexie';
import type { Team } from './models/Team';
import type { Player } from './models/Player';
import type { Match } from './models/Match';
import type { Score } from './models/Score';
import type { Foul } from './models/Foul';

export class BasketControlDB extends Dexie {
    teams!: Table<Team>;
    players!: Table<Player>;
    matches!: Table<Match>;
    scores!: Table<Score>;
    fouls!: Table<Foul>;

    constructor(databaseName = 'basket_control_db') {
        super(databaseName);

        // Versiones anteriores (mantener para compatibilidad)
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

        this.version(6).stores({
            matches: '++id, status, createdAt, totalQuarters' 
        }).upgrade(async tx => {
            const matches = await tx.table('matches').toArray();
            const scores = await tx.table('scores').toArray();
            const fouls = await tx.table('fouls').toArray();

            for (const m of matches) {
                const mScores = scores.filter((s: Score) => s.matchId === m.id);
                const mFouls = fouls.filter((f: Foul) => f.matchId === m.id);

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

                await tx.table('matches').update(m.id, {
                    localScore,
                    visitorScore,
                    localFouls,
                    visitorFouls
                });
            }
        });

        // 🆕 VERSIÓN 7: Migración a nuevo sistema de configuración
        this.version(7).stores({
            matches: '++id, status, createdAt, config.mode'
        }).upgrade(async tx => {
            const matches = await tx.table('matches').toArray();
            
            for (const match of matches) {
                // Crear configuración tradicional desde campos legacy
                const config = {
                    mode: 'traditional' as const,
                    traditional: {
                        totalQuarters: match.totalQuarters || 4,
                        minutesPerQuarter: match.quarterDuration || 10
                    }
                };
                
                // Asegurar que los scores existan (si no hay migración previa)
                const updates: Partial<Match> = { 
                    config,
                    localScore: match.localScore ?? 0,
                    visitorScore: match.visitorScore ?? 0,
                    localFouls: match.localFouls ?? 0,
                    visitorFouls: match.visitorFouls ?? 0
                };
                
                await tx.table('matches').update(match.id, updates);
            }
        });

        // 🆕 VERSIÓN 8: Incorporación de índices relacionales en matches (SB-01)
        this.version(8).stores({
            matches: '++id, status, createdAt, config.mode, localTeamId, visitorTeamId'
        });
    }
}

export const db = new BasketControlDB();
