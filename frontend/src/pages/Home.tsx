import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { getHomeData } from '../i18n';

export default function Home() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { lang, t } = useLang();
  const dashboardPath = user?.role === 'RIDER' ? '/dashboard/rider' : '/dashboard/driver';
  const h = getHomeData(lang);

  return (
    <div className="home">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="hero-section">
        <div className="hero-inner">
          <div className="hero-content">
            <div className="hero-badge">{h.badge}</div>
            <h1 className="hero-title">
              {h.heroTitle}{' '}
              <span style={{ color: '#f87171' }}>{h.heroTitleSpan}</span>
            </h1>
            <p className="hero-subtitle">{h.heroSub}</p>

            {!isLoading && (
              isAuthenticated ? (
                <div className="hero-ctas">
                  <Link to={dashboardPath} className="btn btn-primary btn-lg">{h.goToDashboard}</Link>
                </div>
              ) : (
                <div className="hero-ctas">
                  <Link to="/register?role=RIDER" className="btn btn-primary btn-lg">{h.registerRider}</Link>
                  <Link to="/register?role=DRIVER" className="btn btn-outline-white btn-lg">{h.driveWithUs}</Link>
                  <Link to="/login" className="btn btn-outline-white btn-lg">{h.login}</Link>
                </div>
              )
            )}

            <div className="hero-trust">
              <div className="hero-trust-avatars">
                <div className="trust-avatar ta-1">JK</div>
                <div className="trust-avatar ta-2">AM</div>
                <div className="trust-avatar ta-3">PM</div>
                <div className="trust-avatar ta-4">WN</div>
              </div>
              <p className="hero-trust-text">{h.trustedBy}</p>
            </div>
          </div>

          <div className="hero-visual">
            <div className="hero-moto-img-wrap">
              <span className="hero-moto-tag">Bajaj Boxer</span>
              <img src="/boxer.png" alt="Bajaj Boxer motorcycle — the BodaBoda fleet" className="hero-moto-img" />
            </div>
            <div className="hero-stats">
              <div className="h-stat">
                <span className="h-stat-val">2 min</span>
                <span className="h-stat-lbl">{h.avgPickup}</span>
              </div>
              <div className="h-stat-divider" />
              <div className="h-stat">
                <span className="h-stat-val">4.8 ★</span>
                <span className="h-stat-lbl">{h.avgRating}</span>
              </div>
              <div className="h-stat-divider" />
              <div className="h-stat">
                <span className="h-stat-val">1,000+</span>
                <span className="h-stat-lbl">{h.activeDrivers}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────── */}
      <div className="stats-bar">
        <div className="stats-bar-inner">
          {[
            { icon: '⚡', val: '< 2 min', lbl: h.avgPickup },
            { icon: '⭐', val: '4.8 / 5', lbl: h.avgRating },
            { icon: '🏍️', val: '1,000+', lbl: h.activeDrivers },
            { icon: '🛣️', val: '50,000+', lbl: lang === 'sw' ? 'Safari zilizokamilika' : 'Rides completed' },
          ].map((s) => (
            <div className="sbar-item" key={s.lbl}>
              <div className="sbar-icon">{s.icon}</div>
              <div className="sbar-info">
                <div className="sbar-val">{s.val}</div>
                <div className="sbar-lbl">{s.lbl}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── How It Works ─────────────────────────────────────── */}
      <section className="section section-white">
        <div className="section-inner">
          <div className="section-header center">
            <div className="section-eyebrow">{lang === 'sw' ? '— Jinsi Inavyofanya Kazi' : '— How It Works'}</div>
            <h2 className="section-title">{h.howTitle}</h2>
            <p className="section-sub">{h.howSub}</p>
          </div>
          <div className="steps-grid">
            {(['01','02','03','04'] as const).map((num, i) => (
              <div className="step-item" key={num}>
                <div className={`step-num${i === 0 ? ' filled' : ''}`}>{num}</div>
                <div className="step-icon">{['📲','📍','🏍️','🎉'][i]}</div>
                <div className="step-title">{h.steps[i].title}</div>
                <p className="step-desc">{h.steps[i].desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why Choose Us ────────────────────────────────────── */}
      <section className="section section-gray">
        <div className="section-inner">
          <div className="section-header center">
            <div className="section-eyebrow">{h.whyEyebrow}</div>
            <h2 className="section-title">{h.whyTitle}</h2>
            <p className="section-sub">{h.whySub}</p>
          </div>
          <div className="features-grid">
            {(['⚡','🛡️','💰','📍'] as const).map((icon, i) => (
              <div className="feature-card" key={i}>
                <div className="fc-icon">{icon}</div>
                <div className="fc-title">{h.features[i].title}</div>
                <p className="fc-desc">{h.features[i].desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── For Riders & Drivers ─────────────────────────────── */}
      <section className="section section-white">
        <div className="section-inner">
          <div className="section-header center" style={{ marginBottom: '2.5rem' }}>
            <div className="section-eyebrow">{h.joinEyebrow}</div>
            <h2 className="section-title">{h.joinTitle}</h2>
          </div>
          <div className="audience-grid">
            <div className="audience-card rider-card">
              <div>
                <div className="ac-eyebrow">{h.forRiders}</div>
                <div className="ac-title">{h.riderTitle}</div>
              </div>
              <p className="ac-desc">{h.riderDesc}</p>
              <div className="ac-features">
                {h.riderPerks.map((p) => (
                  <div className="ac-feature" key={p}>
                    <div className="ac-check">✓</div>
                    <span>{p}</span>
                  </div>
                ))}
              </div>
              {!isLoading && !isAuthenticated && (
                <div className="ac-cta">
                  <Link to="/register?role=RIDER" className="btn btn-outline-white btn-block">
                    {h.registerRiderCta}
                  </Link>
                </div>
              )}
            </div>

            <div className="audience-card driver-card">
              <div>
                <div className="ac-eyebrow">{h.forDrivers}</div>
                <div className="ac-title">{h.driverTitle}</div>
              </div>
              <p className="ac-desc">{h.driverDesc}</p>
              <div className="ac-features">
                {h.driverPerks.map((p) => (
                  <div className="ac-feature" key={p}>
                    <div className="ac-check">✓</div>
                    <span>{p}</span>
                  </div>
                ))}
              </div>
              {!isLoading && !isAuthenticated && (
                <div className="ac-cta">
                  <Link to="/register?role=DRIVER" className="btn btn-outline-white btn-block">
                    {h.driveWithUsCta}
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── About ────────────────────────────────────────────── */}
      <section className="section section-white" id="about">
        <div className="section-inner">
          <div className="section-header center">
            <div className="section-eyebrow">{h.aboutEyebrow}</div>
            <h2 className="section-title">{h.aboutTitle}</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '1.5rem', marginTop: '2rem' }}>
            <div style={{ background: 'linear-gradient(135deg,#0f172a,#1e3a5f)', borderRadius: 16, padding: '1.75rem', color: '#fff' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🏍️</div>
              <h3 style={{ fontWeight: 800, fontSize: '1.1rem', marginBottom: '0.5rem' }}>{h.mission}</h3>
              <p style={{ fontSize: '0.88rem', lineHeight: 1.7, opacity: 0.85, margin: 0 }}>{h.missionText}</p>
            </div>
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 16, padding: '1.75rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🌍</div>
              <h3 style={{ fontWeight: 800, fontSize: '1.1rem', marginBottom: '0.5rem', color: '#0f172a' }}>{h.reach}</h3>
              <p style={{ fontSize: '0.88rem', lineHeight: 1.7, color: '#64748b', margin: 0 }}>{h.reachText}</p>
            </div>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 16, padding: '1.75rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🔒</div>
              <h3 style={{ fontWeight: 800, fontSize: '1.1rem', marginBottom: '0.5rem', color: '#0f172a' }}>{h.safety}</h3>
              <p style={{ fontSize: '0.88rem', lineHeight: 1.7, color: '#64748b', margin: 0 }}>{h.safetyText}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Contact Us ───────────────────────────────────────── */}
      <section className="section section-gray" id="contact">
        <div className="section-inner">
          <div className="section-header center">
            <div className="section-eyebrow">{h.contactEyebrow}</div>
            <h2 className="section-title">{h.contactTitle}</h2>
            <p className="section-sub">{h.contactSub}</p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2rem' }}>
            <div style={{ background: '#fff', borderRadius: 18, padding: '2rem', maxWidth: 480, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <a href="tel:+255763795801" style={{ display: 'flex', alignItems: 'center', gap: '1rem', textDecoration: 'none', background: '#fff7ed', border: '1.5px solid #fed7aa', borderRadius: 12, padding: '1rem 1.25rem' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#FF6B00', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>📞</div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h.phone}</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>+255 763 795 801</div>
                </div>
              </a>
              <a href="mailto:Hamisiselemani039@gmail.com" style={{ display: 'flex', alignItems: 'center', gap: '1rem', textDecoration: 'none', background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 12, padding: '1rem 1.25rem' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>✉️</div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h.emailLabel}</div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a', wordBreak: 'break-all' }}>Hamisiselemani039@gmail.com</div>
                </div>
              </a>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 12, padding: '1rem 1.25rem' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>🏢</div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h.company}</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>BodaBoda Tanzania</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    {lang === 'sw' ? 'Usafiri wa Pikipiki — Haraka, Salama, Bei Nafuu' : 'Motorcycle Transport — Fast, Safe, Affordable'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA Banner ───────────────────────────────────────── */}
      {!isLoading && !isAuthenticated && (
        <section className="cta-banner">
          <div className="cta-banner-title">{h.ctaTitle}</div>
          <p className="cta-banner-sub">{h.ctaSub}</p>
          <div className="cta-buttons">
            <Link to="/register?role=RIDER" className="btn btn-navy btn-lg">{h.registerRider}</Link>
            <Link to="/register?role=DRIVER" className="btn btn-outline-white btn-lg">{h.driveWithUs}</Link>
          </div>
        </section>
      )}

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">🏍️ <span>BodaBoda</span></div>
          <p className="footer-copy">
            {h.footerRights.replace('{year}', String(new Date().getFullYear()))}
          </p>
          <nav className="footer-links">
            <button type="button">{t('nav.privacy')}</button>
            <button type="button">{t('nav.terms')}</button>
            <button type="button">{t('nav.support')}</button>
          </nav>
        </div>
      </footer>
    </div>
  );
}
