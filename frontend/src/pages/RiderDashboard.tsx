import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { User } from '../types';
import api from '../api/axios';
import Alert from '../components/Alert';

const actions = [
  {
    icon: '🏍️',
    title: 'Request a BodaBoda Ride',
    desc: 'Book a motorcycle ride to your destination in seconds.',
  },
  {
    icon: '📋',
    title: 'My Trips',
    desc: 'View your complete ride history and receipts.',
  },
  {
    icon: '💳',
    title: 'Payment Methods',
    desc: 'Manage M-Pesa, card, and cash payment options.',
  },
  {
    icon: '⭐',
    title: 'Ride History',
    desc: 'Rate past rides and review driver feedback.',
  },
];

export default function RiderDashboard() {
  const { user: ctxUser, setUser } = useAuth();
  const [user, setLocalUser] = useState<User | null>(ctxUser);
  const [error, setError] = useState('');
  // Only show the full-screen spinner when we have no data at all.
  // If ctxUser is already loaded, render immediately and refresh in background.
  const [isLoading, setIsLoading] = useState(!ctxUser);

  useEffect(() => {
    let cancelled = false;
    api
      .get<User>('/auth/me')
      .then(({ data }) => {
        if (!cancelled) { setLocalUser(data); setUser(data); }
      })
      .catch(() => { if (!cancelled) setError('Could not load your profile.'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [setUser]);

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading your dashboard…</p>
      </div>
    );
  }

  const profile = user?.rider_profile;

  return (
    <div className="dashboard">
      {/* Banner */}
      <div className="db-banner rider-banner">
        <div className="db-banner-inner">
          <div className="db-welcome">
            <div className="db-avatar">
              {user?.full_name?.charAt(0).toUpperCase() ?? 'R'}
            </div>
            <div>
              <p className="db-greeting">Welcome back, Rider 👋</p>
              <h1 className="db-name">{user?.full_name ?? '—'}</h1>
              <div className="db-pills">
                <span className="db-role-pill">🧑‍💼 RIDER</span>
              </div>
            </div>
          </div>
          <div className="db-banner-actions">
            <Link to="/profile" className="btn-rider-outline">View Profile</Link>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="db-body">
        {error && <Alert type="error" message={error} />}

        {/* Stats */}
        <div className="db-stats">
          <div className="db-stat">
            <div className="db-stat-icon rider-stat-icon">⭐</div>
            <div className="db-stat-info">
              <div className="db-stat-val">
                {profile?.rating != null ? profile.rating.toFixed(1) : '—'}
              </div>
              <div className="db-stat-lbl">My Rating</div>
            </div>
          </div>

          <div className="db-stat">
            <div className="db-stat-icon rider-stat-icon">🏍️</div>
            <div className="db-stat-info">
              <div className="db-stat-val">{profile?.total_trips ?? 0}</div>
              <div className="db-stat-lbl">Total Trips</div>
            </div>
          </div>

          <div className="db-stat">
            <div className="db-stat-icon rider-stat-icon">📱</div>
            <div className="db-stat-info">
              <div className="db-stat-val ellipsis">{user?.phone ?? '—'}</div>
              <div className="db-stat-lbl">Phone</div>
            </div>
          </div>

          <div className="db-stat">
            <div className="db-stat-icon rider-stat-icon">✉️</div>
            <div className="db-stat-info">
              <div className="db-stat-val ellipsis">{user?.email ?? '—'}</div>
              <div className="db-stat-lbl">Email</div>
            </div>
          </div>
        </div>

        {/* Rider Profile card */}
        {profile && (
          <div className="info-card">
            <div className="info-card-head">
              <span className="info-card-title">Rider Profile</span>
              <span className="info-card-accent rider-accent">🧑‍💼 Active</span>
            </div>
            <div className="info-body">
              <div className="info-row">
                <span className="info-label">Profile ID</span>
                <span className="info-value mono">{profile.id}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Rating</span>
                <span className="info-value">
                  {profile.rating != null ? `${profile.rating.toFixed(1)} ★` : 'No ratings yet'}
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">Total Trips</span>
                <span className="info-value">{profile.total_trips}</span>
              </div>
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div className="db-section-heading">Quick Actions</div>
        <div className="action-grid">
          {actions.map((a) => (
            <div className="action-card rider-action-card" key={a.title}>
              <div className="action-card-icon rider-action-icon">{a.icon}</div>
              <div className="action-card-head">
                <span className="action-card-title">{a.title}</span>
                <span className="action-badge">Coming soon</span>
              </div>
              <p className="action-card-desc">{a.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
