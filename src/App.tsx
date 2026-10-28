// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

// Componentes
import { Layout } from './components/Layout';
import { Matches } from './pages/Matches';
import { Teams } from './pages/Teams';
import { NewMatch } from './pages/NewMatch';
import { LiveMatch } from './pages/LiveMatch';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Ruta Raíz */}
        <Route path="/" element={<Navigate to="/matches" />} />

        {/* 1. RUTAS CON BARRA DE NAVEGACIÓN (Layout) */}
        <Route element={<Layout />}>
          <Route path="/matches" element={<Matches />} />
          <Route path="/matches/new" element={<NewMatch />} />
          <Route path="/teams" element={<Teams />} />
        </Route>

        {/* 2. RUTA SIN BARRA DE NAVEGACIÓN (Pantalla completa) */}
        {/* Al estar fuera del Layout, no mostrará el navbar inferior */}
        <Route path="/live/:id" element={<LiveMatch />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;
