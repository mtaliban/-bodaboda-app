import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';

export default function Navbar() {
  const { isAuthenticated, isLoading } = useAuth();
  const { t, lang, setLang } = useLang();
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

          {/* Language toggle — always visible */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginLeft: 'auto', marginRight: '0.75rem' }}>
            <button
              onClick={() => setLang('sw')}
              title="Kiswahili"
              style={{
                padding: '0.22rem 0.55rem', borderRadius: 6, border: `1.5px solid ${lang === 'sw' ? '#FF6B00' : '#e5e7eb'}`,
                background: lang === 'sw' ? '#fff7ed' : 'transparent', color: lang === 'sw' ? '#FF6B00' : '#64748b',
                fontWeight: lang === 'sw' ? 700 : 400, cursor: 'pointer', fontSize: '0.72rem', lineHeight: 1,
                transition: 'all 0.15s',
              }}
            >🇹🇿 SW</button>
            <button
              onClick={() => setLang('en')}
              title="English"
              style={{
                padding: '0.22rem 0.55rem', borderRadius: 6, border: `1.5px solid ${lang === 'en' ? '#2563eb' : '#e5e7eb'}`,
                background: lang === 'en' ? '#eff6ff' : 'transparent', color: lang === 'en' ? '#2563eb' : '#64748b',
                fontWeight: lang === 'en' ? 700 : 400, cursor: 'pointer', fontSize: '0.72rem', lineHeight: 1,
                transition: 'all 0.15s',
              }}
            >🇬🇧 EN</button>
          </div>

          {/* Desktop links — only shown when logged out */}
          {!isLoading && !isAuthenticated && (
            <div className="navbar-links">
              <Link to="/" className={`nav-link${location.pathname === '/' ? ' active' : ''}`}>{t('nav.home')}</Link>
              <Link to="/register" className={`nav-link${isActive('/register') ? ' active' : ''}`}>{t('nav.register')}</Link>
              <Link to="/login" className={`nav-link${isActive('/login') ? ' active' : ''}`}>{t('nav.login')}</Link>
              <Link to="/register" className="nav-cta">{t('nav.getStarted')}</Link>
            </div>
          )}

          {/* Hamburger — only shown when logged out */}
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

      {/* Mobile drawer */}
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
