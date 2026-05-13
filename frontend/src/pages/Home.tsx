import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const features = [
  {
    icon: '⚡',
    title: 'Instant Pickup',
    desc: 'Bodas weave through traffic. Average pickup under 2 minutes anywhere in the city.',
  },
  {
    icon: '🛡️',
    title: 'Verified Drivers',
    desc: 'Every driver is background-checked, licensed, and rated by riders before you ever board.',
  },
  {
    icon: '💰',
    title: 'Affordable Fares',
    desc: 'Pay a fraction of car-taxi prices. Flat rates, no surge pricing surprises.',
  },
  {
    icon: '📍',
    title: 'Live Tracking',
    desc: 'Watch your boda in real time. Share your trip with family for peace of mind.',
  },
];

const steps = [
  { num: '01', icon: '📲', title: 'Register', desc: 'Create a free account in under a minute.' },
  { num: '02', icon: '📍', title: 'Set Destination', desc: 'Tell us where you are and where you\'re going.' },
  { num: '03', icon: '🏍️', title: 'Match a Driver', desc: 'We connect you with the nearest available boda.' },
  { num: '04', icon: '🎉', title: 'Ride & Pay', desc: 'Hop on, arrive fast, pay easily via M-Pesa or cash.' },
];

const riderPerks = [
  'Book a ride in under 30 seconds',
  'Real-time driver tracking',
  'Safe, rated, and verified drivers',
  'Pay with M-Pesa, card, or cash',
  'Instant ride history & receipts',
];

const driverPerks = [
  'Earn on your own schedule',
  'Set yourself online/offline anytime',
  'Get ride requests near your location',
  'Weekly earnings payout',
  'Driver support 24 / 7',
];

