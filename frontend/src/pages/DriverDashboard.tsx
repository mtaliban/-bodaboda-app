import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import Alert from '../components/Alert';
import { useMqtt } from '../hooks/useMqtt';

interface DriverState {
  id: number;
  status: 'OFFLINE' | 'AVAILABLE' | 'BUSY';
  full_name: string;
  vehicle_model: string;
  plate_number: string;
  rating: number;
  total_trips: number;
  current_trip_id: number | null;
}

interface TripSummary {
  id: number;
  pickup_address: string;
  destination_address: string;
  ride_type: string;
  payment_method: string;
  status: string;
}

interface Offer {
  id: number;
  trip_id: number;
  status: string;
  expires_at: string;
  trip: TripSummary | null;
}

function StatusDot({ status }: { status: string }) {
  const cfg: Record<string, { color: string; label: string }> = {
    AVAILABLE: { color: '#22c55e', label: 'Online' },
    OFFLINE:   { color: '#94a3b8', label: 'Offline' },
    BUSY:      { color: '#f59e0b', label: 'On a Trip' },
  };
  const s = cfg[status] ?? cfg.OFFLINE;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <span style={{
        width: 10, height: 10, borderRadius: '50%',
        background: s.color, display: 'inline-block',
        boxShadow: status === 'AVAILABLE' ? `0 0 0 3px ${s.color}33` : undefined,
      }} />
      {s.label}
    </span>
  );
}

