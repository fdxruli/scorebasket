// src/pages/LiveMatch.tsx
import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Player } from '../db/models';
import { History, X } from 'lucide-react';
import { MatchesRepository } from '../db/matches.repository';

// Estilos
import './LiveMatch.css';

// Importamos nuestros nuevos componentes
import { Scoreboard } from '../components/live/Scoreboard';
import { MatchControls } from '../components/live/MatchControls';
import { PlayerSelectModal, type GameAction } from '../components/live/PlayerSelectModal';

export function LiveMatch() {
    const { id } = useParams();
    const matchId = Number(id);
    const navigate = useNavigate();
    const [, setTick] = useState(0);

    // --- ESTADO UI ---
    const [currentAction, setCurrentAction] = useState<{
        teamId: number;
        action: GameAction;
        teamName: string;
        players: Player[];
    } | null>(null);

    // --- DATA FETCHING ---
    const data = useLiveQuery(async () => {
        const match = await db.matches.get(matchId);
        if (!match) return null;

        const [localTeam, visitorTeam, localPlayers, visitorPlayers, scores, fouls] = await Promise.all([
            db.teams.get(match.localTeamId),
            db.teams.get(match.visitorTeamId),
            db.players.where({ teamId: match.localTeamId }).toArray(),
            db.players.where({ teamId: match.visitorTeamId }).toArray(),
            db.scores.where({ matchId }).toArray(),
            db.fouls.where({ matchId }).toArray()
        ]);

        return { match, localTeam, visitorTeam, localPlayers, visitorPlayers, scores, fouls };
    }, [matchId]);

    // --- CALCULOS (STATS) ---
    const stats = useMemo(() => {
        if (!data) return { localScore: 0, visitorScore: 0, localFoulsQ: 0, visitorFoulsQ: 0 };
        const { scores, fouls, match } = data;

        return {
            localScore: scores.filter(s => s.teamId === data.localTeam!.id).reduce((a, b) => a + b.points, 0),
            visitorScore: scores.filter(s => s.teamId === data.visitorTeam!.id).reduce((a, b) => a + b.points, 0),
            localFoulsQ: fouls.filter(f => f.teamId === data.localTeam!.id && f.quarter === match.currentQuarter).length,
            visitorFoulsQ: fouls.filter(f => f.teamId === data.visitorTeam!.id && f.quarter === match.currentQuarter).length
        };
    }, [data]);

    // --- LOGICA RELOJ ---
    const isTimerRunning = !!data?.match?.timerLastStart;

    const getEffectiveTimeLeft = () => {
        if (!data?.match) return 0;
        const { timerSecondsRemaining, timerLastStart } = data.match;
        if (timerLastStart) {
            const elapsed = (Date.now() - timerLastStart.getTime()) / 1000;
            return Math.max(0, timerSecondsRemaining - elapsed);
        }
        return timerSecondsRemaining;
    };

    const timeLeft = getEffectiveTimeLeft();

    useEffect(() => {
        let interval: number;
        if (isTimerRunning && timeLeft > 0) interval = setInterval(() => setTick(t => t + 1), 1000);
        if (isTimerRunning && timeLeft <= 0) toggleTimer(); // Auto-pause
        return () => clearInterval(interval);
    }, [isTimerRunning, timeLeft]);

    // --- HANDLERS ---
    const toggleTimer = async () => {
        if (!data?.match) return;
        const { timerLastStart, timerSecondsRemaining } = data.match;
        if (timerLastStart) {
            const elapsed = (Date.now() - timerLastStart.getTime()) / 1000;
            await db.matches.update(matchId, { timerLastStart: undefined, timerSecondsRemaining: Math.max(0, timerSecondsRemaining - elapsed) });
        } else {
            if (timerSecondsRemaining > 0) await db.matches.update(matchId, { timerLastStart: new Date() });
        }
    };

    const handleNextQuarter = async () => {
        if (!data) return;
        if (isTimerRunning) await toggleTimer();
        const nextQ = data.match.currentQuarter + 1;
        if (confirm(`¿Iniciar Cuarto ${nextQ}?`)) {
            await db.matches.update(matchId, { currentQuarter: nextQ, timerSecondsRemaining: data.match.quarterDuration * 60, timerLastStart: undefined });
        }
    };

    const handleEndMatch = async () => {
        if (confirm("¿Finalizar partido?")) {
            await db.matches.update(matchId, { status: 'finished', finishedAt: new Date() });
            navigate('/matches');
        }
    };

    const handleActionRequest = (teamId: number, teamName: string, players: Player[], action: GameAction) => {
        setCurrentAction({ teamId, teamName, players, action });
    };

    const handleUndo = async () => {
        // Opcional: Vibración para feedback táctil en móviles
        if (navigator.vibrate) navigator.vibrate(50);

        await MatchesRepository.undoLastAction(matchId);
    };

    const confirmAction = async (playerId: number | null) => {
        if (!currentAction || !data) return;
        const commonData = {
            matchId,
            teamId: currentAction.teamId,
            playerId: playerId ?? undefined,
            quarter: data.match.currentQuarter,
            createdAt: new Date()
        };

        if (currentAction.action.type === 'score') {
            await db.scores.add({ ...commonData, points: currentAction.action.points });
        } else {
            await db.fouls.add(commonData);
        }
        setCurrentAction(null);
    };

    // --- RENDER ---
    if (!data) return <div className="bg-black h-screen flex items-center justify-center text-white">Cargando...</div>;
    const { match, localTeam, visitorTeam, localPlayers, visitorPlayers } = data;

    return (
        <div className="live-overlay">

            {/* 1. Header (Se mantiene simple, no merece componente aun) */}
            <header className="live-header">
                <button onClick={() => navigate('/matches')} className="live-back-btn">
                    <X size={24} />
                </button>
                <div className="live-status-badge">
                    Q{match.currentQuarter} • {match.status === 'finished' ? 'FINAL' : 'EN VIVO'}
                </div>
                <button onClick={handleUndo} className="live-back-btn" title="Deshacer última acción">
                    <History size={20} />
                </button>
            </header>

            {/* 2. Scoreboard Component */}
            <Scoreboard
                localName={localTeam?.name || 'Local'}
                visitorName={visitorTeam?.name || 'Visita'}
                localScore={stats.localScore}
                visitorScore={stats.visitorScore}
                localFouls={stats.localFoulsQ}
                visitorFouls={stats.visitorFoulsQ}
                timeLeft={timeLeft}
                isTimerRunning={isTimerRunning}
            />

            {/* 3. Controls Component */}
            <MatchControls
                localTeam={localTeam!}
                visitorTeam={visitorTeam!}
                localPlayers={localPlayers}
                visitorPlayers={visitorPlayers}
                isTimerRunning={isTimerRunning}
                onActionRequest={handleActionRequest}
                onToggleTimer={toggleTimer}
                onNextQuarter={handleNextQuarter}
                onEndMatch={handleEndMatch}
            />

            {/* 4. Modal Component */}
            {currentAction && (
                <PlayerSelectModal
                    teamName={currentAction.teamName}
                    players={currentAction.players}
                    action={currentAction.action}
                    onSelect={confirmAction}
                    onCancel={() => setCurrentAction(null)}
                />
            )}

        </div>
    );
}