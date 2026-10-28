import { ArrowRight, Trophy, Target, Clock } from 'lucide-react';
import type { Match } from '../../../db/models/Match';

interface Props {
    match: Match;
    localName: string;
    visitorName: string;
    onClick: () => void;
}

export const HistoryMatchTicket = ({ match, localName, visitorName, onClick }: Props) => {
    const mode = match.config?.mode || 'traditional';
    
    const formatDate = (date: Date) => {
        try {
            return new Intl.DateTimeFormat('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' }).format(date);
        } catch { return ""; }
    };

    // Lógica para determinar el score a mostrar
    let localDisplayScore = match.localScore;
    let visitorDisplayScore = match.visitorScore;
    let modeIcon = <Clock size={12} />;
    let isRaceWithGames = false;
    
    if (mode === 'best-of-series') {
        // En series, mostramos SETS ganados
        localDisplayScore = match.config.bestOf?.wins?.local || 0;
        visitorDisplayScore = match.config.bestOf?.wins?.visitor || 0;
        modeIcon = <Trophy size={12} color="var(--success)" />;
    } else if (mode === 'race') {
        modeIcon = <Target size={12} color="var(--primary)" />;

        // Con revanchas: mostramos JUEGOS ganados en lugar del marcador del último juego
        if (match.gameHistory && match.gameHistory.length > 1) {
            localDisplayScore = match.gameHistory.filter(g => g.winner === 'local').length;
            visitorDisplayScore = match.gameHistory.filter(g => g.winner === 'visitor').length;
            isRaceWithGames = true;
        }
    }

    const localWon = localDisplayScore > visitorDisplayScore;
    const visitorWon = visitorDisplayScore > localDisplayScore;

    return (
        <div className="match-ticket cursor-pointer" onClick={onClick}>
            <div className="ticket-header">
                <span className="flex-gap">
                    {modeIcon}
                    {formatDate(match.createdAt)}
                </span>
                <ArrowRight size={12} />
            </div>
            <div className="ticket-body">
                <div className={`ticket-team ${localWon ? 'winner' : ''}`}>
                    <span className="ticket-team-name">{localName}</span>
                    <span className="ticket-score">{localDisplayScore}</span>
                </div>
                <div className="ticket-vs">VS</div>
                <div className={`ticket-team ${visitorWon ? 'winner' : ''}`}>
                    <span className="ticket-team-name">{visitorName}</span>
                    <span className="ticket-score">{visitorDisplayScore}</span>
                </div>
            </div>
            {/* Si es serie o reta con revanchas, aclaramos qué representa el marcador */}
            {(mode === 'best-of-series' || isRaceWithGames) && (
                <div
                    className="text-center"
                    style={{
                        backgroundColor: 'rgba(24, 24, 27, 0.5)',
                        padding: '0.25rem 0.75rem',
                        borderTop: '1px solid var(--border-color)'
                    }}
                >
                    <span
                        className="text-muted uppercase font-bold"
                        style={{ fontSize: '0.625rem', letterSpacing: '0.1em' }}
                    >
                        {isRaceWithGames ? 'Juegos Ganados' : 'Resultado en Sets'}
                    </span>
                </div>
            )}
        </div>
    );
};
