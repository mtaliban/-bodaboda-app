import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { User } from '../types';
import api from '../api/axios';
import Alert from '../components/Alert';

const actions = [
  {
    icon: '🟢',
    title: 'Go Online',
    desc: 'Start receiving ride requests from riders near you.',
  },
  {
    icon: '📨',
    title: 'Current Ride Offers',
    desc: 'Accept or decline incoming ride requests.',
  },
  {
    icon: '📋',
    title: 'My Trips',
    desc: 'Track completed trips and your full trip history.',
  },
  {
    icon: '💰',
    title: 'Earnings',
    desc: 'View daily, weekly, and monthly earnings breakdown.',
  },
];

function VerificationBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING:  { label: '⏳ Pending Review', cls: 'badge-warning' },
    VERIFIED: { label: '✓ Verified',        cls: 'badge-success' },
    REJECTED: { label: '✕ Rejected',        cls: 'badge-error'   },
  };
  const s = map[status?.toUpperCase()] ?? { label: status, cls: 'badge-info' };
  return <span className={`verification-badge ${s.cls}`}>{s.label}</span>;
}

export default function DriverDashboard() {
  const { user: ctxUser, setUser } = useAuth();
  const [user, setLocalUser] = useState<User | null>(ctxUser);
  const [error, setError] = useState('');
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
        <div className="spinner spinner-navy" />
        <p>Loading your dashboard…</p>
      </div>
    );
  }

  const profile = user?.driver_profile;

  return (
    <div className="dashboard">
      {/* Banner */}
      <div className="db-banner driver-banner">
        <div className="db-banner-inner">
          <div className="db-welcome">
            <div className="db-avatar">
              {user?.full_name?.charAt(0).toUpperCase() ?? 'D'}
            </div>
            <div>
              <p className="db-greeting">Ready to earn today, Driver 🏍️</p>
              <h1 className="db-name">{user?.full_name ?? '—'}</h1>
              <div className="db-pills">
                <span className="db-role-pill">🏍️ DRIVER</span>
                {profile && <VerificationBadge status={profile.verification_status} />}
              </div>
            </div>
          </div>
          <div className="db-banner-actions">
            <Link to="/profile" className="btn-driver-outline">View Profile</Link>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="db-body">
        {error && <Alert type="error" message={error} />}

        {/* Stats */}
        <div className="db-stats">
          <div className="db-stat">
            <div className="db-stat-icon driver-stat-icon">⭐</div>
            <div className="db-stat-info">
              <div className="db-stat-val">
                {profile?.rating != null ? profile.rating.toFixed(1) : '—'}
              </div>
              <div className="db-stat-lbl">My Rating</div>
            </div>
          </div>

          <div className="db-stat">
            <div className="db-stat-icon driver-stat-icon">🏍️</div>
            <div className="db-stat-info">
              <div className="db-stat-val">{profile?.total_trips ?? 0}</div>
              <div className="db-stat-lbl">Total Trips</div>
            </div>
          </div>

          <div className="db-stat">
            <div className="db-stat-icon driver-stat-icon">🔖</div>
            <div className="db-stat-info">
              <div className="db-stat-val">{profile?.plate_number ?? '—'}</div>
              <div className="db-stat-lbl">Plate Number</div>
            </div>
          </div>

          <div className="db-stat">
            <div className="db-stat-icon driver-stat-icon">🛵</div>
            <div className="db-stat-info">
              <div className="db-stat-val ellipsis">{profile?.vehicle_model ?? '—'}</div>
              <div className="db-stat-lbl">Motorcycle</div>
            </div>
          </div>
        </div>

        {/* Driver profile card */}
        {profile && (
          <div className="info-card">
            <div className="info-card-head">
              <span className="info-card-title">Driver Profile</span>
              <span className="info-card-accent driver-accent">🏍️ Driver</span>
            </div>
            <div className="info-body">
              <div className="info-row">
                <span className="info-label">Profile ID</span>
                <span className="info-value mono">{profile.id}</span>
              </div>
              <div className="info-row">
                <span className="info-label">License Number</span>
                <span className="info-value">{profile.license_number}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Motorcycle Model</span>
                <span className="info-value">{profile.vehicle_model}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Plate Number</span>
                <span className="info-value">{profile.plate_number}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Verification Status</span>
                <span className="info-value">
                  <VerificationBadge status={profile.verification_status} />
                </span>
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
            <div className="info-card-foot">
              <Link to="/profile/edit-profile" className="btn-driver-sm">
                Edit Driver Profile
              </Link>
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div className="db-section-heading">Quick Actions</div>
        <div className="action-grid">
          {actions.map((a) => (
            <div className="action-card driver-action-card" key={a.title}>
              <div className="action-card-icon driver-action-icon">{a.icon}</div>
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
