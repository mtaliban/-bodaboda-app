import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { User } from '../types';
import api from '../api/axios';
import Alert from '../components/Alert';

function VerificationBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING:  { label: '⏳ Pending', cls: 'badge-warning' },
    VERIFIED: { label: '✓ Verified', cls: 'badge-success' },
    REJECTED: { label: '✕ Rejected', cls: 'badge-error'  },
  };
  const s = map[status?.toUpperCase()] ?? { label: status, cls: 'badge-info' };
  return <span className={`verification-badge ${s.cls}`}>{s.label}</span>;
}

export default function Profile() {
  const { user: ctxUser, setUser } = useAuth();
  const [user, setLocalUser] = useState<User | null>(ctxUser);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(!ctxUser);

  useEffect(() => {
    api
      .get<User>('/auth/me')
      .then(({ data }) => { setLocalUser(data); setUser(data); })
      .catch(() => setError('Could not load your profile.'))
      .finally(() => setIsLoading(false));
  }, [setUser]);

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading profile…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page-wrap">
        {error && <Alert type="error" message={error} />}
      </div>
    );
  }

  const isDriver = user.role === 'DRIVER';

  return (
    <div className="page-wrap">
      {error && <Alert type="error" message={error} />}

      {/* Profile banner */}
      <div className={`profile-banner ${isDriver ? 'driver-profile-banner' : 'rider-profile-banner'}`}>
        {/* Avatar */}
        <div>
          {user.profile_image_url ? (
            <img src={user.profile_image_url} alt="Profile" className="profile-avatar-img" />
          ) : (
            <div className="profile-avatar-initial">
              {user.full_name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="profile-banner-info">
          <h1 className="profile-name">{user.full_name}</h1>
          <div className="profile-pills">
            <span className="role-pill">
              {isDriver ? '🏍️ DRIVER' : '🧑‍💼 RIDER'}
            </span>
            {isDriver && user.driver_profile && (
              <VerificationBadge status={user.driver_profile.verification_status} />
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="profile-banner-actions">
          <Link to="/profile/edit-account" className="btn-outline-sm">
            ✏️ Edit Account
          </Link>
          <Link to="/profile/edit-profile" className="btn-outline-sm">
            🔧 Edit Profile
          </Link>
        </div>
      </div>

      {/* Cards */}
      <div className="profile-cards">
        {/* Account info */}
        <div className="info-card">
          <div className="info-card-head">
            <span className="info-card-title">Account Information</span>
            <Link to="/profile/edit-account" className="info-card-accent rider-accent" style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--primary)', textDecoration: 'none' }}>
              Edit →
            </Link>
          </div>
          <div className="info-body">
            <div className="info-row">
              <span className="info-label">Full Name</span>
              <span className="info-value">{user.full_name}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Email Address</span>
              <span className="info-value">{user.email}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Phone Number</span>
              <span className="info-value">{user.phone}</span>
            </div>
            <div className="info-row">
              <span className="info-label">User ID</span>
              <span className="info-value mono">{user.id}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Role</span>
              <span className="info-value">{isDriver ? '🏍️ Driver' : '🧑‍💼 Rider'}</span>
            </div>
          </div>
        </div>

        {/* Role-specific profile */}
        {isDriver && user.driver_profile && (
          <div className="info-card">
            <div className="info-card-head">
              <span className="info-card-title">Driver Profile</span>
              <span className="info-card-accent driver-accent">🏍️ Driver</span>
            </div>
            <div className="info-body">
              <div className="info-row">
                <span className="info-label">Profile ID</span>
                <span className="info-value mono">{user.driver_profile.id}</span>
              </div>
              <div className="info-row">
                <span className="info-label">License Number</span>
                <span className="info-value">{user.driver_profile.license_number}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Motorcycle Model</span>
                <span className="info-value">{user.driver_profile.vehicle_model}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Plate Number</span>
                <span className="info-value">{user.driver_profile.plate_number}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Verification</span>
                <span className="info-value">
                  <VerificationBadge status={user.driver_profile.verification_status} />
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">Rating</span>
                <span className="info-value">
                  {user.driver_profile.rating != null
                    ? `${user.driver_profile.rating.toFixed(1)} ★`
                    : 'No ratings yet'}
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">Total Trips</span>
                <span className="info-value">{user.driver_profile.total_trips}</span>
              </div>
            </div>
            <div className="info-card-foot">
              <Link to="/profile/edit-profile" className="btn-driver-sm">
                Edit Driver Profile
              </Link>
            </div>
          </div>
        )}

        {!isDriver && user.rider_profile && (
          <div className="info-card">
            <div className="info-card-head">
              <span className="info-card-title">Rider Profile</span>
              <span className="info-card-accent rider-accent">🧑‍💼 Rider</span>
            </div>
            <div className="info-body">
              <div className="info-row">
                <span className="info-label">Profile ID</span>
                <span className="info-value mono">{user.rider_profile.id}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Rating</span>
                <span className="info-value">
                  {user.rider_profile.rating != null
                    ? `${user.rider_profile.rating.toFixed(1)} ★`
                    : 'No ratings yet'}
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">Total Trips</span>
                <span className="info-value">{user.rider_profile.total_trips}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
