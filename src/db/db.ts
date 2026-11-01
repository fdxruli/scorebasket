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

        // V6: migración histórica de contadores. Agregación O(eventos + partidos)
        // en lugar de filtrar TODAS las acciones una vez por cada partido.
        this.version(6).stores({
            matches: '++id, status, createdAt, totalQuarters'
        }).upgrade(async tx => {
            const scoreTotals = new Map<number, Map<number, number>>();
            const foulTotals = new Map<number, Map<number, number>>();
            const accumulate = (
                totals: Map<number, Map<number, number>>,
                matchId: number,
                teamId: number,
                delta: number
            ) => {
                let teams = totals.get(matchId);
                if (!teams) {
                    teams = new Map<number, number>();
                    totals.set(matchId, teams);
                }
                teams.set(teamId, (teams.get(teamId) ?? 0) + delta);
            };
            // Los callbacks de each() son sincrónicos y no dejan morir la
            // transacción upgrade de IndexedDB.
            await tx.table('scores').each((score: Score) => {
                accumulate(scoreTotals, score.matchId, score.teamId, score.points);
            });
            await tx.table('fouls').each((foul: Foul) => {
                accumulate(foulTotals, foul.matchId, foul.teamId, 1);
            });
            await tx.table('matches').toCollection().modify((match: Match) => {
                const scoreByTeam = scoreTotals.get(match.id ?? -1);
                const foulsByTeam = foulTotals.get(match.id ?? -1);
                match.localScore = scoreByTeam?.get(match.localTeamId) ?? 0;
                match.visitorScore = scoreByTeam?.get(match.visitorTeamId) ?? 0;
                match.localFouls = foulsByTeam?.get(match.localTeamId) ?? 0;
                match.visitorFouls = foulsByTeam?.get(match.visitorTeamId) ?? 0;
            });
        });

        // V7: adaptación de config. Modificación por cursor, sin cargar
        // la tabla entera ni lanzar una escritura por cada partido.
        this.version(7).stores({
            matches: '++id, status, createdAt, config.mode'
        }).upgrade(tx =>
            tx.table('matches').toCollection().modify((match: Match) => {
                match.config = {
                    mode: 'traditional',
                    traditional: {
                        totalQuarters: match.totalQuarters || 4,
                        minutesPerQuarter: match.quarterDuration || 10
                    }
                };
                match.localScore = match.localScore ?? 0;
                match.visitorScore = match.visitorScore ?? 0;
                match.localFouls = match.localFouls ?? 0;
                match.visitorFouls = match.visitorFouls ?? 0;
            })
        );

        // 🆕 VERSIÓN 8: Incorporación de índices relacionales en matches (SB-01)
        this.version(8).stores({
            matches: '++id, status, createdAt, config.mode, localTeamId, visitorTeamId'
        });

        // V9: Índices adicionales únicamente. Conserva IDs, eventos, marcadores y
        // todas las migraciones anteriores; nunca reescribe resultados históricos.
        this.version(9).stores({
            matches: '++id, status, createdAt, config.mode, localTeamId, visitorTeamId, [status+createdAt], [status+config.mode+createdAt]',
            scores: '++id, matchId, teamId, quarter, [matchId+quarter], [matchId+quarter+createdAt]',
            fouls: '++id, matchId, teamId, playerId, quarter, [matchId+quarter], [matchId+teamId+quarter], [matchId+playerId], [matchId+quarter+createdAt]'
        });
    }
}

export const db = new BasketControlDB();
