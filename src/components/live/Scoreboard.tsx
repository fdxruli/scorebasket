// src/components/live/Scoreboard.tsx
interface ScoreboardProps {
    localName: string;
    visitorName: string;
    localScore: number;
    visitorScore: number;
    localFouls: number;
    visitorFouls: number;
    timeLeft: number;
    isTimerRunning: boolean;
    showTimer?: boolean;
    showFouls?: boolean;
}

const formatTime = (seconds: number) => {
    const s = Math.ceil(seconds);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
};

export function Scoreboard({
    localName, visitorName,
    localScore, visitorScore,
    localFouls, visitorFouls,
    timeLeft, isTimerRunning,
    showTimer = true,
    showFouls = true
}: ScoreboardProps) {

    return (
        <section className="scoreboard-container">
            {/* Reloj Central (Píldora Digital) */}
            {showTimer && (
                <div className={`timer-pill ${isTimerRunning ? 'running' : ''}`}>
                    {formatTime(timeLeft)}
                </div>
            )}

            {/* Card Local */}
            <div className="score-card local">
                <span className="score-card-role">HOME // LOCAL</span>
                <h2 className="team-name">{localName}</h2>
                <div className="score-big">{localScore}</div>
                
                {showFouls && (
                    <div className="fouls-dots" title={`${localFouls} faltas de equipo`}>
                        {[...Array(5)].map((_, i) => (
                            <div 
                                key={i} 
                                className={`dot ${i < localFouls ? 'active' : ''}`} 
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Card Visitante */}
            <div className="score-card visitor">
                <span className="score-card-role">AWAY // VISITA</span>
                <h2 className="team-name">{visitorName}</h2>
                <div className="score-big">{visitorScore}</div>
                
                {showFouls && (
                    <div className="fouls-dots" title={`${visitorFouls} faltas de equipo`}>
                        {[...Array(5)].map((_, i) => (
                            <div 
                                key={i} 
                                className={`dot ${i < visitorFouls ? 'active' : ''}`} 
                            />
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
