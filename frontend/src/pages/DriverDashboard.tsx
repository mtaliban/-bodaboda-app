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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function fmtMoney(v: number) {
  return `TSh ${v.toLocaleString('en-TZ')}`;
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('sw-TZ', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function fmtDateTime(s: string) {
  const d = new Date(s);
  return `${d.toLocaleDateString('sw-TZ', { day: '2-digit', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function tripStatusColor(s: string): string {
  const map: Record<string, string> = {
    COMPLETED: '#16a34a', CANCELLED: '#dc2626', IN_PROGRESS: '#ea580c',
    SEARCHING_DRIVER: '#ca8a04', DRIVER_ASSIGNED: '#2563eb', DRIVER_ARRIVED: '#7c3aed',
    NO_DRIVER_AVAILABLE: '#dc2626',
  };
  return map[s] ?? '#64748b';
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'sw,en' } }
    );
    if (!res.ok) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const data = await res.json() as { display_name?: string; address?: { road?: string; suburb?: string; city?: string; town?: string; village?: string } };
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

// ── TabBar ────────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: '🏠' },
    { key: 'trips',     label: 'Trips Zangu', icon: '🏍️' },
    { key: 'wallet',    label: 'Mkoba', icon: '💰' },
  ];
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e2e8f0', marginBottom: '1rem', overflowX: 'auto' }}>
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            padding: '0.65rem 1.2rem',
            border: 'none',
            borderBottom: active === t.key ? '3px solid #e85d04' : '3px solid transparent',
            background: 'none',
            cursor: 'pointer',
            fontWeight: active === t.key ? 700 : 500,
            color: active === t.key ? '#e85d04' : '#64748b',
            fontSize: '0.9rem',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s',
          }}
        >
          {t.icon} {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DriverDashboard() {
  const { user } = useAuth();
  const [driver, setDriver] = useState<DriverState | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [timer, setTimer] = useState('');
  const [toggling, setToggling] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const [newRideAlert, setNewRideAlert] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [driverTrips, setDriverTrips] = useState<TripSummary[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [locationName, setLocationName] = useState('');
  const [currentTrip, setCurrentTrip] = useState<TripSummary | null>(null);

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── load driver ─────────────────────────────────────────────────────────────
  useEffect(() => {
    api.post('/drivers/sync-me')
      .then(({ data }) => setDriver(data))
      .catch(() => api.get('/drivers/me').then(({ data }) => setDriver(data)))
      .catch(() => setError('Could not load driver profile.'));
  }, []);

  // ── get driver location name from browser GPS ────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const name = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        setLocationName(name);
      },
      () => setLocationName(''),
    );
  }, []);

  // ── load current trip when BUSY ──────────────────────────────────────────────
  useEffect(() => {
    if (driver?.status === 'BUSY') {
      api.get<TripSummary>('/drivers/current-trip')
        .then(({ data }) => setCurrentTrip(data))
        .catch(() => setCurrentTrip(null));
    } else {
      setCurrentTrip(null);
    }
  }, [driver?.status]);

  // ── fetch current offer ──────────────────────────────────────────────────────
  const fetchOffer = useCallback(async () => {
    try {
      const { data } = await api.get<Offer | null>('/drivers/offers/current');
      setOffer(data ?? null);
    } catch {
      // no offer
    }
  }, []);

  // ── poll every 8s when AVAILABLE ────────────────────────────────────────────
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

  // ── offer countdown ──────────────────────────────────────────────────────────
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

  // ── auto-scroll chat ─────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── load trips tab ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'trips') return;
    setTripsLoading(true);
    api.get<TripSummary[]>('/drivers/trips')
      .then(({ data }) => setDriverTrips(data))
      .catch(() => setDriverTrips([]))
      .finally(() => setTripsLoading(false));
  }, [activeTab]);

  // ── load wallet tab ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab !== 'wallet') return;
    setWalletLoading(true);
    api.get<WalletData>('/wallet')
      .then(({ data }) => setWalletData(data))
      .catch(() => setWalletData(null))
      .finally(() => setWalletLoading(false));
  }, [activeTab]);

  // ── MQTT ─────────────────────────────────────────────────────────────────────
  const mqttTopics = ['rides/new', offer ? `rides/${offer.trip_id}/chat` : 'rides/__none__'];
  const { publish } = useMqtt(mqttTopics, useCallback((event) => {
    if (event.event_type === 'CHAT_MESSAGE') {
      const p = event.payload as { sender?: string; text?: string };
      if (p.sender !== 'Driver') {
        setMessages(prev => [...prev, {
          id: Date.now().toString() + Math.random(),
          sender: p.sender ?? 'Rider',
          text: String(p.text ?? ''),
          time: new Date().toLocaleTimeString(),
        }]);
      }
      return;
    }
    setNewRideAlert(true);
    setTimeout(() => setNewRideAlert(false), 5000);
    if (driver?.status === 'AVAILABLE') fetchOffer();
  }, [driver?.status, fetchOffer, offer]));

  // ── send chat ────────────────────────────────────────────────────────────────
  const sendChat = () => {
    if (!chatInput.trim() || !offer) return;
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      sender: 'Driver',
      text: chatInput.trim(),
      time: new Date().toLocaleTimeString(),
    }]);
    publish(`rides/${offer.trip_id}/chat`, {
      event_type: 'CHAT_MESSAGE',
      payload: { sender: 'Driver', text: chatInput.trim(), trip_id: offer.trip_id },
    });
    setChatInput('');
  };

  // ── toggle online/offline ────────────────────────────────────────────────────
  const toggleOnline = async () => {
    if (!driver || toggling) return;
    setToggling(true);
    setError('');
    try {
      const endpoint = driver.status === 'AVAILABLE' ? '/drivers/go-offline' : '/drivers/go-online';
      const { data } = await api.post<DriverState>(endpoint);
      setDriver(data);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Could not update status.');
    } finally {
      setToggling(false);
    }
  };

  // ── accept offer ─────────────────────────────────────────────────────────────
  const acceptOffer = async () => {
    if (!offer || acting) return;
    setActing(true);
    setError('');
    try {
      const { data } = await api.post(`/drivers/offers/${offer.id}/accept`);
      setDriver(data.driver);
      setOffer(null);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Could not accept offer.');
      await fetchOffer();
    } finally {
      setActing(false);
    }
  };

  // ── decline offer ────────────────────────────────────────────────────────────
  const declineOffer = async () => {
    if (!offer || acting) return;
    setActing(true);
    setError('');
    try {
      await api.post(`/drivers/offers/${offer.id}/decline`);
      setOffer(null);
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Could not decline offer.');
    } finally {
      setActing(false);
    }
  };

  // ── trip actions ─────────────────────────────────────────────────────────────
  const doTripAction = async (endpoint: string, label: string) => {
    if (!currentTrip || acting) return;
    setActing(true);
    setError('');
    try {
      const { data } = await api.post<TripSummary>(endpoint);
      setCurrentTrip(data);
      if (data.status === 'COMPLETED' || data.status === 'CANCELLED') {
        const { data: d } = await api.get<DriverState>('/drivers/me');
        setDriver(d);
      }
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? `Could not ${label}.`);
    } finally {
      setActing(false);
    }
  };

  // ── Loading screen ───────────────────────────────────────────────────────────
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

  // ── Trips tab ────────────────────────────────────────────────────────────────
  const TripsTab = () => (
    <div>
      <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700 }}>Safari Zangu</h3>
      {tripsLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
          <div className="spinner spinner-navy" style={{ margin: '0 auto 0.5rem' }} />
          Inapakia…
        </div>
      ) : driverTrips.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🏍️</div>
          Bado hujafanya safari yoyote.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {driverTrips.map(trip => (
            <div key={trip.id} style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
              padding: '1rem', borderLeft: `4px solid ${tripStatusColor(trip.status)}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1e293b' }}>
                    Safari #{trip.id}
                  </div>
                  {trip.trip_name && (
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>{trip.trip_name}</div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    background: `${tripStatusColor(trip.status)}18`,
                    color: tripStatusColor(trip.status),
                    padding: '0.15rem 0.5rem', borderRadius: 99,
                    fontSize: '0.72rem', fontWeight: 700,
                  }}>{trip.status.replace(/_/g, ' ')}</span>
                  {trip.fare_tzs && (
                    <div style={{ fontWeight: 800, color: '#16a34a', fontSize: '0.95rem', marginTop: '0.25rem' }}>
                      {fmtMoney(Math.round(trip.fare_tzs * 0.9))}
                      <span style={{ fontWeight: 400, fontSize: '0.72rem', color: '#64748b' }}> (mapato)</span>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ marginTop: '0.6rem', fontSize: '0.82rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <div>📍 <strong>Pickup:</strong> {trip.pickup_address}</div>
                <div>🏁 <strong>Dest:</strong> {trip.destination_address}</div>
                <div style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: '0.25rem' }}>
                  🕐 {fmtDateTime(trip.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── Wallet tab ───────────────────────────────────────────────────────────────
  const WalletTab = () => (
    <div>
      {walletLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
          <div className="spinner spinner-navy" style={{ margin: '0 auto 0.5rem' }} />
          Inapakia mkoba…
        </div>
      ) : !walletData ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#ef4444' }}>Imeshindwa kupakia mkoba.</div>
      ) : (
        <>
          {/* Balance card */}
          <div style={{
            background: 'linear-gradient(135deg, #1e3a5f 0%, #e85d04 100%)',
            borderRadius: 16, padding: '1.5rem', color: '#fff', marginBottom: '1.25rem',
          }}>
            <div style={{ fontSize: '0.85rem', opacity: 0.8, marginBottom: '0.25rem' }}>Salio la Mkoba</div>
            <div style={{ fontSize: '2.2rem', fontWeight: 800 }}>{fmtMoney(walletData.balance)}</div>
            <div style={{ fontSize: '0.78rem', opacity: 0.7, marginTop: '0.4rem' }}>
              {driver.full_name}
            </div>
          </div>

          {/* Earnings summary */}
          {(() => {
            const credits = walletData.transactions.filter(t => t.type === 'CREDIT');
            const total = credits.reduce((s, t) => s + t.amount, 0);
            return (
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ flex: 1, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontWeight: 800, color: '#16a34a', fontSize: '1.1rem' }}>{fmtMoney(total)}</div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>Jumla ya Mapato</div>
                </div>
                <div style={{ flex: 1, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ fontWeight: 800, color: '#2563eb', fontSize: '1.1rem' }}>{credits.length}</div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>Safari Zilizolipwa</div>
                </div>
              </div>
            );
          })()}

          {/* Transaction history */}
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', fontWeight: 700 }}>Miamala</h3>
          {walletData.transactions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8' }}>Hakuna miamala bado.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {walletData.transactions.map(txn => (
                <div key={txn.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: '#fff', border: '1px solid #f1f5f9', borderRadius: 10,
                  padding: '0.75rem 1rem', gap: '0.5rem',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                      Salio: {fmtMoney(txn.balance_after)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────────
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

        {/* New ride toast */}
        {newRideAlert && !offer && (
          <div className="info-card" style={{ borderLeft: '4px solid #e85d04', background: '#fff7ed' }}>
            <strong>🏍️ New ride request nearby!</strong>
            <span style={{ marginLeft: '0.5rem', color: '#888', fontSize: '0.85rem' }}>Checking if assigned to you…</span>
          </div>
        )}

        {/* Tabs (only when not in offer / busy) */}
        <TabBar active={activeTab} onChange={setActiveTab} />

        {/* ── Dashboard Tab ─────────────────────────────────────────────────── */}
        {activeTab === 'dashboard' && (
          <>
            {/* Incoming offer */}
            {offer && offer.trip && (
              <div className="info-card" style={{ borderLeft: '4px solid #e85d04' }}>
                <div className="info-card-head">
                  <span className="info-card-title">🚨 Incoming Ride Request</span>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem', color: timer < '0:30' ? '#ef4444' : '#e85d04' }}>
                    ⏱ {timer}
                  </span>
                </div>

                {/* Fare preview */}
                {offer.trip.fare_tzs && (
                  <div style={{
                    background: '#f0fdf4', border: '1px solid #bbf7d0',
                    borderRadius: 8, padding: '0.6rem 0.9rem', margin: '0.6rem 0',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span style={{ fontSize: '0.82rem', color: '#374151' }}>💰 Bei ya Safari</span>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 800, color: '#16a34a', fontSize: '1rem' }}>
                        {fmtMoney(offer.trip.fare_tzs)}
                      </span>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        Mapato yako: <strong style={{ color: '#16a34a' }}>{fmtMoney(Math.round(offer.trip.fare_tzs * 0.9))}</strong> (90%)
                      </div>
                    </div>
                  </div>
                )}

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

                <DriverTripMapSafe
                  pickupLat={offer.trip.pickup_lat}
                  pickupLng={offer.trip.pickup_lng}
                  pickupAddress={offer.trip.pickup_address}
                  destinationLat={offer.trip.destination_lat}
                  destinationLng={offer.trip.destination_lng}
                  destinationAddress={offer.trip.destination_address}
                />

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={acceptOffer} disabled={acting}>
                    {acting ? <><span className="btn-spinner" /> Accepting…</> : '✅ Accept'}
                  </button>
                  <button className="btn btn-navy" style={{ flex: 1 }} onClick={declineOffer} disabled={acting}>
                    {acting ? '…' : '✕ Decline'}
                  </button>
                  <button className="btn btn-navy" style={{ minWidth: 60 }} onClick={() => setChatOpen(true)}>
                    💬 Chat
                  </button>
                </div>
              </div>
            )}

            {/* Active trip when BUSY */}
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
                        padding: '0.6rem 0.9rem', margin: '0.6rem 0',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}>
                        <span style={{ fontSize: '0.82rem', color: '#374151' }}>💰 Mapato Yako</span>
                        <span style={{ fontWeight: 800, color: '#16a34a', fontSize: '1rem' }}>
                          {fmtMoney(Math.round(currentTrip.fare_tzs * 0.9))}
                        </span>
                      </div>
                    )}
                    <div className="info-body">
                      <div className="info-row">
                        <span className="info-label">Pickup</span>
                        <span className="info-value">📍 {currentTrip.pickup_address}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Destination</span>
                        <span className="info-value">🏁 {currentTrip.destination_address}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Hali</span>
                        <span className="info-value" style={{ color: tripStatusColor(currentTrip.status), fontWeight: 700 }}>
                          {currentTrip.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>

                    {/* Trip action buttons */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                      {currentTrip.status === 'DRIVER_ASSIGNED' && (
                        <button className="btn btn-primary btn-sm" onClick={() => doTripAction(`/trips/${currentTrip.id}/driver-arrived`, 'mark arrived')} disabled={acting}>
                          {acting ? '…' : '📍 Nimefika Pickup'}
                        </button>
                      )}
                      {(currentTrip.status === 'DRIVER_ARRIVED' || currentTrip.status === 'DRIVER_ASSIGNED') && (
                        <button className="btn btn-primary btn-sm" onClick={() => doTripAction(`/trips/${currentTrip.id}/start`, 'start trip')} disabled={acting}>
                          {acting ? '…' : '▶️ Anza Safari'}
                        </button>
                      )}
                      {currentTrip.status === 'IN_PROGRESS' && (
                        <button className="btn btn-primary btn-sm" style={{ background: '#16a34a', borderColor: '#16a34a' }}
                          onClick={() => doTripAction(`/trips/${currentTrip.id}/complete`, 'complete trip')} disabled={acting}>
                          {acting ? '…' : '✅ Maliza Safari'}
                        </button>
                      )}
                      <button className="btn btn-navy btn-sm" onClick={() => setChatOpen(true)}>💬 Chat</button>
                    </div>

                    <DriverTripMapSafe
                      pickupLat={currentTrip.pickup_lat}
                      pickupLng={currentTrip.pickup_lng}
                      pickupAddress={currentTrip.pickup_address}
                      destinationLat={currentTrip.destination_lat}
                      destinationLng={currentTrip.destination_lng}
                      destinationAddress={currentTrip.destination_address}
                    />
                  </>
                ) : (
                  <p style={{ color: '#64748b', margin: '0.5rem 0 0' }}>
                    Trip #{driver.current_trip_id} inaendelea…
                  </p>
                )}
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
                  <div className="db-stat-lbl">Safari Zote</div>
                </div>
              </div>
              <div className="db-stat">
                <div className="db-stat-icon driver-stat-icon">🔖</div>
                <div className="db-stat-info">
                  <div className="db-stat-val">{driver.plate_number}</div>
                  <div className="db-stat-lbl">Nambari</div>
                </div>
              </div>
              <div className="db-stat">
                <div className="db-stat-icon driver-stat-icon">🛵</div>
                <div className="db-stat-info">
                  <div className="db-stat-val ellipsis">{driver.vehicle_model}</div>
                  <div className="db-stat-lbl">Bodaboda</div>
                </div>
              </div>
            </div>

            {/* Current location */}
            {locationName && (
              <div className="info-card" style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.1rem' }}>📍</span>
                <div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>Mahali Ulipo Sasa</div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#1e293b' }}>{locationName}</div>
                </div>
              </div>
            )}

            {/* Status guidance */}
            {!isOnline && !isBusy && (
              <div className="info-card" style={{ textAlign: 'center', padding: '2rem' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🔴</div>
                <h3 style={{ margin: '0 0 0.5rem' }}>Uko Offline</h3>
                <p style={{ color: '#64748b', margin: '0 0 1rem' }}>
                  Bonyeza <strong>Go Online</strong> ili uanze kupokea maombi ya safari.
                </p>
                <button className="btn btn-primary" onClick={toggleOnline} disabled={toggling}>
                  {toggling ? <><span className="btn-spinner" /> Connecting…</> : '🟢 Go Online Sasa'}
                </button>
              </div>
            )}

            {isOnline && !offer && (
              <div className="info-card" style={{ textAlign: 'center', padding: '2rem' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🟢</div>
                <h3 style={{ margin: '0 0 0.5rem' }}>Uko Online</h3>
                <p style={{ color: '#64748b', margin: 0 }}>
                  Unasubiri maombi ya safari… Utaarifiwa mara moja kupitia MQTT.
                </p>
              </div>
            )}
          </>
        )}

        {/* ── Trips Tab ──────────────────────────────────────────────────────── */}
        {activeTab === 'trips' && <TripsTab />}

        {/* ── Wallet Tab ─────────────────────────────────────────────────────── */}
        {activeTab === 'wallet' && <WalletTab />}
      </div>

      {/* Chat backdrop */}
      {chatOpen && (
        <div onClick={() => setChatOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999 }} />
      )}

      {/* Chat panel */}
      <div style={{
        position: 'fixed', top: 0, right: chatOpen ? 0 : '-100%',
        width: 'min(340px, 100vw)', height: '100vh',
        background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
        transition: 'right 0.3s ease', zIndex: 1000,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '1rem', background: '#1e3a5f', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>💬 Chat na {offer?.rider_name ?? currentTrip ? 'Rider' : 'Rider'}</span>
          <button onClick={() => setChatOpen(false)}
            style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.3rem', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {messages.length === 0 && (
            <p style={{ color: '#94a3b8', textAlign: 'center', marginTop: '2rem' }}>Hakuna ujumbe bado</p>
          )}
          {messages.map(m => (
            <div key={m.id} style={{
              alignSelf: m.sender === 'Driver' ? 'flex-end' : 'flex-start',
              background: m.sender === 'Driver' ? '#e85d04' : '#f1f5f9',
              color: m.sender === 'Driver' ? '#fff' : '#1e293b',
              padding: '0.5rem 0.75rem', maxWidth: '80%',
              borderRadius: m.sender === 'Driver' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              fontSize: '0.9rem',
            }}>
              <div>{m.text}</div>
              <div style={{ fontSize: '0.7rem', opacity: 0.7, marginTop: '0.2rem' }}>{m.time}</div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <div style={{ padding: '0.75rem', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '0.5rem' }}>
          <input
            type="text" value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()}
            placeholder="Andika ujumbe…"
            style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid #cbd5e1', outline: 'none', fontSize: '0.9rem' }}
          />
          <button onClick={sendChat} className="btn btn-primary btn-sm">Tuma</button>
        </div>
      </div>
    </div>
  );
}
