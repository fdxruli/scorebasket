// src/components/matches/MatchHistoryModal.tsx
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import {
    X,
    Calendar,
    BarChart2,
    Users,
    Target,
    Layers,
    Trash2,
    Share2,
    Download,
    CheckCircle2,
    Trophy,
    ShieldAlert,
    Activity
} from 'lucide-react';
import {
    deleteMatchCascade,
    computeMatchReportStats,
    type TeamReportStats,
    type ReportStatAvailability
} from '../../utils/matchHelpers';
import {
    shareOrDownloadMatchCard,
    downloadMatchCardPng,
    type ShareMatchCardInput
} from '../../utils/shareCardGenerator';

interface MatchHistoryModalProps {
    matchId: number;
    onClose: () => void;
}

export function MatchHistoryModal({ matchId, onClose }: MatchHistoryModalProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [shareFeedback, setShareFeedback] = useState<string | null>(null);

    // --- 1. CARGA DE DATOS ---
    const data = useLiveQuery(async () => {
        const match = await db.matches.get(matchId);
        if (!match) return null;

        const [localTeam, visitorTeam, scores, fouls, teamPlayers] = await Promise.all([
            db.teams.get(match.localTeamId),
            db.teams.get(match.visitorTeamId),
            db.scores.where({ matchId }).toArray(),
            db.fouls.where({ matchId }).toArray(),
            db.players.where('teamId').anyOf([match.localTeamId, match.visitorTeamId]).toArray()
        ]);

        const safeScores = scores || [];
        const safeFouls = fouls || [];
        const safeTeamPlayers = teamPlayers || [];

        const knownIds = new Set(
            safeTeamPlayers.map(p => p.id).filter((id): id is number => id !== undefined)
        );
        const missingPlayerIds = Array.from(
            new Set([
                ...safeScores.map(s => s.playerId).filter((id): id is number => id !== undefined && !knownIds.has(id)),
                ...safeFouls.map(f => f.playerId).filter((id): id is number => id !== undefined && !knownIds.has(id))
            ])
        );

        const extraPlayers =
            missingPlayerIds.length > 0
                ? (await db.players.bulkGet(missingPlayerIds)).filter(
                      (p): p is NonNullable<typeof p> => Boolean(p)
                  )
                : [];

        return {
            match,
            localTeam,
            visitorTeam,
            scores: safeScores,
            fouls: safeFouls,
            players: [...safeTeamPlayers, ...extraPlayers]
        };
    }, [matchId]);

    const handleDeleteMatch = async () => {
        if (!window.confirm('¿Eliminar permanentemente este partido y todas sus estadísticas?')) return;
        try {
            await deleteMatchCascade(matchId);
            onClose();
        } catch (err) {
            console.error('Error al eliminar partido:', err);
            window.alert('No se pudo eliminar el partido.');
        }
    };

    // --- 2. CÁLCULOS CENTRALIZADOS Y LÓGICA DE MODALIDADES ---
    const stats = useMemo(() => {
        if (!data) return null;
        return computeMatchReportStats({
            match: data.match,
            scores: data.scores,
            fouls: data.fouls,
            players: data.players
        });
    }, [data]);

    if (!data || !stats) return null;
    const { match, localTeam, visitorTeam } = data;

    const localName = localTeam?.name || 'Local';
    const visitorName = visitorTeam?.name || 'Visita';

    const formatDate = (date: Date) => {
        try {
            return new Intl.DateTimeFormat('es-MX', {
                weekday: 'short',
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit'
            }).format(date);
        } catch {
            return '';
        }
    };

    const getModeIcon = () => {
        if (stats.mode === 'best-of-series') return <Layers size={15} />;
        if (stats.mode === 'race') return <Target size={15} />;
        return <BarChart2 size={15} />;
    };

    const getModeTitle = () => {
        if (stats.mode === 'best-of-series') return 'Desglose por Sets';
        if (stats.mode === 'race') {
            return stats.isRaceWithGames ? 'Desglose por Juegos' : 'Puntuación por Juego';
        }
        return 'Desglose por Periodos';
    };

    const getWinnerSummaryText = () => {
        if (!stats.isFinished) return 'En curso';
        if (stats.localWon) return `Ganador: ${localName}`;
        if (stats.visitorWon) return `Ganador: ${visitorName}`;
        return 'Resultado: Empate';
    };

    const formatFoulsSummaryValue = (teamStats: TeamReportStats) => {
        if (teamStats.fouls === null) return 'No disponible';
        return String(teamStats.fouls);
    };

    const formatTeamPointsCell = (teamStats: TeamReportStats) => {
        if (teamStats.officialPoints === null) return 'No disponible';
        if (teamStats.scoreAvailability === 'partial') {
            return `${teamStats.officialPoints} (${teamStats.eventPoints} reg.)`;
        }
        return String(teamStats.officialPoints);
    };

    const formatTeamBasketCell = (
        value: number | null,
        availability: ReportStatAvailability,
        partialValue: number
    ) => {
        if (availability === 'confirmed' && value !== null) {
            return String(value);
        }
        if (availability === 'partial' && partialValue > 0) {
            return `No disponible (${partialValue} reg.)`;
        }
        return 'No disponible';
    };

    const buildCardPayload = (): ShareMatchCardInput => {
        const mappedPeriods = stats.periodStats.map(qs => ({
            label: qs.label,
            local: qs.local ?? 0,
            visitor: qs.visitor ?? 0
        }));

        return {
            mode: stats.mode,
            isFinished: stats.isFinished,
            dateStr: formatDate(match.createdAt),
            localName,
            visitorName,
            mainLocalScore: stats.mainLocalScore,
            mainVisitorScore: stats.mainVisitorScore,
            scoreUnitLabel: stats.scoreUnitLabel,
            periodHeaders: mappedPeriods.map(p => p.label),
            periodStats: mappedPeriods,
            totalHeader: stats.totalHeader,
            localTotalCell: stats.localTotalCell,
            visitorTotalCell: stats.visitorTotalCell,
            localPointsScored: stats.localTeamStats.officialPoints,
            visitorPointsScored: stats.visitorTeamStats.officialPoints,
            localFoulsTotal: stats.localTeamStats.fouls,
            visitorFoulsTotal: stats.visitorTeamStats.fouls,
            localPlayers: stats.localStats.map(p => ({
                name: p.name,
                number: p.number,
                points: p.points,
                fouls: p.fouls,
                baskets1: p.baskets1,
                baskets2: p.baskets2,
                baskets3: p.baskets3,
                totalBaskets: p.totalBaskets
            })),
            visitorPlayers: stats.visitorStats.map(p => ({
                name: p.name,
                number: p.number,
                points: p.points,
                fouls: p.fouls,
                baskets1: p.baskets1,
                baskets2: p.baskets2,
                baskets3: p.baskets3,
                totalBaskets: p.totalBaskets
            }))
        };
    };

    const triggerFeedback = (msg: string) => {
        setShareFeedback(msg);
        window.setTimeout(() => {
            setShareFeedback(prev => (prev === msg ? null : prev));
        }, 3500);
    };

    const handleShareWhatsApp = async () => {
        if (isGenerating) return;
        setIsGenerating(true);
        try {
            const result = await shareOrDownloadMatchCard(buildCardPayload());
            triggerFeedback(
                result === 'shared'
                    ? '¡Imagen lista para compartir!'
                    : '¡Imagen lista para compartir! (PNG descargado)'
            );
        } catch (err) {
            console.error('Error al generar tarjeta:', err);
            window.alert('No se pudo generar la imagen del partido.');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDownloadPng = async () => {
        if (isGenerating) return;
        setIsGenerating(true);
        try {
            await downloadMatchCardPng(buildCardPayload());
            triggerFeedback('¡Imagen lista para compartir! (PNG descargado)');
        } catch (err) {
            console.error('Error al descargar PNG:', err);
            window.alert('No se pudo descargar la imagen PNG.');
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content variant-report" onClick={e => e.stopPropagation()}>

                {/* 1. HEADER */}
                <div className="modal-header">
                    <div className="flex-col">
                        <span
                            className="flex-gap text-muted uppercase font-bold"
                            style={{ fontSize: '0.72rem', letterSpacing: '0.1em' }}
                        >
                            <Calendar size={12} color="var(--primary)" />
                            {formatDate(match.createdAt)}
                        </span>
                        <h2 className="modal-title" style={{ marginTop: '0.15rem' }}>
                            Acta Oficial del Partido
                        </h2>
                    </div>
                    <div className="flex-gap" style={{ gap: '0.5rem' }}>
                        <button
                            type="button"
                            onClick={handleDeleteMatch}
                            className="btn btn-sm btn-secondary"
                            style={{
                                color: 'var(--danger)',
                                borderColor: 'rgba(244, 63, 94, 0.35)',
                                backgroundColor: 'rgba(244, 63, 94, 0.08)',
                                padding: '0.4rem 0.65rem',
                                fontSize: '0.75rem'
                            }}
                            title="Eliminar Partido"
                        >
                            <Trash2 size={14} />
                            Eliminar
                        </button>
                        <button onClick={onClose} className="btn-icon" aria-label="Cerrar reporte">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {shareFeedback && (
                    <div
                        className="live-roster-toast"
                        style={{
                            margin: '0.65rem 1.25rem 0',
                            justifyContent: 'center'
                        }}
                    >
                        <CheckCircle2 size={16} />
                        <span>{shareFeedback}</span>
                    </div>
                )}

                {/* 2. RESUMEN GENERAL Y MARCADOR PRINCIPAL */}
                <div className="report-score-panel">
                    <div className={`report-team ${stats.localWon ? 'is-winner' : ''}`}>
                        <span className="report-team-name">{localName}</span>
                        <span className="report-score-big" data-testid="report-main-local-score">
                            {stats.mainLocalScore}
                        </span>
                    </div>

                    <div className="report-vs">
                        {stats.scoreUnitLabel}
                    </div>

                    <div className={`report-team ${stats.visitorWon ? 'is-winner' : ''}`}>
                        <span className="report-team-name">{visitorName}</span>
                        <span className="report-score-big" data-testid="report-main-visitor-score">
                            {stats.mainVisitorScore}
                        </span>
                    </div>
                </div>

                <div className="report-summary-strip" data-testid="report-general-summary">
                    <div className="report-summary-pill mode">
                        {getModeIcon()}
                        <span>{stats.modeLabel}</span>
                        <span className="report-summary-sep">·</span>
                        <span className="report-summary-muted">{stats.modeRuleSummary}</span>
                    </div>

                    <div
                        className={`report-summary-pill outcome ${
                            stats.localWon || stats.visitorWon
                                ? 'has-winner'
                                : stats.isTie
                                  ? 'is-tie'
                                  : ''
                        }`}
                        data-testid="report-winner-summary"
                    >
                        <Trophy size={13} />
                        <span>{getWinnerSummaryText()}</span>
                    </div>

                    <div className="report-summary-pill fouls" data-testid="report-fouls-summary">
                        <span>
                            Faltas: {formatFoulsSummaryValue(stats.localTeamStats)} -{' '}
                            {formatFoulsSummaryValue(stats.visitorTeamStats)}
                        </span>
                    </div>
                </div>

                {/* 3. CUERPO SCROLLABLE */}
                <div className="modal-body" style={{ padding: 0 }}>
                    <div className="report-section">

                        {stats.integrityNotice && (
                            <div className="report-integrity-banner" data-testid="report-integrity-notice">
                                <ShieldAlert size={16} />
                                <span>{stats.integrityNotice}</span>
                            </div>
                        )}

                        {/* A. DESGLOSE POR PERIODO / JUEGO / SET */}
                        {stats.periodStats.length > 0 && (
                            <>
                                <div className="report-subtitle-row">
                                    <div className="report-subtitle" style={{ margin: 0 }}>
                                        {getModeIcon()} {getModeTitle()}
                                    </div>
                                    {stats.periodAvailability === 'unavailable' && (
                                        <span className="report-availability-tag">
                                            No disponible por periodo
                                        </span>
                                    )}
                                    {stats.periodAvailability === 'partial' && (
                                        <span className="report-availability-tag is-partial">
                                            Eventos parciales
                                        </span>
                                    )}
                                </div>

                                <div style={{ overflowX: 'auto', paddingBottom: '0.5rem' }}>
                                    <div
                                        className="report-quarters-grid"
                                        data-testid="report-periods-table"
                                        style={{
                                            gridTemplateColumns: `minmax(120px, 1.7fr) repeat(${stats.periodStats.length}, minmax(44px, 1fr)) minmax(64px, 0.85fr)`
                                        }}
                                    >
                                        <div
                                            className="q-cell head"
                                            style={{ textAlign: 'left', paddingLeft: '0.75rem' }}
                                        >
                                            Equipo
                                        </div>
                                        {stats.periodStats.map(qs => {
                                            const isOt =
                                                stats.mode === 'traditional' &&
                                                qs.period > stats.totalQuarters;
                                            return (
                                                <div
                                                    key={qs.period}
                                                    className={`q-cell head ${isOt ? 'is-ot' : ''}`}
                                                >
                                                    {qs.label}
                                                </div>
                                            );
                                        })}
                                        <div className="q-cell head">{stats.totalHeader}</div>

                                        <div className="q-cell team-name local">{localName}</div>
                                        {stats.periodStats.map(qs => {
                                            const isOt =
                                                stats.mode === 'traditional' &&
                                                qs.period > stats.totalQuarters;
                                            const isLeader =
                                                qs.available &&
                                                qs.local !== null &&
                                                qs.visitor !== null &&
                                                qs.local > qs.visitor;
                                            return (
                                                <div
                                                    key={`l-${qs.period}`}
                                                    className={`q-cell score-val ${isOt ? 'is-ot' : ''} ${
                                                        isLeader ? 'is-leader-local' : ''
                                                    }`}
                                                >
                                                    {qs.available && qs.local !== null ? qs.local : '—'}
                                                </div>
                                            );
                                        })}
                                        <div className="q-cell total-val">{stats.localTotalCell}</div>

                                        <div className="q-cell team-name visitor">{visitorName}</div>
                                        {stats.periodStats.map(qs => {
                                            const isOt =
                                                stats.mode === 'traditional' &&
                                                qs.period > stats.totalQuarters;
                                            const isLeader =
                                                qs.available &&
                                                qs.local !== null &&
                                                qs.visitor !== null &&
                                                qs.visitor > qs.local;
                                            return (
                                                <div
                                                    key={`v-${qs.period}`}
                                                    className={`q-cell score-val ${isOt ? 'is-ot' : ''} ${
                                                        isLeader ? 'is-leader-visitor' : ''
                                                    }`}
                                                >
                                                    {qs.available && qs.visitor !== null ? qs.visitor : '—'}
                                                </div>
                                            );
                                        })}
                                        <div className="q-cell total-val">{stats.visitorTotalCell}</div>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* B. ESTADÍSTICAS POR EQUIPO */}
                        <div className="report-subtitle" style={{ marginTop: '1.5rem' }}>
                            <Activity size={15} /> Estadísticas por Equipo
                        </div>

                        <div className="report-team-stats-card" data-testid="report-team-stats">
                            <div className="report-team-stats-row is-header">
                                <span className="rts-label">Métrica</span>
                                <span className="rts-val local">{localName}</span>
                                <span className="rts-val visitor">{visitorName}</span>
                            </div>

                            <div className="report-team-stats-row" data-testid="team-stat-points">
                                <span className="rts-label">Puntos anotados</span>
                                <span className="rts-val is-strong">
                                    {formatTeamPointsCell(stats.localTeamStats)}
                                </span>
                                <span className="rts-val is-strong">
                                    {formatTeamPointsCell(stats.visitorTeamStats)}
                                </span>
                            </div>

                            <div className="report-team-stats-row" data-testid="team-stat-baskets1">
                                <span className="rts-label">Canastas de 1 pto (+1)</span>
                                <span className="rts-val">
                                    {formatTeamBasketCell(
                                        stats.localTeamStats.baskets1,
                                        stats.localTeamStats.scoreAvailability,
                                        stats.localTeamStats.partialBaskets.baskets1
                                    )}
                                </span>
                                <span className="rts-val">
                                    {formatTeamBasketCell(
                                        stats.visitorTeamStats.baskets1,
                                        stats.visitorTeamStats.scoreAvailability,
                                        stats.visitorTeamStats.partialBaskets.baskets1
                                    )}
                                </span>
                            </div>

                            <div className="report-team-stats-row" data-testid="team-stat-baskets2">
                                <span className="rts-label">Canastas de 2 pts (+2)</span>
                                <span className="rts-val">
                                    {formatTeamBasketCell(
                                        stats.localTeamStats.baskets2,
                                        stats.localTeamStats.scoreAvailability,
                                        stats.localTeamStats.partialBaskets.baskets2
                                    )}
                                </span>
                                <span className="rts-val">
                                    {formatTeamBasketCell(
                                        stats.visitorTeamStats.baskets2,
                                        stats.visitorTeamStats.scoreAvailability,
                                        stats.visitorTeamStats.partialBaskets.baskets2
                                    )}
                                </span>
                            </div>

                            <div className="report-team-stats-row" data-testid="team-stat-baskets3">
                                <span className="rts-label">Canastas de 3 pts (+3)</span>
                                <span className="rts-val">
                                    {formatTeamBasketCell(
                                        stats.localTeamStats.baskets3,
                                        stats.localTeamStats.scoreAvailability,
                                        stats.localTeamStats.partialBaskets.baskets3
                                    )}
                                </span>
                                <span className="rts-val">
                                    {formatTeamBasketCell(
                                        stats.visitorTeamStats.baskets3,
                                        stats.visitorTeamStats.scoreAvailability,
                                        stats.visitorTeamStats.partialBaskets.baskets3
                                    )}
                                </span>
                            </div>

                            <div className="report-team-stats-row" data-testid="team-stat-total-baskets">
                                <span className="rts-label">Total de anotaciones</span>
                                <span className="rts-val is-strong">
                                    {formatTeamBasketCell(
                                        stats.localTeamStats.totalBaskets,
                                        stats.localTeamStats.scoreAvailability,
                                        stats.localTeamStats.partialBaskets.totalBaskets
                                    )}
                                </span>
                                <span className="rts-val is-strong">
                                    {formatTeamBasketCell(
                                        stats.visitorTeamStats.totalBaskets,
                                        stats.visitorTeamStats.scoreAvailability,
                                        stats.visitorTeamStats.partialBaskets.totalBaskets
                                    )}
                                </span>
                            </div>

                            <div className="report-team-stats-row" data-testid="team-stat-fouls">
                                <span className="rts-label">Faltas registradas</span>
                                <span className="rts-val">
                                    {formatFoulsSummaryValue(stats.localTeamStats)}
                                </span>
                                <span className="rts-val">
                                    {formatFoulsSummaryValue(stats.visitorTeamStats)}
                                </span>
                            </div>
                        </div>

                        {/* C. ESTADÍSTICAS POR JUGADOR (BOX SCORE) */}
                        <div className="report-subtitle" style={{ marginTop: '1.5rem' }}>
                            <Users size={15} /> Estadísticas por Jugador
                        </div>

                        <div className="report-boxscore-columns">
                            <TeamStatsGroup
                                side="local"
                                teamName={localName}
                                teamStats={stats.localTeamStats}
                                color="var(--secondary)"
                            />
                            <TeamStatsGroup
                                side="visitor"
                                teamName={visitorName}
                                teamStats={stats.visitorTeamStats}
                                color="var(--primary)"
                            />
                        </div>

                    </div>
                </div>

                {/* 4. FOOTER DE COMPARTIR Y DESCARGAR */}
                <div
                    className="modal-footer"
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.65rem'
                    }}
                >
                    <button
                        type="button"
                        onClick={handleDownloadPng}
                        disabled={isGenerating}
                        className="btn btn-secondary"
                        style={{ flex: '1 1 150px' }}
                    >
                        <Download size={17} />
                        <span>{isGenerating ? 'Generando...' : 'Descargar PNG'}</span>
                    </button>

                    <button
                        type="button"
                        onClick={handleShareWhatsApp}
                        disabled={isGenerating}
                        className="btn btn-primary"
                        style={{
                            flex: '2 1 220px',
                            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                            boxShadow: '0 6px 20px -4px rgba(16, 185, 129, 0.45)',
                            border: '1px solid rgba(52, 211, 153, 0.4)'
                        }}
                    >
                        <Share2 size={18} />
                        <span>
                            {isGenerating ? 'Generando imagen...' : 'Compartir Acta / WhatsApp'}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}

const TeamStatsGroup = ({
    side,
    teamName,
    teamStats,
    color
}: {
    side: 'local' | 'visitor';
    teamName: string;
    teamStats: TeamReportStats;
    color: string;
}) => {
    const { players, unassigned, scoreAvailability, officialPoints, fouls } = teamStats;
    const hasRows = players.length > 0 || unassigned.hasData;
    const isConfirmedZero =
        scoreAvailability === 'confirmed' &&
        (officialPoints ?? 0) === 0 &&
        (fouls ?? 0) === 0;

    return (
        <div className="stats-group" data-testid={`player-boxscore-${side}`}>
            <div className="stats-group-header" style={{ borderBottomColor: `${color}33` }}>
                <h4
                    style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '1.05rem',
                        fontWeight: 800,
                        color: color,
                        margin: 0
                    }}
                >
                    {teamName}
                </h4>
                <span className="stats-group-summary">
                    {officialPoints !== null ? `${officialPoints} PTS` : 'PTS N/D'} ·{' '}
                    {fouls !== null ? `${fouls} FAL` : 'FAL N/D'}
                </span>
            </div>

            <div className="stats-header-row">
                <span className="stats-col-player">Jugador</span>
                <div className="stat-numbers">
                    <span className="stat-col bsk" title="Canastas de 1 punto">+1</span>
                    <span className="stat-col bsk" title="Canastas de 2 puntos">+2</span>
                    <span className="stat-col bsk" title="Canastas de 3 puntos">+3</span>
                    <span className="stat-col fls" title="Faltas personales">FAL</span>
                    <span className="stat-col pts" title="Puntos totales">PTS</span>
                </div>
            </div>

            {!hasRows ? (
                <p
                    className="text-muted"
                    style={{ fontSize: '0.8rem', padding: '0.75rem 0.5rem', fontStyle: 'italic' }}
                >
                    {isConfirmedZero
                        ? 'Sin anotaciones ni faltas registradas (0 pts).'
                        : 'No disponible — Sin jugadas individuales registradas.'}
                </p>
            ) : (
                <>
                    {players.map(p => (
                        <div
                            key={p.id}
                            className="stat-player-row"
                            data-testid={`player-row-${p.id}`}
                        >
                            <div className="player-info">
                                <span className="player-num">{p.number ?? '-'}</span>
                                <span className="player-name">{p.name}</span>
                            </div>
                            <div className="stat-numbers">
                                <span className="stat-col bsk">{p.baskets1}</span>
                                <span className="stat-col bsk">{p.baskets2}</span>
                                <span className="stat-col bsk">{p.baskets3}</span>
                                <span
                                    className="stat-col fls"
                                    style={{
                                        color:
                                            p.fouls >= 5
                                                ? 'var(--danger)'
                                                : p.fouls > 0
                                                  ? 'var(--text-secondary)'
                                                  : 'var(--text-muted)',
                                        fontWeight: p.fouls >= 5 ? 800 : 600
                                    }}
                                >
                                    {p.fouls}
                                </span>
                                <span className="stat-col pts">{p.points}</span>
                            </div>
                        </div>
                    ))}

                    {unassigned.hasData && (
                        <div
                            className="stat-player-row is-unassigned"
                            data-testid={`unassigned-row-${side}`}
                        >
                            <div className="player-info">
                                <span className="player-num is-unassigned" title="Sin dorsal">—</span>
                                <span className="player-name is-unassigned">
                                    Sin jugador asignado
                                </span>
                            </div>
                            <div className="stat-numbers">
                                <span className="stat-col bsk">{unassigned.baskets1}</span>
                                <span className="stat-col bsk">{unassigned.baskets2}</span>
                                <span className="stat-col bsk">{unassigned.baskets3}</span>
                                <span className="stat-col fls">{unassigned.fouls}</span>
                                <span className="stat-col pts">{unassigned.points}</span>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
