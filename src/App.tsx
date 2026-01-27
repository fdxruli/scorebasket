// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';

// Componentes existentes
import { Layout } from './components/Layout';
import { Matches } from './pages/Matches';
import { Teams } from './pages/Teams';
import { NewMatch } from './pages/NewMatch';
import { LiveMatch } from './pages/LiveMatch';

// --- COMPONENTE TEMPORAL (PLACEHOLDER) ---
// Este componente sirve para verificar que la redirección funciona correctamente
// antes de que construyamos la pantalla real de anotación.
function LiveMatchPlaceholder() {
  const { id } = useParams();
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] p-4 space-y-4 text-center">
      <div className="bg-green-100 text-green-700 p-4 rounded-full mb-2">
         {/* Icono simple simulado */}
         Starting...
      </div>
      <h2 className="text-2xl font-bold text-gray-800">¡Partido Creado!</h2>
      <p className="text-gray-500">
        Estás en la ruta del partido con ID: 
        <br/>
        <span className="font-mono text-lg font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded mt-2 inline-block">
          {id}
        </span>
      </p>
      <div className="p-4 bg-yellow-50 text-yellow-800 text-sm rounded-lg border border-yellow-200 max-w-xs mx-auto mt-4">
        🚧 <strong>En construcción:</strong> Aquí irá la interfaz del marcador en vivo (LiveMatch.tsx).
      </div>
    </div>
  );
}

function App() {
  // --- LÓGICA DE INICIO INTELIGENTE ---
  const teamCount = useLiveQuery(() => db.teams.count());

  // Pantalla de carga inicial
  if (teamCount === undefined) {
    return <div className="h-screen flex items-center justify-center text-gray-500">Cargando base de datos...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Ruta Raíz: Decide a dónde ir basado en si hay datos */}
        <Route 
          path="/" 
          element={ teamCount > 0 ? <Navigate to="/matches" /> : <Navigate to="/teams" /> } 
        />

        {/* Layout principal que envuelve las rutas */}
        <Route element={<Layout />}>
          <Route path="/matches" element={<Matches />} />
          <Route path="/matches/new" element={<NewMatch />} />
          <Route path="/teams" element={<Teams />} />
          
          {/* --- NUEVA RUTA AGREGADA --- */}
          <Route path="/live/:id" element={<LiveMatch />} />
        </Route>

      </Routes>
    </BrowserRouter>
  );
}

export default App;