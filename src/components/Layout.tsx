// src/components/Layout.tsx
import { Link, Outlet, useLocation } from "react-router-dom";
import { Trophy, Users, PlusCircle } from "lucide-react";
import "./Layout.css"; // <--- Importamos el CSS

export function Layout() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="layout-container">
      {/* CONTENIDO */}
      <main className="main-content">
        <Outlet />
      </main>

      {/* NAVBAR INFERIOR */}
      <nav className="navbar">
        <Link 
          to="/matches" 
          className={`nav-link ${isActive("/matches") ? "active" : ""}`}
        >
          <Trophy size={24} />
          <span className="nav-text">Partidos</span>
        </Link>

        {/* BOTÓN CENTRAL */}
        <Link to="/matches/new" className="nav-center-btn">
          <div className="circle-icon">
            <PlusCircle size={28} />
          </div>
          <span className="nav-text" style={{ color: '#a1a1aa', marginTop: '0.25rem' }}>
            Nuevo
          </span>
        </Link>

        <Link 
          to="/teams" 
          className={`nav-link ${isActive("/teams") ? "active" : ""}`}
        >
          <Users size={24} />
          <span className="nav-text">Equipos</span>
        </Link>
      </nav>
    </div>
  );
}