import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  const close = () => setMenuOpen(false);

  return (
    <>
      <nav className="navbar">
        <div className="navbar-inner">
          <Link to="/" className="navbar-brand" onClick={close}>
            <span className="brand-icon">🏍️</span>
            <span className="brand-text">BodaBoda</span>
          </Link>

          {/* Desktop links — only shown when logged out */}
          {!isLoading && !isAuthenticated && (
            <div className="navbar-links">
              <Link to="/" className={`nav-link${location.pathname === '/' ? ' active' : ''}`}>Home</Link>
              <Link to="/register" className={`nav-link${isActive('/register') ? ' active' : ''}`}>Register</Link>
              <Link to="/login" className={`nav-link${isActive('/login') ? ' active' : ''}`}>Login</Link>
              <Link to="/register" className="nav-cta">Get Started</Link>
            </div>
          )}

          {/* Hamburger — only shown when logged out; logged-in users use bottom nav */}
          {!isLoading && !isAuthenticated && (
            <button
              className={`nav-hamburger${menuOpen ? ' open' : ''}`}
              aria-label="Toggle menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span /><span /><span />
            </button>
          )}
        </div>
      </nav>

      {/* Mobile drawer — only for unauthenticated users */}
      {!isLoading && !isAuthenticated && (
        <div className={`nav-mobile${menuOpen ? ' open' : ''}`} aria-hidden={!menuOpen}>
          <Link to="/" className="nav-link" onClick={close}>Home</Link>
          <Link to="/register" className="nav-link" onClick={close}>Register</Link>
          <Link to="/login" className="nav-link" onClick={close}>Login</Link>
        </div>
      )}
    </>
  );
}
