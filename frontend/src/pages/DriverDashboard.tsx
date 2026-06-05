import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import Alert from '../components/Alert';
import { useMqtt } from '../hooks/useMqtt';
import { DriverTripMapSafe } from '../components/DriverTripMap';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  trip_name?: string;
  pickup_address: string;
  pickup_lat?: number;
  pickup_lng?: number;
  destination_address: string;
  destination_lat?: number;
  destination_lng?: number;
  ride_type: string;
  payment_method: string;
  status: string;
  fare_tzs?: number;
  created_at: string;
  updated_at: string;
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

interface WalletTxn {
  id: number;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  balance_after: number;
  trip_id: number | null;
  description: string;
  created_at: string;
}

interface WalletData {
  balance: number;
  transactions: WalletTxn[];
}

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  time: string;
}

type Tab = 'dashboard' | 'trips' | 'wallet';

// ── Standalone helpers (defined outside component — no re-creation issue) ──────

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
        width: 10, height: 10, borderRadius: '50%', background: s.color, display: 'inline-block',
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

function fmtMoney(v: number) { return `TSh ${v.toLocaleString('en-TZ')}`; }

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('sw-TZ', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(s: string) {
  const d = new Date(s);
  return `${d.toLocaleDateString('sw-TZ', { day: '2-digit', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function statusColor(s: string) {
  const m: Record<string, string> = {
    COMPLETED: '#16a34a', CANCELLED: '#dc2626', IN_PROGRESS: '#ea580c',
    SEARCHING_DRIVER: '#ca8a04', DRIVER_ASSIGNED: '#2563eb',
    DRIVER_ARRIVED: '#7c3aed', NO_DRIVER_AVAILABLE: '#dc2626',
  };
  return m[s] ?? '#64748b';
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'sw,en' } }
    );
    if (!res.ok) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const data = await res.json() as {
      display_name?: string;
      address?: { road?: string; suburb?: string; city?: string; town?: string; village?: string };
    };
    const a = data.address;
    if (a) {
      const parts = [a.road, a.suburb ?? a.village ?? a.town ?? a.city].filter(Boolean);
      if (parts.length) return parts.join(', ');
    }
    return data.display_name?.split(',').slice(0, 2).join(',').trim() ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

// ── Tab bar — defined outside so React never re-creates it ────────────────────

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: '🏠' },
    { key: 'trips',     label: 'Trips Zangu', icon: '🏍️' },
    { key: 'wallet',    label: 'Mkoba Wangu', icon: '💰' },
  ];
  return (
    <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', marginBottom: '1rem', overflowX: 'auto' }}>
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)} style={{
          padding: '0.65rem 1.2rem', border: 'none',
          borderBottom: active === t.key ? '3px solid #e85d04' : '3px solid transparent',
          background: 'none', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
          fontWeight: active === t.key ? 700 : 500,
          color: active === t.key ? '#e85d04' : '#64748b', fontSize: '0.9rem',
        }}>
          {t.icon} {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DriverDashboard() {
  const { user } = useAuth();

  const [driver, setDriver]             = useState<DriverState | null>(null);
  const [offer, setOffer]               = useState<Offer | null>(null);
  const [timer, setTimer]               = useState('');
  const [toggling, setToggling]         = useState(false);
  const [acting, setActing]             = useState(false);
  const [error, setError]               = useState('');
  const [newRideAlert, setNewRideAlert] = useState(false);
  const [activeTab, setActiveTab]       = useState<Tab>('dashboard');
  const [locationName, setLocationName] = useState('');
  const [currentTrip, setCurrentTrip]   = useState<TripSummary | null>(null);

  // Trips tab state
  const [driverTrips, setDriverTrips]   = useState<TripSummary[]>([]);
  const [tripsLoaded, setTripsLoaded]   = useState(false);
  const [tripsLoading, setTripsLoading] = useState(false);

  // Wallet tab state
  const [walletData, setWalletData]     = useState<WalletData | null>(null);
  const [walletLoaded, setWalletLoaded] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);

  // Chat state
  const [chatOpen, setChatOpen]         = useState(false);
  const [messages, setMessages]         = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]       = useState('');
  const messagesEndRef                  = useRef<HTMLDivElement>(null);

  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load driver ──────────────────────────────────────────────────────────────
  useEffect(() => {
    api.post('/drivers/sync-me')
      .then(({ data }) => setDriver(data))
      .catch(() => api.get('/drivers/me').then(({ data }) => setDriver(data)))
      .catch(() => setError('Imeshindwa kupakia wasifu wa dereva.'));
  }, []);

  // ── GPS location name ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const name = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      setLocationName(name);
    });
  }, []);

  // ── Current trip when BUSY ───────────────────────────────────────────────────
  useEffect(() => {
    if (driver?.status === 'BUSY') {
      api.get<TripSummary>('/drivers/current-trip')
        .then(({ data }) => setCurrentTrip(data))
        .catch(() => setCurrentTrip(null));
    } else {
      setCurrentTrip(null);
    }
  }, [driver?.status, driver?.current_trip_id]);

  // ── Fetch current offer ──────────────────────────────────────────────────────
  const fetchOffer = useCallback(async () => {
    try {
      const { data } = await api.get<Offer | null>('/drivers/offers/current');
      setOffer(data ?? null);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (driver?.status === 'AVAILABLE') {
      fetchOffer();
      pollRef.current = setInterval(fetchOffer, 8000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setOffer(null);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [driver?.status, fetchOffer]);

  // ── Countdown timer ──────────────────────────────────────────────────────────
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

  // ── Load trips (once per session when tab is first opened) ───────────────────
  useEffect(() => {
    if (activeTab !== 'trips' || tripsLoaded) return;
    setTripsLoading(true);
    api.get<TripSummary[]>('/drivers/trips')
      .then(({ data }) => { setDriverTrips(data); setTripsLoaded(true); })
      .catch(() => { setDriverTrips([]); setTripsLoaded(true); })
      .finally(() => setTripsLoading(false));
  }, [activeTab, tripsLoaded]);

  // ── Load wallet (once per session when tab is first opened) ──────────────────
  useEffect(() => {
    if (activeTab !== 'wallet' || walletLoaded) return;
    setWalletLoading(true);
    api.get<WalletData>('/wallet')
      .then(({ data }) => { setWalletData(data); setWalletLoaded(true); })
      .catch(() => { setWalletData(null); setWalletLoaded(true); })
      .finally(() => setWalletLoading(false));
  }, [activeTab, walletLoaded]);

  // ── Auto-scroll chat ─────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── MQTT ─────────────────────────────────────────────────────────────────────
  const mqttTopics = [
    'rides/new',
    driver?.id ? `driver/${driver.id}/offers` : 'rides/__none__',
    offer?.trip_id ? `rides/${offer.trip_id}/chat` : 'rides/__none__',
  ];
  const { publish } = useMqtt(mqttTopics, useCallback((event) => {
    if (event.event_type === 'CHAT_MESSAGE') {
      const p = event.payload as { sender?: string; text?: string };
      if (p.sender !== 'Driver') {
        setMessages(prev => [...prev, {
          id: Date.now().toString() + Math.random(),
          sender: p.sender ?? 'Rider', text: String(p.text ?? ''),
          time: new Date().toLocaleTimeString(),
        }]);
      }
      return;
    }
    if (driver?.status === 'AVAILABLE') {
      setNewRideAlert(true);
      setTimeout(() => setNewRideAlert(false), 5000);
      fetchOffer();
    }
  }, [driver?.status, fetchOffer]));

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const sendChat = () => {
    if (!chatInput.trim() || !offer) return;
    setMessages(prev => [...prev, {
      id: Date.now().toString(), sender: 'Driver',
      text: chatInput.trim(), time: new Date().toLocaleTimeString(),
    }]);
    publish(`rides/${offer.trip_id}/chat`, {
      event_type: 'CHAT_MESSAGE',
      payload: { sender: 'Driver', text: chatInput.trim(), trip_id: offer.trip_id },
    });
    setChatInput('');
  };

  const toggleOnline = async () => {
    if (!driver || toggling) return;
    setToggling(true); setError('');
    try {
      const ep = driver.status === 'AVAILABLE' ? '/drivers/go-offline' : '/drivers/go-online';
      const { data } = await api.post<DriverState>(ep);
      setDriver(data);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Imeshindwa kubadilisha hali.');
    } finally { setToggling(false); }
  };

  const acceptOffer = async () => {
    if (!offer || acting) return;
    setActing(true); setError('');
    try {
      const { data } = await api.post(`/drivers/offers/${offer.id}/accept`);
      if (data.trip) setCurrentTrip(data.trip as TripSummary);
      setDriver(data.driver);
      setOffer(null);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Imeshindwa kukubali.');
      await fetchOffer();
    } finally { setActing(false); }
  };

  const declineOffer = async () => {
    if (!offer || acting) return;
    setActing(true); setError('');
    try {
      await api.post(`/drivers/offers/${offer.id}/decline`);
      setOffer(null);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Imeshindwa kukataa.');
    } finally { setActing(false); }
  };

  const doTripAction = async (endpoint: string) => {
    if (!currentTrip || acting) return;
    setActing(true); setError('');
    try {
      const { data } = await api.post<TripSummary>(endpoint);
      setCurrentTrip(data);
      if (data.status === 'COMPLETED' || data.status === 'CANCELLED') {
        const { data: d } = await api.get<DriverState>('/drivers/me');
        setDriver(d);
        // Refresh wallet after trip completes
        setWalletLoaded(false);
      }
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Imeshindwa.');
    } finally { setActing(false); }
  };

  const refreshTrips = () => { setTripsLoaded(false); };
  const refreshWallet = () => { setWalletLoaded(false); };

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (!driver) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-navy" />
        <p>Inapakia dashibodi ya dereva…</p>
      </div>
    );
  }

  const isOnline = driver.status === 'AVAILABLE';
  const isBusy   = driver.status === 'BUSY';

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="dashboard">

      {/* ── Banner ── */}
      <div className="db-banner driver-banner">
        <div className="db-banner-inner">
          <div className="db-welcome">
            <div className="db-avatar">{user?.full_name?.charAt(0).toUpperCase() ?? 'D'}</div>
            <div>
              <p className="db-greeting">Karibu kufanya kazi leo 🏍️</p>
              <h1 className="db-name">{driver.full_name}</h1>
              <div className="db-pills">
                <span className="db-role-pill">🏍️ DEREVA</span>
                <span className="db-role-pill" style={{ background: '#1e293b' }}>
                  <StatusDot status={driver.status} />
                </span>
              </div>
            </div>
          </div>
          <div className="db-banner-actions">
            <button
              className={`btn ${isOnline || isBusy ? 'btn-navy' : 'btn-primary'}`}
              style={{ minWidth: 140 }} onClick={toggleOnline}
              disabled={toggling || isBusy}
              title={isBusy ? 'Huwezi kwenda offline ukiwa na safari' : undefined}
            >
              {toggling ? <><span className="btn-spinner" /> Inabadilika…</> : isOnline ? '🔴 Nenda Offline' : '🟢 Nenda Online'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="db-body">
        {error && <Alert type="error" message={error} />}

        {newRideAlert && !offer && (
          <div className="info-card" style={{ borderLeft: '4px solid #e85d04', background: '#fff7ed' }}>
            <strong>🏍️ Ombi jipya la safari karibu nawe!</strong>
          </div>
        )}

        <TabBar active={activeTab} onChange={setActiveTab} />

        {/* ══════════════════════════════════════════════════════════════════
            TAB: DASHBOARD
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'dashboard' && (
          <>
            {/* Incoming offer */}
            {offer && offer.trip && (
              <div className="info-card" style={{ borderLeft: '4px solid #e85d04' }}>
                <div className="info-card-head">
                  <span className="info-card-title">🚨 Ombi la Safari</span>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem', color: timer < '0:30' ? '#ef4444' : '#e85d04' }}>
                    ⏱ {timer}
                  </span>
                </div>

                {/* Fare preview */}
                {offer.trip.fare_tzs && (
                  <div style={{
                    background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
                    padding: '0.65rem 1rem', margin: '0.6rem 0',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span style={{ fontSize: '0.83rem', color: '#374151', fontWeight: 600 }}>💰 Bei ya Safari</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, color: '#16a34a', fontSize: '1.05rem' }}>
                        {fmtMoney(offer.trip.fare_tzs)}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        Mapato yako: <strong style={{ color: '#16a34a' }}>{fmtMoney(Math.round(offer.trip.fare_tzs * 0.9))}</strong> (90%)
                      </div>
                    </div>
                  </div>
                )}

                {(offer.rider_name || offer.rider_phone) && (
                  <div className="info-row" style={{ marginTop: '0.5rem' }}>
                    <span className="info-label">Abiria</span>
                    <span className="info-value" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
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
                  <div className="info-row"><span className="info-label">Pickup</span><span className="info-value">📍 {offer.trip.pickup_address}</span></div>
                  <div className="info-row"><span className="info-label">Dest</span><span className="info-value">🏁 {offer.trip.destination_address}</span></div>
                  <div className="info-row"><span className="info-label">Aina</span><span className="info-value">{offer.trip.ride_type}</span></div>
                  <div className="info-row"><span className="info-label">Malipo</span><span className="info-value">{offer.trip.payment_method}</span></div>
                </div>

                <DriverTripMapSafe
                  pickupLat={offer.trip.pickup_lat} pickupLng={offer.trip.pickup_lng}
                  pickupAddress={offer.trip.pickup_address}
                  destinationLat={offer.trip.destination_lat} destinationLng={offer.trip.destination_lng}
                  destinationAddress={offer.trip.destination_address}
                />

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={acceptOffer} disabled={acting}>
                    {acting ? <><span className="btn-spinner" /> …</> : '✅ Kubali'}
                  </button>
                  <button className="btn btn-navy" style={{ flex: 1 }} onClick={declineOffer} disabled={acting}>
                    {acting ? '…' : '✕ Kataa'}
                  </button>
                  <button className="btn btn-navy" style={{ minWidth: 60 }} onClick={() => setChatOpen(true)}>💬</button>
                </div>
              </div>
            )}

            {/* Active trip (BUSY) */}
            {isBusy && !offer && (
              <div className="info-card" style={{ borderLeft: '4px solid #f59e0b' }}>
                <div className="info-card-head">
                  <span className="info-card-title">🏍️ Safari Inayoendelea</span>
                  <span style={{ color: '#f59e0b', fontWeight: 700 }}>In Progress</span>
                </div>
                {currentTrip ? (
                  <>
                    {currentTrip.fare_tzs && (
                      <div style={{
                        background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
                        padding: '0.65rem 1rem', margin: '0.5rem 0',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}>
                        <span style={{ fontSize: '0.83rem', color: '#374151', fontWeight: 600 }}>💰 Mapato Yako</span>
                        <span style={{ fontWeight: 800, color: '#16a34a', fontSize: '1.05rem' }}>
                          {fmtMoney(Math.round(currentTrip.fare_tzs * 0.9))}
                        </span>
                      </div>
                    )}
                    <div className="info-body">
                      <div className="info-row"><span className="info-label">Pickup</span><span className="info-value">📍 {currentTrip.pickup_address}</span></div>
                      <div className="info-row"><span className="info-label">Dest</span><span className="info-value">🏁 {currentTrip.destination_address}</span></div>
                      <div className="info-row">
                        <span className="info-label">Hali</span>
                        <span className="info-value" style={{ color: statusColor(currentTrip.status), fontWeight: 700 }}>
                          {currentTrip.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                      {currentTrip.status === 'DRIVER_ASSIGNED' && (
                        <button className="btn btn-primary btn-sm" disabled={acting}
                          onClick={() => doTripAction(`/trips/${currentTrip.id}/driver-arrived`)}>
                          {acting ? '…' : '📍 Nimefika Pickup'}
                        </button>
                      )}
                      {(currentTrip.status === 'DRIVER_ARRIVED' || currentTrip.status === 'DRIVER_ASSIGNED') && (
                        <button className="btn btn-primary btn-sm" disabled={acting}
                          onClick={() => doTripAction(`/trips/${currentTrip.id}/start`)}>
                          {acting ? '…' : '▶️ Anza Safari'}
                        </button>
                      )}
                      {currentTrip.status === 'IN_PROGRESS' && (
                        <button className="btn btn-primary btn-sm"
                          style={{ background: '#16a34a', borderColor: '#16a34a' }} disabled={acting}
                          onClick={() => doTripAction(`/trips/${currentTrip.id}/complete`)}>
                          {acting ? '…' : '✅ Maliza Safari'}
                        </button>
                      )}
                      <button className="btn btn-navy btn-sm" onClick={() => setChatOpen(true)}>💬 Chat</button>
                    </div>
                    <DriverTripMapSafe
                      pickupLat={currentTrip.pickup_lat} pickupLng={currentTrip.pickup_lng}
                      pickupAddress={currentTrip.pickup_address}
                      destinationLat={currentTrip.destination_lat} destinationLng={currentTrip.destination_lng}
                      destinationAddress={currentTrip.destination_address}
                    />
                  </>
                ) : (
                  <p style={{ color: '#64748b', margin: '0.5rem 0 0' }}>Safari #{driver.current_trip_id} inaendelea…</p>
                )}
              </div>
            )}

            {/* Stats */}
            <div className="db-stats">
              {[
                { icon: '⭐', val: driver.rating.toFixed(1), lbl: 'Rating' },
                { icon: '🏍️', val: driver.total_trips,      lbl: 'Safari Zote' },
                { icon: '🔖', val: driver.plate_number,     lbl: 'Nambari' },
                { icon: '🛵', val: driver.vehicle_model,    lbl: 'Bodaboda' },
              ].map(s => (
                <div key={s.lbl} className="db-stat">
                  <div className="db-stat-icon driver-stat-icon">{s.icon}</div>
                  <div className="db-stat-info">
                    <div className="db-stat-val ellipsis">{s.val}</div>
                    <div className="db-stat-lbl">{s.lbl}</div>
                  </div>
                </div>
              ))}
            </div>

            {locationName && (
              <div className="info-card" style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.2rem' }}>📍</span>
                <div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>Mahali Ulipo Sasa</div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#1e293b' }}>{locationName}</div>
                </div>
              </div>
            )}

            {!isOnline && !isBusy && (
              <div className="info-card" style={{ textAlign: 'center', padding: '2rem' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🔴</div>
                <h3 style={{ margin: '0 0 0.5rem' }}>Uko Offline</h3>
                <p style={{ color: '#64748b', margin: '0 0 1rem' }}>Bonyeza <strong>Nenda Online</strong> ili uanze kupokea maombi.</p>
                <button className="btn btn-primary" onClick={toggleOnline} disabled={toggling}>
                  {toggling ? <><span className="btn-spinner" /> Inaunganisha…</> : '🟢 Nenda Online Sasa'}
                </button>
              </div>
            )}
            {isOnline && !offer && (
              <div className="info-card" style={{ textAlign: 'center', padding: '2rem' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🟢</div>
                <h3 style={{ margin: '0 0 0.5rem' }}>Uko Online</h3>
                <p style={{ color: '#64748b', margin: 0 }}>Unasubiri maombi… Utaarifiwa mara moja.</p>
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: TRIPS ZANGU
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'trips' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Safari Zangu</h3>
              <button onClick={refreshTrips} className="btn btn-navy btn-sm" disabled={tripsLoading}>
                {tripsLoading ? <span className="btn-spinner" /> : '🔄 Reload'}
              </button>
            </div>

            {tripsLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                <div className="spinner spinner-navy" style={{ margin: '0 auto 0.75rem' }} />
                Inapakia safari…
              </div>
            ) : driverTrips.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8' }}>
                <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🏍️</div>
                <p style={{ margin: 0 }}>Bado hujafanya safari yoyote.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {driverTrips.map(trip => (
                  <div key={trip.id} style={{
                    background: '#fff', border: '1px solid #e2e8f0',
                    borderLeft: `4px solid ${statusColor(trip.status)}`, borderRadius: 12, padding: '1rem',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>Safari #{trip.id}</div>
                        {trip.trip_name && <div style={{ fontSize: '0.73rem', color: '#64748b', marginTop: 1 }}>{trip.trip_name}</div>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{
                          background: `${statusColor(trip.status)}15`, color: statusColor(trip.status),
                          padding: '0.15rem 0.55rem', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700,
                        }}>
                          {trip.status.replace(/_/g, ' ')}
                        </span>
                        {trip.fare_tzs && trip.status === 'COMPLETED' && (
                          <div style={{ fontWeight: 800, color: '#16a34a', fontSize: '0.95rem', marginTop: '0.2rem' }}>
                            +{fmtMoney(Math.round(trip.fare_tzs * 0.9))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ marginTop: '0.6rem', fontSize: '0.82rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '0.18rem' }}>
                      <div>📍 {trip.pickup_address}</div>
                      <div>🏁 {trip.destination_address}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.76rem', marginTop: '0.25rem' }}>
                        🕐 {fmtDateTime(trip.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: MKOBA WANGU
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'wallet' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Mkoba Wangu</h3>
              <button onClick={refreshWallet} className="btn btn-navy btn-sm" disabled={walletLoading}>
                {walletLoading ? <span className="btn-spinner" /> : '🔄 Reload'}
              </button>
            </div>

            {walletLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                <div className="spinner spinner-navy" style={{ margin: '0 auto 0.75rem' }} />
                Inapakia mkoba…
              </div>
            ) : !walletData ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#ef4444' }}>
                Imeshindwa kupakia mkoba. <button onClick={refreshWallet} className="btn btn-navy btn-sm" style={{ marginLeft: '0.5rem' }}>Jaribu tena</button>
              </div>
            ) : (
              <>
                {/* Balance card */}
                <div style={{
                  background: 'linear-gradient(135deg, #1e3a5f 0%, #e85d04 100%)',
                  borderRadius: 16, padding: '1.5rem', color: '#fff', marginBottom: '1rem',
                }}>
                  <div style={{ fontSize: '0.82rem', opacity: 0.75, marginBottom: '0.25rem' }}>Salio la Mkoba</div>
                  <div style={{ fontSize: '2.2rem', fontWeight: 800, letterSpacing: '-0.5px' }}>
                    {fmtMoney(walletData.balance)}
                  </div>
                  <div style={{ fontSize: '0.78rem', opacity: 0.65, marginTop: '0.4rem' }}>{driver.full_name}</div>
                </div>

                {/* Summary cards */}
                {(() => {
                  const credits = walletData.transactions.filter(t => t.type === 'CREDIT');
                  const totalEarned = credits.reduce((s, t) => s + t.amount, 0);
                  return (
                    <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                      <div style={{ flex: 1, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '0.8rem', textAlign: 'center' }}>
                        <div style={{ fontWeight: 800, color: '#16a34a', fontSize: '1.05rem' }}>{fmtMoney(totalEarned)}</div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>Jumla Mapato</div>
                      </div>
                      <div style={{ flex: 1, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '0.8rem', textAlign: 'center' }}>
                        <div style={{ fontWeight: 800, color: '#2563eb', fontSize: '1.05rem' }}>{credits.length}</div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>Safari Zilizolipwa</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Transaction list */}
                <h4 style={{ margin: '0 0 0.6rem', fontSize: '0.88rem', fontWeight: 700, color: '#374151' }}>Miamala Yote</h4>

                {walletData.transactions.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.4rem' }}>💸</div>
                    Hakuna miamala bado.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    {walletData.transactions.map(txn => (
                      <div key={txn.id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: '#fff', border: '1px solid #f1f5f9', borderRadius: 10, padding: '0.75rem 1rem', gap: '0.5rem',
                      }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                          background: txn.type === 'CREDIT' ? '#f0fdf4' : '#fef2f2',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem',
                        }}>
                          {txn.type === 'CREDIT' ? '⬆️' : '⬇️'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {txn.description}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 2 }}>
                            {fmtDate(txn.created_at)}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontWeight: 800, color: txn.type === 'CREDIT' ? '#16a34a' : '#ef4444', fontSize: '0.95rem' }}>
                            {txn.type === 'CREDIT' ? '+' : '-'}{fmtMoney(txn.amount)}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Salio: {fmtMoney(txn.balance_after)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Chat backdrop ── */}
      {chatOpen && (
        <div onClick={() => setChatOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999 }} />
      )}

      {/* ── Chat slide panel ── */}
      <div style={{
        position: 'fixed', top: 0, right: chatOpen ? 0 : '-100%',
        width: 'min(340px, 100vw)', height: '100vh', background: '#fff',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.18)', transition: 'right 0.3s ease',
        zIndex: 1000, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '1rem', background: '#1e3a5f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>💬 Chat na {offer?.rider_name ?? 'Abiria'}</span>
          <button onClick={() => setChatOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.3rem', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {messages.length === 0 && <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: '2rem' }}>Hakuna ujumbe bado</p>}
          {messages.map(m => (
            <div key={m.id} style={{
              alignSelf: m.sender === 'Driver' ? 'flex-end' : 'flex-start',
              background: m.sender === 'Driver' ? '#e85d04' : '#f1f5f9',
              color: m.sender === 'Driver' ? '#fff' : '#1e293b',
              padding: '0.5rem 0.75rem', maxWidth: '80%', fontSize: '0.9rem',
              borderRadius: m.sender === 'Driver' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
            }}>
              <div>{m.text}</div>
              <div style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: '0.2rem' }}>{m.time}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <div style={{ padding: '0.75rem', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '0.5rem' }}>
          <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()} placeholder="Andika ujumbe…"
            style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid #cbd5e1', outline: 'none', fontSize: '0.9rem' }} />
          <button onClick={sendChat} className="btn btn-primary btn-sm">Tuma</button>
        </div>
      </div>
    </div>
  );
}
