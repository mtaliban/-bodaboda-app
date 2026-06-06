import { useState, useEffect, useRef, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import axios from 'axios';

const ADMIN_API = `${window.location.protocol}//${window.location.host}/admin-api`;

interface Stats { total_users: number; riders: number; drivers: number; total_trips: number; active_trips: number; completed_trips: number; cancelled_trips: number; pending_verifications: number; }
interface AdminUser { id: number; full_name: string; email: string; phone: string; role: string; status: string; created_at: string; driver_verification?: string; }
interface AdminTrip { id: number; trip_name: string; pickup_address: string; destination_address: string; status: string; rider_name: string; created_at: string; }
interface AdminDriver { user_id: number; full_name: string; email: string; phone: string; profile_id: number; license_number: string; vehicle_model: string; plate_number: string; verification_status: string; driver_status: string; rating: number; total_trips: number; }
interface LiveEvent { topic: string; event_type?: string; timestamp: string; [key: string]: unknown; }
interface HistEvent { id: number; trip_id: number; event_type: string; changed_by: string; timestamp: string; trip_name: string; pickup_address: string; destination_address: string; rider_name: string; }

function fmtDate(s: string) { return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtTime(s: string) { return new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

function triggerDownload(content: string, filename: string) {
  const a = document.createElement('a');
  a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(content)}`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function exportCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.map(escape).join(','), ...rows.map(r => cols.map(c => escape(r[c])).join(','))].join('\r\n');
  triggerDownload(csv, filename);
}

function exportExcel(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.map(escape).join(','), ...rows.map(r => cols.map(c => escape(r[c])).join(','))].join('\r\n');
  triggerDownload(csv, filename.replace(/\.xls$/, '.csv'));
}

function ExportBar({ rows, name }: { rows: Record<string, unknown>[]; name: string }) {
  return (
    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
      <button onClick={() => exportCsv(rows, `${name}.csv`)} style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', padding: '0.3rem 0.75rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>📥 CSV</button>
      <button onClick={() => exportExcel(rows, `${name}.xls`)} style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', padding: '0.3rem 0.75rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>📊 Excel</button>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: '#fff', border: `2px solid ${color}20`, borderRadius: 12, padding: '1rem 1.25rem', flex: 1, minWidth: 130, borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: '2rem', fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

function Badge({ text, color }: { text: string; color: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    COMPLETED: { bg: '#f0fdf4', fg: '#16a34a' }, CANCELLED: { bg: '#fef2f2', fg: '#dc2626' },
    IN_PROGRESS: { bg: '#fff7ed', fg: '#ea580c' }, SEARCHING_DRIVER: { bg: '#fefce8', fg: '#ca8a04' },
    DRIVER_ASSIGNED: { bg: '#eff6ff', fg: '#2563eb' }, DRIVER_ARRIVED: { bg: '#f5f3ff', fg: '#7c3aed' },
    VERIFIED: { bg: '#f0fdf4', fg: '#16a34a' }, PENDING: { bg: '#fff7ed', fg: '#ea580c' }, REJECTED: { bg: '#fef2f2', fg: '#dc2626' },
    active: { bg: '#f0fdf4', fg: '#16a34a' }, suspended: { bg: '#fef2f2', fg: '#dc2626' },
    RIDER: { bg: '#f5f3ff', fg: '#7c3aed' }, DRIVER: { bg: '#fefce8', fg: '#b45309' },
  };
  const s = map[text] ?? { bg: color + '18', fg: color };
  return <span style={{ background: s.bg, color: s.fg, padding: '0.2rem 0.55rem', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{text}</span>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: '1.5rem', width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#6b7280' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#374151' }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ padding: '0.6rem 0.75rem', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: '0.85rem', outline: 'none' }} />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#374151' }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ padding: '0.6rem 0.75rem', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: '0.85rem' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── Main AdminPage ────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [token, setToken] = useState(() => {
    const t = localStorage.getItem('admin_token') ?? '';
    if (!t) return '';
    try { const p = JSON.parse(atob(t.split('.')[1])); if (p.exp * 1000 < Date.now()) { localStorage.removeItem('admin_token'); return ''; } } catch { localStorage.removeItem('admin_token'); return ''; }
    return t;
  });
  const [stats,   setStats]    = useState<Stats | null>(null);
  const [users,   setUsers]    = useState<AdminUser[]>([]);
  const [trips,   setTrips]    = useState<AdminTrip[]>([]);
  const [drivers, setDrivers]  = useState<AdminDriver[]>([]);
  const [tab, setTab] = useState<'stats'|'users'|'trips'|'drivers'|'events'|'wallet'|'profile'>('stats');
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [histEvents, setHistEvents] = useState<HistEvent[]>([]);
  const [evtSubTab, setEvtSubTab]   = useState<'live'|'history'>('live');
  const [walletTxns, setWalletTxns] = useState<Record<string,unknown>[]>([]);
  const [walletCards, setWalletCards] = useState<Record<string,unknown>[]>([]);
  const [walletSubTab, setWalletSubTab] = useState<'earnings'|'txns'|'cards'>('earnings');
  const [adminEarnings, setAdminEarnings] = useState<{ total: number; count: number; earnings: Record<string,unknown>[] }>({ total: 0, count: 0, earnings: [] });
  const [loading, setLoading]   = useState(false);
  const [apiError, setApiError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  const [editUser,   setEditUser]   = useState<AdminUser | null>(null);
  const [editUserForm, setEditUserForm] = useState({ full_name: '', email: '', phone: '', role: '', status: '' });
  const [editDriver, setEditDriver] = useState<AdminDriver | null>(null);
  const [editDriverForm, setEditDriverForm] = useState({ full_name: '', email: '', phone: '', vehicle_model: '', plate_number: '', license_number: '', verification_status: '', status: '' });
  const [editTrip,   setEditTrip]   = useState<AdminTrip | null>(null);
  const [editTripForm, setEditTripForm] = useState({ trip_name: '', status: '', pickup_address: '', destination_address: '' });
  const [resetPwdUser, setResetPwdUser] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showCreateCard, setShowCreateCard] = useState(false);
  const [createCardUserId, setCreateCardUserId] = useState('');

  const [profileName, setProfileName]   = useState(() => localStorage.getItem('admin_display_name') || 'Admin');
  const [profileEmail, setProfileEmail] = useState(() => localStorage.getItem('admin_email') || '');
  const [profileImg, setProfileImg]     = useState(() => localStorage.getItem('admin_img') || '');
  const [profileSaved, setProfileSaved] = useState(false);

  const headers = { Authorization: `Bearer ${token}` };

  const api = useCallback(async (path: string) => {
    const { data } = await axios.get(`${ADMIN_API}${path}`, { headers });
    return data;
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const toast = (msg: string) => { setActionMsg(msg); setTimeout(() => setActionMsg(''), 3000); };

  useEffect(() => {
    if (!token) return;
    setLoading(true); setApiError('');
    Promise.all([api('/admin/stats'), api('/admin/users?limit=100'), api('/admin/trips?limit=100'), api('/admin/drivers'), api('/admin/events/history?limit=200'), api('/admin/wallet/transactions'), api('/admin/wallet/cards'), api('/admin/earnings')])
      .then(([s, u, t, d, eh, wt, wc, ae]) => { setStats(s); setUsers(u.users); setTrips(t.trips); setDrivers(d); setHistEvents(eh); setWalletTxns(wt); setWalletCards(wc); setAdminEarnings(ae); })
      .catch(err => {
        const status = err?.response?.status;
        if (status === 401 || status === 403) setToken('');
        else setApiError(`Hitilafu: ${status ?? 'seva haijibu'}`);
      }).finally(() => setLoading(false));
  }, [token, api]);

  useEffect(() => {
    if (!token) return;
    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${wsProto}://${window.location.host}/admin-api/admin/ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    ws.onmessage = e => { try { const ev = JSON.parse(e.data as string) as LiveEvent; setLiveEvents(p => [ev, ...p].slice(0, 200)); } catch {} };
    return () => { ws.close(); wsRef.current = null; };
  }, [token]);

  const logout = () => { localStorage.removeItem('admin_token'); window.location.href = '/login'; };

  const verifyDriver = async (profileId: number, status: 'VERIFIED' | 'REJECTED') => {
    await axios.patch(`${ADMIN_API}/admin/drivers/${profileId}/verify`, { status }, { headers });
    setDrivers(p => p.map(d => d.profile_id === profileId ? { ...d, verification_status: status } : d));
    toast(`Dereva: ${status}`);
  };

  const updateUserStatus = async (userId: number, status: 'active' | 'suspended') => {
    await axios.patch(`${ADMIN_API}/admin/users/${userId}/status`, { status }, { headers });
    setUsers(p => p.map(u => u.id === userId ? { ...u, status } : u));
    toast(`Status: ${status}`);
  };

  const deleteUser = async (userId: number, name: string) => {
    if (!confirm(`Futa kabisa akaunti ya ${name}? Hatua hii haiwezi kurudishwa.`)) return;
    await axios.delete(`${ADMIN_API}/admin/users/${userId}`, { headers });
    setUsers(p => p.filter(u => u.id !== userId));
    toast('Mtumiaji amefutwa.');
  };

  const extendCard = async (cardId: unknown, months: number) => {
    try {
      const res = await axios.patch(`${ADMIN_API}/admin/wallet/cards/${cardId}/extend`, { months }, { headers });
      setWalletCards(p => p.map(c => c.id === cardId ? { ...c, ...extractExpiry(res.data.new_expiry) } : c));
      toast(`Kadi imepanuliwa miezi ${months}.`);
    } catch { toast('Imeshindwa kupanua kadi.'); }
  };

  const burnCard = async (cardId: unknown, userName: string) => {
    if (!confirm(`Futa kadi ya ${userName}? Hatua hii haiwezi kurudishwa.`)) return;
    try {
      await axios.delete(`${ADMIN_API}/admin/wallet/cards/${cardId}`, { headers });
      setWalletCards(p => p.filter(c => c.id !== cardId));
      toast('Kadi imefutwa. Mtumiaji amearidhiwa.');
    } catch { toast('Imeshindwa kufuta kadi.'); }
  };

  const createCardForUser = async () => {
    const uid = parseInt(createCardUserId.trim());
    if (!uid || isNaN(uid)) { toast('Ingiza ID ya mtumiaji sahihi.'); return; }
    try {
      const res = await axios.post(`${ADMIN_API}/admin/wallet/cards/user/${uid}`, {}, { headers });
      setWalletCards(p => [res.data, ...p]);
      setShowCreateCard(false); setCreateCardUserId('');
      toast(`Kadi imetengenezwa kwa ${res.data.user_name ?? `User #${uid}`}.`);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast(detail ?? 'Imeshindwa kutengeneza kadi.');
    }
  };

  function extractExpiry(str: string) {
    const [m, y] = str.split('/');
    return { expiry_month: parseInt(m), expiry_year: parseInt(y) };
  }

  const saveEditUser = async () => {
    if (!editUser) return;
    try {
      await axios.patch(`${ADMIN_API}/admin/users/${editUser.id}/profile`, editUserForm, { headers });
      await axios.patch(`${ADMIN_API}/admin/users/${editUser.id}/status`, { status: editUserForm.status }, { headers });
      setUsers(p => p.map(u => u.id === editUser.id ? { ...u, ...editUserForm } : u));
      setEditUser(null); toast('Imehifadhiwa.');
    } catch { toast('Hitilafu ya kuhifadhi.'); }
  };

  const saveEditDriver = async () => {
    if (!editDriver) return;
    try {
      await axios.patch(`${ADMIN_API}/admin/drivers/${editDriver.user_id}/edit`, editDriverForm, { headers });
      setDrivers(p => p.map(d => d.user_id === editDriver.user_id ? { ...d, ...editDriverForm } : d));
      setEditDriver(null); toast('Imehifadhiwa.');
    } catch { toast('Hitilafu ya kuhifadhi.'); }
  };

  const saveEditTrip = async () => {
    if (!editTrip) return;
    try {
      await axios.patch(`${ADMIN_API}/admin/trips/${editTrip.id}/edit`, editTripForm, { headers });
      setTrips(p => p.map(t => t.id === editTrip.id ? { ...t, ...editTripForm } : t));
      setEditTrip(null); toast('Imehifadhiwa.');
    } catch { toast('Hitilafu ya kuhifadhi.'); }
  };

  const doResetPassword = async () => {
    if (!resetPwdUser || newPassword.length < 6) { toast('Nywila lazima iwe na herufi 6+'); return; }
    try {
      await axios.post(`${ADMIN_API}/admin/users/${resetPwdUser.id}/reset-password`, { password: newPassword }, { headers });
      setResetPwdUser(null); setNewPassword(''); toast('Nywila imebadilishwa.');
    } catch { toast('Hitilafu ya kubadilisha nywila.'); }
  };

  const saveProfile = () => {
    localStorage.setItem('admin_display_name', profileName);
    localStorage.setItem('admin_email', profileEmail);
    localStorage.setItem('admin_img', profileImg);
    setProfileSaved(true); setTimeout(() => setProfileSaved(false), 2500);
  };

  const thStyle: React.CSSProperties = { padding: '0.6rem 0.875rem', textAlign: 'left', fontWeight: 700, color: '#374151', borderBottom: '2px solid #e5e7eb', fontSize: '0.78rem', background: '#f8fafc', whiteSpace: 'nowrap' };
  const tdStyle: React.CSSProperties = { padding: '0.55rem 0.875rem', fontSize: '0.8rem', borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle' };

  // Redirect to shared login page if not authenticated
  if (!token) return <Navigate to="/login" replace />;

  const navItems = [
    { id: 'stats'   as const, icon: '📊', label: 'Stats'     },
    { id: 'users'   as const, icon: '👥', label: 'Watumiaji' },
    { id: 'trips'   as const, icon: '🏍️', label: 'Safari'    },
    { id: 'drivers' as const, icon: '⚙️', label: 'Madereva'  },
    { id: 'wallet'  as const, icon: '💰', label: 'Wallet'    },
    { id: 'events'  as const, icon: '⚡', label: 'Matukio'   },
    { id: 'profile' as const, icon: '👤', label: 'Profaili'  },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui,sans-serif', paddingBottom: 68 }}>

      {/* Top header — same gradient style as rider/driver */}
      <div style={{ background: 'linear-gradient(135deg,#1e3a5f 0%,#FF6B00 100%)', color: '#fff', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {profileImg
            ? <img src={profileImg} alt="" style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.4)' }} />
            : <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1rem', border: '2px solid rgba(255,255,255,0.3)' }}>{profileName.charAt(0)}</div>
          }
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.92rem', lineHeight: 1.2 }}>🛡️ BodaBoda Admin</div>
            <div style={{ fontSize: '0.68rem', opacity: 0.82, lineHeight: 1.3 }}>{profileName}</div>
          </div>
        </div>
        <button onClick={logout} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 8, padding: '0.38rem 0.8rem', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
          Toka
        </button>
      </div>

      {/* Scrollable content — same max-width + padding as Dashboard panels */}
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '1rem 0.75rem' }}>
        {apiError && <div style={{ color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem' }}>{apiError}</div>}
        {loading && <div style={{ textAlign: 'center', padding: '3rem' }}><div className="spinner" /></div>}

        {/* ── Stats ── */}
        {!loading && tab === 'stats' && stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: '0.75rem' }}>
            <StatCard label="Watumiaji Wote"     value={stats.total_users}           color="#3b82f6" />
            <StatCard label="Warukaji"            value={stats.riders}                color="#8b5cf6" />
            <StatCard label="Madereva"            value={stats.drivers}               color="#f59e0b" />
            <StatCard label="Safari Zote"         value={stats.total_trips}           color="#6b7280" />
            <StatCard label="Safari Hai"          value={stats.active_trips}          color="#FF6B00" />
            <StatCard label="Zilizokamilika"      value={stats.completed_trips}       color="#10b981" />
            <StatCard label="Zilizofutwa"         value={stats.cancelled_trips}       color="#ef4444" />
            <StatCard label="Subiri Uthibitisho"  value={stats.pending_verifications} color="#f59e0b" />
          </div>
        )}

        {/* ── Users ── */}
        {!loading && tab === 'users' && (
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.07)' }}>
            <div style={{ padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Watumiaji ({users.length})</span>
              <ExportBar rows={users as unknown as Record<string,unknown>[]} name="users" />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['#','Jina','Email','Simu','Role','Status','Tarehe','Hatua'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ background: '#fff' }}>
                      <td style={{ ...tdStyle, color: '#9ca3af' }}>{u.id}</td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{u.full_name}</td>
                      <td style={{ ...tdStyle, color: '#64748b' }}>{u.email}</td>
                      <td style={tdStyle}>{u.phone}</td>
                      <td style={tdStyle}><Badge text={u.role} color="#8b5cf6" /></td>
                      <td style={tdStyle}><Badge text={u.status} color="#10b981" /></td>
                      <td style={{ ...tdStyle, color: '#9ca3af' }}>{fmtDate(u.created_at)}</td>
                      <td style={{ ...tdStyle }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button onClick={() => { setEditUser(u); setEditUserForm({ full_name: u.full_name, email: u.email, phone: u.phone ?? '', role: u.role, status: u.status }); }}
                            style={{ background: '#eff6ff', color: '#2563eb', border: 'none', padding: '0.22rem 0.55rem', borderRadius: 5, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>✏️ Edit</button>
                          <button onClick={() => { setResetPwdUser(u); setNewPassword(''); }}
                            style={{ background: '#f5f3ff', color: '#7c3aed', border: 'none', padding: '0.22rem 0.55rem', borderRadius: 5, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>🔑</button>
                          {u.status === 'active'
                            ? <button onClick={() => updateUserStatus(u.id, 'suspended')} style={{ background: '#fef2f2', color: '#dc2626', border: 'none', padding: '0.22rem 0.55rem', borderRadius: 5, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>⛔</button>
                            : <button onClick={() => updateUserStatus(u.id, 'active')} style={{ background: '#f0fdf4', color: '#16a34a', border: 'none', padding: '0.22rem 0.55rem', borderRadius: 5, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>✅</button>}
                          <button onClick={() => deleteUser(u.id, u.full_name)}
                            style={{ background: '#fef2f2', color: '#dc2626', border: 'none', padding: '0.22rem 0.55rem', borderRadius: 5, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Trips ── */}
        {!loading && tab === 'trips' && (
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.07)' }}>
            <div style={{ padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Safari ({trips.length})</span>
              <ExportBar rows={trips as unknown as Record<string,unknown>[]} name="trips" />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['#','Jina','Pickup','Destination','Status','Rider','Tarehe','Hatua'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {trips.map(t => (
                    <tr key={t.id}>
                      <td style={{ ...tdStyle, color: '#9ca3af' }}>{t.id}</td>
                      <td style={{ ...tdStyle, fontWeight: 600, maxWidth: 160 }}>{t.trip_name ?? `#${t.id}`}</td>
                      <td style={{ ...tdStyle, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.pickup_address}</td>
                      <td style={{ ...tdStyle, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.destination_address}</td>
                      <td style={tdStyle}><Badge text={t.status} color="#FF6B00" /></td>
                      <td style={tdStyle}>{t.rider_name}</td>
                      <td style={{ ...tdStyle, color: '#9ca3af' }}>{fmtDate(t.created_at)}</td>
                      <td style={tdStyle}>
                        <button onClick={() => { setEditTrip(t); setEditTripForm({ trip_name: t.trip_name ?? '', status: t.status, pickup_address: t.pickup_address, destination_address: t.destination_address }); }}
                          style={{ background: '#eff6ff', color: '#2563eb', border: 'none', padding: '0.22rem 0.55rem', borderRadius: 5, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>✏️ Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Drivers ── */}
        {!loading && tab === 'drivers' && (
          <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.07)' }}>
            <div style={{ padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f3f4f6' }}>
              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Madereva ({drivers.length})</span>
              <ExportBar rows={drivers as unknown as Record<string,unknown>[]} name="drivers" />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Jina','Simu','Bodaboda','Nambari','Leseni','Uthibitisho','Status','Rating','Hatua'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                <tbody>
                  {drivers.map(d => (
                    <tr key={d.user_id}>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{d.full_name}</td>
                      <td style={tdStyle}>{d.phone}</td>
                      <td style={tdStyle}>{d.vehicle_model}</td>
                      <td style={tdStyle}>{d.plate_number}</td>
                      <td style={{ ...tdStyle, color: '#64748b', fontSize: '0.75rem' }}>{d.license_number}</td>
                      <td style={tdStyle}><Badge text={d.verification_status} color="#10b981" /></td>
                      <td style={tdStyle}>{d.driver_status ?? '—'}</td>
                      <td style={tdStyle}>{d.rating?.toFixed(1) ?? '—'} ⭐</td>
                      <td style={{ ...tdStyle }}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button onClick={() => { setEditDriver(d); setEditDriverForm({ full_name: d.full_name, email: d.email ?? '', phone: d.phone ?? '', vehicle_model: d.vehicle_model ?? '', plate_number: d.plate_number ?? '', license_number: d.license_number ?? '', verification_status: d.verification_status, status: d.driver_status ?? '' }); }}
                            style={{ background: '#eff6ff', color: '#2563eb', border: 'none', padding: '0.22rem 0.55rem', borderRadius: 5, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>✏️ Edit</button>
                          {d.verification_status !== 'VERIFIED' && <button onClick={() => verifyDriver(d.profile_id, 'VERIFIED')} style={{ background: '#f0fdf4', color: '#16a34a', border: 'none', padding: '0.22rem 0.5rem', borderRadius: 5, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>✓</button>}
                          {d.verification_status !== 'REJECTED' && <button onClick={() => verifyDriver(d.profile_id, 'REJECTED')} style={{ background: '#fef2f2', color: '#dc2626', border: 'none', padding: '0.22rem 0.5rem', borderRadius: 5, cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600 }}>✕</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Events ── */}
        {!loading && tab === 'events' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', background: '#fff', padding: '0.5rem', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', width: 'fit-content' }}>
              <button onClick={() => setEvtSubTab('live')} style={{ padding: '0.4rem 1rem', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', background: evtSubTab === 'live' ? '#FF6B00' : 'transparent', color: evtSubTab === 'live' ? '#fff' : '#64748b' }}>
                🔴 Live ({liveEvents.length})
              </button>
              <button onClick={() => setEvtSubTab('history')} style={{ padding: '0.4rem 1rem', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', background: evtSubTab === 'history' ? '#FF6B00' : 'transparent', color: evtSubTab === 'history' ? '#fff' : '#64748b' }}>
                📋 Historia ({histEvents.length})
              </button>
            </div>

            {evtSubTab === 'live' && (
              <div style={{ background: '#0f172a', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.15)' }}>
                <div style={{ padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#e2e8f0' }}>⚡ Matukio ya MQTT (Real-time)</span>
                  <button onClick={() => setLiveEvents([])} style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '0.25rem 0.6rem', borderRadius: 5, cursor: 'pointer', fontSize: '0.72rem' }}>Futa Yote</button>
                </div>
                {liveEvents.length === 0
                  ? <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>Hakuna matukio bado — inangoja MQTT…</div>
                  : <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                    {liveEvents.map((ev, i) => {
                      const payload = ev.payload as Record<string,unknown> | undefined;
                      return (
                        <div key={i} style={{ padding: '0.5rem 1rem', borderBottom: '1px solid #1e293b', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', fontSize: '0.78rem' }}>
                          <div style={{ color: '#64748b', whiteSpace: 'nowrap', paddingTop: 1 }}>{fmtTime(ev.timestamp)}</div>
                          <code style={{ background: '#1e293b', color: '#94a3b8', padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>{ev.topic}</code>
                          <span style={{ fontWeight: 700, color: '#fb923c' }}>{ev.event_type ?? '—'}</span>
                          <span style={{ color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {payload ? Object.entries(payload).filter(([k]) => !['lat','lng'].includes(k)).map(([k,v]) => `${k}:${v}`).join(' · ') : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                }
              </div>
            )}

            {evtSubTab === 'history' && (
              <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.07)' }}>
                <div style={{ padding: '0.75rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f3f4f6' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>📋 Historia ya Matukio ya Safari</span>
                  <ExportBar rows={histEvents as unknown as Record<string,unknown>[]} name="events_history" />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Wakati','Trip #','Jina la Safari','Tukio','Alibadilisha','Rider'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
                    <tbody>
                      {histEvents.length === 0
                        ? <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>Hakuna historia bado.</td></tr>
                        : histEvents.map(ev => (
                          <tr key={ev.id}>
                            <td style={{ ...tdStyle, color: '#9ca3af', whiteSpace: 'nowrap' }}>{fmtDate(ev.timestamp)} {fmtTime(ev.timestamp)}</td>
                            <td style={{ ...tdStyle, color: '#3b82f6', fontWeight: 700 }}>#{ev.trip_id}</td>
                            <td style={{ ...tdStyle, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.trip_name}</td>
                            <td style={tdStyle}><Badge text={ev.event_type} color="#FF6B00" /></td>
                            <td style={{ ...tdStyle, color: '#64748b' }}>{ev.changed_by}</td>
                            <td style={tdStyle}>{ev.rider_name}</td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Wallet Tab ── */}
        {!loading && tab === 'wallet' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
              <div style={{ flex: 1, minWidth: 140, background: 'linear-gradient(135deg,#1e3a5f,#e85d04)', borderRadius: 14, padding: '1rem 1.25rem', color: '#fff' }}>
                <div style={{ fontSize: '0.72rem', opacity: 0.8 }}>Jumla ya 10% (Mapato ya Admin)</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '0.2rem' }}>TSh {adminEarnings.total.toLocaleString()}</div>
              </div>
              <div style={{ flex: 1, minWidth: 110, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 14, padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, color: '#16a34a', fontSize: '1.3rem' }}>{adminEarnings.count}</div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>Safari Zilizolipwa</div>
              </div>
              <div style={{ flex: 1, minWidth: 110, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 14, padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, color: '#2563eb', fontSize: '1.1rem' }}>
                  TSh {adminEarnings.count > 0 ? Math.round(adminEarnings.total / adminEarnings.count).toLocaleString() : 0}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>Wastani/Safari</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.35rem', background: '#fff', padding: '0.4rem', borderRadius: 10, width: 'fit-content', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              {(['earnings','txns','cards'] as const).map(st => (
                <button key={st} onClick={() => setWalletSubTab(st)}
                  style={{ padding: '0.35rem 0.875rem', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem', background: walletSubTab === st ? '#FF6B00' : 'transparent', color: walletSubTab === st ? '#fff' : '#64748b' }}>
                  {st === 'earnings' ? `💰 Mapato (${adminEarnings.count})` : st === 'txns' ? `💸 Miamala (${walletTxns.length})` : `💳 Kadi (${walletCards.length})`}
                </button>
              ))}
            </div>

            {walletSubTab === 'earnings' && (
              <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>Mapato ya Admin (10% kwa kila safari)</div>
                  <ExportBar rows={adminEarnings.earnings} name="admin_earnings" />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>{['#', 'Safari', 'Pickup', 'Destination', 'Nauli Yote', '10% Admin', 'Tarehe'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {adminEarnings.earnings.map((e, i) => (
                        <tr key={String(e.id ?? i)}>
                          <td style={tdStyle}>{String(e.id)}</td>
                          <td style={{ ...tdStyle, color: '#6366f1', fontWeight: 700 }}>{e.trip_id ? `#${e.trip_id}` : '—'}</td>
                          <td style={{ ...tdStyle, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(e.pickup_address ?? '—')}</td>
                          <td style={{ ...tdStyle, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(e.destination_address ?? '—')}</td>
                          <td style={tdStyle}>{e.fare_tzs ? `TSh ${Number(e.fare_tzs).toLocaleString()}` : '—'}</td>
                          <td style={{ ...tdStyle, fontWeight: 700, color: '#16a34a' }}>+TSh {Number(e.amount).toLocaleString()}</td>
                          <td style={{ ...tdStyle, color: '#64748b', whiteSpace: 'nowrap' }}>{e.created_at ? new Date(String(e.created_at)).toLocaleString() : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {walletSubTab === 'txns' && (
              <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>Miamala Yote ya Wallet</div>
                  <ExportBar rows={walletTxns} name="wallet_transactions" />
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>{['#', 'Mtumiaji', 'Simu', 'Aina', 'Kiasi', 'Baada', 'Maelezo', 'Safari', 'Tarehe'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {walletTxns.map((tx, i) => (
                        <tr key={String(tx.id ?? i)}>
                          <td style={tdStyle}>{String(tx.id)}</td>
                          <td style={tdStyle}>{String(tx.user_name ?? '')}</td>
                          <td style={tdStyle}>{String(tx.user_phone ?? '')}</td>
                          <td style={tdStyle}>
                            <span style={{ fontWeight: 700, color: tx.type === 'CREDIT' ? '#16a34a' : '#dc2626' }}>{String(tx.type)}</span>
                          </td>
                          <td style={{ ...tdStyle, fontWeight: 700, color: tx.type === 'CREDIT' ? '#16a34a' : '#dc2626' }}>
                            {tx.type === 'CREDIT' ? '+' : '-'}TSh {Number(tx.amount).toLocaleString()}
                          </td>
                          <td style={tdStyle}>TSh {Number(tx.balance_after).toLocaleString()}</td>
                          <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(tx.description ?? '')}</td>
                          <td style={{ ...tdStyle, color: '#64748b' }}>{tx.trip_id ? `#${tx.trip_id}` : '—'}</td>
                          <td style={{ ...tdStyle, color: '#64748b', whiteSpace: 'nowrap' }}>{tx.created_at ? new Date(String(tx.created_at)).toLocaleString() : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {walletSubTab === 'cards' && (
              <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderBottom: '1px solid #f3f4f6', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>💳 Kadi za Virtual za Watumiaji</div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button onClick={() => { setShowCreateCard(true); setCreateCardUserId(''); }}
                      style={{ background: '#FF6B00', color: '#fff', border: 'none', borderRadius: 7, padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
                      ➕ Unda Kadi
                    </button>
                    <ExportBar rows={walletCards} name="virtual_cards" />
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>{['#', 'Mtumiaji', 'Simu', 'Aina', 'Nambari ya Kadi', 'Tarehe ya Kumalizika', 'Tarehe ya Kutengeneza', 'Vitendo'].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {walletCards.map((c, i) => {
                        const expM = Number(c.expiry_month ?? 0);
                        const expY = Number(c.expiry_year ?? 0);
                        const now = new Date();
                        const isExpired = expY < now.getFullYear() || (expY === now.getFullYear() && expM < now.getMonth() + 1);
                        return (
                          <tr key={String(c.id ?? i)}>
                            <td style={tdStyle}>{String(c.id)}</td>
                            <td style={tdStyle}>{String(c.user_name ?? '')}</td>
                            <td style={tdStyle}>{String(c.user_phone ?? '')}</td>
                            <td style={tdStyle}>{String(c.user_role ?? '')}</td>
                            <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{String(c.card_number ?? '')}</td>
                            <td style={{ ...tdStyle, color: isExpired ? '#ef4444' : '#16a34a', fontWeight: 600 }}>
                              {String(expM).padStart(2,'0')}/{expY}{isExpired ? ' ⚠️' : ''}
                            </td>
                            <td style={{ ...tdStyle, color: '#64748b', whiteSpace: 'nowrap' }}>{c.created_at ? new Date(String(c.created_at)).toLocaleString() : ''}</td>
                            <td style={tdStyle}>
                              <div style={{ display:'flex', gap:'0.3rem' }}>
                                <button onClick={() => extendCard(c.id, 12)} style={{ background:'#dbeafe', color:'#1d4ed8', border:'none', borderRadius:5, padding:'0.25rem 0.5rem', fontSize:'0.72rem', cursor:'pointer', fontWeight:600 }}>+12M</button>
                                <button onClick={() => extendCard(c.id, 24)} style={{ background:'#ede9fe', color:'#7c3aed', border:'none', borderRadius:5, padding:'0.25rem 0.5rem', fontSize:'0.72rem', cursor:'pointer', fontWeight:600 }}>+24M</button>
                                <button onClick={() => burnCard(c.id, String(c.user_name ?? ''))} style={{ background:'#fee2e2', color:'#dc2626', border:'none', borderRadius:5, padding:'0.25rem 0.5rem', fontSize:'0.72rem', cursor:'pointer', fontWeight:600 }}>🔥</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Admin Profile ── */}
        {tab === 'profile' && (
          <div style={{ maxWidth: 440, margin: '0 auto' }}>
            <div style={{ background: '#fff', borderRadius: 14, padding: '1.5rem', boxShadow: '0 1px 8px rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: profileImg ? 'transparent' : '#FF6B00', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, border: '2px solid #e5e7eb' }}>
                  {profileImg ? <img src={profileImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: '#fff', fontWeight: 800, fontSize: '1.5rem' }}>{profileName.charAt(0)}</span>}
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{profileName}</div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b' }}>Msimamizi wa BodaBoda</div>
                </div>
              </div>

              <Input label="Jina la Kuonyesha" value={profileName} onChange={setProfileName} placeholder="Admin" />
              <Input label="Barua Pepe" value={profileEmail} onChange={setProfileEmail} type="email" placeholder="admin@bodaboda.tz" />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#374151' }}>Picha (faili)</label>
                <input type="file" accept="image/*" style={{ fontSize: '0.82rem' }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => setProfileImg(ev.target?.result as string);
                    reader.readAsDataURL(file);
                  }}
                />
                {profileImg && <img src={profileImg} alt="preview" style={{ width: 60, height: 60, borderRadius: '50%', objectFit: 'cover', marginTop: 6, border: '2px solid #e5e7eb' }} onError={e => (e.currentTarget.style.display = 'none')} />}
              </div>

              {profileSaved && <div style={{ color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '0.5rem 0.875rem', fontSize: '0.83rem' }}>✅ Imehifadhiwa!</div>}

              <button onClick={saveProfile} style={{ background: 'linear-gradient(135deg,#1e3a5f,#FF6B00)', color: '#fff', border: 'none', borderRadius: 9, padding: '0.7rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem' }}>
                Hifadhi Taarifa
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav — same style as rider/driver Dashboard */}
      <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: '1px solid #e5e7eb', display: 'flex', zIndex: 100, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {navItems.map(item => (
          <button key={item.id} onClick={() => setTab(item.id)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0.45rem 0.15rem 0.35rem', background: 'none', border: 'none', cursor: 'pointer', color: tab === item.id ? '#FF6B00' : '#9ca3af', minWidth: 0 }}>
            <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>{item.icon}</span>
            <span style={{ fontSize: '0.57rem', marginTop: '0.18rem', fontWeight: tab === item.id ? 700 : 500, lineHeight: 1, whiteSpace: 'nowrap' }}>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Edit User Modal */}
      {editUser && (
        <Modal title={`✏️ Hariri — ${editUser.full_name}`} onClose={() => setEditUser(null)}>
          <Input label="Jina Kamili" value={editUserForm.full_name} onChange={v => setEditUserForm(p => ({ ...p, full_name: v }))} />
          <Input label="Barua Pepe" value={editUserForm.email} onChange={v => setEditUserForm(p => ({ ...p, email: v }))} type="email" />
          <Input label="Nambari ya Simu" value={editUserForm.phone} onChange={v => setEditUserForm(p => ({ ...p, phone: v }))} />
          <Select label="Role" value={editUserForm.role} onChange={v => setEditUserForm(p => ({ ...p, role: v }))} options={[{ value: 'RIDER', label: 'RIDER' }, { value: 'DRIVER', label: 'DRIVER' }]} />
          <Select label="Status" value={editUserForm.status} onChange={v => setEditUserForm(p => ({ ...p, status: v }))} options={[{ value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]} />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={saveEditUser} style={{ flex: 1, padding: '0.65rem', background: '#FF6B00', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Hifadhi</button>
            <button onClick={() => setEditUser(null)} style={{ flex: 1, padding: '0.65rem', background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Funga</button>
          </div>
        </Modal>
      )}

      {/* Edit Driver Modal */}
      {editDriver && (
        <Modal title={`✏️ Hariri Dereva — ${editDriver.full_name}`} onClose={() => setEditDriver(null)}>
          <Input label="Jina Kamili" value={editDriverForm.full_name} onChange={v => setEditDriverForm(p => ({ ...p, full_name: v }))} />
          <Input label="Barua Pepe" value={editDriverForm.email} onChange={v => setEditDriverForm(p => ({ ...p, email: v }))} type="email" />
          <Input label="Nambari ya Simu" value={editDriverForm.phone} onChange={v => setEditDriverForm(p => ({ ...p, phone: v }))} />
          <Input label="Aina ya Bodaboda" value={editDriverForm.vehicle_model} onChange={v => setEditDriverForm(p => ({ ...p, vehicle_model: v }))} placeholder="Bajaj Boxer 150" />
          <Input label="Nambari ya Sahani" value={editDriverForm.plate_number} onChange={v => setEditDriverForm(p => ({ ...p, plate_number: v }))} placeholder="T 123 ABC" />
          <Input label="Nambari ya Leseni" value={editDriverForm.license_number} onChange={v => setEditDriverForm(p => ({ ...p, license_number: v }))} />
          <Select label="Uthibitisho" value={editDriverForm.verification_status} onChange={v => setEditDriverForm(p => ({ ...p, verification_status: v }))} options={[{ value: 'PENDING', label: 'PENDING' }, { value: 'VERIFIED', label: 'VERIFIED' }, { value: 'REJECTED', label: 'REJECTED' }]} />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={saveEditDriver} style={{ flex: 1, padding: '0.65rem', background: '#FF6B00', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Hifadhi</button>
            <button onClick={() => setEditDriver(null)} style={{ flex: 1, padding: '0.65rem', background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Funga</button>
          </div>
        </Modal>
      )}

      {/* Edit Trip Modal */}
      {editTrip && (
        <Modal title={`✏️ Hariri Safari #${editTrip.id}`} onClose={() => setEditTrip(null)}>
          <Input label="Jina la Safari" value={editTripForm.trip_name} onChange={v => setEditTripForm(p => ({ ...p, trip_name: v }))} />
          <Select label="Status" value={editTripForm.status} onChange={v => setEditTripForm(p => ({ ...p, status: v }))} options={['SEARCHING_DRIVER','DRIVER_ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS','COMPLETED','CANCELLED'].map(s => ({ value: s, label: s }))} />
          <Input label="Mahali pa Kuanzia" value={editTripForm.pickup_address} onChange={v => setEditTripForm(p => ({ ...p, pickup_address: v }))} />
          <Input label="Mahali pa Kwenda" value={editTripForm.destination_address} onChange={v => setEditTripForm(p => ({ ...p, destination_address: v }))} />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={saveEditTrip} style={{ flex: 1, padding: '0.65rem', background: '#FF6B00', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Hifadhi</button>
            <button onClick={() => setEditTrip(null)} style={{ flex: 1, padding: '0.65rem', background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Funga</button>
          </div>
        </Modal>
      )}

      {/* Create Card Modal */}
      {showCreateCard && (
        <Modal title="💳 Unda Kadi ya Virtual" onClose={() => setShowCreateCard(false)}>
          <p style={{ fontSize: '0.83rem', color: '#64748b', margin: 0 }}>
            Ingiza ID ya mtumiaji (unaweza kuona kwenye jedwali la Watumiaji). Kadi mpya itatengenezwa na mtumiaji ataarifiwa.
          </p>
          <Input label="User ID" value={createCardUserId} onChange={setCreateCardUserId} placeholder="e.g. 42" />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={createCardForUser} style={{ flex: 1, padding: '0.65rem', background: '#FF6B00', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Unda</button>
            <button onClick={() => setShowCreateCard(false)} style={{ flex: 1, padding: '0.65rem', background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Funga</button>
          </div>
        </Modal>
      )}

      {/* Reset Password Modal */}
      {resetPwdUser && (
        <Modal title={`🔑 Nywila Mpya — ${resetPwdUser.full_name}`} onClose={() => setResetPwdUser(null)}>
          <Input label="Nywila Mpya (min 6)" value={newPassword} onChange={setNewPassword} type="password" placeholder="••••••••" />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={doResetPassword} style={{ flex: 1, padding: '0.65rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Badilisha</button>
            <button onClick={() => setResetPwdUser(null)} style={{ flex: 1, padding: '0.65rem', background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Funga</button>
          </div>
        </Modal>
      )}

      {/* Toast */}
      {actionMsg && (
        <div onClick={() => setActionMsg('')} style={{ position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', background: '#1e3a5f', color: '#fff', padding: '0.75rem 1.5rem', borderRadius: 10, fontSize: '0.85rem', zIndex: 2000, cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.2)', whiteSpace: 'nowrap' }}>
          {actionMsg}
        </div>
      )}
    </div>
  );
}
