import type { Player } from '../../db/models';

export type GameAction = 
  | { type: 'score'; points: 1 | 2 | 3 }
  | { type: 'foul' };

interface PlayerSelectModalProps {
  teamName: string;
  players: Player[];
  action: GameAction;
  onSelect: (playerId: number | null) => void;
  onCancel: () => void;
}

export function PlayerSelectModal({ teamName, players, action, onSelect, onCancel }: PlayerSelectModalProps) {
  const isFoul = action.type === 'foul';
  
  return (
    <div className="fixed inset-0 bg-black/80 z-[10000] flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-[#18181b] w-full max-w-md rounded-2xl p-6 border border-[#27272a]">
        <h3 className="text-xl font-bold text-white mb-2">
          {isFoul ? `Falta de ${teamName}` : `Puntos para ${teamName}`}
        </h3>
        <p className="text-gray-400 mb-4">Selecciona el jugador:</p>
        
        <div className="grid grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto mb-4">
          {players.map(p => (
            <button 
              key={p.id}
              onClick={() => onSelect(p.id!)}
              className="p-3 bg-[#27272a] text-gray-200 rounded-lg font-medium hover:bg-[#3f3f46] active:scale-95 transition"
            >
              {p.name}
            </button>
          ))}
          <button 
            onClick={() => onSelect(null)} 
            className="p-3 border border-[#3f3f46] text-gray-400 rounded-lg text-sm hover:text-white"
          >
            {isFoul ? 'Banca / Técnica' : 'Equipo / Desconocido'}
          </button>
        </div>
        <button onClick={onCancel} className="w-full py-3 bg-red-500/10 text-red-500 font-bold rounded-lg">
          Cancelar
        </button>
      </div>
    </div>
  );
}