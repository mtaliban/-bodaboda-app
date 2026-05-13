import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { flushSync } from 'react-dom';
import { AxiosError } from 'axios';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import Alert from '../components/Alert';
import { User, Trip, DriverOut, Offer, UserNotification, AcceptOfferResponse, DeclineOfferResponse } from '../types';

type Tab =
  | 'home' | 'profile' | 'edit-account' | 'edit-profile'
  | 'request-ride' | 'my-trips'
  | 'current-offer' | 'offer-history'
  | 'notifications';

type NavItem = { tab: Tab; label: string; icon: ReactNode; badge?: number };

const ACTIVE_TRIP_STATUSES = ['SEARCHING_DRIVER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'];

// ── Shared helpers ─────────────────────────────────────────────────────

function VerificationBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING:  { label: '⏳ Pending', cls: 'badge-warning' },
    VERIFIED: { label: '✓ Verified', cls: 'badge-success' },
    REJECTED: { label: '✕ Rejected', cls: 'badge-error'  },
  };
  const s = map[status?.toUpperCase()] ?? { label: status, cls: 'badge-info' };
  return <span className={`verification-badge ${s.cls}`}>{s.label}</span>;
}

function TripStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    SEARCHING_DRIVER:    { label: '🔍 Searching',        cls: 'ts-searching' },
    DRIVER_ASSIGNED:     { label: '✓ Driver Assigned',   cls: 'ts-assigned'  },
    DRIVER_ARRIVED:      { label: '📍 Driver Arrived',   cls: 'ts-arrived'   },
    NO_DRIVER_AVAILABLE: { label: '✕ No Driver Found',   cls: 'ts-nodriver'  },
    CANCELLED:           { label: '✕ Cancelled',         cls: 'ts-cancelled' },
    IN_PROGRESS:         { label: '🚀 In Progress',      cls: 'ts-progress'  },
    COMPLETED:           { label: '✓ Completed',         cls: 'ts-completed' },
  };
  const s = map[status?.toUpperCase()] ?? { label: status, cls: '' };
  return <span className={`trip-status-badge ${s.cls}`}>{s.label}</span>;
}

function OfferStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    OFFERED:  { label: '📨 Pending',  cls: 'ts-searching' },
    ACCEPTED: { label: '✓ Accepted', cls: 'ts-completed' },
    DECLINED: { label: '✕ Declined', cls: 'ts-cancelled' },
    EXPIRED:  { label: '⏰ Expired',  cls: 'ts-nodriver'  },
  };
  const s = map[status?.toUpperCase()] ?? { label: status, cls: '' };
  return <span className={`trip-status-badge ${s.cls}`}>{s.label}</span>;
}

