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
    
    if (mode === 'best-of-series') {
        // En series, mostramos SETS ganados
        localDisplayScore = match.config.bestOf?.wins?.local || 0;
        visitorDisplayScore = match.config.bestOf?.wins?.visitor || 0;
        modeIcon = <Trophy size={12} className="text-green-500" />;
    } else if (mode === 'race') {
        modeIcon = <Target size={12} className="text-orange-500" />;
    }

    const localWon = localDisplayScore > visitorDisplayScore;
    const visitorWon = visitorDisplayScore > localDisplayScore;

    return (
        <div className="match-ticket cursor-pointer" onClick={onClick}>
            <div className="ticket-header">
                <span className="flex items-center gap-2">
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
            {/* Si es serie, aclaramos que son Sets */}
            {mode === 'best-of-series' && (
                <div className="bg-zinc-900/50 py-1 px-3 text-center border-t border-zinc-800">
                    <span className="text-[10px] text-muted uppercase font-bold tracking-widest">Resultado en Sets</span>
                </div>
            )}
        </div>
    );
};