import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';

export default function Navbar() {
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useLang();
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

          {!isLoading && !isAuthenticated && (
            <div className="navbar-links">
              <Link to="/" className={`nav-link${location.pathname === '/' ? ' active' : ''}`}>{t('nav.home')}</Link>
              <Link to="/register" className={`nav-link${isActive('/register') ? ' active' : ''}`}>{t('nav.register')}</Link>
              <Link to="/login" className={`nav-link${isActive('/login') ? ' active' : ''}`}>{t('nav.login')}</Link>
              <Link to="/register" className="nav-cta">{t('nav.getStarted')}</Link>
            </div>
          )}

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

      {!isLoading && !isAuthenticated && (
        <div className={`nav-mobile${menuOpen ? ' open' : ''}`} aria-hidden={!menuOpen}>
          <Link to="/" className="nav-link" onClick={close}>{t('nav.home')}</Link>
          <Link to="/register" className="nav-link" onClick={close}>{t('nav.register')}</Link>
          <Link to="/login" className="nav-link" onClick={close}>{t('nav.login')}</Link>
        </div>
      )}
    </>
  );
}
