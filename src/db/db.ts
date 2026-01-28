// src/db/db.ts
import Dexie, { type Table } from 'dexie';
import type {
    Team,
    Player,
    Match,
    Score,
    Foul
} from './models';

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
            fouls:
                '++id, matchId, teamId, playerId, quarter, ' +
                '[matchId+quarter], [matchId+teamId+quarter], [matchId+playerId]'

        });

        this.version(3).stores({
            players: '++id, teamId, name, number'
        });

        // 🆕 Version 4: Agregar totalQuarters a matches
        this.version(4).stores({
            matches: '++id, status, createdAt, totalQuarters'
        }).upgrade(tx => {
            // Migración: establecer totalQuarters=4 para partidos existentes
            return tx.table('matches').toCollection().modify(match => {
                if (!match.totalQuarters) {
                    match.totalQuarters = 4;
                }
            });
        });
    }
}

export const db = new BasketControlDB();