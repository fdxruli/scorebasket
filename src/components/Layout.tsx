// src/components/Layout.tsx
import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Trophy, Users, PlusCircle, Zap, Activity, Flame } from "lucide-react";
import { db } from "../db/db";
import { startQuickPickupMatch } from "../utils/matchHelpers";

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [startingQuick, setStartingQuick] = useState(false);

  const isActive = (path: string) => location.pathname === path;

  const counts = useLiveQuery(async () => {
    try {
      const [matches, teams] = await Promise.all([
        db.matches.toArray(),
        db.teams.toArray()
      ]);
      const activeMatches = matches.filter(m => m.status !== "finished").length;
      const activeTeams = teams.filter(t => !t.isArchived).length;
      return {
        activeMatches,
        totalMatches: matches.length,
        activeTeams
      };
    } catch {
      return { activeMatches: 0, totalMatches: 0, activeTeams: 0 };
    }
  }, []);

  const handleQuickPickup = async () => {
    if (startingQuick) return;
    setStartingQuick(true);
    try {
      const matchId = await startQuickPickupMatch(21);
      navigate(`/live/${matchId}`);
    } catch (err) {
      console.error("Error iniciando reta rápida:", err);
    } finally {
      setStartingQuick(false);
    }
  };

  return (
    <div className="layout-container">
      {/* --- TOPBAR MÓVIL (< 768px) --- */}
      <header className="mobile-topbar">
        <Link to="/matches" className="brand-identity">
          <div className="brand-logo-mark">
            <Flame size={20} fill="currentColor" />
          </div>
          <div className="brand-text-group">
            <span className="brand-title">
              SCORE<span>BASKET</span>
            </span>
            <span className="brand-subtitle">Courtside Pro</span>
          </div>
        </Link>

        {counts && counts.activeMatches > 0 ? (
          <Link to="/matches" className="topbar-live-pill">
            <span className="pulse-dot" />
            {counts.activeMatches} En Vivo
          </Link>
        ) : (
          <button
            type="button"
            onClick={handleQuickPickup}
            disabled={startingQuick}
            className="btn btn-xs btn-primary"
          >
            <Zap size={13} fill="currentColor" />
            Reta 21
          </button>
        )}
      </header>

      {/* --- SIDEBAR DESKTOP (>= 768px) --- */}
      <aside className="desktop-sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <Link to="/matches" className="brand-identity">
              <div className="brand-logo-mark">
                <Flame size={22} fill="currentColor" />
              </div>
              <div className="brand-text-group">
                <span className="brand-title">
                  SCORE<span>BASKET</span>
                </span>
                <span className="brand-subtitle">Courtside Control</span>
              </div>
            </Link>
          </div>

          <div className="sidebar-cta-group">
            <Link to="/matches/new" className="btn btn-primary btn-full">
              <PlusCircle size={18} />
              Nuevo Partido
            </Link>
            <button
              type="button"
              onClick={handleQuickPickup}
              disabled={startingQuick}
              className="btn btn-secondary btn-full"
              title="Crear equipos al instante y jugar a 21 puntos"
            >
              <Zap size={16} color="var(--primary)" fill="var(--primary)" />
              Reta Rápida (21 pts)
            </button>
          </div>

          <nav className="sidebar-nav">
            <span className="sidebar-section-label">Panel de Cancha</span>

            <Link
              to="/matches"
              className={`sidebar-link ${isActive("/matches") ? "active" : ""}`}
            >
              <span className="sidebar-link-left">
                <Trophy size={19} />
                <span>Partidos</span>
              </span>
              {counts && counts.activeMatches > 0 ? (
                <span className="sidebar-badge live">
                  {counts.activeMatches} LIVE
                </span>
              ) : counts && counts.totalMatches > 0 ? (
                <span className="sidebar-badge">{counts.totalMatches}</span>
              ) : null}
            </Link>

            <Link
              to="/matches/new"
              className={`sidebar-link ${isActive("/matches/new") ? "active" : ""}`}
            >
              <span className="sidebar-link-left">
                <PlusCircle size={19} />
                <span>Configurar Juego</span>
              </span>
            </Link>

            <Link
              to="/teams"
              className={`sidebar-link ${isActive("/teams") ? "active" : ""}`}
            >
              <span className="sidebar-link-left">
                <Users size={19} />
                <span>Franquicias / Equipos</span>
              </span>
              {counts && counts.activeTeams > 0 && (
                <span className="sidebar-badge">{counts.activeTeams}</span>
              )}
            </Link>
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-footer-title">
            <Activity size={14} color="var(--primary)" />
            Estado de Cancha
          </div>
          <div className="sidebar-stats-grid">
            <div className="sidebar-stat-box">
              <span className="sidebar-stat-val" style={{ color: counts?.activeMatches ? "var(--primary)" : undefined }}>
                {counts?.activeMatches ?? 0}
              </span>
              <span className="sidebar-stat-lbl">En Juego</span>
            </div>
            <div className="sidebar-stat-box">
              <span className="sidebar-stat-val">{counts?.activeTeams ?? 0}</span>
              <span className="sidebar-stat-lbl">Equipos</span>
            </div>
          </div>
        </div>
      </aside>

      {/* --- CONTENIDO PRINCIPAL --- */}
      <main className="main-content">
        <Outlet />
      </main>

      {/* --- NAVBAR INFERIOR MÓVIL (< 768px) --- */}
      <nav className="navbar">
        <Link
          to="/matches"
          className={`nav-link ${isActive("/matches") ? "active" : ""}`}
        >
          <Trophy size={22} />
          <span className="nav-text">Partidos</span>
        </Link>

        <Link to="/matches/new" className="nav-center-btn">
          <div className="circle-icon">
            <PlusCircle size={26} />
          </div>
          <span className="nav-text" style={{ color: "var(--text-secondary)", marginTop: "0.2rem" }}>
            Nuevo
          </span>
        </Link>

        <Link
          to="/teams"
          className={`nav-link ${isActive("/teams") ? "active" : ""}`}
        >
          <Users size={22} />
          <span className="nav-text">Equipos</span>
        </Link>
      </nav>
    </div>
  );
}
