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
    }
}

export const db = new BasketControlDB();
