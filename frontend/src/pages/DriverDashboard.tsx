import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import Alert from '../components/Alert';
import { useMqtt } from '../hooks/useMqtt';
import { DriverTripMapSafe } from '../components/DriverTripMap';

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
  pickup_lat?: number;
  pickup_lng?: number;
  destination_address: string;
  destination_lat?: number;
  destination_lng?: number;
  ride_type: string;
  payment_method: string;
  status: string;
}

interface Offer {
  id: number;
  trip_id: number;
  status: string;
  expires_at: string;
  rider_name?: string;
  rider_phone?: string;
  trip: TripSummary | null;
}

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  time: string;
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

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  // ── auto-scroll chat ────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── MQTT: listen for new ride requests and chat messages ─────────────────
  const mqttTopics = ['rides/new', offer ? `rides/${offer.trip_id}/chat` : 'rides/__none__'];
  const { publish } = useMqtt(mqttTopics, useCallback((event) => {
    if (event.event_type === 'CHAT_MESSAGE') {
      const p = event.payload as { sender?: string; text?: string };
      if (p.sender !== 'Driver') {
        const newMsg: ChatMessage = {
          id: Date.now().toString() + Math.random(),
          sender: p.sender ?? 'Rider',
          text: String(p.text ?? ''),
          time: new Date().toLocaleTimeString(),
        };
        setMessages(prev => [...prev, newMsg]);
      }
      return;
    }
    // New ride alert
    setNewRideAlert(true);
    setTimeout(() => setNewRideAlert(false), 5000);
    if (driver?.status === 'AVAILABLE') fetchOffer();
  }, [driver?.status, fetchOffer, offer]));

  // ── send chat message ───────────────────────────────────────────────────
  const sendChat = () => {
    if (!chatInput.trim() || !offer) return;
    const msg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'Driver',
      text: chatInput.trim(),
      time: new Date().toLocaleTimeString(),
    };
    setMessages(prev => [...prev, msg]);
    publish(`rides/${offer.trip_id}/chat`, {
      event_type: 'CHAT_MESSAGE',
      payload: { sender: 'Driver', text: chatInput.trim(), trip_id: offer.trip_id },
    });
    setChatInput('');
  };

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

            {/* Rider contact row */}
            {(offer.rider_name || offer.rider_phone) && (
              <div className="info-row" style={{ marginTop: '0.5rem' }}>
                <span className="info-label">Rider</span>
                <span className="info-value" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {offer.rider_name && <strong>{offer.rider_name}</strong>}
                  {offer.rider_phone && (
                    <a href={`tel:${offer.rider_phone}`} style={{ color: '#e85d04', fontWeight: 700, textDecoration: 'none' }}>
                      📞 {offer.rider_phone}
                    </a>
                  )}
                </span>
              </div>
            )}

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

            {/* Map */}
            <DriverTripMapSafe
              pickupLat={offer.trip.pickup_lat}
              pickupLng={offer.trip.pickup_lng}
              pickupAddress={offer.trip.pickup_address}
              destinationLat={offer.trip.destination_lat}
              destinationLng={offer.trip.destination_lng}
              destinationAddress={offer.trip.destination_address}
            />

            {/* Action buttons */}
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
              <button
                className="btn btn-navy"
                style={{ minWidth: 60 }}
                onClick={() => setChatOpen(true)}
              >
                💬 Chat
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

      {/* ── Chat backdrop ── */}
      {chatOpen && (
        <div
          onClick={() => setChatOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999 }}
        />
      )}

      {/* ── Chat panel (right-side slide) ── */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: chatOpen ? 0 : '-100%',
        width: 'min(340px, 100vw)',
        height: '100vh',
        background: '#fff',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
        transition: 'right 0.3s ease',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '1rem', background: '#1e3a5f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>💬 Chat with {offer?.rider_name ?? 'Rider'}</span>
          <button
            onClick={() => setChatOpen(false)}
            style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.3rem', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {messages.length === 0 && (
            <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: '2rem' }}>No messages yet</p>
          )}
          {messages.map(m => (
            <div
              key={m.id}
              style={{
                alignSelf: m.sender === 'Driver' ? 'flex-end' : 'flex-start',
                background: m.sender === 'Driver' ? '#e85d04' : '#f1f5f9',
                color: m.sender === 'Driver' ? '#fff' : '#1e293b',
                padding: '0.5rem 0.75rem',
                borderRadius: m.sender === 'Driver' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                maxWidth: '80%',
                fontSize: '0.9rem',
              }}
            >
              <div>{m.text}</div>
              <div style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: '0.2rem' }}>{m.time}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '0.75rem', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()}
            placeholder="Type a message…"
            style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid #cbd5e1', outline: 'none', fontSize: '0.9rem' }}
          />
          <button onClick={sendChat} className="btn btn-primary btn-sm">Send</button>
        </div>
      </div>
    </div>
  );
}
