import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

const ADMIN_API = `${window.location.protocol}//${window.location.host}/admin-api`;

interface Stats {
  total_users: number; riders: number; drivers: number;
  total_trips: number; active_trips: number; completed_trips: number;
  cancelled_trips: number; pending_verifications: number;
}
interface AdminUser { id: number; full_name: string; email: string; phone: string; role: string; status: string; created_at: string; driver_verification?: string; }
interface AdminTrip { id: number; trip_name: string; pickup_address: string; destination_address: string; status: string; rider_name: string; created_at: string; }
interface AdminDriver { user_id: number; full_name: string; email: string; phone: string; profile_id: number; license_number: string; vehicle_model: string; plate_number: string; verification_status: string; driver_status: string; rating: number; total_trips: number; }
interface Event { topic: string; event_type?: string; timestamp: string; [key: string]: unknown; }

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: '#fff', border: `2px solid ${color}`, borderRadius: 12, padding: '1rem 1.25rem', flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: '1.8rem', fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 2 }}>{label}</div>
    </div>
  );
}

export default function AdminPage() {
  const [token, setToken]     = useState(() => localStorage.getItem('admin_token') ?? '');
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginErr, setLoginErr]   = useState('');
  const [stats,    setStats]   = useState<Stats | null>(null);
  const [users,    setUsers]   = useState<AdminUser[]>([]);
  const [trips,    setTrips]   = useState<AdminTrip[]>([]);
  const [drivers,  setDrivers] = useState<AdminDriver[]>([]);
  const [tab,      setTab]     = useState<'stats'|'users'|'trips'|'drivers'|'events'>('stats');
  const [events,   setEvents]  = useState<Event[]>([]);
  const [loading,  setLoading] = useState(false);
  const [apiError, setApiError] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setLoginErr('');
    try {
      const { data } = await axios.post(`${ADMIN_API}/admin/login`, loginForm);
      localStorage.setItem('admin_token', data.access_token);
      setToken(data.access_token);
    } catch { setLoginErr('Credentials zisizo sahihi.'); }
  };

  const logout = () => { localStorage.removeItem('admin_token'); setToken(''); };

  const api = useCallback(async (path: string) => {
    const { data } = await axios.get(`${ADMIN_API}${path}`, { headers });
    return data;
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      api('/admin/stats'),
      api('/admin/users?limit=50'),
      api('/admin/trips?limit=50'),
      api('/admin/drivers'),
    ]).then(([s, u, t, d]) => {
      setStats(s);
      setUsers(u.users);
      setTrips(t.trips);
      setDrivers(d);
    }).catch((err) => {
      const status = err?.response?.status;
      if (status === 401 || status === 403) setToken('');
      else setApiError(`Hitilafu: ${status ?? 'seva haijibu'} — ${err?.message ?? ''}`);
    }).finally(() => setLoading(false));
  }, [token, api]);

  // WebSocket for real-time events
  useEffect(() => {
    if (!token) return;
    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${wsProto}://${window.location.host}/admin-api/admin/ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data as string) as Event;
        setEvents(prev => [ev, ...prev].slice(0, 100));
      } catch {}
    };
    ws.onclose = () => {};
    return () => { ws.close(); wsRef.current = null; };
  }, [token]);

  const verifyDriver = async (profileId: number, status: 'VERIFIED' | 'REJECTED') => {
    await axios.patch(`${ADMIN_API}/admin/drivers/${profileId}/verify`, { status }, { headers });
    setDrivers(prev => prev.map(d => d.profile_id === profileId ? { ...d, verification_status: status } : d));
  };

  const updateUserStatus = async (userId: number, status: 'active' | 'suspended') => {
    await axios.patch(`${ADMIN_API}/admin/users/${userId}/status`, { status }, { headers });
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, status } : u));
  };

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: '2rem', width: 340, boxShadow: '0 4px 24px rgba(0,0,0,0.12)' }}>
          <h1 style={{ fontWeight: 800, fontSize: '1.4rem', color: '#111', marginBottom: '0.25rem' }}>🛡️ Admin Panel</h1>
          <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '1.5rem' }}>BodaBoda Administration</p>
          {loginErr && <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '1rem', padding: '0.5rem', background: '#fef2f2', borderRadius: 8 }}>{loginErr}</div>}
          <form onSubmit={login} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input placeholder="Username" value={loginForm.username} onChange={e => setLoginForm(p => ({ ...p, username: e.target.value }))} style={{ padding: '0.65rem 0.875rem', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: '0.9rem', outline: 'none' }} />
            <input placeholder="Password" type="password" value={loginForm.password} onChange={e => setLoginForm(p => ({ ...p, password: e.target.value }))} style={{ padding: '0.65rem 0.875rem', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: '0.9rem', outline: 'none' }} />
            <button type="submit" style={{ padding: '0.7rem', background: '#FF6B00', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem' }}>Ingia</button>
          </form>
        </div>
      </div>
    );
  }

  const tabStyle = (t: string) => ({
    padding: '0.5rem 1.1rem', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
    background: tab === t ? '#FF6B00' : '#f3f4f6', color: tab === t ? '#fff' : '#374151',
  });

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: '#1e293b', color: '#fff', padding: '0.875rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>🛡️ BodaBoda Admin</div>
        <button onClick={logout} style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', padding: '0.4rem 0.875rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.82rem' }}>Toka</button>
      </div>

      <div style={{ padding: '1.25rem 1.5rem' }}>
        {/* Tab nav */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          {(['stats','users','trips','drivers','events'] as const).map(t => (
            <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>
              {t === 'stats' ? '📊 Stats' : t === 'users' ? `👥 Users (${users.length})` : t === 'trips' ? `🏍️ Trips (${trips.length})` : t === 'drivers' ? `🏍️ Drivers (${drivers.length})` : `⚡ Events (${events.length})`}
            </button>
          ))}
        </div>

        {apiError && <div style={{ color: '#ef4444', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem' }}>{apiError}</div>}
        {loading && <div style={{ textAlign: 'center', color: '#6b7280', padding: '3rem' }}>Inapakia…</div>}

        {/* Stats */}
        {!loading && tab === 'stats' && stats && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <StatCard label="Total Users" value={stats.total_users} color="#3b82f6" />
            <StatCard label="Riders" value={stats.riders} color="#8b5cf6" />
            <StatCard label="Drivers" value={stats.drivers} color="#f59e0b" />
            <StatCard label="Total Trips" value={stats.total_trips} color="#6b7280" />
            <StatCard label="Active Trips" value={stats.active_trips} color="#FF6B00" />
            <StatCard label="Completed" value={stats.completed_trips} color="#10b981" />
            <StatCard label="Cancelled" value={stats.cancelled_trips} color="#ef4444" />
            <StatCard label="Pending Verify" value={stats.pending_verifications} color="#f59e0b" />
          </div>
        )}

        {/* Users */}
        {!loading && tab === 'users' && (
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead style={{ background: '#f8fafc' }}>
                <tr>{['ID','Jina','Email','Simu','Role','Status','Tarehe','Hatua'].map(h => <th key={h} style={{ padding: '0.65rem 0.875rem', textAlign: 'left', fontWeight: 700, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.6rem 0.875rem', color: '#6b7280' }}>{u.id}</td>
                    <td style={{ padding: '0.6rem 0.875rem', fontWeight: 600 }}>{u.full_name}</td>
                    <td style={{ padding: '0.6rem 0.875rem', color: '#6b7280' }}>{u.email}</td>
                    <td style={{ padding: '0.6rem 0.875rem' }}>{u.phone}</td>
                    <td style={{ padding: '0.6rem 0.875rem' }}><span style={{ background: u.role === 'DRIVER' ? '#fef3c7' : '#ede9fe', color: u.role === 'DRIVER' ? '#92400e' : '#5b21b6', padding: '0.2rem 0.5rem', borderRadius: 99, fontWeight: 600 }}>{u.role}</span></td>
                    <td style={{ padding: '0.6rem 0.875rem' }}><span style={{ color: u.status === 'active' ? '#10b981' : '#ef4444', fontWeight: 600 }}>{u.status}</span></td>
                    <td style={{ padding: '0.6rem 0.875rem', color: '#6b7280' }}>{fmtDate(u.created_at)}</td>
                    <td style={{ padding: '0.6rem 0.875rem' }}>
                      {u.status === 'active'
                        ? <button onClick={() => updateUserStatus(u.id, 'suspended')} style={{ background: '#fef2f2', color: '#ef4444', border: 'none', padding: '0.25rem 0.6rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>Suspend</button>
                        : <button onClick={() => updateUserStatus(u.id, 'active')} style={{ background: '#f0fdf4', color: '#10b981', border: 'none', padding: '0.25rem 0.6rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>Activate</button>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Trips */}
        {!loading && tab === 'trips' && (
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead style={{ background: '#f8fafc' }}>
                <tr>{['ID','Jina','Pickup','Destination','Status','Rider','Tarehe'].map(h => <th key={h} style={{ padding: '0.65rem 0.875rem', textAlign: 'left', fontWeight: 700, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {trips.map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.6rem 0.875rem', color: '#6b7280' }}>{t.id}</td>
                    <td style={{ padding: '0.6rem 0.875rem', fontWeight: 600 }}>{t.trip_name ?? `#${t.id}`}</td>
                    <td style={{ padding: '0.6rem 0.875rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.pickup_address}</td>
                    <td style={{ padding: '0.6rem 0.875rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.destination_address}</td>
                    <td style={{ padding: '0.6rem 0.875rem' }}><span style={{ background: t.status === 'COMPLETED' ? '#f0fdf4' : t.status === 'CANCELLED' ? '#fef2f2' : '#fff7ed', color: t.status === 'COMPLETED' ? '#10b981' : t.status === 'CANCELLED' ? '#ef4444' : '#FF6B00', padding: '0.2rem 0.5rem', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600 }}>{t.status}</span></td>
                    <td style={{ padding: '0.6rem 0.875rem' }}>{t.rider_name}</td>
                    <td style={{ padding: '0.6rem 0.875rem', color: '#6b7280' }}>{fmtDate(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Drivers */}
        {!loading && tab === 'drivers' && (
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead style={{ background: '#f8fafc' }}>
                <tr>{['Jina','Simu','Gari','Sahani','Verification','Status','Rating','Trips','Hatua'].map(h => <th key={h} style={{ padding: '0.65rem 0.875rem', textAlign: 'left', fontWeight: 700, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {drivers.map(d => (
                  <tr key={d.user_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.6rem 0.875rem', fontWeight: 600 }}>{d.full_name}</td>
                    <td style={{ padding: '0.6rem 0.875rem' }}>{d.phone}</td>
                    <td style={{ padding: '0.6rem 0.875rem' }}>{d.vehicle_model}</td>
                    <td style={{ padding: '0.6rem 0.875rem' }}>{d.plate_number}</td>
                    <td style={{ padding: '0.6rem 0.875rem' }}>
                      <span style={{ background: d.verification_status === 'VERIFIED' ? '#f0fdf4' : d.verification_status === 'REJECTED' ? '#fef2f2' : '#fff7ed', color: d.verification_status === 'VERIFIED' ? '#10b981' : d.verification_status === 'REJECTED' ? '#ef4444' : '#f59e0b', padding: '0.2rem 0.5rem', borderRadius: 99, fontSize: '0.75rem', fontWeight: 600 }}>{d.verification_status}</span>
                    </td>
                    <td style={{ padding: '0.6rem 0.875rem' }}>{d.driver_status ?? '—'}</td>
                    <td style={{ padding: '0.6rem 0.875rem' }}>{d.rating?.toFixed(1) ?? '—'} ⭐</td>
                    <td style={{ padding: '0.6rem 0.875rem' }}>{d.total_trips ?? 0}</td>
                    <td style={{ padding: '0.6rem 0.875rem', display: 'flex', gap: '0.35rem' }}>
                      {d.verification_status !== 'VERIFIED' && (
                        <button onClick={() => verifyDriver(d.profile_id, 'VERIFIED')} style={{ background: '#f0fdf4', color: '#10b981', border: 'none', padding: '0.25rem 0.5rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>✓ Verify</button>
                      )}
                      {d.verification_status !== 'REJECTED' && (
                        <button onClick={() => verifyDriver(d.profile_id, 'REJECTED')} style={{ background: '#fef2f2', color: '#ef4444', border: 'none', padding: '0.25rem 0.5rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>✕ Reject</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Events */}
        {tab === 'events' && (
          <div>
            <div style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, color: '#374151' }}>Real-time MQTT Events</span>
              <button onClick={() => setEvents([])} style={{ background: '#f3f4f6', border: 'none', padding: '0.35rem 0.75rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.8rem' }}>Futa Yote</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '70vh', overflowY: 'auto' }}>
              {events.length === 0 && <div style={{ color: '#9ca3af', textAlign: 'center', padding: '3rem' }}>Inasubiri events…</div>}
              {events.map((ev, i) => (
                <div key={i} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.65rem 0.875rem', fontSize: '0.8rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: 700, color: '#FF6B00' }}>{ev.event_type ?? ev.topic}</span>
                    <span style={{ color: '#9ca3af' }}>{new Date(ev.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div style={{ color: '#374151' }}>{ev.topic}</div>
                  <pre style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#6b7280', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(ev, null, 2)}</pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