function extractApiError(err: unknown): string {
  const error = err as AxiosError<{ detail?: unknown; message?: string }>;
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d: { msg: string }) => d.msg).join(', ');
  return error.response?.data?.message ?? 'Something went wrong. Please try again.';
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(s: string) {
  return new Date(s).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function EmptyState({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-desc">{desc}</p>
    </div>
  );
}

function TabLoader() {
  return (
    <div className="tab-loading">
      <div className="spinner" />
      <p>Loading…</p>
    </div>
  );
}

// ── Current Trip Card (Driver) ─────────────────────────────────────────

interface CurrentTripCardProps {
  trip: Trip;
  actionLoading: string | null;
  onAction: (action: 'driver-arrived' | 'start' | 'complete') => void;
}

function CurrentTripCard({ trip, actionLoading, onAction }: CurrentTripCardProps) {
  const guideText: Record<string, string> = {
    DRIVER_ASSIGNED: 'Head to the pickup point to collect your rider.',
    DRIVER_ARRIVED:  'You have arrived. Waiting for the rider to board.',
    IN_PROGRESS:     'Trip is underway. Complete it when you reach the destination.',
  };

  return (
    <div className="current-trip-card">
      <div className="ctc-head">
        <span className="ctc-title">🏍️ Current Trip #{trip.id}</span>
        <TripStatusBadge status={trip.status} />
      </div>

      <div className="trip-route" style={{ margin: '0.875rem 0' }}>
        <div className="trip-route-item">
          <span className="trip-route-dot dot-pickup" />
          <div>
            <span className="offer-route-label">Pickup</span>
            <span className="trip-route-text">{trip.pickup_address}</span>
          </div>
        </div>
        <div className="trip-route-line" />
        <div className="trip-route-item">
          <span className="trip-route-dot dot-dest" />
          <div>
            <span className="offer-route-label">Destination</span>
            <span className="trip-route-text">{trip.destination_address}</span>
          </div>
        </div>
      </div>

      {guideText[trip.status] && (
        <p className="ctc-guide">{guideText[trip.status]}</p>
      )}

      <div className="ctc-actions">
        {trip.status === 'DRIVER_ASSIGNED' && (
          <button
            className="btn btn-primary btn-block"
            onClick={() => onAction('driver-arrived')}
            disabled={!!actionLoading}
          >
            {actionLoading === 'driver-arrived'
              ? <><span className="btn-spinner" /> Updating…</>
              : "📍 I've Arrived at Pickup"}
          </button>
        )}
        {trip.status === 'DRIVER_ARRIVED' && (
          <button
            className="btn btn-primary btn-block"
            onClick={() => onAction('start')}
            disabled={!!actionLoading}
          >
            {actionLoading === 'start'
              ? <><span className="btn-spinner" /> Starting…</>
              : '🚀 Start Trip'}
          </button>
        )}
        {trip.status === 'IN_PROGRESS' && (
          <button
            className="btn btn-navy btn-block"
            onClick={() => onAction('complete')}
            disabled={!!actionLoading}
          >
            {actionLoading === 'complete'
              ? <><span className="btn-spinner" /> Completing…</>
              : '✓ Complete Trip'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Driver Home Panel ──────────────────────────────────────────────────

function DriverHomePanel() {
  const [driver, setDriver]           = useState<DriverOut | null>(null);
  const [loading, setLoading]         = useState(true);
  const [toggling, setToggling]       = useState(false);
  const [offer, setOffer]             = useState<Offer | null>(null);
  const [currentTrip, setCurrentTrip] = useState<Trip | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [msg, setMsg]       = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [error, setError]   = useState('');

  const loadCurrentTrip = useCallback(async () => {
    try {
      const { data } = await api.get<Trip | null>('/drivers/current-trip');
      setCurrentTrip(data ?? null);
    } catch {}
  }, []);

  const refreshDriver = useCallback(async (): Promise<DriverOut | null> => {
    try {
      const { data } = await api.get<DriverOut>('/drivers/me');
      setDriver(data);
      return data;
    } catch {}
    return null;
  }, []);

  // Init: sync-me ensures driver record exists
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.post<DriverOut>('/drivers/sync-me');
        setDriver(data);
        if (data.status === 'BUSY') await loadCurrentTrip();
      } catch {
        setError('Failed to load driver status. Please refresh.');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadCurrentTrip]);

  // Poll offers every 4 s when AVAILABLE
  useEffect(() => {
    if (driver?.status !== 'AVAILABLE') return;
    const poll = async () => {
      try {
        const { data } = await api.get<Offer | null>('/drivers/offers/current');
        setOffer(data ?? null);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [driver?.status]);

  const toggle = async () => {
    if (!driver || driver.status === 'BUSY') return;
    setToggling(true); setError('');
    try {
      const ep = driver.status === 'OFFLINE' ? '/drivers/go-online' : '/drivers/go-offline';
      const { data } = await api.post<DriverOut>(ep);
      setDriver(data);
      setOffer(null);
    } catch {
      setError('Failed to update status. Please try again.');
    }
    setToggling(false);
  };

  const acceptOffer = async () => {
    if (!offer) return;
    setActionLoading('accept');
    try {
      await api.post<AcceptOfferResponse>(`/drivers/offers/${offer.id}/accept`);
      setOffer(null);
      setMsg('Offer accepted! Head to the pickup point.');
      setMsgType('success');
      const d = await refreshDriver();
      if (d?.status === 'BUSY') await loadCurrentTrip();
    } catch (err) {
      setMsg(extractApiError(err));
      setMsgType('error');
    }
    setActionLoading(null);
  };

  const declineOffer = async () => {
    if (!offer) return;
    setActionLoading('decline');
    try {
      const { data } = await api.post<DeclineOfferResponse>(`/drivers/offers/${offer.id}/decline`);
      setOffer(null);
      setMsg(data.next_action || 'Offer declined.');
      setMsgType('success');
    } catch {}
    setActionLoading(null);
  };

  const handleTripAction = async (action: 'driver-arrived' | 'start' | 'complete') => {
    if (!currentTrip) return;
    setActionLoading(action);
    try {
      if (action === 'complete') {
        await api.post<Trip>(`/trips/${currentTrip.id}/complete`);
        setCurrentTrip(null);
        setMsg('Trip completed! You are now available for new rides.');
        setMsgType('success');
        await refreshDriver();
      } else {
        const { data } = await api.post<Trip>(`/trips/${currentTrip.id}/${action}`);
        setCurrentTrip(data);
      }
    } catch (err) {
      setMsg(extractApiError(err));
      setMsgType('error');
    }
    setActionLoading(null);
  };

  if (loading) return <TabLoader />;
  if (!driver) return <Alert type="error" message={error || 'Failed to load driver data.'} />;

  const isOffline   = driver.status === 'OFFLINE';
  const isAvailable = driver.status === 'AVAILABLE';
  const isBusy      = driver.status === 'BUSY';

  const expiryText = (iso: string) => {
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const s = Math.floor(diff / 1000);
    return s < 60 ? `${s}s left` : `${Math.floor(s / 60)}m left`;
  };

  return (
    <div className="driver-panel">
      {/* Status bar */}
      <div className={`driver-status-card ${isAvailable ? 'ds-online' : isBusy ? 'ds-busy' : 'ds-offline'}`}>
        <div className="ds-left">
          <div className={`ds-dot ${isBusy ? 'ds-dot-busy' : isAvailable ? 'ds-dot-on' : 'ds-dot-off'}`} />
          <div>
            <div className="ds-label">
              {isBusy ? 'On a Trip' : isAvailable ? 'Available' : 'Offline'}
            </div>
            <div className="ds-sub">
              {isBusy
                ? 'Complete your current trip to go back online'
                : isAvailable
                ? 'Watching for ride requests…'
                : 'Go online to start receiving ride requests'}
            </div>
          </div>
        </div>
        {!isBusy && (
          <button
            className={`btn btn-sm ${isAvailable ? 'btn-ghost' : 'btn-primary'}`}
            onClick={toggle}
            disabled={toggling}
          >
            {toggling
              ? <><span className="btn-spinner" /> Updating…</>
              : isAvailable ? 'Go Offline' : 'Go Online'}
          </button>
        )}
      </div>

      {error && <div className="driver-panel-msg"><Alert type="error" message={error} /></div>}
      {msg   && <div className="driver-panel-msg"><Alert type={msgType} message={msg} /></div>}

      {/* OFFLINE hint */}
      {isOffline && (
        <div className="driver-waiting-card">
          <div className="driver-waiting-icon">🔴</div>
          <div className="driver-waiting-title">You are offline</div>
          <p className="driver-waiting-desc">
            Tap "Go Online" above to start receiving ride requests from riders near you.
          </p>
        </div>
      )}

      {/* AVAILABLE: offer or waiting */}
      {isAvailable && !offer && (
        <div className="driver-waiting-card">
          <div className="driver-waiting-icon">📡</div>
          <div className="driver-waiting-title">Watching for ride requests</div>
          <p className="driver-waiting-desc">
            An offer card will appear here automatically when a rider near you requests a trip.
          </p>
        </div>
      )}

      {isAvailable && offer && (
        <div className="offer-card offer-card-featured" style={{ marginTop: '1rem' }}>
          <div className="offer-card-head">
            <div className="offer-card-head-left">
              <OfferStatusBadge status={offer.status} />
              <span className="offer-expiry">{expiryText(offer.expires_at)}</span>
            </div>
            <span className="trip-card-id">Offer #{offer.id}</span>
          </div>
          {offer.trip && (
            <>
              <div className="trip-route offer-route">
                <div className="trip-route-item">
                  <span className="trip-route-dot dot-pickup" />
                  <div>
                    <span className="offer-route-label">Pickup</span>
                    <span className="trip-route-text">{offer.trip.pickup_address}</span>
                  </div>
                </div>
                <div className="trip-route-line" />
                <div className="trip-route-item">
                  <span className="trip-route-dot dot-dest" />
                  <div>
                    <span className="offer-route-label">Destination</span>
                    <span className="trip-route-text">{offer.trip.destination_address}</span>
                  </div>
                </div>
              </div>
              <div className="offer-meta-row">
                <span>🏍️ {offer.trip.ride_type}</span>
                <span>💵 {offer.trip.payment_method}</span>
              </div>
            </>
          )}
          {offer.status === 'OFFERED' && (
            <div className="offer-actions">
              <button className="btn btn-ghost" onClick={declineOffer} disabled={!!actionLoading}>
                {actionLoading === 'decline' ? 'Declining…' : '✕ Decline'}
              </button>
              <button className="btn btn-primary" onClick={acceptOffer} disabled={!!actionLoading}>
                {actionLoading === 'accept'
                  ? <><span className="btn-spinner" /> Accepting…</>
                  : '✓ Accept Ride'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* BUSY: current trip */}
      {isBusy && currentTrip && (
        <CurrentTripCard
          trip={currentTrip}
          actionLoading={actionLoading}
          onAction={handleTripAction}
        />
      )}

      {isBusy && !currentTrip && (
        <div className="driver-waiting-card">
          <div className="driver-waiting-icon">⏳</div>
          <div className="driver-waiting-title">Loading your current trip…</div>
          <p className="driver-waiting-desc">Please wait a moment.</p>
        </div>
      )}
    </div>
  );
}

// ── Home Tab ──────────────────────────────────────────────────────────

const riderActions: { icon: string; title: string; desc: string; tab: Tab | null }[] = [
  { icon: '🏍️', title: 'Request a Ride',  desc: 'Book a BodaBoda to your destination in seconds.',    tab: 'request-ride'  },
  { icon: '📋', title: 'My Trips',         desc: 'View your complete ride history and receipts.',       tab: 'my-trips'      },
  { icon: '🔔', title: 'Notifications',    desc: 'Stay updated with ride alerts and messages.',         tab: 'notifications' },
  { icon: '👤', title: 'My Profile',       desc: 'View and update your account details.',               tab: 'profile'       },
];

const driverActions: { icon: string; title: string; desc: string; tab: Tab | null }[] = [
  { icon: '📨', title: 'Current Offer',   desc: 'Accept or decline the current incoming ride request.', tab: 'current-offer' },
  { icon: '📋', title: 'Offer History',   desc: 'View all past ride offers and their outcomes.',        tab: 'offer-history' },
  { icon: '🔔', title: 'Notifications',   desc: 'Stay updated with ride alerts and messages.',          tab: 'notifications' },
  { icon: '👤', title: 'My Profile',      desc: 'View and update your account and vehicle details.',    tab: 'profile'       },
];

function HomeTab({ user, setActiveTab }: { user: User; setActiveTab: (t: Tab) => void }) {
  const isDriver = user.role === 'DRIVER';
  const driverP  = user.driver_profile;
  const riderP   = user.rider_profile;
  const rating   = isDriver ? driverP?.rating : riderP?.rating;
  const trips    = isDriver ? driverP?.total_trips : riderP?.total_trips;
  const actions  = isDriver ? driverActions : riderActions;
  const firstName = user.full_name.split(' ')[0];

  return (
    <>
      <div className="db-header">
        <div className="db-header-inner">
          <div>
            <h1 className="db-greeting-text">{getGreeting()}, {firstName} 👋</h1>
            <p className="db-greeting-sub">{isDriver ? 'Ready to earn today?' : 'Where are you headed today?'}</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('profile')}>View Profile</button>
        </div>
      </div>

      <div className="db-body">
        {/* Driver: full online/offline + offer/trip management panel */}
        {isDriver && <DriverHomePanel />}

        <div className="db-stats">
          <div className="db-stat">
            <div className="db-stat-icon rider-stat-icon">⭐</div>
            <div className="db-stat-info">
              <div className="db-stat-val">{rating != null ? (rating as number).toFixed(1) : '—'}</div>
              <div className="db-stat-lbl">My Rating</div>
            </div>
          </div>
          <div className="db-stat">
            <div className="db-stat-icon rider-stat-icon">🏍️</div>
            <div className="db-stat-info">
              <div className="db-stat-val">{trips ?? 0}</div>
              <div className="db-stat-lbl">Total Trips</div>
            </div>
          </div>
          {isDriver ? (
            <>
              <div className="db-stat">
                <div className="db-stat-icon rider-stat-icon">🔖</div>
                <div className="db-stat-info">
                  <div className="db-stat-val">{driverP?.plate_number ?? '—'}</div>
                  <div className="db-stat-lbl">Plate Number</div>
                </div>
              </div>
              <div className="db-stat">
                <div className="db-stat-icon rider-stat-icon">🛵</div>
                <div className="db-stat-info">
                  <div className="db-stat-val ellipsis">{driverP?.vehicle_model ?? '—'}</div>
                  <div className="db-stat-lbl">Motorcycle</div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="db-stat">
                <div className="db-stat-icon rider-stat-icon">📱</div>
                <div className="db-stat-info">
                  <div className="db-stat-val ellipsis">{user.phone ?? '—'}</div>
                  <div className="db-stat-lbl">Phone</div>
                </div>
              </div>
              <div className="db-stat">
                <div className="db-stat-icon rider-stat-icon">✉️</div>
                <div className="db-stat-info">
                  <div className="db-stat-val ellipsis">{user.email ?? '—'}</div>
                  <div className="db-stat-lbl">Email</div>
                </div>
              </div>
            </>
          )}
        </div>

        {isDriver && driverP && (
          <div className="info-card">
            <div className="info-card-head">
              <span className="info-card-title">Driver Profile</span>
              <span className="info-card-accent driver-accent">🏍️ Driver</span>
            </div>
            <div className="info-body">
              <div className="info-row"><span className="info-label">License Number</span><span className="info-value">{driverP.license_number}</span></div>
              <div className="info-row"><span className="info-label">Motorcycle</span><span className="info-value">{driverP.vehicle_model}</span></div>
              <div className="info-row"><span className="info-label">Plate Number</span><span className="info-value">{driverP.plate_number}</span></div>
              <div className="info-row"><span className="info-label">Verification</span><span className="info-value"><VerificationBadge status={driverP.verification_status} /></span></div>
              <div className="info-row"><span className="info-label">Rating</span><span className="info-value">{driverP.rating != null ? `${driverP.rating.toFixed(1)} ★` : '—'}</span></div>
              <div className="info-row"><span className="info-label">Total Trips</span><span className="info-value">{driverP.total_trips}</span></div>
            </div>
            <div className="info-card-foot">
              <button className="btn-driver-sm" onClick={() => setActiveTab('edit-profile')}>Edit Driver Profile</button>
            </div>
          </div>
        )}

        {!isDriver && riderP && (
          <div className="info-card">
            <div className="info-card-head">
              <span className="info-card-title">Rider Profile</span>
              <span className="info-card-accent rider-accent">🧑‍💼 Active</span>
            </div>
            <div className="info-body">
              <div className="info-row"><span className="info-label">Rating</span><span className="info-value">{riderP.rating != null ? `${riderP.rating.toFixed(1)} ★` : '—'}</span></div>
              <div className="info-row"><span className="info-label">Total Trips</span><span className="info-value">{riderP.total_trips}</span></div>
            </div>
          </div>
        )}

        <div className="db-section-heading">Quick Actions</div>
        <div className="action-grid">
          {actions.map((a) => (
            <div
              key={a.title}
              className={`action-card ${isDriver ? 'driver-action-card' : 'rider-action-card'}${a.tab ? ' action-card-link' : ''}`}
              onClick={() => a.tab && setActiveTab(a.tab)}
            >
              <div className={`action-card-icon ${isDriver ? 'driver-action-icon' : 'rider-action-icon'}`}>{a.icon}</div>
              <div className="action-card-head">
                <span className="action-card-title">{a.title}</span>
                <span className={`action-badge${a.tab ? ' action-badge-live' : ''}`}>{a.tab ? 'Open →' : 'Coming soon'}</span>
              </div>
              <p className="action-card-desc">{a.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────

function ProfileTab({ user, setActiveTab }: { user: User; setActiveTab: (t: Tab) => void }) {
  const isDriver = user.role === 'DRIVER';

  return (
    <div className="page-wrap">
      <div className={`profile-banner ${isDriver ? 'driver-profile-banner' : 'rider-profile-banner'}`}>
        <div>
          {user.profile_image_url
            ? <img src={user.profile_image_url} alt="Profile" className="profile-avatar-img" />
            : <div className="profile-avatar-initial">{user.full_name.charAt(0).toUpperCase()}</div>}
        </div>
        <div className="profile-banner-info">
          <h1 className="profile-name">{user.full_name}</h1>
          <div className="profile-pills">
            <span className="role-pill">{isDriver ? '🏍️ DRIVER' : '🧑‍💼 RIDER'}</span>
            {isDriver && user.driver_profile && <VerificationBadge status={user.driver_profile.verification_status} />}
          </div>
        </div>
        <div className="profile-banner-actions">
          <button className="btn-outline-sm" onClick={() => setActiveTab('edit-account')}>✏️ Edit Account</button>
          <button className="btn-outline-sm" onClick={() => setActiveTab('edit-profile')}>🔧 Edit Profile</button>
        </div>
      </div>

      <div className="profile-cards">
        <div className="info-card">
          <div className="info-card-head">
            <span className="info-card-title">Account Information</span>
            <button onClick={() => setActiveTab('edit-account')} style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Edit →</button>
          </div>
          <div className="info-body">
            <div className="info-row"><span className="info-label">Full Name</span><span className="info-value">{user.full_name}</span></div>
            <div className="info-row"><span className="info-label">Email Address</span><span className="info-value">{user.email}</span></div>
            <div className="info-row"><span className="info-label">Phone Number</span><span className="info-value">{user.phone}</span></div>
            <div className="info-row"><span className="info-label">User ID</span><span className="info-value mono">{user.id}</span></div>
            <div className="info-row"><span className="info-label">Role</span><span className="info-value">{isDriver ? '🏍️ Driver' : '🧑‍💼 Rider'}</span></div>
          </div>
        </div>

        {isDriver && user.driver_profile && (
          <div className="info-card">
            <div className="info-card-head">
              <span className="info-card-title">Driver Profile</span>
              <span className="info-card-accent driver-accent">🏍️ Driver</span>
            </div>
            <div className="info-body">
              <div className="info-row"><span className="info-label">Profile ID</span><span className="info-value mono">{user.driver_profile.id}</span></div>
              <div className="info-row"><span className="info-label">License Number</span><span className="info-value">{user.driver_profile.license_number}</span></div>
              <div className="info-row"><span className="info-label">Motorcycle Model</span><span className="info-value">{user.driver_profile.vehicle_model}</span></div>
              <div className="info-row"><span className="info-label">Plate Number</span><span className="info-value">{user.driver_profile.plate_number}</span></div>
              <div className="info-row"><span className="info-label">Verification</span><span className="info-value"><VerificationBadge status={user.driver_profile.verification_status} /></span></div>
              <div className="info-row"><span className="info-label">Rating</span><span className="info-value">{user.driver_profile.rating != null ? `${user.driver_profile.rating.toFixed(1)} ★` : 'No ratings yet'}</span></div>
              <div className="info-row"><span className="info-label">Total Trips</span><span className="info-value">{user.driver_profile.total_trips}</span></div>
            </div>
            <div className="info-card-foot">
              <button className="btn-driver-sm" onClick={() => setActiveTab('edit-profile')}>Edit Driver Profile</button>
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
              <div className="info-row"><span className="info-label">Profile ID</span><span className="info-value mono">{user.rider_profile.id}</span></div>
              <div className="info-row"><span className="info-label">Rating</span><span className="info-value">{user.rider_profile.rating != null ? `${user.rider_profile.rating.toFixed(1)} ★` : 'No ratings yet'}</span></div>
              <div className="info-row"><span className="info-label">Total Trips</span><span className="info-value">{user.rider_profile.total_trips}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Edit Account Tab ──────────────────────────────────────────────────

function EditAccountTab({ user, updateUser, setActiveTab }: { user: User; updateUser: (u: User) => void; setActiveTab: (t: Tab) => void }) {
  const [form, setForm] = useState({
    full_name:         user.full_name         ?? '',
    phone:             user.phone             ?? '',
    email:             user.email             ?? '',
    profile_image_url: user.profile_image_url ?? '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [success,  setSuccess]  = useState('');
  const [error,    setError]    = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess(''); setIsSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (form.full_name)         payload.full_name         = form.full_name;
      if (form.phone)             payload.phone             = form.phone;
      if (form.email)             payload.email             = form.email;
      if (form.profile_image_url) payload.profile_image_url = form.profile_image_url;
      const { data } = await api.put<User>('/auth/me', payload);
      updateUser(data);
      setSuccess('Account updated successfully!');
    } catch (err) { setError(extractApiError(err)); }
    setIsSaving(false);
  };

  return (
    <div className="edit-page-wrap">
      <div className="edit-card">
        <div className="edit-card-head">
          <button className="edit-back" onClick={() => setActiveTab('profile')}>← Back to Profile</button>
          <h1 className="edit-title">Edit Account</h1>
          <p className="edit-sub">Update your name, phone, email, or profile picture.</p>
        </div>
        <div className="edit-card-body">
          {success && <Alert type="success" message={success} />}
          {error   && <Alert type="error"   message={error}   />}
          <form onSubmit={handleSubmit} className="edit-form">
            <div className="form-group">
              <label htmlFor="ea-full_name">Full Name</label>
              <input id="ea-full_name" name="full_name" type="text" value={form.full_name} onChange={handleChange} placeholder="Your full name" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="ea-phone">Phone Number</label>
                <input id="ea-phone" name="phone" type="tel" value={form.phone} onChange={handleChange} placeholder="+254700000000" />
              </div>
              <div className="form-group">
                <label htmlFor="ea-email">Email Address</label>
                <input id="ea-email" name="email" type="email" value={form.email} onChange={handleChange} placeholder="you@example.com" />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="ea-profile_image_url">Profile Image URL</label>
              <input id="ea-profile_image_url" name="profile_image_url" type="url" value={form.profile_image_url} onChange={handleChange} placeholder="https://example.com/photo.jpg" />
            </div>
            <div className="edit-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setActiveTab('profile')}>Cancel</button>
              <button type="submit" disabled={isSaving} className="btn btn-primary">
                {isSaving ? <><span className="btn-spinner" /> Saving…</> : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Edit Profile Tab ──────────────────────────────────────────────────

function EditProfileTab({ user, updateUser, setActiveTab }: { user: User; updateUser: (u: User) => void; setActiveTab: (t: Tab) => void }) {
  const isDriver = user.role === 'DRIVER';
  const [form, setForm] = useState({
    license_number: user.driver_profile?.license_number ?? '',
    vehicle_model:  user.driver_profile?.vehicle_model  ?? '',
    plate_number:   user.driver_profile?.plate_number   ?? '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [success,  setSuccess]  = useState('');
  const [error,    setError]    = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess(''); setIsSaving(true);
    try {
      const { data } = await api.put<User>('/auth/me/profile', form);
      updateUser(data);
      setSuccess('Driver profile updated successfully!');
    } catch (err) { setError(extractApiError(err)); }
    setIsSaving(false);
  };

  return (
    <div className="edit-page-wrap">
      <div className="edit-card">
        <div className="edit-card-head">
          <button className="edit-back" onClick={() => setActiveTab('profile')}>← Back to Profile</button>
          <h1 className="edit-title">{isDriver ? 'Edit Driver Profile' : 'Rider Profile'}</h1>
          <p className="edit-sub">{isDriver ? 'Update your vehicle and license information.' : 'Your rider profile stats are managed automatically.'}</p>
        </div>
        <div className="edit-card-body">
          {success && <Alert type="success" message={success} />}
          {error   && <Alert type="error"   message={error}   />}
          {!isDriver ? (
            <div className="readonly-profile-card">
              <div className="readonly-title">Rider Profile (Read-only)</div>
              {user.rider_profile ? (
                <>
                  <div className="info-row"><span className="info-label">Profile ID</span><span className="info-value mono">{user.rider_profile.id}</span></div>
                  <div className="info-row"><span className="info-label">Rating</span><span className="info-value">{user.rider_profile.rating != null ? `${user.rider_profile.rating.toFixed(1)} ★` : 'No ratings yet'}</span></div>
                  <div className="info-row"><span className="info-label">Total Trips</span><span className="info-value">{user.rider_profile.total_trips}</span></div>
                </>
              ) : (
                <p className="info-empty">No rider profile found.</p>
              )}
              <div className="readonly-note">ℹ️ Rider stats (rating, trips) are updated automatically based on your rides.</div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="edit-form">
              <div className="form-section-divider">
                <span className="form-section-label driver-label">🏍️ Vehicle Details</span>
              </div>
              <div className="form-group">
                <label htmlFor="ep-license_number">Driving License Number</label>
                <input id="ep-license_number" name="license_number" type="text" value={form.license_number} onChange={handleChange} placeholder="DL-12345678" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="ep-vehicle_model">Motorcycle Model</label>
                  <input id="ep-vehicle_model" name="vehicle_model" type="text" value={form.vehicle_model} onChange={handleChange} placeholder="Bajaj Boxer 150" />
                </div>
                <div className="form-group">
                  <label htmlFor="ep-plate_number">Plate Number</label>
                  <input id="ep-plate_number" name="plate_number" type="text" value={form.plate_number} onChange={handleChange} placeholder="KCA 123A" />
                </div>
              </div>
              <div className="edit-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setActiveTab('profile')}>Cancel</button>
                <button type="submit" disabled={isSaving} className="btn btn-navy">
                  {isSaving ? <><span className="btn-spinner" /> Saving…</> : 'Save Driver Profile'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Trip Status View (Rider active trip) ──────────────────────────────

function TripStatusView({ trip: initialTrip, onNewTrip, onViewTrips }: {
  trip: Trip;
  onNewTrip: () => void;
  onViewTrips: () => void;
}) {
  const [trip, setTrip] = useState(initialTrip);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!ACTIVE_TRIP_STATUSES.includes(trip.status)) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get<Trip>(`/trips/${trip.id}`);
        setTrip(data);
        if (!ACTIVE_TRIP_STATUSES.includes(data.status)) clearInterval(interval);
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [trip.id, trip.status]);

  const cancel = async () => {
    setCancelling(true);
    try {
      const { data } = await api.post<Trip>(`/trips/${trip.id}/cancel`);
      setTrip(data);
    } catch {}
    setCancelling(false);
  };

  const canCancel   = ['SEARCHING_DRIVER', 'NO_DRIVER_AVAILABLE'].includes(trip.status);
  const isSearching = trip.status === 'SEARCHING_DRIVER';
  const isArrived   = trip.status === 'DRIVER_ARRIVED';

  const statusMessages: Record<string, string> = {
    SEARCHING_DRIVER:    'Looking for a driver near you… This may take a moment.',
    DRIVER_ASSIGNED:     'Your driver is on the way! They will arrive at your pickup point shortly.',
    DRIVER_ARRIVED:      'Your driver has arrived at the pickup point. Please head over now!',
    IN_PROGRESS:         'Your trip is in progress. Enjoy the ride! 🏍️',
    COMPLETED:           'Your trip is complete. Thanks for riding with BodaBoda!',
    CANCELLED:           'This trip was cancelled.',
    NO_DRIVER_AVAILABLE: 'No driver was available at this time. Please try again.',
  };

  return (
    <div className="edit-page-wrap">
      <div className="edit-card">
        <div className="edit-card-head">
          <h1 className="edit-title">Ride Status</h1>
          <p className="edit-sub">Trip #{trip.id}</p>
        </div>
        <div className="edit-card-body">
          <div className="trip-status-view">
            <div className={`tsv-status-row${isSearching ? ' tsv-searching' : ''}`}>
              {isSearching && <div className="tsv-pulse" />}
              <TripStatusBadge status={trip.status} />
            </div>

            <p className="tsv-message">{statusMessages[trip.status] ?? trip.message}</p>

            {isArrived && (
              <div className="tsv-arrived-alert">
                <span className="tsv-arrived-icon">📍</span>
                <p>Your driver is at the pickup point. Head over now to start your ride!</p>
              </div>
            )}

            {trip.assigned_driver && (
              <div className="tsv-driver-card">
                <div className="tsv-driver-avatar">{trip.assigned_driver.full_name.charAt(0)}</div>
                <div>
                  <div className="tsv-driver-name">{trip.assigned_driver.full_name}</div>
                  <div className="tsv-driver-sub">{trip.assigned_driver.vehicle_model} · {trip.assigned_driver.plate_number}</div>
                  <div className="tsv-driver-rating">⭐ {trip.assigned_driver.rating.toFixed(1)}</div>
                </div>
              </div>
            )}

            <div className="info-card" style={{ marginTop: '1.25rem', marginBottom: 0 }}>
              <div className="info-body">
                <div className="info-row"><span className="info-label">Pickup</span><span className="info-value">{trip.pickup_address}</span></div>
                <div className="info-row"><span className="info-label">Destination</span><span className="info-value">{trip.destination_address}</span></div>
                <div className="info-row"><span className="info-label">Ride Type</span><span className="info-value">🏍️ {trip.ride_type}</span></div>
                <div className="info-row"><span className="info-label">Payment</span><span className="info-value">💵 {trip.payment_method}</span></div>
              </div>
            </div>

            <div className="tsv-actions">
              {['NO_DRIVER_AVAILABLE', 'CANCELLED'].includes(trip.status) && (
                <button className="btn btn-primary" onClick={onNewTrip}>Try Again</button>
              )}
              {trip.status === 'COMPLETED' && (
                <button className="btn btn-primary" onClick={onNewTrip}>Book Another Ride</button>
              )}
              {canCancel && (
                <button className="btn btn-ghost" onClick={cancel} disabled={cancelling}>
                  {cancelling ? 'Cancelling…' : 'Cancel Ride'}
                </button>
              )}
              <button className="btn btn-ghost" onClick={onViewTrips}>View All Trips →</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Request Ride Tab (RIDER only) ─────────────────────────────────────

function RequestRideTab({ setActiveTab }: { setActiveTab: (t: Tab) => void }) {
  const [form, setForm]       = useState({ pickup_address: '', destination_address: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError]     = useState('');
  const [trip, setTrip]       = useState<Trip | null>(null);

  // On mount, look for an existing active trip to resume
  useEffect(() => {
    api.get<Trip[]>('/trips/my')
      .then(({ data }) => {
        const active = data.find(t => ACTIVE_TRIP_STATUSES.includes(t.status));
        if (active) setTrip(active);
      })
      .catch(() => {})
      .finally(() => setIsChecking(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true); setError('');
    try {
      const { data } = await api.post<Trip>('/trips/request', { ...form, ride_type: 'BODA', payment_method: 'CASH' });
      setTrip(data);
    } catch (err) { setError(extractApiError(err)); }
    setIsLoading(false);
  };

  if (isChecking) return <TabLoader />;

  if (trip) {
    return <TripStatusView trip={trip} onNewTrip={() => setTrip(null)} onViewTrips={() => setActiveTab('my-trips')} />;
  }

  return (
    <div className="edit-page-wrap">
      <div className="edit-card">
        <div className="edit-card-head">
          <button className="edit-back" onClick={() => setActiveTab('home')}>← Back to Home</button>
          <h1 className="edit-title">Request a Ride</h1>
          <p className="edit-sub">Book a BodaBoda to your destination.</p>
        </div>
        <div className="edit-card-body">
          {error && <Alert type="error" message={error} />}
          <form onSubmit={handleSubmit} className="edit-form">
            <div className="form-group">
              <label htmlFor="rr-pickup">Pickup Location</label>
              <input id="rr-pickup" name="pickup_address" type="text" value={form.pickup_address} onChange={handleChange} placeholder="Enter pickup address or landmark" required />
            </div>
            <div className="form-group">
              <label htmlFor="rr-dest">Destination</label>
              <input id="rr-dest" name="destination_address" type="text" value={form.destination_address} onChange={handleChange} placeholder="Enter destination address or landmark" required />
            </div>
            <div className="ride-summary-box">
              <div className="ride-summary-row">
                <span className="ride-summary-label">Ride Type</span>
                <span className="ride-summary-value">🏍️ BodaBoda</span>
              </div>
              <div className="ride-summary-row">
                <span className="ride-summary-label">Payment</span>
                <span className="ride-summary-value">💵 Cash</span>
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={isLoading}>
              {isLoading ? <><span className="btn-spinner" /> Searching for a driver…</> : '🏍️  Request Ride'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── My Trips Tab (RIDER only) ─────────────────────────────────────────

function MyTripsTab({ setActiveTab }: { setActiveTab: (t: Tab) => void }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  useEffect(() => {
    api.get<Trip[]>('/trips/my')
      .then(({ data }) => setTrips(data))
      .catch(() => setError('Failed to load trips.'))
      .finally(() => setIsLoading(false));
  }, []);

  const cancel = async (id: number) => {
    setCancellingId(id);
    try {
      const { data } = await api.post<Trip>(`/trips/${id}/cancel`);
      setTrips(prev => prev.map(t => t.id === id ? data : t));
    } catch {}
    setCancellingId(null);
  };

  const canCancel = (status: string) =>
    ['SEARCHING_DRIVER', 'NO_DRIVER_AVAILABLE'].includes(status);

  const sorted = [...trips].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="tab-page">
      <div className="tab-page-head">
        <h1 className="tab-page-title">My Trips</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('request-ride')}>+ Request Ride</button>
      </div>

      {isLoading && <TabLoader />}
      {!isLoading && error && <Alert type="error" message={error} />}
      {!isLoading && !error && trips.length === 0 && (
        <EmptyState icon="🏍️" title="No trips yet" desc="Request your first BodaBoda ride to get started." />
      )}

      {!isLoading && sorted.length > 0 && (
        <div className="trip-list">
          {sorted.map(trip => (
            <div key={trip.id} className="trip-card">
              <div className="trip-card-head">
                <div className="trip-card-head-left">
                  <TripStatusBadge status={trip.status} />
                  <span className="trip-card-id">Trip #{trip.id}</span>
                </div>
                <span className="trip-card-date">{fmtDate(trip.created_at)} · {fmtTime(trip.created_at)}</span>
              </div>
              <div className="trip-route">
                <div className="trip-route-item">
                  <span className="trip-route-dot dot-pickup" />
                  <span className="trip-route-text">{trip.pickup_address}</span>
                </div>
                <div className="trip-route-line" />
                <div className="trip-route-item">
                  <span className="trip-route-dot dot-dest" />
                  <span className="trip-route-text">{trip.destination_address}</span>
                </div>
              </div>
              {trip.assigned_driver && (
                <div className="trip-driver-row">
                  <span>🏍️ {trip.assigned_driver.full_name}</span>
                  <span className="trip-driver-sep">·</span>
                  <span>{trip.assigned_driver.plate_number}</span>
                  <span className="trip-driver-sep">·</span>
                  <span>⭐ {trip.assigned_driver.rating.toFixed(1)}</span>
                </div>
              )}
              {canCancel(trip.status) && (
                <div className="trip-card-foot">
                  <button className="btn btn-ghost btn-sm" onClick={() => cancel(trip.id)} disabled={cancellingId === trip.id}>
                    {cancellingId === trip.id ? 'Cancelling…' : 'Cancel Ride'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Current Offer Tab (DRIVER only) ──────────────────────────────────

function CurrentOfferTab({ setActiveTab }: { setActiveTab: (t: Tab) => void }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<'accept' | 'decline' | null>(null);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Offer | null>('/drivers/offers/current');
      setOffer(data ?? null);
    } catch {}
    setIsLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [load]);

  const accept = async () => {
    if (!offer) return;
    setActionLoading('accept');
    try {
      const { data } = await api.post<AcceptOfferResponse>(`/drivers/offers/${offer.id}/accept`);
      setMsg(`${data.message} — ${data.next_action}`);
      setMsgType('success');
      setOffer(null);
    } catch (err) { setMsg(extractApiError(err)); setMsgType('error'); }
    setActionLoading(null);
  };

  const decline = async () => {
    if (!offer) return;
    setActionLoading('decline');
    try {
      const { data } = await api.post<DeclineOfferResponse>(`/drivers/offers/${offer.id}/decline`);
      setMsg(data.next_action || 'Offer declined.');
      setMsgType('success');
      setOffer(null);
    } catch {}
    setActionLoading(null);
  };

  const expiryText = (iso: string) => {
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const s = Math.floor(diff / 1000);
    return s < 60 ? `${s}s left` : `${Math.floor(s / 60)}m left`;
  };

  return (
    <div className="tab-page">
      <div className="tab-page-head">
        <h1 className="tab-page-title">Current Offer</h1>
        <button className="btn btn-ghost btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {msg && (
        <div style={{ marginBottom: '1rem' }}>
          <Alert type={msgType} message={msg} />
        </div>
      )}

      {isLoading && <TabLoader />}

      {!isLoading && !offer && !msg && (
        <EmptyState icon="📨" title="No pending offers" desc="Go online on the Home tab to start receiving ride requests from nearby riders." />
      )}

      {!isLoading && !offer && msg && (
        <div className="offer-done-prompt">
          <button className="btn btn-ghost btn-sm" onClick={() => { setMsg(''); load(); }}>Check for new offers</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setActiveTab('offer-history')}>View Offer History →</button>
        </div>
      )}

      {!isLoading && offer && (
        <div className="offer-card offer-card-featured">
          <div className="offer-card-head">
            <div className="offer-card-head-left">
              <OfferStatusBadge status={offer.status} />
              <span className="offer-expiry">{expiryText(offer.expires_at)}</span>
            </div>
            <span className="trip-card-id">Offer #{offer.id}</span>
          </div>

          {offer.trip && (
            <>
              <div className="trip-route offer-route">
                <div className="trip-route-item">
                  <span className="trip-route-dot dot-pickup" />
                  <div>
                    <span className="offer-route-label">Pickup</span>
                    <span className="trip-route-text">{offer.trip.pickup_address}</span>
                  </div>
                </div>
                <div className="trip-route-line" />
                <div className="trip-route-item">
                  <span className="trip-route-dot dot-dest" />
                  <div>
                    <span className="offer-route-label">Destination</span>
                    <span className="trip-route-text">{offer.trip.destination_address}</span>
                  </div>
                </div>
              </div>
              <div className="offer-meta-row">
                <span>🏍️ {offer.trip.ride_type}</span>
                <span>💵 {offer.trip.payment_method}</span>
              </div>
            </>
          )}

          {offer.status === 'OFFERED' && (
            <div className="offer-actions">
              <button className="btn btn-ghost" onClick={decline} disabled={!!actionLoading}>
                {actionLoading === 'decline' ? 'Declining…' : '✕ Decline'}
              </button>
              <button className="btn btn-primary" onClick={accept} disabled={!!actionLoading}>
                {actionLoading === 'accept' ? <><span className="btn-spinner" /> Accepting…</> : '✓ Accept Ride'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Offer History Tab (DRIVER only) ──────────────────────────────────

function OfferHistoryTab() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Offer[]>('/drivers/offers/history')
      .then(({ data }) => setOffers(data))
      .catch(() => setError('Failed to load offer history.'))
      .finally(() => setIsLoading(false));
  }, []);

  const sorted = [...offers].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="tab-page">
      <div className="tab-page-head">
        <h1 className="tab-page-title">Offer History</h1>
      </div>

      {isLoading && <TabLoader />}
      {!isLoading && error && <Alert type="error" message={error} />}
      {!isLoading && !error && offers.length === 0 && (
        <EmptyState icon="📋" title="No offer history" desc="Your accepted and declined ride offers will appear here." />
      )}

      {!isLoading && sorted.length > 0 && (
        <div className="trip-list">
          {sorted.map(offer => (
            <div key={offer.id} className="offer-card">
              <div className="offer-card-head">
                <div className="offer-card-head-left">
                  <OfferStatusBadge status={offer.status} />
                  <span className="trip-card-id">Offer #{offer.id}</span>
                </div>
                <span className="trip-card-date">{fmtDate(offer.created_at)} · {fmtTime(offer.created_at)}</span>
              </div>
              {offer.trip && (
                <div className="trip-route">
                  <div className="trip-route-item">
                    <span className="trip-route-dot dot-pickup" />
                    <span className="trip-route-text">{offer.trip.pickup_address}</span>
                  </div>
                  <div className="trip-route-line" />
                  <div className="trip-route-item">
                    <span className="trip-route-dot dot-dest" />
                    <span className="trip-route-text">{offer.trip.destination_address}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Notifications Tab (BOTH) ──────────────────────────────────────────

function NotificationsTab({ onRead }: { onRead: () => void }) {
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<UserNotification[]>('/notifications/my')
      .then(({ data }) => setNotifications(data))
      .catch(() => setError('Failed to load notifications.'))
      .finally(() => setIsLoading(false));
  }, []);

  const markRead = async (id: number) => {
    try {
      const { data } = await api.post<UserNotification>(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? data : n));
      onRead();
    } catch {}
  };

  const unread = notifications.filter(n => !n.is_read).length;
  const sorted = [...notifications].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="tab-page">
      <div className="tab-page-head">
        <h1 className="tab-page-title">
          Notifications {unread > 0 && <span className="notif-title-badge">{unread}</span>}
        </h1>
      </div>

      {isLoading && <TabLoader />}
      {!isLoading && error && <Alert type="error" message={error} />}
      {!isLoading && !error && notifications.length === 0 && (
        <EmptyState icon="🔔" title="All caught up!" desc="You have no notifications right now. New alerts will appear here." />
      )}

      {!isLoading && sorted.length > 0 && (
        <div className="notif-list">
          {sorted.map(n => (
            <div key={n.id} className={`notif-item${n.is_read ? '' : ' notif-unread'}`}>
              <div className="notif-indicator">
                {!n.is_read && <span className="notif-dot" />}
              </div>
              <div className="notif-body">
                <div className="notif-header">
                  <span className="notif-title">{n.title}</span>
                  <span className="notif-time">{fmtDate(n.created_at)} · {fmtTime(n.created_at)}</span>
                </div>
                <p className="notif-message">{n.message}</p>
              </div>
              {!n.is_read && (
                <button className="notif-read-btn" onClick={() => markRead(n.id)}>Mark read</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SVG icons ─────────────────────────────────────────────────────────

const IconHome = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
  </svg>
);
const IconUser = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
  </svg>
);
const IconEdit = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
  </svg>
);
const IconSettings = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.02 7.02 0 0 0-1.62-.94l-.36-2.54A.484.484 0 0 0 14 2h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41H14c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.09-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
  </svg>
);
const IconLogout = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
  </svg>
);
const IconBell = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
  </svg>
);
const IconMoto = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 7c0-1.1-.9-2-2-2h-3l2 4h1.5c.8 0 1.5-.7 1.5-2zm-4.94 5H11L9.53 9H7.5C6.12 9 5 10.12 5 11.5c0 .56.19 1.08.5 1.5H4c-.55 0-1 .45-1 1s.45 1 1 1h.08C4.03 15.33 4 15.66 4 16c0 2.21 1.79 4 4 4s4-1.79 4-4h2.5c0 2.21 1.79 4 4 4s4-1.79 4-4c0-2.21-1.79-4-4-4-.27 0-.54.03-.79.08L14.06 12zM8 18c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm10 0c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
  </svg>
);
const IconList = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
  </svg>
);
const IconOffer = () => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
  </svg>
);

// ── Nav items (role-aware) ────────────────────────────────────────────

function getNavItems(role: string, unreadCount: number): NavItem[] {
  if (role === 'RIDER') {
    return [
      { tab: 'home',          label: 'Home',          icon: <IconHome /> },
      { tab: 'request-ride',  label: 'Request Ride',  icon: <IconMoto /> },
      { tab: 'my-trips',      label: 'My Trips',      icon: <IconList /> },
      { tab: 'notifications', label: 'Notifications', icon: <IconBell />, badge: unreadCount },
      { tab: 'profile',       label: 'Profile',       icon: <IconUser /> },
      { tab: 'edit-account',  label: 'Edit Account',  icon: <IconEdit /> },
      { tab: 'edit-profile',  label: 'Edit Profile',  icon: <IconSettings /> },
    ];
  }
  if (role === 'DRIVER') {
    return [
      { tab: 'home',          label: 'Home',          icon: <IconHome /> },
      { tab: 'current-offer', label: 'Current Offer', icon: <IconOffer /> },
      { tab: 'offer-history', label: 'Offer History', icon: <IconList /> },
      { tab: 'notifications', label: 'Notifications', icon: <IconBell />, badge: unreadCount },
      { tab: 'profile',       label: 'Profile',       icon: <IconUser /> },
      { tab: 'edit-account',  label: 'Edit Account',  icon: <IconEdit /> },
      { tab: 'edit-profile',  label: 'Edit Profile',  icon: <IconSettings /> },
    ];
  }
  return [
    { tab: 'home',          label: 'Home',          icon: <IconHome /> },
    { tab: 'notifications', label: 'Notifications', icon: <IconBell />, badge: unreadCount },
    { tab: 'profile',       label: 'Profile',       icon: <IconUser /> },
    { tab: 'edit-account',  label: 'Edit Account',  icon: <IconEdit /> },
    { tab: 'edit-profile',  label: 'Edit Profile',  icon: <IconSettings /> },
  ];
}

// ── Sidebar ───────────────────────────────────────────────────────────

function Sidebar({ user, activeTab, setActiveTab, onLogout, unreadCount }: {
  user: User;
  activeTab: Tab;
  setActiveTab: (t: Tab) => void;
  onLogout: () => void;
  unreadCount: number;
}) {
  const navItems = getNavItems(user.role, unreadCount);
  return (
    <aside className="spa-sidebar">
      <div className="spa-sidebar-user">
        <div className="spa-sidebar-avatar">
          {user.profile_image_url
            ? <img src={user.profile_image_url} alt={user.full_name} />
            : user.full_name.charAt(0).toUpperCase()}
        </div>
        <div className="spa-sidebar-name">{user.full_name}</div>
        <div className="spa-sidebar-role">{user.role === 'DRIVER' ? 'Driver' : 'Rider'}</div>
      </div>

      <nav className="spa-nav">
        {navItems.map(({ tab, label, icon, badge }) => (
          <button
            key={tab}
            className={`spa-nav-item${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            <span className="spa-nav-icon">{icon}</span>
            {label}
            {badge != null && badge > 0 && (
              <span className="spa-nav-badge">{badge > 99 ? '99+' : badge}</span>
            )}
          </button>
        ))}
        <div className="spa-nav-divider" />
        <button className="spa-nav-item spa-logout" onClick={onLogout}>
          <span className="spa-nav-icon"><IconLogout /></span>
          Logout
        </button>
      </nav>
    </aside>
  );
}

// ── Bottom nav (mobile) ───────────────────────────────────────────────

function BottomNav({ user, activeTab, setActiveTab, onLogout, unreadCount }: {
  user: User;
  activeTab: Tab;
  setActiveTab: (t: Tab) => void;
  onLogout: () => void;
  unreadCount: number;
}) {
  const navItems = getNavItems(user.role, unreadCount).slice(0, 4);
  return (
    <nav className="spa-bottom-nav">
      <div className="spa-bottom-nav-inner">
        {navItems.map(({ tab, label, icon, badge }) => (
          <button
            key={tab}
            className={`spa-bottom-item${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            <span className="spa-bottom-item-icon">
              {icon}
              {badge != null && badge > 0 && <span className="spa-bottom-badge">{badge > 9 ? '9+' : badge}</span>}
            </span>
            <span>{label}</span>
          </button>
        ))}
        <button className="spa-bottom-item spa-logout" onClick={onLogout}>
          <span className="spa-bottom-item-icon"><IconLogout /></span>
          <span>Logout</span>
        </button>
      </div>
    </nav>
  );
}

// ── Dashboard (root) ──────────────────────────────────────────────────

export default function Dashboard() {
  const { user: ctxUser, setUser, logout } = useAuth();
  const [user,        setLocalUser]   = useState<User | null>(ctxUser);
  const [activeTab,   setActiveTab]   = useState<Tab>('home');
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api.get<User>('/auth/me')
      .then(({ data }) => { if (!cancelled) { setLocalUser(data); setUser(data); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [setUser]);

  useEffect(() => { if (ctxUser) setLocalUser(ctxUser); }, [ctxUser]);

  useEffect(() => {
    api.get<UserNotification[]>('/notifications/my')
      .then(({ data }) => setUnreadCount(data.filter(n => !n.is_read).length))
      .catch(() => {});
  }, []);

  const updateUser = (u: User) => { setLocalUser(u); setUser(u); };
  const handleLogout = () => { flushSync(() => logout()); navigate('/', { replace: true }); };

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    if (tab === 'notifications') setUnreadCount(0);
  };

  if (!user) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading dashboard…</p>
      </div>
    );
  }

  const isRider  = user.role === 'RIDER';
  const isDriver = user.role === 'DRIVER';

  return (
    <div className="spa-layout">
      <Sidebar user={user} activeTab={activeTab} setActiveTab={handleTabChange} onLogout={handleLogout} unreadCount={unreadCount} />

      <div className="spa-content">
        <div key={activeTab} className="spa-content-inner">
          {activeTab === 'home'          && <HomeTab        user={user} setActiveTab={handleTabChange} />}
          {activeTab === 'profile'       && <ProfileTab     user={user} setActiveTab={handleTabChange} />}
          {activeTab === 'edit-account'  && <EditAccountTab user={user} updateUser={updateUser} setActiveTab={handleTabChange} />}
          {activeTab === 'edit-profile'  && <EditProfileTab user={user} updateUser={updateUser} setActiveTab={handleTabChange} />}
          {activeTab === 'request-ride'  && isRider  && <RequestRideTab  setActiveTab={handleTabChange} />}
          {activeTab === 'my-trips'      && isRider  && <MyTripsTab      setActiveTab={handleTabChange} />}
          {activeTab === 'current-offer' && isDriver && <CurrentOfferTab setActiveTab={handleTabChange} />}
          {activeTab === 'offer-history' && isDriver && <OfferHistoryTab />}
          {activeTab === 'notifications' && <NotificationsTab onRead={() => setUnreadCount(0)} />}
        </div>
      </div>

      <BottomNav user={user} activeTab={activeTab} setActiveTab={handleTabChange} onLogout={handleLogout} unreadCount={unreadCount} />
    </div>
  );
}
