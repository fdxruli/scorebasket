// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';

// Componentes existentes
import { Layout } from './components/Layout';
import { Matches } from './pages/Matches';
import { Teams } from './pages/Teams';
import { NewMatch } from './pages/NewMatch';
import { LiveMatch } from './pages/LiveMatch';

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