export default function Home() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const dashboardPath = user?.role === 'RIDER' ? '/dashboard/rider' : '/dashboard/driver';

  return (
    <div className="home">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="hero-section">
        <div className="hero-inner">
          {/* Left: copy */}
          <div className="hero-content">
            <div className="hero-badge">🏍️ &nbsp;Motorcycle Ride-Hailing</div>

            <h1 className="hero-title">
              Your BodaBoda Ride,{' '}
              <span style={{ color: '#f87171' }}>On&nbsp;Demand.</span>
            </h1>

            <p className="hero-subtitle">
              Fast, affordable, and reliable motorcycle rides around the city.
              Skip the traffic jam — your boda is 2&nbsp;minutes away.
            </p>

            {!isLoading && (
              isAuthenticated ? (
                <div className="hero-ctas">
                  <Link to={dashboardPath} className="btn btn-primary btn-lg">
                    Go to Dashboard
                  </Link>
                </div>
              ) : (
                <div className="hero-ctas">
                  <Link to="/register?role=RIDER" className="btn btn-primary btn-lg">
                    Register as Rider
                  </Link>
                  <Link to="/register?role=DRIVER" className="btn btn-outline-white btn-lg">
                    Drive with Us
                  </Link>
                  <Link to="/login" className="btn btn-outline-white btn-lg">
                    Login
                  </Link>
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
              <p className="hero-trust-text">
                Trusted by <strong>10,000+ riders</strong> across the city
              </p>
            </div>
          </div>

          {/* Right: real Boxer motorcycle image */}
          <div className="hero-visual">
            <div className="hero-moto-img-wrap">
              <span className="hero-moto-tag">Bajaj Boxer</span>
              <img
                src="/boxer.png"
                alt="Bajaj Boxer motorcycle — the BodaBoda fleet"
                className="hero-moto-img"
              />
            </div>

            <div className="hero-stats">
              <div className="h-stat">
                <span className="h-stat-val">2 min</span>
                <span className="h-stat-lbl">Avg pickup</span>
              </div>
              <div className="h-stat-divider" />
              <div className="h-stat">
                <span className="h-stat-val">4.8 ★</span>
                <span className="h-stat-lbl">Driver rating</span>
              </div>
              <div className="h-stat-divider" />
              <div className="h-stat">
                <span className="h-stat-val">1,000+</span>
                <span className="h-stat-lbl">Active drivers</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────── */}
      <div className="stats-bar">
        <div className="stats-bar-inner">
          {[
            { icon: '⚡', val: '< 2 min', lbl: 'Average pickup time' },
            { icon: '⭐', val: '4.8 / 5', lbl: 'Average driver rating' },
            { icon: '🏍️', val: '1,000+', lbl: 'Verified drivers' },
            { icon: '🛣️', val: '50,000+', lbl: 'Rides completed' },
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
            <div className="section-eyebrow">— How It Works</div>
            <h2 className="section-title">Ride in 4 easy steps</h2>
            <p className="section-sub">
              From registration to your first ride, BodaBoda gets you moving in minutes.
            </p>
          </div>

          <div className="steps-grid">
            {steps.map((s, i) => (
              <div className="step-item" key={s.num}>
                <div className={`step-num${i === 0 ? ' filled' : ''}`}>{s.num}</div>
                <div className="step-icon">{s.icon}</div>
                <div className="step-title">{s.title}</div>
                <p className="step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why Choose Us ────────────────────────────────────── */}
      <section className="section section-gray">
        <div className="section-inner">
          <div className="section-header center">
            <div className="section-eyebrow">— Why BodaBoda</div>
            <h2 className="section-title">Built for speed. Built for trust.</h2>
            <p className="section-sub">
              Every feature is designed to make your motorcycle ride faster, safer, and more affordable.
            </p>
          </div>
          <div className="features-grid">
            {features.map((f) => (
              <div className="feature-card" key={f.title}>
                <div className="fc-icon">{f.icon}</div>
                <div className="fc-title">{f.title}</div>
                <p className="fc-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── For Riders & Drivers ─────────────────────────────── */}
      <section className="section section-white">
        <div className="section-inner">
          <div className="section-header center" style={{ marginBottom: '2.5rem' }}>
            <div className="section-eyebrow">— Join the Community</div>
            <h2 className="section-title">Rider or Driver — we've got you covered</h2>
          </div>

          <div className="audience-grid">
            {/* Riders */}
            <div className="audience-card rider-card">
              <div>
                <div className="ac-eyebrow">For Riders</div>
                <div className="ac-title">Get where you need to go, fast.</div>
              </div>
              <p className="ac-desc">
                No more waiting for taxis or squeezing into matatus. Request a boda,
                track it live, and arrive on time — every time.
              </p>
              <div className="ac-features">
                {riderPerks.map((p) => (
                  <div className="ac-feature" key={p}>
                    <div className="ac-check">✓</div>
                    <span>{p}</span>
                  </div>
                ))}
              </div>
              {!isLoading && !isAuthenticated && (
                <div className="ac-cta">
                  <Link to="/register?role=RIDER" className="btn btn-outline-white btn-block">
                    Register as Rider →
                  </Link>
                </div>
              )}
            </div>

            {/* Drivers */}
            <div className="audience-card driver-card">
              <div>
                <div className="ac-eyebrow">For Drivers</div>
                <div className="ac-title">Earn more. Work on your terms.</div>
              </div>
              <p className="ac-desc">
                Join hundreds of boda-boda drivers already earning with BodaBoda.
                No boss, no fixed hours — just you, your bike, and your customers.
              </p>
              <div className="ac-features">
                {driverPerks.map((p) => (
                  <div className="ac-feature" key={p}>
                    <div className="ac-check">✓</div>
                    <span>{p}</span>
                  </div>
                ))}
              </div>
              {!isLoading && !isAuthenticated && (
                <div className="ac-cta">
                  <Link to="/register?role=DRIVER" className="btn btn-outline-white btn-block">
                    Drive with BodaBoda →
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA Banner ───────────────────────────────────────── */}
      {!isLoading && !isAuthenticated && (
        <section className="cta-banner">
          <div className="cta-banner-title">Ready to ride with BodaBoda?</div>
          <p className="cta-banner-sub">
            Hop on a Bajaj Boxer. Join thousands of riders and drivers already on the platform.
          </p>
          <div className="cta-buttons">
            <Link to="/register?role=RIDER" className="btn btn-navy btn-lg">
              Register as Rider
            </Link>
            <Link to="/register?role=DRIVER" className="btn btn-outline-white btn-lg">
              Drive with Us
            </Link>
          </div>
        </section>
      )}

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            🏍️ <span>BodaBoda</span>
          </div>
          <p className="footer-copy">© {new Date().getFullYear()} BodaBoda. All rights reserved.</p>
          <nav className="footer-links">
            <button type="button">Privacy</button>
            <button type="button">Terms</button>
            <button type="button">Support</button>
          </nav>
        </div>
      </footer>
    </div>
  );
}
