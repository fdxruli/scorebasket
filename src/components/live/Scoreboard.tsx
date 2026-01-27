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

// Movemos el helper de formato aquí o a un utils
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
    <section className="scoreboard-section">
      {/* Local */}
      <div className="team-score-block">
        <h2 className="team-name-display" style={{ color: '#60a5fa' }}>{localName}</h2>
        <span className="score-giant text-white">{localScore}</span>
        {/* Faltas Dots */}
        <div className="flex gap-1 mt-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className={`w-2 h-2 rounded-full ${i < localFouls ? 'bg-red-500' : 'bg-gray-800'}`} />
          ))}
        </div>
      </div>

      {/* Reloj */}
      <div className="timer-container">
          <div className={`timer-display ${isTimerRunning ? 'active' : ''}`}>
            {formatTime(timeLeft)}
          </div>
      </div>

      {/* Visitante */}
      <div className="team-score-block">
        <h2 className="team-name-display" style={{ color: '#fb923c' }}>{visitorName}</h2>
        <span className="score-giant text-white">{visitorScore}</span>
          <div className="flex gap-1 mt-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className={`w-2 h-2 rounded-full ${i < visitorFouls ? 'bg-red-500' : 'bg-gray-800'}`} />
          ))}
        </div>
      </div>
    </section>
  );
}