function countdown(expiresAt: string): string {
  const secs = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

export default function DriverDashboard() {
  const { user } = useAuth();
  const [driver, setDriver] = useState<DriverState | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [timer, setTimer] = useState('');
  const [toggling, setToggling] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const [newRideAlert, setNewRideAlert] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── load driver on mount ────────────────────────────────────────────────
  useEffect(() => {
    api.post('/drivers/sync-me')
      .then(({ data }) => setDriver(data))
      .catch(() => api.get('/drivers/me').then(({ data }) => setDriver(data)))
      .catch(() => setError('Could not load driver profile.'));
  }, []);

  // ── fetch current offer ─────────────────────────────────────────────────
  const fetchOffer = useCallback(async () => {
    try {
      const { data } = await api.get<Offer | null>('/drivers/offers/current');
      setOffer(data ?? null);
    } catch {
      // no offer or not available
    }
  }, []);

  // ── poll every 8s when AVAILABLE ────────────────────────────────────────
  useEffect(() => {
    if (driver?.status === 'AVAILABLE') {
      fetchOffer();
      pollRef.current = setInterval(fetchOffer, 8000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (driver?.status !== 'AVAILABLE') setOffer(null);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [driver?.status, fetchOffer]);

  // ── offer countdown timer ───────────────────────────────────────────────
  useEffect(() => {
    if (offer) {
      setTimer(countdown(offer.expires_at));
      timerRef.current = setInterval(() => setTimer(countdown(offer.expires_at)), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setTimer('');
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [offer]);

  // ── MQTT: listen for new ride requests ──────────────────────────────────
  const mqttTopics = ['rides/new'];
  useMqtt(mqttTopics, useCallback(() => {
    setNewRideAlert(true);
    setTimeout(() => setNewRideAlert(false), 5000);
    // Immediately poll for an offer directed at this driver
    if (driver?.status === 'AVAILABLE') fetchOffer();
  }, [driver?.status, fetchOffer]));

  // ── go online / offline ─────────────────────────────────────────────────
  const toggleOnline = async () => {
    if (!driver || toggling) return;
    setToggling(true);
    setError('');
    try {
      const endpoint = driver.status === 'AVAILABLE' ? '/drivers/go-offline' : '/drivers/go-online';
      const { data } = await api.post<DriverState>(endpoint);
      setDriver(data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? 'Could not update status.');
    } finally {
      setToggling(false);
    }
  };

  // ── accept offer ────────────────────────────────────────────────────────
  const acceptOffer = async () => {
    if (!offer || acting) return;
    setActing(true);
    setError('');
    try {
      const { data } = await api.post(`/drivers/offers/${offer.id}/accept`);
      setDriver(data.driver);
      setOffer(null);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? 'Could not accept offer.');
      await fetchOffer();
    } finally {
      setActing(false);
    }
  };

  // ── decline offer ───────────────────────────────────────────────────────
  const declineOffer = async () => {
    if (!offer || acting) return;
    setActing(true);
    setError('');
    try {
      await api.post(`/drivers/offers/${offer.id}/decline`);
      setOffer(null);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? 'Could not decline offer.');
    } finally {
      setActing(false);
    }
  };

  if (!driver) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-navy" />
        <p>Loading driver dashboard…</p>
      </div>
    );
  }

  const isOnline = driver.status === 'AVAILABLE';
  const isBusy   = driver.status === 'BUSY';

  return (
    <div className="dashboard">
      {/* Banner */}
      <div className="db-banner driver-banner">
        <div className="db-banner-inner">
          <div className="db-welcome">
            <div className="db-avatar">{user?.full_name?.charAt(0).toUpperCase() ?? 'D'}</div>
            <div>
              <p className="db-greeting">Ready to earn today, Driver 🏍️</p>
              <h1 className="db-name">{driver.full_name}</h1>
              <div className="db-pills">
                <span className="db-role-pill">🏍️ DRIVER</span>
                <span className="db-role-pill" style={{ background: '#1e293b' }}>
                  <StatusDot status={driver.status} />
                </span>
              </div>
            </div>
          </div>

          {/* Go Online / Offline button */}
          <div className="db-banner-actions">
            <button
              className={`btn ${isOnline || isBusy ? 'btn-navy' : 'btn-primary'}`}
              style={{ minWidth: 140 }}
              onClick={toggleOnline}
              disabled={toggling || isBusy}
              title={isBusy ? 'Cannot go offline while on a trip' : undefined}
            >
              {toggling ? (
                <><span className="btn-spinner" /> Updating…</>
              ) : isOnline ? '🔴 Go Offline' : '🟢 Go Online'}
            </button>
          </div>
        </div>
      </div>

      <div className="db-body">
        {error && <Alert type="error" message={error} />}

        {/* New ride nearby toast */}
        {newRideAlert && !offer && (
          <div className="info-card" style={{ borderLeft: '4px solid #e85d04', background: '#fff7ed' }}>
            <strong>🏍️ New ride request nearby!</strong>
            <span style={{ marginLeft: '0.5rem', color: '#888', fontSize: '0.85rem' }}>Checking if assigned to you…</span>
          </div>
        )}

        {/* ── Incoming offer card ── */}
        {offer && offer.trip && (
          <div className="info-card" style={{ borderLeft: '4px solid #e85d04' }}>
            <div className="info-card-head">
              <span className="info-card-title">🚨 Incoming Ride Request</span>
              <span style={{
                fontWeight: 700, fontSize: '1.1rem',
                color: timer < '0:30' ? '#ef4444' : '#e85d04',
              }}>
                ⏱ {timer}
              </span>
            </div>
            <div className="info-body">
              <div className="info-row">
                <span className="info-label">Pickup</span>
                <span className="info-value">📍 {offer.trip.pickup_address}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Destination</span>
                <span className="info-value">🏁 {offer.trip.destination_address}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Ride Type</span>
                <span className="info-value">{offer.trip.ride_type}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Payment</span>
                <span className="info-value">{offer.trip.payment_method}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={acceptOffer}
                disabled={acting}
              >
                {acting ? <><span className="btn-spinner" /> Accepting…</> : '✅ Accept'}
              </button>
              <button
                className="btn btn-navy"
                style={{ flex: 1 }}
                onClick={declineOffer}
                disabled={acting}
              >
                {acting ? '…' : '✕ Decline'}
              </button>
            </div>
          </div>
        )}

        {/* ── Current trip info when BUSY ── */}
        {isBusy && !offer && (
          <div className="info-card" style={{ borderLeft: '4px solid #f59e0b' }}>
            <div className="info-card-head">
              <span className="info-card-title">🏍️ Active Trip</span>
              <span className="info-card-accent" style={{ color: '#f59e0b' }}>In Progress</span>
            </div>
            <p style={{ color: '#64748b', margin: '0.5rem 0 0' }}>
              Trip #{driver.current_trip_id} is active. Manage it via the driver app endpoints.
            </p>
          </div>
        )}

        {/* Stats */}
        <div className="db-stats">
          <div className="db-stat">
            <div className="db-stat-icon driver-stat-icon">⭐</div>
            <div className="db-stat-info">
              <div className="db-stat-val">{driver.rating.toFixed(1)}</div>
              <div className="db-stat-lbl">Rating</div>
            </div>
          </div>
          <div className="db-stat">
            <div className="db-stat-icon driver-stat-icon">🏍️</div>
            <div className="db-stat-info">
              <div className="db-stat-val">{driver.total_trips}</div>
              <div className="db-stat-lbl">Total Trips</div>
            </div>
          </div>
          <div className="db-stat">
            <div className="db-stat-icon driver-stat-icon">🔖</div>
            <div className="db-stat-info">
              <div className="db-stat-val">{driver.plate_number}</div>
              <div className="db-stat-lbl">Plate</div>
            </div>
          </div>
          <div className="db-stat">
            <div className="db-stat-icon driver-stat-icon">🛵</div>
            <div className="db-stat-info">
              <div className="db-stat-val ellipsis">{driver.vehicle_model}</div>
              <div className="db-stat-lbl">Motorcycle</div>
            </div>
          </div>
        </div>

        {/* Status guidance */}
        {!isOnline && !isBusy && (
          <div className="info-card" style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🔴</div>
            <h3 style={{ margin: '0 0 0.5rem' }}>You are Offline</h3>
            <p style={{ color: '#64748b', margin: '0 0 1rem' }}>
              Press <strong>Go Online</strong> to start receiving ride requests.
            </p>
            <button className="btn btn-primary" onClick={toggleOnline} disabled={toggling}>
              {toggling ? <><span className="btn-spinner" /> Connecting…</> : '🟢 Go Online Now'}
            </button>
          </div>
        )}

        {isOnline && !offer && (
          <div className="info-card" style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🟢</div>
            <h3 style={{ margin: '0 0 0.5rem' }}>You are Online</h3>
            <p style={{ color: '#64748b', margin: 0 }}>
              Waiting for ride requests… You will be notified instantly via MQTT.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
