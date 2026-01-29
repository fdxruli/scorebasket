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
    timeLeft, isTimerRunning
}: ScoreboardProps) {

    return (
        <section className="scoreboard-container">
            {/* Reloj Flotante (Píldora) */}
            <div className={`timer-pill ${isTimerRunning ? 'running' : ''}`}>
                {formatTime(timeLeft)}
            </div>

            {/* Card Local */}
            <div className="score-card local">
                <h2 className="team-name">{localName}</h2>
                <div className="score-big">{localScore}</div>
                
                {/* Indicador de Faltas */}
                <div className="fouls-dots" title={`${localFouls} faltas de equipo`}>
                    {[...Array(5)].map((_, i) => (
                        <div 
                            key={i} 
                            className={`dot ${i < localFouls ? 'active' : ''}`} 
                        />
                    ))}
                </div>
            </div>

            {/* Card Visitante */}
            <div className="score-card visitor">
                <h2 className="team-name">{visitorName}</h2>
                <div className="score-big">{visitorScore}</div>
                
                <div className="fouls-dots" title={`${visitorFouls} faltas de equipo`}>
                    {[...Array(5)].map((_, i) => (
                        <div 
                            key={i} 
                            className={`dot ${i < visitorFouls ? 'active' : ''}`} 
                        />
                    ))}
                </div>
            </div>
        </section>
    );
}