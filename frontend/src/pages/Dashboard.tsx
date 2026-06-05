import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { flushSync, createPortal } from 'react-dom';
import { AxiosError } from 'axios';
import L from 'leaflet';
import { useAuth } from '../context/AuthContext';
import api, { driverApi } from '../api/axios';
import { useMqtt, type MqttEvent } from '../hooks/useMqtt';
import Alert from '../components/Alert';
import RideMap, { type MapLocation } from '../components/RideMap';
import { User, Trip, DriverOut, UserNotification } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function fmtChatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  if (isYest) return `Yesterday ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

type Tab =
  | 'home' | 'settings' | 'profile' | 'edit-account' | 'edit-profile'
  | 'request-ride' | 'my-trips'
  | 'offer-history'
  | 'notifications'
  | 'wallet';

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


function extractApiError(err: unknown): string {
  const error = err as AxiosError<unknown>;
  if (!error.response) return 'Seva haijibu. Angalia muunganiko wako.';
  const status = error.response.status;
  const data = error.response.data;
  if (typeof data === 'object' && data !== null) {
    const d = data as { detail?: unknown; message?: string };
    if (typeof d.detail === 'string') return d.detail;
    if (Array.isArray(d.detail)) return (d.detail as { msg: string }[]).map(x => x.msg).join(', ');
    if (typeof d.message === 'string') return d.message;
  }
  if (status === 500) return 'Hitilafu ya seva (500). Tafadhali jaribu tena.';
  if (status === 404) return 'Rasilimali haikupatikana.';
  if (status === 401 || status === 403) return 'Huna ruhusa.';
  return `Hitilafu (${status}). Tafadhali jaribu tena.`;
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

// ── Leaflet icons (shared) ────────────────────────────────────────────
const bodaIcon = L.divIcon({ html: '🏍️', className: '', iconSize: [28, 28], iconAnchor: [14, 14] });
const greenDot = L.divIcon({ html: '<div style="width:14px;height:14px;background:#10b981;border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px #10b98180"></div>', className: '', iconSize: [14, 14], iconAnchor: [7, 7] });
const redDot   = L.divIcon({ html: '<div style="width:14px;height:14px;background:#ef4444;border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px #ef444480"></div>', className: '', iconSize: [14, 14], iconAnchor: [7, 7] });
const youDot   = L.divIcon({ html: '<div style="width:16px;height:16px;background:#3b82f6;border:2.5px solid #fff;border-radius:50%;box-shadow:0 0 6px #3b82f680"></div>', className: '', iconSize: [16, 16], iconAnchor: [8, 8] });

// ── Shared map helper ─────────────────────────────────────────────────
function initTileMap(el: HTMLDivElement, center: [number, number], zoom = 14): L.Map {
  const map = L.map(el, { center, zoom, zoomControl: false, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  return map;
}

// ── Trip Live Map — RIDER sees boda coming ────────────────────────────
function TripLiveMap({ trip, driverId, onPos, trackingMode }: {
  trip: Trip;
  driverId: number | null;
  onPos?: (p: {lat:number;lng:number}|null) => void;
  trackingMode?: boolean;
}) {
  const mapRef        = useRef<HTMLDivElement>(null);
  const mapObjRef     = useRef<L.Map | null>(null);
  const markerRef     = useRef<L.Marker | null>(null);
  const routeLineRef  = useRef<L.Polyline | null>(null);
  const simRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const [realPos, setRealPos]   = useState<{ lat: number; lng: number } | null>(null);
  const [simPos,  setSimPos]    = useState<{ lat: number; lng: number } | null>(null);

  const pLat = trip.pickup_lat, pLng = trip.pickup_lng;
  const dLat = trip.destination_lat, dLng = trip.destination_lng;

  // Subscribe to real driver location via MQTT
  const locTopics = driverId ? [`driver/${driverId}/location`] : [];
  useMqtt(locTopics, useCallback((event: MqttEvent) => {
    if (event.event_type === 'DRIVER_LOCATION') {
      const p = event.payload as Record<string, unknown>;
      setRealPos({ lat: Number(p.lat), lng: Number(p.lng) });
    }
  }, []));

  // Start simulation when driver ID known but no real GPS yet
  useEffect(() => {
    if (!driverId || !pLat || !pLng || realPos) return;
    const angle = Math.random() * 2 * Math.PI;
    const offset = 0.02;
    let cur = { lat: pLat + offset * Math.sin(angle), lng: pLng + offset * Math.cos(angle) };
    setSimPos(cur);
    simRef.current = setInterval(() => {
      cur = { lat: cur.lat + (pLat - cur.lat) * 0.06, lng: cur.lng + (pLng - cur.lng) * 0.06 };
      setSimPos({ ...cur });
      if (haversineKm(cur.lat, cur.lng, pLat, pLng) < 0.04) {
        clearInterval(simRef.current!); simRef.current = null;
      }
    }, 2500);
    return () => { if (simRef.current) { clearInterval(simRef.current); simRef.current = null; } };
  }, [driverId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop simulation when real GPS arrives
  useEffect(() => {
    if (realPos && simRef.current) { clearInterval(simRef.current); simRef.current = null; setSimPos(null); }
  }, [realPos]);

  const effectivePos = realPos ?? simPos;

  // Notify parent of position
  useEffect(() => { onPos?.(effectivePos ?? null); }, [effectivePos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Init map
  useEffect(() => {
    if (!mapRef.current || mapObjRef.current || !pLat || !pLng) return;
    const map = initTileMap(mapRef.current, [pLat, pLng]);
    L.marker([pLat, pLng], { icon: greenDot }).addTo(map).bindPopup('📍 Pickup yako');
    if (dLat && dLng) {
      L.marker([dLat, dLng], { icon: redDot }).addTo(map).bindPopup('🏁 Destination');
      map.fitBounds([[pLat, pLng], [dLat, dLng]], { padding: [50, 50] });
    }
    mapObjRef.current = map;
    return () => { map.remove(); mapObjRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Move boda marker + draw route line to pickup
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map || !effectivePos || !pLat || !pLng) return;
    if (markerRef.current) {
      markerRef.current.setLatLng([effectivePos.lat, effectivePos.lng]);
    } else {
      markerRef.current = L.marker([effectivePos.lat, effectivePos.lng], { icon: bodaIcon }).addTo(map);
    }
    // Route line from driver → pickup
    if (routeLineRef.current) {
      routeLineRef.current.setLatLngs([[effectivePos.lat, effectivePos.lng], [pLat, pLng]]);
    } else {
      routeLineRef.current = L.polyline([[effectivePos.lat, effectivePos.lng], [pLat, pLng]], {
        color: '#FF6B00', weight: 3, dashArray: '8 5', opacity: 0.85,
      }).addTo(map);
    }
    if (trackingMode) {
      map.fitBounds([[effectivePos.lat, effectivePos.lng], [pLat, pLng]], { padding: [60, 60], maxZoom: 16 });
    } else if (!realPos) {
      map.panTo([effectivePos.lat, effectivePos.lng], { animate: true, duration: 1 });
    }
  }, [effectivePos]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pLat || !pLng) return null;

  const dist = effectivePos ? haversineKm(effectivePos.lat, effectivePos.lng, pLat, pLng) : null;
  const eta  = dist ? Math.max(1, Math.round(dist / 25 * 60)) : null;

  if (trackingMode) {
    return <div ref={mapRef} className="tlm-tracking-canvas" />;
  }

  return (
    <div className="trip-live-map-wrap">
      <div ref={mapRef} className="trip-live-map" />
      {dist !== null && eta !== null ? (
        <div className="tlm-eta-row">
          <span className="tlm-eta-item">🏍️ {dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`} away</span>
          <span className="tlm-eta-item">⏱ ETA ~{eta} min</span>
          {!realPos && <span className="tlm-eta-item tlm-sim">● simulation</span>}
        </div>
      ) : (
        <div className="tlm-waiting">Inasubiri nafasi ya driver…</div>
      )}
    </div>
  );
}

// ── Driver Live Map — DRIVER sees rider's pickup ───────────────────────
function DriverLiveMap({ trip }: { trip: Trip }) {
  const mapRef    = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<L.Map | null>(null);
  const myMarkerRef = useRef<L.Marker | null>(null);
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);

  const pLat = trip.pickup_lat, pLng = trip.pickup_lng;

  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      ({ coords }) => setMyPos({ lat: coords.latitude, lng: coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => {
    if (!mapRef.current || mapObjRef.current || !pLat || !pLng) return;
    const map = initTileMap(mapRef.current, [pLat, pLng]);
    L.marker([pLat, pLng], { icon: greenDot }).addTo(map).bindPopup('📍 Pickup ya abiria');
    mapObjRef.current = map;
    return () => { map.remove(); mapObjRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapObjRef.current;
    if (!map || !myPos) return;
    if (myMarkerRef.current) {
      myMarkerRef.current.setLatLng([myPos.lat, myPos.lng]);
    } else {
      myMarkerRef.current = L.marker([myPos.lat, myPos.lng], { icon: youDot }).addTo(map).bindPopup('Wewe');
    }
    if (pLat && pLng) map.fitBounds([[myPos.lat, myPos.lng], [pLat, pLng]], { padding: [30, 30], maxZoom: 16 });
  }, [myPos]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pLat || !pLng) return null;

  const dist = myPos ? haversineKm(myPos.lat, myPos.lng, pLat, pLng) : null;
  const eta  = dist ? Math.max(1, Math.round(dist / 25 * 60)) : null;

  return (
    <div className="trip-live-map-wrap">
      <div ref={mapRef} className="trip-live-map" />
      {dist !== null && eta !== null ? (
        <div className="tlm-eta-row">
          <span className="tlm-eta-item">📍 Pickup {dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`}</span>
          <span className="tlm-eta-item">⏱ ~{eta} min</span>
        </div>
      ) : (
        <div className="tlm-waiting">Inasubiri GPS yako… Ruhusu location kwenye browser</div>
      )}
    </div>
  );
}

// ── 5-Step Tracking Progress Bar ─────────────────────────────────────
const TRACK_STEPS = ['Received','Accepted','On the way','Arriving','Completed'];

function getTrackIdx(status: string, approaching = false): number {
  if (approaching) return 3;
  const m: Record<string,number> = {
    SEARCHING_DRIVER:    0,
    DRIVER_ASSIGNED:     1,
    IN_PROGRESS:         2,
    DRIVER_ARRIVED:      3,
    COMPLETED:           4,
    NO_DRIVER_AVAILABLE: 0,
    CANCELLED:           0,
  };
  return m[status] ?? 0;
}

function TrackSteps({ status, approaching = false }: { status: string; approaching?: boolean }) {
  const activeIdx = getTrackIdx(status, approaching);
  return (
    <div className="track-steps">
      {TRACK_STEPS.map((label, i) => (
        <div key={label} className="track-step-group">
          <div className="track-step">
            <div className={`track-dot${i < activeIdx ? ' done' : i === activeIdx ? ' active' : ''}`} />
            <span className={`track-label${i <= activeIdx ? ' lit' : ''}`}>{label}</span>
          </div>
          {i < TRACK_STEPS.length - 1 && (
            <div className={`track-line${i < activeIdx ? ' done' : ''}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Pagination helper ─────────────────────────────────────────────────
const PAGE_SIZE = 10;
function Paginator({ total, page, onPage }: { total: number; page: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', margin: '0.75rem 0 0.25rem' }}>
      <button className="btn btn-ghost btn-sm" onClick={() => onPage(page - 1)} disabled={page === 0} style={{ minWidth: 70 }}>← Nyuma</button>
      <span style={{ fontSize: '0.82rem', color: '#64748b' }}>{page + 1} / {pages}</span>
      <button className="btn btn-ghost btn-sm" onClick={() => onPage(page + 1)} disabled={page >= pages - 1} style={{ minWidth: 70 }}>Mbele →</button>
    </div>
  );
}

// ── Trip Chat (MQTT — Rider ↔ Driver) ─────────────────────────────────
type ChatMsg = {
  id?: number | string;
  sender: string;
  senderName: string;
  message: string;
  image_url?: string;
  time: string;
  read_at?: string | null;
};

const chatKey = (id: number) => `boda_chat_${id}`;

function loadChat(tripId: number): ChatMsg[] {
  try { return JSON.parse(localStorage.getItem(chatKey(tripId)) ?? '[]'); } catch { return []; }
}
function saveChat(tripId: number, msgs: ChatMsg[]) {
  try { localStorage.setItem(chatKey(tripId), JSON.stringify(msgs)); } catch {}
}

function TripChat({ tripId, myRole, onNewMessage }: { tripId: number; myRole: 'RIDER' | 'DRIVER'; myName: string; onNewMessage?: (text?: string) => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [wsState, setWsState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load history from API
  useEffect(() => {
    api.get<ChatMsg[]>(`/chat/${tripId}/history`).then(({ data }) => {
      setMessages(data.map(m => ({
        id: m.id,
        sender: (m as unknown as Record<string, string>).role,
        senderName: (m as unknown as Record<string, string>).name,
        message: (m as unknown as Record<string, string>).text ?? '',
        image_url: m.image_url,
        time: m.time,
        read_at: m.read_at,
      })));
    }).catch(() => setMessages(loadChat(tripId)));
  }, [tripId]);

  useEffect(() => {
    const token = encodeURIComponent(localStorage.getItem('access_token') ?? '');
    const base = ((import.meta.env.VITE_API_BASE_URL as string) || window.location.origin).replace(/^http/, 'ws');
    const ws = new WebSocket(`${base}/ws/chat/${tripId}?token=${token}`);
    wsRef.current = ws;
    ws.onopen  = () => setWsState('open');
    ws.onclose = () => setWsState('closed');
    ws.onerror = () => setWsState('closed');
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data as string);
        if (d.type === 'message') {
          const msg: ChatMsg = { id: d.id, sender: d.role, senderName: d.name, message: d.text ?? '', image_url: d.image_url, time: d.time, read_at: d.read_at };
          setMessages(prev => { const u = [...prev, msg]; saveChat(tripId, u); return u; });
          if (d.role !== myRole) onNewMessage?.(d.text ?? '');
        } else if (d.type === 'deleted') {
          setMessages(prev => prev.filter(m => String(m.id) !== String(d.id)));
        } else if (d.type === 'read_by') {
          setMessages(prev => prev.map(m => m.sender === myRole && !m.read_at ? { ...m, read_at: d.at } : m));
        }
      } catch { /* ignore */ }
    };
    return () => { ws.close(); wsRef.current = null; };
  }, [tripId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text }));
    setInput('');
  };

  const deleteMsg = (msg: ChatMsg) => {
    if (msg.sender !== myRole || !msg.id) return;
    wsRef.current?.send(JSON.stringify({ type: 'delete', id: msg.id }));
    setMessages(prev => prev.filter(m => m.id !== msg.id));
  };

  const groupByDate = (msgs: ChatMsg[]) => {
    const groups: { label: string; msgs: ChatMsg[] }[] = [];
    let lastDate = '';
    for (const m of msgs) {
      const d = new Date(m.time);
      const today = new Date();
      const yest = new Date(); yest.setDate(today.getDate() - 1);
      const label = d.toDateString() === today.toDateString() ? 'Leo' :
                    d.toDateString() === yest.toDateString() ? 'Jana' :
                    d.toLocaleDateString('sw-TZ', { day: 'numeric', month: 'short', year: 'numeric' });
      if (label !== lastDate) { groups.push({ label, msgs: [] }); lastDate = label; }
      groups[groups.length - 1].msgs.push(m);
    }
    return groups;
  };

  return (
    <div className="trip-chat">
      <div className="tc-header">
        💬 Chat — {myRole === 'RIDER' ? 'Dereva' : 'Abiria'}
        <span className={`tc-ws-dot tc-ws-${wsState}`} title={wsState} />
      </div>
      <div className="tc-messages">
        {messages.length === 0
          ? <span className="tc-empty">Hakuna ujumbe bado. Sema hujambo! 👋</span>
          : groupByDate(messages).map((group, gi) => (
              <div key={gi}>
                <div className="tc-date-sep"><span>{group.label}</span></div>
                {group.msgs.map((m, i) => {
                  const isMine = m.sender === myRole;
                  const prevMsg = group.msgs[i - 1];
                  const showName = !isMine && (!prevMsg || prevMsg.sender !== m.sender);
                  const time = new Date(m.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                  const isRead = !!m.read_at;
                  return (
                    <div key={m.id ?? i} className={`tc-msg ${isMine ? 'tc-msg-mine' : 'tc-msg-theirs'}`}>
                      {showName && <span className="tc-msg-name">{m.senderName}</span>}
                      <div className="tc-msg-bubble" onDoubleClick={() => isMine && deleteMsg(m)}>
                        {m.image_url && <img src={m.image_url} alt="attachment" className="tc-msg-img" />}
                        {m.message && <span className="tc-msg-text">{m.message}</span>}
                        <div className="tc-msg-footer">
                          <span className="tc-msg-time">{time}</span>
                          {isMine && (
                            <span className={`tc-ticks ${isRead ? 'tc-ticks-read' : ''}`}>
                              {isRead ? '✓✓' : '✓'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
        }
        <div ref={bottomRef} />
      </div>
      <div className="tc-input-row">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder={wsState === 'open' ? 'Andika ujumbe…' : wsState === 'connecting' ? 'Inaunganisha…' : 'Hakuna muunganiko'}
          disabled={wsState !== 'open'}
        />
        <button className="tc-send-btn" onClick={send} disabled={!input.trim() || wsState !== 'open'}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
      {wsState === 'open' && <div className="tc-hint">Bonyeza mara mbili ujumbe wako kuufuta</div>}
    </div>
  );
}

// ── Chat History (read-only) ──────────────────────────────────────────
// standalone=true: renders just the messages list (used inside overlay)
function TripChatHistory({ tripId, myRole, standalone }: { tripId: number; myRole: 'RIDER' | 'DRIVER'; standalone?: boolean }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => loadChat(tripId));
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMsgs(loadChat(tripId)); }, [tripId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior }); }, [msgs]);

  const msgList = msgs.length === 0
    ? <div className="tch-empty">Hakuna ujumbe kwenye safari hii.</div>
    : msgs.map((m, i) => {
        const isMine = m.sender === myRole;
        const isFirst = i === 0 || msgs[i - 1].sender !== m.sender;
        return (
          <div key={i} className={`tch-msg ${isMine ? 'tch-msg-mine' : 'tch-msg-theirs'}`}>
            {!isMine && isFirst && <span className="tch-sender">{m.senderName}</span>}
            <span className="tch-bubble">
              {m.message}
              <span className="tch-time">{fmtChatTime(m.time)}</span>
            </span>
          </div>
        );
      });

  if (standalone) {
    return <div className="tch-standalone">{msgList}<div ref={bottomRef} /></div>;
  }

  return null; // rendered via overlay from parent
}

// ── Chat Panel (full-screen overlay for My Trips chat) ───────────────

function ChatPanel({ trip, myRole, myName, onClose }: {
  trip: Trip;
  myRole: 'RIDER' | 'DRIVER';
  myName: string;
  onClose: () => void;
}) {
  const isActive = ACTIVE_TRIP_STATUSES.includes(trip.status);
  const initials = (trip.trip_name ?? `T${trip.id}`)
    .replace(/[→·\-–]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w.charAt(0).toUpperCase())
    .join('') || 'T';

  return (
    <div className="trip-chat-panel">
      <div className="tcp-header">
        <button className="tcp-back" onClick={onClose}>←</button>
        <div className="tcp-avatar">{initials}</div>
        <div className="tcp-info">
          <div className="tcp-name">{trip.trip_name ?? `Trip #${trip.id}`}</div>
          <div className="tcp-route">{trip.pickup_address} → {trip.destination_address}</div>
        </div>
        <TripStatusBadge status={trip.status} />
      </div>

      {isActive
        ? <TripChat tripId={trip.id} myRole={myRole} myName={myName} />
        : (
          <>
            <TripChatHistory tripId={trip.id} myRole={myRole} standalone />
            <div className="tcp-readonly-bar">
              🔒 {trip.status === 'CANCELLED' ? 'Safari ilifutwa' : 'Safari imekamilika'} — huwezi kutuma ujumbe
            </div>
          </>
        )
      }
    </div>
  );
}

// ── WebRTC Voice Call ─────────────────────────────────────────────────

type CallState = 'idle' | 'calling' | 'ringing' | 'connected';

function useWebRTCCall(tripId: number | null) {
  const [callState, setCallState] = useState<CallState>('idle');
  const [peerName,  setPeerName]  = useState('');
  const [muted,     setMuted]     = useState(false);
  const [micError,  setMicError]  = useState<string | null>(null);
  const wsRef      = useRef<WebSocket | null>(null);
  const pcRef      = useRef<RTCPeerConnection | null>(null);
  const localRef   = useRef<MediaStream | null>(null);
  const pendingSdp = useRef<string | null>(null);

  useEffect(() => {
    if (!tripId) return;
    const token = encodeURIComponent(localStorage.getItem('access_token') ?? '');
    const base = ((import.meta.env.VITE_API_BASE_URL as string) || window.location.origin).replace(/^http/, 'ws');
    const ws = new WebSocket(`${base}/ws/signal/${tripId}?token=${token}`);
    wsRef.current = ws;

    ws.onmessage = async (e) => {
      try {
        const d = JSON.parse(e.data as string);
        if (d.type === 'call_offer') {
          pendingSdp.current = d.sdp as string;
          setPeerName(d.from_name ?? '');
          setCallState('ringing');
        } else if (d.type === 'call_answer' && pcRef.current) {
          await pcRef.current.setRemoteDescription({ type: 'answer', sdp: d.sdp as string });
          setCallState('connected');
        } else if (d.type === 'ice_candidate' && pcRef.current && d.candidate) {
          await pcRef.current.addIceCandidate(d.candidate as RTCIceCandidateInit).catch(() => {});
        } else if (d.type === 'call_end' || d.type === 'peer_left') {
          _cleanup();
        }
      } catch { /* ignore */ }
    };

    return () => { ws.close(); wsRef.current = null; };
  }, [tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  const _makePC = (stream: MediaStream): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80',             username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443',            username: 'openrelayproject', credential: 'openrelayproject' },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
      ],
    });
    pcRef.current = pc;
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    const audio = new Audio();
    audio.autoplay = true;
    pc.ontrack = e => { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); };
    pc.onicecandidate = e => {
      if (e.candidate) {
        wsRef.current?.send(JSON.stringify({ type: 'ice_candidate', candidate: e.candidate.toJSON() }));
      }
    };
    return pc;
  };

  const _checkSecureCtx = (): boolean => {
    if (!window.isSecureContext || !navigator.mediaDevices) {
      setMicError('Simu inahitaji HTTPS. Fungua https:// badala ya http:// kisha jaribu tena.');
      return false;
    }
    return true;
  };

  const call = async () => {
    if (callState !== 'idle') return;
    if (!_checkSecureCtx()) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localRef.current = stream;
      const pc = _makePC(stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsRef.current?.send(JSON.stringify({ type: 'call_offer', sdp: offer.sdp }));
      setCallState('calling');
    } catch { setMicError('Ruhusu microphone ili kupiga simu ndani ya app.'); }
  };

  const answer = async () => {
    if (!pendingSdp.current) return;
    if (!_checkSecureCtx()) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localRef.current = stream;
      const pc = _makePC(stream);
      await pc.setRemoteDescription({ type: 'offer', sdp: pendingSdp.current });
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      wsRef.current?.send(JSON.stringify({ type: 'call_answer', sdp: ans.sdp }));
      setCallState('connected');
      pendingSdp.current = null;
    } catch { setMicError('Ruhusu microphone ili kujibu simu.'); }
  };

  const reject = () => {
    wsRef.current?.send(JSON.stringify({ type: 'call_end' }));
    pendingSdp.current = null;
    setCallState('idle'); setPeerName('');
  };

  const hangup = () => {
    wsRef.current?.send(JSON.stringify({ type: 'call_end' }));
    _cleanup();
  };

  const toggleMute = () => {
    localRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setMuted(m => !m);
  };

  const _cleanup = () => {
    pcRef.current?.close(); pcRef.current = null;
    localRef.current?.getTracks().forEach(t => t.stop()); localRef.current = null;
    pendingSdp.current = null;
    setCallState('idle'); setMuted(false);
  };

  return { callState, peerName, muted, micError, clearMicError: () => setMicError(null), call, answer, reject, hangup, toggleMute };
}

function VoiceCallUI({ rtc, remoteName }: {
  rtc: ReturnType<typeof useWebRTCCall>;
  remoteName: string;
}) {
  if (rtc.micError) {
    return (
      <div className="call-overlay">
        <div className="call-card">
          <div className="call-mic-icon">🎤</div>
          <div className="call-name">Ruhusa ya Microphone</div>
          <div className="call-mic-msg">{rtc.micError}</div>
          <div className="call-mic-steps">
            {!window.isSecureContext
              ? <>
                  <p>⚠️ Ukurasa huu uko kwenye HTTP</p>
                  <p>Fungua: <strong>https://{window.location.hostname}</strong></p>
                  <p>Kisha kukubali certificate na ujaribu tena</p>
                </>
              : <>
                  <p>1. Gonga icon ya 🔒 kwenye address bar</p>
                  <p>2. Ruhusu Microphone</p>
                  <p>3. Reload ukurasa kisha jaribu tena</p>
                </>
            }
          </div>
          <div className="call-btns">
            <button className="call-btn call-btn-end" onClick={rtc.clearMicError}>Sawa</button>
          </div>
        </div>
      </div>
    );
  }

  if (rtc.callState === 'idle') return null;
  const name = rtc.peerName || remoteName;
  return (
    <div className="call-overlay">
      <div className="call-card">
        <div className="call-avatar">{name.charAt(0).toUpperCase()}</div>
        <div className="call-name">{name}</div>
        <div className="call-status-text">
          {rtc.callState === 'calling'   && <><span className="call-pulse" /> Inapiga simu…</>}
          {rtc.callState === 'ringing'   && <><span className="call-pulse" /> Simu inakuja…</>}
          {rtc.callState === 'connected' && '🟢 Unaongea'}
        </div>
        {rtc.callState === 'ringing' && (
          <div className="call-btns">
            <button className="call-btn call-btn-reject" onClick={rtc.reject}>📵 Kataa</button>
            <button className="call-btn call-btn-answer" onClick={rtc.answer}>📞 Jibu</button>
          </div>
        )}
        {(rtc.callState === 'calling' || rtc.callState === 'connected') && (
          <div className="call-btns">
            {rtc.callState === 'connected' && (
              <button
                className={`call-btn call-btn-mute${rtc.muted ? ' muted' : ''}`}
                onClick={rtc.toggleMute}
                title={rtc.muted ? 'Unmute' : 'Mute'}
              >
                {rtc.muted ? '🔇' : '🎙️'}
              </button>
            )}
            <button className="call-btn call-btn-end" onClick={rtc.hangup}>📵 Maliza</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Current Trip Card (Driver) ─────────────────────────────────────────
// 4-click flow: 1.Accept → 2.Anza Safari → 3.Nakaribia → 4.Nimemaliza

interface CurrentTripCardProps {
  trip: Trip;
  actionLoading: string | null;
  onAction: (action: 'start' | 'complete') => void;
}

function CurrentTripCard({ trip, actionLoading, onAction, driverName }: CurrentTripCardProps & { driverName: string }) {
  const [notifying, setNotifying]       = useState(false);
  const [notifySent, setNotifySent]     = useState(false);
  const [chatOpen, setChatOpen]         = useState(false);
  const [chatUnread, setChatUnread]     = useState(0);
  const [chatToast, setChatToast]         = useState<string | null>(null);
  const [driverPayToast, setDriverPayToast] = useState<string | null>(null);
  const chatToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLocRef = useRef<{ lat: number; lng: number } | null>(null);
  const rtcDriver = useWebRTCCall(trip.id);

  // Keep an MQTT connection alive while trip is active for location publishing
  const isActive = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(trip.status);
  const locTopics = isActive && trip.driver_id ? [`driver/${trip.driver_id}/location`] : [];
  const { publish: publishLoc } = useMqtt(locTopics, useCallback(() => {}, []));
  const { publish: publishStatusEvt } = useMqtt([], useCallback(() => {}, []));

  // Payment notification for driver
  useMqtt([`rides/${trip.id}/payment`], useCallback((event: MqttEvent) => {
    if (event.event_type === 'PAYMENT_DONE') {
      const p = event.payload as Record<string, unknown>;
      if (String(p.for_role) === 'DRIVER') {
        const amount = Number(p.amount);
        setDriverPayToast(`💰 TSh ${amount.toLocaleString()} imeingizwa mkobani`);
        setTimeout(() => setDriverPayToast(null), 6000);
      }
    }
  }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  // Continuous real GPS tracking cached in a ref — used by all action events
  const realGpsRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      ({ coords }) => { realGpsRef.current = { lat: coords.latitude, lng: coords.longitude }; },
      () => { /* denied — keep null */ },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Periodic GPS broadcast every 5s while trip is active
  useEffect(() => {
    const isActive = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(trip.status);
    if (!isActive || !trip.driver_id) return;

    const id = setInterval(() => {
      if (!realGpsRef.current) return; // don't send 0,0
      const { lat, lng } = realGpsRef.current;
      publishLoc(`driver/${trip.driver_id}/location`, {
        event_id:   `loc_periodic_${Date.now()}`,
        event_type: 'DRIVER_LOCATION',
        timestamp:  new Date().toISOString(),
        version:    '1.0',
        payload:    { lat, lng, driver_id: trip.driver_id, trip_id: trip.id },
      });
      // Also update REST endpoint silently
      driverApi.post('/driver/location', { trip_id: trip.id, lat, lng }).catch(() => {});
    }, 5000);

    return () => clearInterval(id);
  }, [trip.status, trip.id, trip.driver_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // GPS for action events — uses cached realGpsRef, falls back to trip coords only if GPS never arrived
  const getSmartCoords = useCallback((_eventType: string): Promise<{ lat: number; lng: number; address?: string }> => {
    if (realGpsRef.current) {
      return Promise.resolve({ lat: realGpsRef.current.lat, lng: realGpsRef.current.lng });
    }
    const pLat = trip.pickup_lat ?? -6.168, pLng = trip.pickup_lng ?? 35.751;
    const fallback = { lat: pLat, lng: pLng, address: trip.pickup_address };
    if (!navigator.geolocation) return Promise.resolve(fallback);
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(fallback), 5000);
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          clearTimeout(timer);
          realGpsRef.current = { lat: coords.latitude, lng: coords.longitude };
          resolve({ lat: coords.latitude, lng: coords.longitude });
        },
        () => { clearTimeout(timer); resolve(fallback); },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    });
  }, [trip.pickup_lat, trip.pickup_lng, trip.pickup_address]); // eslint-disable-line react-hooks/exhaustive-deps

  const publishGpsOnAction = useCallback(async (eventType: string) => {
    const driverId = trip.driver_id;
    if (!driverId) return;
    const { lat, lng, address } = await getSmartCoords(eventType);
    prevLocRef.current = { lat, lng };
    publishLoc(`driver/${driverId}/location`, {
      event_id:   `loc_${Date.now()}`,
      event_type: 'DRIVER_LOCATION',
      timestamp:  new Date().toISOString(),
      version:    '1.0',
      payload:    { lat, lng, address, driver_id: driverId, trip_id: trip.id, action: eventType },
    });
    driverApi.post('/driver/location', { trip_id: trip.id, lat, lng }).catch(() => {});
  }, [trip.id, trip.driver_id, getSmartCoords]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset notify badge when trip status changes (new stage)
  useEffect(() => { setNotifySent(false); }, [trip.status]);

  const sendNakaribia = async () => {
    setNotifying(true);
    try {
      await driverApi.post(`/driver/trips/${trip.id}/approaching`);
      setNotifySent(true);
      const { lat, lng, address } = await getSmartCoords('DRIVER_APPROACHING');
      prevLocRef.current = { lat, lng };
      publishStatusEvt(`rides/${trip.id}/status`, {
        event_id:   `approaching_${Date.now()}`,
        event_type: 'DRIVER_APPROACHING',
        timestamp:  new Date().toISOString(),
        version:    '1.0',
        payload:    { trip_id: trip.id, driver_id: trip.driver_id, driver_name: driverName, lat, lng, address },
      });
      publishLoc(`driver/${trip.driver_id}/location`, {
        event_id:   `loc_approaching_${Date.now()}`,
        event_type: 'DRIVER_LOCATION',
        timestamp:  new Date().toISOString(),
        version:    '1.0',
        payload:    { lat, lng, address, driver_id: trip.driver_id, trip_id: trip.id, action: 'DRIVER_APPROACHING' },
      });
    } catch {}
    setNotifying(false);
  };

  return (
    <div className="current-trip-card">
      <div className="ctc-head">
        <span className="ctc-title">🏍️ {trip.trip_name ?? `Trip #${trip.id}`}</span>
        <TripStatusBadge status={trip.status} />
      </div>

      {/* Map — guide driver to pickup */}
      {trip.status === 'DRIVER_ASSIGNED' && <DriverLiveMap trip={trip} />}

      {/* Route */}
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

      {/* Chat & Call row */}
      <div className="ctc-chat-row">
        <button
          className={`ctc-chat-toggle${chatOpen ? ' active' : ''}`}
          onClick={() => { setChatOpen(o => !o); setChatUnread(0); }}
          style={{ position: 'relative' }}
        >
          💬 Chat na Abiria {chatOpen ? '▲' : '▼'}
          {chatUnread > 0 && (
            <span style={{ position:'absolute', top:'-6px', right:'-6px', background:'#ef4444', color:'#fff', borderRadius:'99px', fontSize:'0.65rem', fontWeight:700, minWidth:'18px', height:'18px', display:'flex', alignItems:'center', justifyContent:'center', padding:'0 4px', lineHeight:1 }}>
              {chatUnread > 9 ? '9+' : chatUnread}
            </span>
          )}
        </button>
        <button
          className={`ctc-call-btn${rtcDriver.callState !== 'idle' ? ' ring' : ''}`}
          onClick={() => {
            if (window.location.protocol === 'https:') {
              rtcDriver.call();
            } else {
              trip.rider_phone ? (window.location.href = 'tel:' + trip.rider_phone) : alert('Inahitaji HTTPS kupiga simu ndani ya app.');
            }
          }}
          title="Piga simu"
        >
          📞 Piga Simu
        </button>
      </div>
      {/* Chat message toast — shows sender's text like WhatsApp */}
      {chatToast && (
        <div style={{
          position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: '#1e293b', color: '#fff', borderRadius: 12, padding: '0.6rem 1rem',
          fontSize: '0.88rem', fontWeight: 600, zIndex: 900, maxWidth: '90vw',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          💬 Abiria: {chatToast}
        </div>
      )}

      {/* Payment notification toast for driver */}
      {driverPayToast && (
        <div style={{
          position: 'fixed', top: chatToast ? 72 : 16, left: '50%', transform: 'translateX(-50%)',
          background: 'linear-gradient(135deg, #1a3a1a, #2d6a2d)', color: '#fff', borderRadius: 12,
          padding: '0.6rem 1rem', fontSize: '0.88rem', fontWeight: 700, zIndex: 901, maxWidth: '90vw',
          boxShadow: '0 4px 20px rgba(0,100,0,0.4)',
        }}>
          {driverPayToast}
        </div>
      )}
      <div style={{ display: chatOpen ? undefined : 'none' }}>
        <TripChat tripId={trip.id} myRole="DRIVER" myName={driverName} onNewMessage={(text?: string) => {
          if (!chatOpen) {
            setChatUnread(c => c + 1);
            if (text) {
              setChatToast(text.length > 60 ? text.slice(0, 60) + '…' : text);
              if (chatToastTimer.current) clearTimeout(chatToastTimer.current);
              chatToastTimer.current = setTimeout(() => setChatToast(null), 4000);
            }
          }
        }} />
      </div>

      {/* ── Buttons: exactly what matches the current status ── */}
      <div className="ctc-actions">

        {/* STEP 2 of 4: Anza Safari */}
        {(trip.status === 'DRIVER_ASSIGNED' || trip.status === 'DRIVER_ARRIVED') && (
          <button className="btn btn-primary btn-block" onClick={() => { publishGpsOnAction('RIDE_STARTED'); onAction('start'); }} disabled={!!actionLoading}>
            {actionLoading === 'start' ? <><span className="btn-spinner" /> Inaanza…</> : '🚀 Anza Safari'}
          </button>
        )}

        {/* STEP 3 of 4: Nakaribia (notify rider) */}
        {trip.status === 'IN_PROGRESS' && (
          <button className="btn btn-ghost btn-block" onClick={() => { publishGpsOnAction('DRIVER_APPROACHING'); sendNakaribia(); }} disabled={notifying || notifySent}>
            {notifying ? <><span className="btn-spinner" /> Inatuma…</> : notifySent ? '✓ Rider amejulishwa' : '📡 Nakaribia'}
          </button>
        )}

        {/* STEP 4 of 4: Nimemaliza */}
        {trip.status === 'IN_PROGRESS' && (
          <button className="btn btn-navy btn-block" onClick={() => { publishGpsOnAction('RIDE_COMPLETED'); onAction('complete'); }} disabled={!!actionLoading}>
            {actionLoading === 'complete' ? <><span className="btn-spinner" /> Inakamilisha…</> : '✓ Nimemaliza'}
          </button>
        )}

      </div>
      <VoiceCallUI rtc={rtcDriver} remoteName="Abiria" />
    </div>
  );
}

// ── Driver Home Panel ──────────────────────────────────────────────────

function DriverHomePanel() {
  const [driver, setDriver]               = useState<DriverOut | null>(null);
  const [loading, setLoading]             = useState(true);
  const [toggling, setToggling]           = useState(false);
  const [incomingTrip, setIncomingTrip]   = useState<Trip | null>(null);
  const [currentTrip, setCurrentTrip]     = useState<Trip | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [msg, setMsg]                     = useState('');
  const [msgType, setMsgType]             = useState<'success' | 'error'>('success');
  const [error, setError]                 = useState('');
  const [completedTripId, setCompletedTripId] = useState<number | null>(null);
  const [driverPayToast, setDriverPayToast]   = useState<string | null>(null);

  const { publish: publishStatus } = useMqtt([], useCallback(() => {}, []));

  const lastGpsRef = useRef<{ lat: number; lng: number; address: string }>({ lat: -6.168, lng: 35.751, address: '' });

  // Track driver's real GPS and do reverse geocoding for address
  useEffect(() => {
    if (!navigator.geolocation) return;
    const geoId = navigator.geolocation.watchPosition(
      async ({ coords }) => {
        const lat = coords.latitude, lng = coords.longitude;
        lastGpsRef.current = { lat, lng, address: lastGpsRef.current.address };
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=sw`);
          const d = await r.json() as { display_name?: string; address?: { road?: string; suburb?: string; city?: string; town?: string; village?: string } };
          const a = d.address;
          const name = [a?.road, a?.suburb ?? a?.village ?? a?.town ?? a?.city].filter(Boolean).join(', ');
          lastGpsRef.current = { lat, lng, address: name || d.display_name?.split(',').slice(0, 2).join(', ') || '' };
        } catch { /* keep previous address */ }
      },
      () => { /* GPS denied — keep default */ },
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(geoId);
  }, []);

  const publishGpsEvent = useCallback(async (topic: string, eventType: string, extraPayload?: Record<string, unknown>) => {
    let { lat, lng, address } = lastGpsRef.current;
    if (!address && lat && lng) {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=sw`);
        const d = await r.json() as { display_name?: string; address?: { road?: string; suburb?: string; city?: string; town?: string; village?: string } };
        const a = d.address;
        address = [a?.road, a?.suburb ?? a?.village ?? a?.town ?? a?.city].filter(Boolean).join(', ')
               || d.display_name?.split(',').slice(0, 2).join(', ') || '';
        if (address) lastGpsRef.current = { lat, lng, address };
      } catch { /* publish without address */ }
    }
    publishStatus(topic, {
      event_id:   `${eventType}_${Date.now()}`,
      event_type: eventType,
      timestamp:  new Date().toISOString(),
      version:    '1.0',
      payload:    { lat, lng, address, ...extraPayload },
    });
  }, [publishStatus]);

  const refreshDriver = useCallback(async (): Promise<DriverOut | null> => {
    try {
      const { data } = await driverApi.get<DriverOut>('/driver/me');
      setDriver(data);
      return data;
    } catch {}
    return null;
  }, []);

  // Init
  useEffect(() => {
    (async () => {
      try {
        // sync-me in service 1 ensures driver record exists
        await api.post('/drivers/sync-me');
        const { data } = await driverApi.get<DriverOut>('/driver/me');
        setDriver(data);
        if (data.status === 'BUSY') {
          const trips = await driverApi.get<Trip[]>('/driver/trips/my');
          const active = trips.data.find(t => ['DRIVER_ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS'].includes(t.status));
          if (active) setCurrentTrip(active);
        }
      } catch {
        setError('Imeshindwa kupakia driver data. Refresh.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // When DriverOfferWatcher accepts a trip via its modal, sync state here immediately
  useEffect(() => {
    const handler = async (e: Event) => {
      const { trip } = (e as CustomEvent<{ tripId: number; trip?: Trip }>).detail;
      if (trip) setCurrentTrip(trip);
      const updated = await refreshDriver();
      if (!trip && updated?.status === 'BUSY') {
        try {
          const { data: trips } = await driverApi.get<Trip[]>('/driver/trips/my');
          const active = trips.find(t => ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(t.status));
          if (active) setCurrentTrip(active);
        } catch { /* silent */ }
      }
    };
    window.addEventListener('driver-trip-accepted', handler);
    return () => window.removeEventListener('driver-trip-accepted', handler);
  }, [refreshDriver]);

  // Panel-level payment subscription — active DURING trip so it's ready before backend publishes
  const activeTripId = currentTrip?.id ?? completedTripId;
  const payTopic = activeTripId ? [`rides/${activeTripId}/payment`] : [];
  useMqtt(payTopic, useCallback((event: MqttEvent) => {
    if (event.event_type === 'PAYMENT_DONE') {
      const p = event.payload as Record<string, unknown>;
      if (String(p.for_role) === 'DRIVER') {
        const amount = Number(p.amount);
        setDriverPayToast(`💰 TSh ${amount.toLocaleString()} imeingizwa mkobani`);
        setTimeout(() => setDriverPayToast(null), 7000);
        setTimeout(() => setCompletedTripId(null), 10000);
      }
    }
  }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    if (!driver || driver.status === 'BUSY') return;
    setToggling(true); setError('');
    try {
      const newStatus = driver.status === 'OFFLINE' ? 'AVAILABLE' : 'OFFLINE';
      const { data } = await driverApi.post<DriverOut>('/driver/status', { status: newStatus });
      setDriver(data);
      setIncomingTrip(null);
    } catch {
      setError('Imeshindwa kubadilisha status.');
    }
    setToggling(false);
  };

  const acceptTrip = async () => {
    if (!incomingTrip) return;
    setActionLoading('accept');
    try {
      const tripId = (incomingTrip as any).trip_id ?? incomingTrip.id;
      const { data } = await driverApi.post<Trip>(`/driver/trips/${tripId}/accept`);
      setCurrentTrip(data);
      setIncomingTrip(null);
      setMsg('Umekubali safari! Nenda pickup point.');
      if (driver) {
        await publishGpsEvent(`rides/${tripId}/status`, 'RIDE_ACCEPTED', { trip_id: tripId, driver_id: driver.id, driver_name: driver.full_name });
      }
      setMsgType('success');
      await refreshDriver();
    } catch (err) {
      setMsg(extractApiError(err));
      setMsgType('error');
    }
    setActionLoading(null);
  };

  const declineTrip = () => {
    setIncomingTrip(null);
    setMsg('Umekataa safari.');
    setMsgType('success');
  };

  const handleTripAction = async (action: 'start' | 'complete') => {
    if (!currentTrip) return;
    setActionLoading(action);
    try {
      const { data } = await driverApi.post<Trip>(`/driver/trips/${currentTrip.id}/${action}`);
      if (action === 'complete') {
        await publishGpsEvent(`rides/${currentTrip.id}/status`, 'RIDE_COMPLETED', { trip_id: currentTrip.id, driver_id: driver?.id });
        setCompletedTripId(currentTrip.id);
        setCurrentTrip(null);
        setMsg('Safari imekamilika! Uko tayari tena.');
        setMsgType('success');
        setTimeout(() => setMsg(''), 5000);
        await refreshDriver();
      } else {
        await publishGpsEvent(`rides/${currentTrip.id}/status`, 'RIDE_STARTED', { trip_id: currentTrip.id, driver_id: driver?.id });
        setCurrentTrip(data);
      }
    } catch (err) {
      setMsg(extractApiError(err));
      setMsgType('error');
    }
    setActionLoading(null);
  };

  if (loading) return <TabLoader />;
  if (!driver) return <Alert type="error" message={error || 'Imeshindwa kupakia driver data.'} />;

  const isOffline   = driver.status === 'OFFLINE';
  const isAvailable = driver.status === 'AVAILABLE';
  const isBusy      = driver.status === 'BUSY';

  return (
    <div className="driver-panel">
      {/* Status bar */}
      <div className={`driver-status-card ${isAvailable ? 'ds-online' : isBusy ? 'ds-busy' : 'ds-offline'}`}>
        <div className="ds-left">
          <div className={`ds-dot ${isBusy ? 'ds-dot-busy' : isAvailable ? 'ds-dot-on' : 'ds-dot-off'}`} />
          <div>
            <div className="ds-label">
              {isBusy ? 'Unasafiri' : isAvailable ? 'Unasubiri Safari' : 'Nje ya Mtandao'}
            </div>
            <div className="ds-sub">
              {isBusy
                ? 'Maliza safari yako kwanza'
                : isAvailable
                ? 'Unangoja safari kupitia MQTT…'
                : 'Bonyeza "Ingia Mtandaoni" kupokea safari'}
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
              ? <><span className="btn-spinner" /> Inabadilisha…</>
              : isAvailable ? 'Toka Mtandaoni' : 'Ingia Mtandaoni'}
          </button>
        )}
      </div>

      {error && <div className="driver-panel-msg"><Alert type="error" message={error} /></div>}
      {msg   && <div className="driver-panel-msg"><Alert type={msgType} message={msg} /></div>}

      {driverPayToast && (
        <div style={{
          position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'linear-gradient(135deg, #1a3a1a, #2d6a2d)', color: '#fff', borderRadius: 12,
          padding: '0.65rem 1.1rem', fontSize: '0.95rem', fontWeight: 700, zIndex: 2000,
          maxWidth: '90vw', boxShadow: '0 4px 20px rgba(0,100,0,0.45)',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          {driverPayToast}
        </div>
      )}

      {/* OFFLINE */}
      {isOffline && (
        <div className="driver-waiting-card">
          <div className="driver-waiting-icon">🔴</div>
          <div className="driver-waiting-title">Uko nje ya mtandao</div>
          <p className="driver-waiting-desc">Bonyeza "Ingia Mtandaoni" kupokea safari za abiria.</p>
        </div>
      )}

      {/* AVAILABLE — waiting */}
      {isAvailable && !incomingTrip && (
        <div className="driver-waiting-card">
          <div className="driver-waiting-icon">📡</div>
          <div className="driver-waiting-title">Unangoja safari kupitia MQTT</div>
          <p className="driver-waiting-desc">
            Safari itaonekana hapa papo hapo abiria atakapoituma — hakuna kurefresh.
          </p>
        </div>
      )}

      {/* INCOMING TRIP via MQTT — fixed full-screen overlay banner */}
      {incomingTrip && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          padding: '0.75rem',
          paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        }}>
          <div style={{
            background: '#fff', borderRadius: 18, width: '100%', maxWidth: 420,
            boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
            overflow: 'hidden',
            animation: 'trip-notification-bounce 0.4s cubic-bezier(0.34,1.56,0.64,1)',
          }}>
            {/* Header */}
            <div style={{
              background: 'linear-gradient(135deg, #ff6b00, #ff8c00)',
              color: '#fff', padding: '0.875rem 1rem',
              display: 'flex', alignItems: 'center', gap: '0.75rem',
            }}>
              <span style={{ fontSize: '1.5rem' }}>🔔</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>Safari Mpya!</div>
                <div style={{ fontSize: '0.78rem', opacity: 0.9 }}>
                  {(incomingTrip as any).trip_name ?? `Safari #${(incomingTrip as any).trip_id ?? incomingTrip.id}`}
                </div>
              </div>
              <div style={{
                marginLeft: 'auto', background: 'rgba(255,255,255,0.2)',
                borderRadius: '50%', width: 32, height: 32,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1rem', fontWeight: 700, cursor: 'pointer',
              }} onClick={declineTrip}>✕</div>
            </div>
            {/* Route */}
            <div style={{ padding: '0.75rem 1rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.75rem', marginTop: 2 }}>FROM</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1e293b' }}>{(incomingTrip as any).pickup_address}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.75rem', marginTop: 2 }}>TO</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1e293b' }}>{(incomingTrip as any).destination_address}</span>
              </div>
              <div style={{
                display: 'flex', gap: '0.75rem', marginTop: '0.75rem',
                background: '#f8fafc', borderRadius: 10, padding: '0.5rem 0.75rem',
              }}>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>🏍️ {(incomingTrip as any).ride_type}</span>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>💵 {(incomingTrip as any).payment_method}</span>
                {(incomingTrip as any).fare_tzs && (
                  <span style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 700 }}>TSh {Number((incomingTrip as any).fare_tzs).toLocaleString()}</span>
                )}
              </div>
            </div>
            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.5rem', padding: '0 1rem 1rem' }}>
              <button
                style={{ flex: 1, padding: '0.75rem', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' }}
                onClick={declineTrip} disabled={!!actionLoading}
              >✕ Kataa</button>
              <button
                style={{ flex: 2, padding: '0.75rem', background: 'linear-gradient(135deg, #ff6b00, #ff8c00)', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: '1rem', cursor: 'pointer', boxShadow: '0 4px 12px rgba(255,107,0,0.4)' }}
                onClick={acceptTrip} disabled={!!actionLoading}
              >
                {actionLoading === 'accept' ? '⏳ Inakubali…' : '✓ Kubali Safari'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BUSY: current trip actions */}
      {isBusy && currentTrip && (
        <CurrentTripCard
          trip={currentTrip}
          actionLoading={actionLoading}
          onAction={handleTripAction}
          driverName={driver?.full_name ?? 'Driver'}
        />
      )}

      {isBusy && !currentTrip && (
        <div className="driver-waiting-card">
          <div className="driver-waiting-icon">⏳</div>
          <div className="driver-waiting-title">Inapakia safari yako…</div>
          <p className="driver-waiting-desc">Subiri kidogo.</p>
        </div>
      )}
    </div>
  );
}

// ── Home Tab ──────────────────────────────────────────────────────────

const riderActions: { icon: string; title: string; desc: string; tab: Tab | null }[] = [
  { icon: '🏍️', title: 'Request a Ride', desc: 'Book a BodaBoda to your destination in seconds.', tab: 'request-ride' },
  { icon: '📋', title: 'My Trips',        desc: 'View your complete ride history and chat.',        tab: 'my-trips'     },
  { icon: '⚙️', title: 'Settings',        desc: 'Edit your profile, appearance, and preferences.', tab: 'settings'     },
];


function HomeTab({ user, setActiveTab }: { user: User; setActiveTab: (t: Tab) => void }) {
  const isDriver  = user.role === 'DRIVER';
  const firstName = user.full_name.split(' ')[0];

  return (
    <>
      {/* Driver: no header clutter — just the live trip panel */}
      {isDriver && (
        <div className="db-body" style={{ paddingTop: '1rem' }}>
          <DriverHomePanel />
        </div>
      )}

      {/* Rider: full header + stats */}
      {!isDriver && (
      <>
      <div className="db-header">
        <div className="db-header-inner">
          <div>
            <h1 className="db-greeting-text">{getGreeting()}, {firstName} 👋</h1>
            <p className="db-greeting-sub">Unaenda wapi leo?</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setActiveTab('settings')}>⚙️</button>
        </div>
      </div>

      <div className="db-body">

        {/* Rider: quick actions */}
        {!isDriver && (
          <>
            <div className="db-section-heading">Menyu ya Haraka</div>
            <div className="action-grid">
              {riderActions.map((a) => (
                <div
                  key={a.title}
                  className={`action-card rider-action-card${a.tab ? ' action-card-link' : ''}`}
                  onClick={() => a.tab && setActiveTab(a.tab)}
                >
                  <div className="action-card-icon rider-action-icon">{a.icon}</div>
                  <div className="action-card-head">
                    <span className="action-card-title">{a.title}</span>
                    <span className="action-badge action-badge-live">Open →</span>
                  </div>
                  <p className="action-card-desc">{a.desc}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      </>
      )}
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
              <label>Profile Picture</label>
              <input type="file" accept="image/*" style={{ fontSize: '0.85rem' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = ev => setForm(p => ({ ...p, profile_image_url: ev.target?.result as string }));
                  reader.readAsDataURL(file);
                }}
              />
              {form.profile_image_url && (
                <img src={form.profile_image_url} alt="preview"
                  style={{ marginTop: '0.5rem', width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid #e5e7eb' }}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
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

// ── Settings Tab ─────────────────────────────────────────────────────

function SettingsTab({ user, updateUser }: { user: User; updateUser: (u: User) => void }) {
  const isDriver = user.role === 'DRIVER';
  const [section, setSection] = useState<'account' | 'vehicle' | null>(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('boda_theme') === 'dark');

  // Dark mode toggle
  useEffect(() => {
    if (darkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('boda_theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('boda_theme');
    }
  }, [darkMode]);

  // ── Account edit form ──
  const [accForm, setAccForm] = useState({
    full_name: user.full_name ?? '', phone: user.phone ?? '',
    email: user.email ?? '', profile_image_url: user.profile_image_url ?? '',
  });
  const [accSaving, setAccSaving] = useState(false);
  const [accMsg, setAccMsg]       = useState('');
  const [accErr, setAccErr]       = useState('');

  const handleAccChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setAccForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const saveAccount = async (e: React.FormEvent) => {
    e.preventDefault(); setAccErr(''); setAccMsg(''); setAccSaving(true);
    try {
      const payload: Record<string,string> = {};
      if (accForm.full_name)         payload.full_name         = accForm.full_name;
      if (accForm.phone)             payload.phone             = accForm.phone;
      if (accForm.email)             payload.email             = accForm.email;
      if (accForm.profile_image_url) payload.profile_image_url = accForm.profile_image_url;
      const { data } = await api.put<User>('/auth/me', payload);
      updateUser(data);
      setAccMsg('Imehifadhiwa!');
      setSection(null);
    } catch (err) { setAccErr(extractApiError(err)); }
    setAccSaving(false);
  };

  // ── Vehicle/profile edit form (driver only) ──
  const [vehForm, setVehForm] = useState({
    license_number: user.driver_profile?.license_number ?? '',
    vehicle_model:  user.driver_profile?.vehicle_model  ?? '',
    plate_number:   user.driver_profile?.plate_number   ?? '',
  });
  const [vehSaving, setVehSaving] = useState(false);
  const [vehMsg, setVehMsg]       = useState('');
  const [vehErr, setVehErr]       = useState('');

  const handleVehChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setVehForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const saveVehicle = async (e: React.FormEvent) => {
    e.preventDefault(); setVehErr(''); setVehMsg(''); setVehSaving(true);
    try {
      const { data } = await api.put<User>('/auth/me/profile', vehForm);
      updateUser(data);
      setVehMsg('Imehifadhiwa!');
      setSection(null);
    } catch (err) { setVehErr(extractApiError(err)); }
    setVehSaving(false);
  };

  return (
    <div className="settings-page">
      {/* ── Profile card ── */}
      <div className="settings-profile-card">
        <div className="settings-avatar">
          {user.profile_image_url
            ? <img src={user.profile_image_url} alt={user.full_name} />
            : user.full_name.charAt(0).toUpperCase()}
        </div>
        <div className="settings-profile-info">
          <div className="settings-profile-name">{user.full_name}</div>
          <div className="settings-profile-role">{isDriver ? '🏍️ Driver' : '🧑‍💼 Rider'}</div>
          {user.phone && <div className="settings-profile-phone">📞 {user.phone}</div>}
        </div>
      </div>

      {/* ── Account section ── */}
      <div className="settings-section">
        <div className="settings-section-header" onClick={() => setSection(section === 'account' ? null : 'account')}>
          <div>
            <div className="settings-section-title">👤 Taarifa za Akaunti</div>
            <div className="settings-section-sub">Jina, simu, barua pepe, picha</div>
          </div>
          <span className="settings-chevron">{section === 'account' ? '▲' : '▶'}</span>
        </div>
        {section === 'account' && (
          <div className="settings-section-body">
            {accMsg && <Alert type="success" message={accMsg} />}
            {accErr && <Alert type="error"   message={accErr} />}
            <form onSubmit={saveAccount} className="edit-form">
              <div className="form-group">
                <label>Jina Kamili</label>
                <input name="full_name" type="text" value={accForm.full_name} onChange={handleAccChange} placeholder="Jina lako kamili" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Nambari ya Simu</label>
                  <input name="phone" type="tel" value={accForm.phone} onChange={handleAccChange} placeholder="+255700000000" />
                </div>
                <div className="form-group">
                  <label>Barua Pepe</label>
                  <input name="email" type="email" value={accForm.email} onChange={handleAccChange} placeholder="wewe@mfano.com" />
                </div>
              </div>
              <div className="form-group">
                <label>Picha ya Wasifu</label>
                <input type="file" accept="image/*" style={{ fontSize:'0.82rem' }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => setAccForm(p => ({ ...p, profile_image_url: ev.target?.result as string }));
                    reader.readAsDataURL(file);
                  }}
                />
                {accForm.profile_image_url && (
                  <img src={accForm.profile_image_url} alt="preview" className="settings-img-preview"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
              </div>
              <div className="edit-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setSection(null)}>Ghairi</button>
                <button type="submit" className="btn btn-primary" disabled={accSaving}>
                  {accSaving ? <><span className="btn-spinner" /> Inahifadhi…</> : 'Hifadhi'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* ── Vehicle section (Driver) / Rider stats ── */}
      <div className="settings-section">
        <div className="settings-section-header" onClick={() => setSection(section === 'vehicle' ? null : 'vehicle')}>
          <div>
            <div className="settings-section-title">{isDriver ? '🏍️ Gari & Leseni' : '📊 Takwimu za Rider'}</div>
            <div className="settings-section-sub">
              {isDriver ? 'Modeli ya bodaboda, nambari ya sahani, leseni' : 'Rating na safari zako'}
            </div>
          </div>
          <span className="settings-chevron">{section === 'vehicle' ? '▲' : '▶'}</span>
        </div>
        {section === 'vehicle' && (
          <div className="settings-section-body">
            {isDriver ? (
              <>
                {vehMsg && <Alert type="success" message={vehMsg} />}
                {vehErr && <Alert type="error"   message={vehErr} />}
                <form onSubmit={saveVehicle} className="edit-form">
                  <div className="form-group">
                    <label>Nambari ya Leseni</label>
                    <input name="license_number" type="text" value={vehForm.license_number} onChange={handleVehChange} placeholder="DL-12345678" />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Modeli ya Bodaboda</label>
                      <input name="vehicle_model" type="text" value={vehForm.vehicle_model} onChange={handleVehChange} placeholder="Bajaj Boxer 150" />
                    </div>
                    <div className="form-group">
                      <label>Nambari ya Sahani</label>
                      <input name="plate_number" type="text" value={vehForm.plate_number} onChange={handleVehChange} placeholder="T 123 ABC" />
                    </div>
                  </div>
                  <div className="edit-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => setSection(null)}>Ghairi</button>
                    <button type="submit" className="btn btn-navy" disabled={vehSaving}>
                      {vehSaving ? <><span className="btn-spinner" /> Inahifadhi…</> : 'Hifadhi'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="settings-stats-grid">
                <div className="settings-stat">
                  <span className="settings-stat-val">{user.rider_profile?.rating?.toFixed(1) ?? '—'}</span>
                  <span className="settings-stat-lbl">⭐ Rating</span>
                </div>
                <div className="settings-stat">
                  <span className="settings-stat-val">{user.rider_profile?.total_trips ?? 0}</span>
                  <span className="settings-stat-lbl">🏍️ Trips</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Appearance ── */}
      <div className="settings-section">
        <div className="settings-section-header" style={{ cursor: 'default' }}>
          <div>
            <div className="settings-section-title">🎨 Muonekano</div>
            <div className="settings-section-sub">Mada ya programu (Dark / Light)</div>
          </div>
          <label className="settings-toggle">
            <input type="checkbox" checked={darkMode} onChange={e => setDarkMode(e.target.checked)} />
            <span className="settings-toggle-track">
              <span className="settings-toggle-thumb" />
            </span>
            <span className="settings-toggle-label">{darkMode ? '🌙 Dark' : '☀️ Light'}</span>
          </label>
        </div>
      </div>

      {/* ── App info ── */}
      <div className="settings-app-info">
        <p>BodaBoda v1.0</p>
        <p className="settings-app-sub">Haki zote zimehifadhiwa © 2026</p>
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
  const [trip, setTrip]               = useState(initialTrip);
  const [cancelling, setCancelling]   = useState(false);
  const [driverId, setDriverId]         = useState<number | null>(initialTrip.assigned_driver?.id ?? null);
  const [approaching, setApproaching]   = useState(false);
  const [driverPos, setDriverPos]       = useState<{lat:number;lng:number}|null>(null);
  const [liveLocPos, setLiveLocPos]     = useState<{lat:number|null;lng:number|null;address?:string;time:string}|null>(null);
  const [chatOpen, setChatOpen]         = useState(false);
  const [chatUnread, setChatUnread]     = useState(0);
  const [declineToast, setDeclineToast] = useState<string | null>(null);
  const [paymentToast, setPaymentToast] = useState<string | null>(null);
  const [retrying, setRetrying]         = useState(false);
  const chatOverlayRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();
  const canCall = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(trip.status);
  const rtc = useWebRTCCall(canCall ? trip.id : null);

  // One-time sync on mount — catches any MQTT events that arrived before WebSocket connected
  useEffect(() => {
    api.get<Trip>(`/trips/${initialTrip.id}`).then(({ data }) => {
      setTrip(prev => ({ ...prev, ...data }));
      if (data.assigned_driver?.id) setDriverId(data.assigned_driver.id);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fix chat keyboard layout on Android: resize overlay to visual viewport height
  useEffect(() => {
    if (!chatOpen) return;
    const update = () => {
      if (chatOverlayRef.current && window.visualViewport) {
        chatOverlayRef.current.style.height = window.visualViewport.height + 'px';
      }
    };
    window.visualViewport?.addEventListener('resize', update);
    update();
    return () => window.visualViewport?.removeEventListener('resize', update);
  }, [chatOpen]);

  // Real-time updates via MQTT (status events)
  const mqttTopics = ACTIVE_TRIP_STATUSES.includes(trip.status)
    ? [`rides/${trip.id}/status`]
    : [];

  // Payment notification
  const paymentTopics = [`rides/${trip.id}/payment`];
  useMqtt(paymentTopics, useCallback((event: MqttEvent) => {
    if (event.event_type === 'PAYMENT_DONE') {
      const p = event.payload as Record<string, unknown>;
      if (String(p.for_role) === 'RIDER') {
        const amount = Number(p.amount);
        setPaymentToast(`💸 TSh ${amount.toLocaleString()} imekatwa kwa safari yako`);
        setTimeout(() => setPaymentToast(null), 6000);
      }
    }
  }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  // Direct subscription to driver location topic — independent of map
  const locTopics = driverId && [...ACTIVE_TRIP_STATUSES, 'COMPLETED'].includes(trip.status)
    ? [`driver/${driverId}/location`]
    : [];
  useMqtt(locTopics, useCallback((event: MqttEvent) => {
    if (event.event_type === 'DRIVER_LOCATION') {
      const p = event.payload as Record<string, unknown>;
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      const address = p.address ? String(p.address) : undefined;
      if (lat && lng) {
        setLiveLocPos({ lat, lng, address, time: new Date().toLocaleTimeString() });
        setDriverPos({ lat, lng });
      }
    }
  }, []));

  useMqtt(mqttTopics, useCallback((event: MqttEvent) => {
    const p = event.payload as Record<string, unknown>;

    const evtLat  = Number(p.lat || 0);
    const evtLng  = Number(p.lng || 0);
    const evtAddr = p.address ? String(p.address) : undefined;

    if (event.event_type === 'RIDE_DRIVER_ASSIGNED' || event.event_type === 'RIDE_ACCEPTED') {
      setDriverId(Number(p.driver_id) || null);
      setTrip(prev => ({
        ...prev,
        status: 'DRIVER_ASSIGNED',
        assigned_driver: {
          id: Number(p.driver_id) || 0,
          full_name: String(p.driver_name ?? ''),
          vehicle_model: String(p.vehicle ?? ''),
          plate_number: String(p.plate ?? ''),
          rating: 0,
          photo_url: p.photo_url ? String(p.photo_url) : undefined,
          driver_phone: p.driver_phone ? String(p.driver_phone) : undefined,
        },
      }));
      if (evtLat && evtLng) {
        setLiveLocPos({ lat: evtLat, lng: evtLng, address: evtAddr, time: new Date().toLocaleTimeString() });
        setDriverPos({ lat: evtLat, lng: evtLng });
      } else {
        setLiveLocPos(prev => prev ?? { lat: null, lng: null, time: new Date().toLocaleTimeString() });
      }

    } else if (event.event_type === 'RIDE_SEARCHING_AGAIN') {
      setTrip(prev => ({ ...prev, status: 'SEARCHING_DRIVER' }));
      setDeclineToast('Dereva alikataa — tunakutafutia mwingine…');
      setTimeout(() => setDeclineToast(null), 5000);

    } else if (event.event_type === 'RIDE_NO_DRIVER_AVAILABLE') {
      setTrip(prev => ({ ...prev, status: 'NO_DRIVER_AVAILABLE' }));

    } else if (event.event_type === 'DRIVER_APPROACHING') {
      setApproaching(true);
      if (evtLat && evtLng) {
        setLiveLocPos({ lat: evtLat, lng: evtLng, address: evtAddr, time: new Date().toLocaleTimeString() });
        setDriverPos({ lat: evtLat, lng: evtLng });
      }
      setTimeout(() => setApproaching(false), 8000);
    } else if (event.event_type === 'DRIVER_ARRIVED') {
      setApproaching(false);
      setTrip(prev => ({ ...prev, status: 'DRIVER_ARRIVED' }));
      if (evtLat && evtLng) {
        setLiveLocPos({ lat: evtLat, lng: evtLng, address: evtAddr, time: new Date().toLocaleTimeString() });
        setDriverPos({ lat: evtLat, lng: evtLng });
      }
    } else if (event.event_type === 'RIDE_STARTED') {
      setTrip(prev => ({ ...prev, status: 'IN_PROGRESS' }));
      if (evtLat && evtLng) {
        setLiveLocPos({ lat: evtLat, lng: evtLng, address: evtAddr, time: new Date().toLocaleTimeString() });
        setDriverPos({ lat: evtLat, lng: evtLng });
      }
    } else if (event.event_type === 'RIDE_COMPLETED') {
      setTrip(prev => ({ ...prev, status: 'COMPLETED' }));
      if (evtLat && evtLng) {
        setLiveLocPos({ lat: evtLat, lng: evtLng, address: evtAddr, time: new Date().toLocaleTimeString() });
        setDriverPos({ lat: evtLat, lng: evtLng });
      }
    }
  }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling fallback (30s) — safety net only; MQTT retained messages handle real-time updates
  useEffect(() => {
    if (!ACTIVE_TRIP_STATUSES.includes(trip.status)) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get<Trip>(`/trips/${trip.id}`);
        setTrip(data);
        if (data.assigned_driver?.id) setDriverId(data.assigned_driver.id);
        if (!ACTIVE_TRIP_STATUSES.includes(data.status)) clearInterval(interval);
      } catch {}
    }, 30000);
    return () => clearInterval(interval);
  }, [trip.id, trip.status]);

  // Hard 30-second search timeout: if still SEARCHING_DRIVER, cancel and show no-driver UI
  useEffect(() => {
    if (trip.status !== 'SEARCHING_DRIVER') return;
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get<Trip>(`/trips/${trip.id}`);
        if (data.status === 'SEARCHING_DRIVER') {
          try { await api.post(`/trips/${trip.id}/cancel`); } catch {}
          setTrip(prev => ({ ...prev, status: 'NO_DRIVER_AVAILABLE' }));
        } else {
          setTrip(data);
          if (data.assigned_driver?.id) setDriverId(data.assigned_driver.id);
        }
      } catch {
        setTrip(prev => ({ ...prev, status: 'NO_DRIVER_AVAILABLE' }));
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [trip.id, trip.status]);

  const cancel = async () => {
    setCancelling(true);
    try {
      const { data } = await api.post<Trip>(`/trips/${trip.id}/cancel`);
      setTrip(data);
    } catch {}
    setCancelling(false);
  };

  const retryTrip = async () => {
    setRetrying(true);
    try {
      const { data } = await api.post<Trip>('/trips/request', {
        pickup_address: trip.pickup_address,
        pickup_lat: trip.pickup_lat,
        pickup_lng: trip.pickup_lng,
        destination_address: trip.destination_address,
        destination_lat: trip.destination_lat,
        destination_lng: trip.destination_lng,
        ride_type: trip.ride_type,
        payment_method: trip.payment_method,
      });
      setTrip(data);
      setDriverId(null);
    } catch {}
    setRetrying(false);
  };

  const canCancel   = ['SEARCHING_DRIVER', 'NO_DRIVER_AVAILABLE'].includes(trip.status);
  const isSearching = trip.status === 'SEARCHING_DRIVER';
  const isActive    = ACTIVE_TRIP_STATUSES.includes(trip.status);
  const showMap     = isActive || trip.status === 'COMPLETED';
  const showChat    = ['DRIVER_ASSIGNED','DRIVER_ARRIVED','IN_PROGRESS'].includes(trip.status);

  const pLat = trip.pickup_lat, pLng = trip.pickup_lng;
  const eta  = driverPos && pLat && pLng
    ? Math.max(1, Math.round(haversineKm(driverPos.lat, driverPos.lng, pLat, pLng) / 25 * 60))
    : null;

  const statusTitles: Record<string,string> = {
    SEARCHING_DRIVER:    'Inatafuta Dereva…',
    DRIVER_ASSIGNED:     'Dereva Anakuja',
    DRIVER_ARRIVED:      'Dereva Amefika!',
    IN_PROGRESS:         'Safari Inaendelea 🏍️',
    COMPLETED:           'Safari Imekamilika ✓',
    CANCELLED:           'Safari Imefutwa',
    NO_DRIVER_AVAILABLE: 'Hakuna Dereva',
  };

  const statusDescs: Record<string,string> = {
    SEARCHING_DRIVER:    'Inatafuta dereva karibu nawe…',
    DRIVER_ASSIGNED:     trip.assigned_driver ? `${trip.assigned_driver.full_name} anakuelekea` : 'Dereva anakuelekea',
    DRIVER_ARRIVED:      'Dereva yako amefika! Nenda pickup point sasa.',
    IN_PROGRESS:         'Furahia safari yako!',
    COMPLETED:           'Asante kwa kutumia BodaBoda!',
    CANCELLED:           'Safari hii imefutwa.',
    NO_DRIVER_AVAILABLE: 'Hakuna dereva. Jaribu tena.',
  };

  return (
    <div className="tracking-page">

      {/* ── Driver decline toast ── */}
      {declineToast && (
        <div className="decline-toast">{declineToast}</div>
      )}

      {/* ── Payment notification toast ── */}
      {paymentToast && (
        <div className="payment-toast">{paymentToast}</div>
      )}

      {/* ── Map area ── */}
      <div className="tracking-map-area">
        {/* Floating header on top of map */}
        <div className="tracking-map-header">
          <button className="tracking-back-btn" onClick={onViewTrips}>←</button>
          <div className="tracking-header-center">
            <span className="tracking-title">
              {trip.status === 'COMPLETED' ? 'Safari Imekamilika' : (trip.trip_name ?? `Trip #${trip.id}`)}
            </span>
            {eta !== null && isActive && (
              <span className="tracking-eta-sub">⏱ ~{eta} min</span>
            )}
          </div>
          {eta !== null && isActive && (
            <span className="tracking-eta-badge">~{eta} min</span>
          )}
        </div>

        {/* Map */}
        {showMap ? (
          <TripLiveMap trip={trip} driverId={driverId} trackingMode onPos={setDriverPos} />
        ) : (
          <div className="tracking-map-placeholder">
            {isSearching ? (
              <>
                <div className="tracking-search-spinner" />
                <p>Inatafuta dereva…</p>
              </>
            ) : (
              <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>Safari imekamilika</p>
            )}
          </div>
        )}
      </div>

      {/* ── Chat overlay (always mounted when showChat so WebSocket stays connected; visibility controlled via display) ── */}
      {showChat && createPortal(
        <div ref={chatOverlayRef} className="tsv-chat-overlay" style={{ display: chatOpen ? 'flex' : 'none' }}>
          <div className="tsv-chat-header">
            <button className="tsv-chat-back" onClick={() => setChatOpen(false)}>←</button>
            <div className="tsv-chat-avatar">
              {trip.assigned_driver?.photo_url
                ? <img src={trip.assigned_driver.photo_url} alt="Dereva" style={{ width:'100%', height:'100%', borderRadius:'50%', objectFit:'cover' }} />
                : (trip.assigned_driver?.full_name ?? 'D').charAt(0).toUpperCase()
              }
            </div>
            <div className="tsv-chat-info">
              <div className="tsv-chat-name">{trip.assigned_driver?.full_name ?? 'Dereva'}</div>
              <div className="tsv-chat-sub">{trip.assigned_driver?.vehicle_model ?? ''} · {trip.assigned_driver?.plate_number ?? ''}</div>
            </div>
            {canCall && (
              <button className="tsv-chat-call" onClick={() => {
                if (window.location.protocol === 'https:') {
                  rtc.call();
                } else {
                  window.location.href = 'tel:' + (trip.assigned_driver?.driver_phone ?? '');
                }
              }} title="Piga simu">📞</button>
            )}
          </div>
          <TripChat tripId={trip.id} myRole="RIDER" myName={user?.full_name ?? 'Rider'} onNewMessage={(text?: string) => {
            if (!chatOpen) {
              setChatUnread(c => c + 1);
              setPaymentToast(`💬 Dereva: ${text ? (text.length > 50 ? text.slice(0, 50) + '…' : text) : 'Ujumbe mpya'}`);
              setTimeout(() => setPaymentToast(null), 5000);
            }
          }} />
        </div>,
        document.body
      )}

      {/* ── Bottom panel ── */}
      <div className="tracking-bottom">

        {/* Status headline */}
        <div className="tracking-status-msg">
          <strong>{statusTitles[trip.status] ?? trip.status}</strong>
          <p>{statusDescs[trip.status] ?? trip.message}</p>
        </div>

        {/* Driver live location — compact chip */}
        {liveLocPos && liveLocPos.lat && liveLocPos.lng ? (
          <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', background:'#f0fdf4', border:'1px solid #86efac', borderRadius:'99px', padding:'0.3rem 0.75rem', fontSize:'0.75rem', flexWrap:'wrap' }}>
            <span style={{ color:'#15803d', fontWeight:700 }}>📡</span>
            {liveLocPos.address && <span style={{ color:'#166534', fontWeight:600 }}>{liveLocPos.address}</span>}
            <span style={{ color:'#6b7280' }}>·</span>
            <span style={{ color:'#374151', fontFamily:'monospace' }}>{liveLocPos.lat.toFixed(5)}, {liveLocPos.lng.toFixed(5)}</span>
            <span style={{ color:'#9ca3af' }}>· {liveLocPos.time}</span>
          </div>
        ) : liveLocPos ? (
          <div style={{ fontSize:'0.75rem', color:'#d97706', padding:'0.25rem 0' }}>⏳ Inasubiri GPS ya dereva…</div>
        ) : null}

        {/* Approaching banner */}
        {approaching && (
          <div className="tsv-approaching-banner">
            <span>🏍️</span>
            <div>
              <strong>Dereva anakaribia!</strong>
              <p>Dereva yako yuko karibu — jiandae!</p>
            </div>
          </div>
        )}

        {/* Driver info card */}
        {trip.assigned_driver && (
          <div className="tracking-driver-card">
            <div className="tracking-driver-avatar">
              {trip.assigned_driver.photo_url
                ? <img src={trip.assigned_driver.photo_url} alt="Dereva" style={{ width:'100%', height:'100%', borderRadius:'50%', objectFit:'cover' }} />
                : trip.assigned_driver.full_name.charAt(0).toUpperCase()
              }
            </div>
            <div className="tracking-driver-info">
              <div className="tracking-driver-name">{trip.assigned_driver.full_name}</div>
              <div className="tracking-driver-sub">
                🏍️ {trip.assigned_driver.vehicle_model} · 📋 {trip.assigned_driver.plate_number}
              </div>
              {trip.assigned_driver.driver_phone && (
                <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>📱 {trip.assigned_driver.driver_phone}</div>
              )}
              {trip.assigned_driver.rating > 0 && (
                <div className="tracking-driver-rating">⭐ {trip.assigned_driver.rating.toFixed(1)}</div>
              )}
            </div>
            <div className="tracking-driver-btns">
              {canCall && (
                <button
                  className={`tracking-icon-btn tracking-call-btn${rtc.callState !== 'idle' ? ' ring' : ''}`}
                  onClick={() => {
                    if (window.location.protocol === 'https:') {
                      rtc.call();
                    } else {
                      window.location.href = 'tel:' + (trip.assigned_driver?.driver_phone ?? '');
                    }
                  }}
                  title="Piga simu"
                >
                  📞
                </button>
              )}
              {showChat && (
                <button
                  className={`tracking-icon-btn tracking-chat-btn${chatOpen ? ' active' : ''}`}
                  onClick={() => { setChatOpen(o => !o); setChatUnread(0); }}
                  title="Chat"
                  style={{ position: 'relative' }}
                >
                  💬
                  {chatUnread > 0 && (
                    <span style={{ position:'absolute', top:'-4px', right:'-4px', background:'#ef4444', color:'#fff', borderRadius:'99px', fontSize:'0.65rem', fontWeight:700, minWidth:'16px', height:'16px', display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px', lineHeight:1 }}>
                      {chatUnread > 9 ? '9+' : chatUnread}
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 5-step progress bar */}
        <TrackSteps status={trip.status} approaching={approaching} />

        {/* Trip route summary */}
        <div className="tracking-route">
          <div className="tracking-route-row">
            <span className="tracking-route-dot dot-pickup" />
            <div>
              <span className="tracking-route-label">Pickup</span>
              <span className="tracking-route-addr">{trip.pickup_address}</span>
            </div>
          </div>
          <div className="tracking-route-divider" />
          <div className="tracking-route-row">
            <span className="tracking-route-dot dot-dest" />
            <div>
              <span className="tracking-route-label">Destination</span>
              <span className="tracking-route-addr">{trip.destination_address}</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="tracking-actions">
          {['NO_DRIVER_AVAILABLE','CANCELLED'].includes(trip.status) && (
            <div className="tracking-retry-row">
              <button className="btn btn-primary tracking-retry-new" onClick={onNewTrip}>Ombi Jipya</button>
              <button
                className={`tracking-retry-icon${retrying ? ' spinning' : ''}`}
                onClick={retryTrip}
                disabled={retrying}
                title="Jaribu tena na safari ile ile"
              >
                ↺
              </button>
            </div>
          )}
          {trip.status === 'COMPLETED' && (
            <button className="btn btn-primary btn-block" onClick={onNewTrip}>Safari Nyingine</button>
          )}
          {canCancel && (
            <button className="btn btn-ghost btn-block" onClick={cancel} disabled={cancelling}>
              {cancelling ? 'Inafuta…' : 'Futa Safari'}
            </button>
          )}
          {isActive && (
            <button className="btn btn-ghost btn-block" onClick={onViewTrips}>Angalia Trips Zote →</button>
          )}
        </div>
      </div>
      <VoiceCallUI rtc={rtc} remoteName={trip.assigned_driver?.full_name ?? 'Dereva'} />
    </div>
  );
}

// ── Fare Estimate ─────────────────────────────────────────────────────

function calcFareLocally(pickup: MapLocation, dest: MapLocation) {
  const km = Math.round(haversineKm(pickup.lat, pickup.lng, dest.lat, dest.lng) * 100) / 100;
  return {
    distance_km: km,
    eta_minutes: Math.max(1, Math.round(km / 25 * 60)),
    fare_tzs: Math.max(1500, Math.round((1000 + 400 * km) / 10) * 10),
  };
}

function FareEstimate({ pickup, destination, onReady, walletBalance }: {
  pickup: MapLocation;
  destination: MapLocation;
  onReady?: (ready: boolean, fare: number) => void;
  walletBalance?: number | null;
}) {
  const [estimate, setEstimate] = useState<{ distance_km: number; eta_minutes: number; fare_tzs: number } | null>(null);

  useEffect(() => {
    const local = calcFareLocally(pickup, destination);
    setEstimate(local);
    onReady?.(true, local.fare_tzs);
    api.get('/trips/estimate', { params: {
      pickup_lat: pickup.lat, pickup_lng: pickup.lng,
      dest_lat: destination.lat, dest_lng: destination.lng,
    }}).then(({ data }) => {
      setEstimate(data);
      onReady?.(true, data.fare_tzs);
    }).catch(() => {/* keep local */});
  }, [pickup.lat, pickup.lng, destination.lat, destination.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const insufficient = walletBalance !== null && walletBalance !== undefined && estimate !== null && walletBalance < estimate.fare_tzs;

  return (
    <div className="fare-estimate-box">
      <div className="fare-row">
        <span className="fare-label">📍 Kutoka</span>
        <span className="fare-value">{pickup.name}</span>
      </div>
      <div className="fare-row">
        <span className="fare-label">🏁 Kwenda</span>
        <span className="fare-value">{destination.name}</span>
      </div>
      {estimate ? (
        <>
          <div className="fare-divider" />
          <div className="fare-row">
            <span className="fare-label">📏 Umbali</span>
            <span className="fare-value">{estimate.distance_km} km</span>
          </div>
          <div className="fare-row">
            <span className="fare-label">⏱️ Muda</span>
            <span className="fare-value">~{estimate.eta_minutes} dakika</span>
          </div>
          <div className="fare-row fare-row-price">
            <span className="fare-label">💵 Bei ya Safari</span>
            <span className="fare-price">TSh {estimate.fare_tzs.toLocaleString()}</span>
          </div>
          {walletBalance !== null && walletBalance !== undefined && (
            <div className="fare-row" style={{ marginTop: '0.25rem' }}>
              <span className="fare-label">💰 Salio Lako</span>
              <span style={{ fontWeight: 700, fontSize: '0.88rem', color: insufficient ? '#dc2626' : '#16a34a' }}>
                TSh {walletBalance.toLocaleString()}
              </span>
            </div>
          )}
          {insufficient && (
            <div style={{ marginTop: '0.5rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#dc2626', fontWeight: 600 }}>
              ⚠️ Salio haitoshi. Unahitaji TSh {(estimate.fare_tzs - walletBalance!).toLocaleString()} zaidi. Nenda Wallet uongeze pesa.
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '0.8rem', padding: '0.5rem' }}>Inakokotoa bei…</div>
      )}
    </div>
  );
}

// ── Request Ride Tab (RIDER only) ─────────────────────────────────────

function RequestRideTab({ setActiveTab }: { setActiveTab: (t: Tab) => void }) {
  const [pickup, setPickup]               = useState<MapLocation | null>(null);
  const [destination, setDestination]     = useState<MapLocation | null>(null);
  const [isLoading, setIsLoading]         = useState(false);
  const [isChecking, setIsChecking]       = useState(true);
  const [error, setError]                 = useState('');
  const [trip, setTrip]                   = useState<Trip | null>(null);
  const [estimateReady, setEstimateReady] = useState(false);
  const [estimatedFare, setEstimatedFare] = useState(0);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  useEffect(() => {
    // Load active trip + wallet balance in parallel
    api.get<Trip[]>('/trips/my')
      .then(({ data }) => {
        const active = data.find(t => ACTIVE_TRIP_STATUSES.includes(t.status));
        if (active) setTrip(active);
      })
      .catch(() => {})
      .finally(() => setIsChecking(false));

    api.get<{ balance: number }>('/wallet')
      .then(({ data }) => setWalletBalance(data.balance))
      .catch(() => {});
  }, []);

  const handleFareReady = (ready: boolean, fare: number) => {
    setEstimateReady(ready);
    setEstimatedFare(fare);
  };

  const balanceInsufficient = walletBalance !== null && estimatedFare > 0 && walletBalance < estimatedFare;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickup) { setError('Weka mahali pa kuanza safari.'); return; }
    if (!destination) { setError('Weka mahali pa kwenda.'); return; }
    if (balanceInsufficient) { setError('Salio haitoshi. Ongeza pesa kwenye Wallet kwanza.'); return; }
    setIsLoading(true); setError('');
    try {
      const { data } = await api.post<Trip>('/trips/request', {
        pickup_address: pickup.name,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        destination_address: destination.name,
        destination_lat: destination.lat,
        destination_lng: destination.lng,
        ride_type: 'BODA',
        payment_method: 'CASH',
      });
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
      <div className="edit-card" style={{ maxWidth: '680px' }}>
        <div className="edit-card-head">
          <button className="edit-back" onClick={() => setActiveTab('home')}>← Back to Home</button>
          <h1 className="edit-title">Omba Safari</h1>
          <p className="edit-sub">Chagua mahali pa kuanzia na kwenda kwenye ramani.</p>
        </div>
        <div className="edit-card-body">
          {error && <Alert type="error" message={error} />}
          <form onSubmit={handleSubmit} className="edit-form">
            <RideMap
              pickup={pickup}
              destination={destination}
              onPickupChange={setPickup}
              onDestinationChange={setDestination}
            />

            {pickup && destination && (
              <FareEstimate
                pickup={pickup}
                destination={destination}
                onReady={handleFareReady}
                walletBalance={walletBalance}
              />
            )}

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={isLoading || !pickup || !destination || !estimateReady || balanceInsufficient}
              style={{ marginTop: '1rem', opacity: balanceInsufficient ? 0.5 : 1 }}
            >
              {isLoading
                ? <><span className="btn-spinner" /> Inatafuta dereva…</>
                : balanceInsufficient
                  ? '🔒 Salio Haitoshi — Ongeza Pesa'
                  : '🏍️  Omba Safari'}
            </button>

            {balanceInsufficient && (
              <button
                type="button"
                className="btn btn-outline btn-block"
                style={{ marginTop: '0.5rem' }}
                onClick={() => setActiveTab('wallet')}
              >
                💰 Nenda Wallet Uongeze Pesa
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

// ── My Trips Tab (RIDER only) ─────────────────────────────────────────

function MyTripsTab({ setActiveTab }: { setActiveTab: (t: Tab) => void }) {
  const { user } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [chatTripId, setChatTripId] = useState<number | null>(null);

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

  const [tripsPage, setTripsPage] = useState(0);
  const sorted = [...trips].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const pagedTrips = sorted.slice(tripsPage * PAGE_SIZE, (tripsPage + 1) * PAGE_SIZE);
  const chatTrip = chatTripId != null ? sorted.find(t => t.id === chatTripId) : null;

  if (chatTrip) {
    return (
      <ChatPanel
        trip={chatTrip}
        myRole="RIDER"
        myName={user?.full_name ?? 'Rider'}
        onClose={() => setChatTripId(null)}
      />
    );
  }

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
          {pagedTrips.map(trip => (
            <div key={trip.id} className={`trip-card-h tc-s-${trip.status.toLowerCase()}`}>
              {/* Left accent bar based on status */}
              <div className="tch-accent" />

              {/* Centre: name + route */}
              <div className="tch-body">
                <div className="tch-name">{trip.pickup_address} → {trip.destination_address}</div>
                <div className="tch-meta-row">
                  <span>🏍️ {trip.ride_type}</span>
                  <span>💵 {trip.payment_method}</span>
                </div>
                {trip.assigned_driver && (
                  <div className="tch-driver">
                    🏍️ {trip.assigned_driver.full_name} · {trip.assigned_driver.plate_number} · ⭐{trip.assigned_driver.rating.toFixed(1)}
                  </div>
                )}
                {canCancel(trip.status) && (
                  <button className="tch-cancel-btn" onClick={() => cancel(trip.id)} disabled={cancellingId === trip.id}>
                    {cancellingId === trip.id ? 'Inafuta…' : '✕ Futa Safari'}
                  </button>
                )}
              </div>

              {/* Right: status + date + chat button */}
              <div className="tch-side">
                <TripStatusBadge status={trip.status} />
                <span className="tch-date">{fmtDate(trip.created_at)}</span>
                <span className="tch-time-val">{fmtTime(trip.created_at)}</span>
                <button className="tch-chat-btn" onClick={() => setChatTripId(trip.id)} title="Ona mazungumzo">💬</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Paginator total={sorted.length} page={tripsPage} onPage={setTripsPage} />
    </div>
  );
}

// ── Offer History Tab (DRIVER only) ──────────────────────────────────

function OfferHistoryTab() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [chatTripId, setChatTripId] = useState<number | null>(null);

  useEffect(() => {
    driverApi.get<Trip[]>('/driver/trips/my')
      .then(({ data }) => setTrips(data))
      .catch(() => setError('Imeshindwa kupakia trips.'))
      .finally(() => setIsLoading(false));
  }, []);

  const [offerPage, setOfferPage] = useState(0);
  const sorted = [...trips].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const pagedOffers = sorted.slice(offerPage * PAGE_SIZE, (offerPage + 1) * PAGE_SIZE);
  const chatTrip = chatTripId != null ? sorted.find(t => t.id === chatTripId) : null;

  if (chatTrip) {
    return (
      <ChatPanel
        trip={chatTrip}
        myRole="DRIVER"
        myName={user?.full_name ?? 'Dereva'}
        onClose={() => setChatTripId(null)}
      />
    );
  }

  return (
    <div className="tab-page">

      <div className="tab-page-head">
        <h1 className="tab-page-title">My Trips</h1>
      </div>

      {isLoading && <TabLoader />}
      {!isLoading && error && <Alert type="error" message={error} />}
      {!isLoading && !error && trips.length === 0 && (
        <EmptyState icon="🏍️" title="Hakuna trips bado" desc="Trips ulizokubali zitaonekana hapa." />
      )}

      {!isLoading && sorted.length > 0 && (
        <div className="trip-list">
          {pagedOffers.map(trip => (
            <div key={trip.id} className={`trip-card-h tc-s-${trip.status.toLowerCase()}`}>
              <div className="tch-accent" />
              <div className="tch-body">
                <div className="tch-name">{trip.pickup_address} → {trip.destination_address}</div>
                <div className="tch-meta-row">
                  <span>🏍️ {trip.ride_type}</span>
                  <span>💵 {trip.payment_method}</span>
                </div>
              </div>
              <div className="tch-side">
                <TripStatusBadge status={trip.status} />
                <span className="tch-date">{fmtDate(trip.created_at)}</span>
                <span className="tch-time-val">{fmtTime(trip.created_at)}</span>
                <button className="tch-chat-btn" onClick={() => setChatTripId(trip.id)} title="Ona mazungumzo">💬</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Paginator total={sorted.length} page={offerPage} onPage={setOfferPage} />
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
// ── Wallet Tab ────────────────────────────────────────────────────────

type WalletTx = { id: number; type: string; amount: number; balance_after: number; trip_id?: number; description: string; created_at: string };
type WalletData = { balance: number; transactions: WalletTx[] };
type CardData = { card_number: string; expiry_month: number; expiry_year: number; cvv: string } | null;

const QUICK_AMOUNTS = [1000, 5000, 10000, 20000];

// Visual credit card component
function VirtualCardDisplay({ card, userName, onGet, getting }: {
  card: CardData;
  userName: string;
  onGet: () => void;
  getting: boolean;
}) {
  const [showCvv, setShowCvv] = useState(false);

  if (!card) {
    return (
      <div style={{
        background: 'linear-gradient(135deg,#1e293b,#0f172a)',
        borderRadius: 16, padding: '1.5rem', color: '#fff',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: '0.75rem', minHeight: 160,
      }}>
        <div style={{ fontSize: '2rem' }}>💳</div>
        <div style={{ fontSize: '0.9rem', opacity: 0.7 }}>Huna kadi bado</div>
        <button
          onClick={onGet} disabled={getting}
          style={{ background: '#FF6B00', color: '#fff', border: 'none', borderRadius: 99, padding: '0.5rem 1.5rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.88rem' }}>
          {getting ? 'Inatengeneza…' : '+ Pata Kadi Yako'}
        </button>
      </div>
    );
  }

  // Display: first 12 digits masked, last 4 visible
  const parts = card.card_number.split(' ');
  const maskedNum = parts.map((p, i) => i < 3 ? '••••' : p).join('  ');
  const expiry = `${String(card.expiry_month).padStart(2,'0')}/${String(card.expiry_year).slice(-2)}`;

  return (
    <div style={{
      background: 'linear-gradient(135deg,#FF6B00,#c2410c,#1e293b)',
      borderRadius: 16, padding: '1.25rem 1.5rem', color: '#fff',
      fontFamily: '"Courier New", monospace', position: 'relative',
      minHeight: 160, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      boxShadow: '0 8px 32px rgba(255,107,0,0.30)',
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: '0.72rem', letterSpacing: '0.15em', opacity: 0.7, fontFamily: 'inherit' }}>BODABODA WALLET</div>
        <div style={{ fontSize: '1.4rem' }}>💳</div>
      </div>

      {/* Card number */}
      <div style={{ fontSize: '1.05rem', letterSpacing: '0.2em', textAlign: 'center', margin: '0.75rem 0' }}>
        {maskedNum}
      </div>

      {/* Bottom row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: '0.6rem', opacity: 0.6, marginBottom: 2 }}>VALID THRU</div>
          <div style={{ fontSize: '0.85rem', letterSpacing: '0.1em' }}>{expiry}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.6rem', opacity: 0.6, marginBottom: 2 }}>CVV</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <div style={{ fontSize: '0.85rem', letterSpacing: '0.1em' }}>{showCvv ? card.cvv : '•••'}</div>
            <button onClick={() => setShowCvv(s => !s)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: '0.65rem', padding: '1px 5px' }}>
              {showCvv ? '🙈' : '👁'}
            </button>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.6rem', opacity: 0.6, marginBottom: 2 }}>MTUMIAJI</div>
          <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
        </div>
      </div>
    </div>
  );
}

function WalletTab() {
  const { user } = useAuth();
  const [data, setData]         = useState<WalletData | null>(null);
  const [card, setCard]         = useState<CardData | 'loading'>('loading');
  const [loading, setLoading]   = useState(true);
  const [walletErr, setWalletErr] = useState('');
  const [cardErr, setCardErr]   = useState('');
  const [amount, setAmount]     = useState('');
  const [saving, setSaving]     = useState(false);
  const [getting, setGetting]   = useState(false);
  const [msg, setMsg]           = useState('');
  const [topupErr, setTopupErr] = useState('');

  const loadWallet = async () => {
    setLoading(true); setWalletErr('');
    try {
      const { data: d } = await api.get<WalletData>('/wallet');
      setData(d);
    } catch (err) {
      setWalletErr(extractApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const loadCard = async () => {
    try {
      const { data: c } = await api.get<CardData>('/wallet/card');
      setCard(c);
    } catch {
      // endpoint not available or table missing — just hide card section
      setCard(null);
    }
  };

  useEffect(() => {
    loadWallet();
    loadCard();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doTopup = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (!val || val < 500) { setTopupErr('Kiwango cha chini ni TSh 500'); return; }
    setTopupErr(''); setMsg(''); setSaving(true);
    try {
      const { data: d } = await api.post<{ balance: number; message: string }>('/wallet/topup', { amount: val });
      setMsg(d.message ?? 'Pesa zimeongezwa!');
      setAmount('');
      // Update balance instantly from response, then silently refresh transactions
      setData(prev => prev ? { ...prev, balance: d.balance } : { balance: d.balance, transactions: [] });
      api.get<WalletData>('/wallet').then(({ data: w }) => setData(w)).catch(() => {});
    } catch (err) {
      setTopupErr(extractApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const getCard = async () => {
    setCardErr(''); setGetting(true);
    try {
      const { data: c } = await api.post<CardData>('/wallet/card');
      setCard(c);
    } catch (err) {
      setCardErr(extractApiError(err));
    } finally {
      setGetting(false);
    }
  };

  const [txnPage, setTxnPage] = useState(0);
  const balance = data?.balance ?? 0;
  const txns = data?.transactions ?? [];

  return (
    <div style={{ maxWidth: 440, margin: '0 auto', padding: '1rem 0.75rem' }}>

      {/* 1. Balance header — always shown */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(90deg,#FF6B00,#ff9100)', borderRadius: 12, padding: '0.85rem 1.25rem', color: '#fff', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>Salio la Mkoba</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>
            {loading ? '…' : `TSh ${balance.toLocaleString()}`}
          </div>
        </div>
        <span style={{ fontSize: '1.8rem', opacity: 0.4 }}>💰</span>
      </div>

      {walletErr && <Alert type="error" message={walletErr} />}

      {/* 2. Top-up form — always shown, independent of card */}
      <form onSubmit={doTopup} style={{ marginBottom: '1.25rem', padding: '0.85rem', background: '#f9fafb', borderRadius: 12, border: '1px solid #e5e7eb' }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', color: '#374151' }}>
          💳 Ongeza Pesa
        </div>
        {msg      && <Alert type="success" message={msg} />}
        {topupErr && <Alert type="error"   message={topupErr} />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.35rem', marginBottom: '0.5rem' }}>
          {QUICK_AMOUNTS.map(a => (
            <button key={a} type="button"
              onClick={() => setAmount(String(a))}
              style={{ padding: '0.45rem 0', background: amount === String(a) ? '#FF6B00' : '#fff', color: amount === String(a) ? '#fff' : '#374151', border: `1px solid ${amount === String(a) ? '#FF6B00' : '#e5e7eb'}`, borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem' }}>
              {a >= 1000 ? `${a/1000}k` : a}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="number" min="500" max="500000" step="100"
            placeholder="Kiasi (TSh)"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{ flex: 1, padding: '0.6rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: '0.88rem', background: '#fff' }}
          />
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
            {saving ? <><span className="btn-spinner" /> Inaongeza…</> : '+ Weka'}
          </button>
        </div>
      </form>

      {/* 3. Virtual card — shown when loaded, has its own error */}
      {card !== 'loading' && (
        <div style={{ marginBottom: '1.25rem' }}>
          {cardErr && <Alert type="error" message={cardErr} />}
          <VirtualCardDisplay
            card={card}
            userName={user?.full_name ?? ''}
            onGet={getCard}
            getting={getting}
          />
        </div>
      )}

      {/* 4. Statistics */}
      {!loading && txns.length > 0 && (() => {
        const debits = txns.filter(t => t.type === 'DEBIT');
        const totalSpent = debits.reduce((s, t) => s + t.amount, 0);
        const avg = debits.length > 0 ? Math.round(totalSpent / debits.length) : 0;
        return (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 100, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '0.65rem 0.75rem', textAlign: 'center' }}>
              <div style={{ fontWeight: 800, color: '#dc2626', fontSize: '0.95rem' }}>TSh {totalSpent.toLocaleString()}</div>
              <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 2 }}>Jumla Iliyotumika</div>
            </div>
            <div style={{ flex: 1, minWidth: 80, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '0.65rem 0.75rem', textAlign: 'center' }}>
              <div style={{ fontWeight: 800, color: '#2563eb', fontSize: '0.95rem' }}>{debits.length}</div>
              <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 2 }}>Safari Zote</div>
            </div>
            <div style={{ flex: 1, minWidth: 100, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '0.65rem 0.75rem', textAlign: 'center' }}>
              <div style={{ fontWeight: 800, color: '#16a34a', fontSize: '0.95rem' }}>TSh {avg.toLocaleString()}</div>
              <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 2 }}>Wastani/Safari</div>
            </div>
          </div>
        );
      })()}

      {/* 5. Debit history */}
      {!loading && txns.filter(t => t.type === 'DEBIT').length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#374151', marginBottom: '0.5rem' }}>Historia ya Malipo</div>
          {txns.filter(t => t.type === 'DEBIT').slice(txnPage * PAGE_SIZE, (txnPage + 1) * PAGE_SIZE).map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.6rem 0.75rem', marginBottom: '0.4rem', background: '#fff', border: '1px solid #f1f5f9', borderRadius: 10 }}>
              <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>⬇️</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.description}</div>
                <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{fmtTxDate(t.created_at)}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#dc2626' }}>-TSh {t.amount.toLocaleString()}</div>
                <div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>Sal: {t.balance_after.toLocaleString()}</div>
              </div>
            </div>
          ))}
          <Paginator total={txns.filter(t => t.type === 'DEBIT').length} page={txnPage} onPage={setTxnPage} />
        </>
      )}
    </div>
  );
}

// ── Driver Wallet Tab ─────────────────────────────────────────────────

function fmtTxDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('sw-TZ', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function DriverWalletTab() {
  const { user } = useAuth();
  const [data, setData]     = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState('');
  const [card, setCard]     = useState<CardData | 'loading'>('loading');
  const [cardErr, setCardErr] = useState('');
  const [getting, setGetting] = useState(false);
  const [walletPage, setWalletPage] = useState(0);

  useEffect(() => {
    api.get<WalletData>('/wallet')
      .then(({ data: d }) => setData(d))
      .catch(e => setErr(extractApiError(e)))
      .finally(() => setLoading(false));
    api.get<CardData>('/wallet/card')
      .then(({ data: c }) => setCard(c))
      .catch(() => setCard(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getCard = async () => {
    setCardErr(''); setGetting(true);
    try {
      const { data: c } = await api.post<CardData>('/wallet/card');
      setCard(c);
    } catch (e) { setCardErr(extractApiError(e)); }
    finally { setGetting(false); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '3rem' }}><div className="spinner" /></div>;
  if (err) return <div style={{ padding: '1rem' }}><Alert type="error" message={err} /></div>;
  const balance = data?.balance ?? 0;
  const txns    = data?.transactions ?? [];
  const credits = txns.filter(t => t.type === 'CREDIT');
  const totalEarned = credits.reduce((s, t) => s + t.amount, 0);
  const avgEarning  = credits.length > 0 ? Math.round(totalEarned / credits.length) : 0;

  return (
    <div style={{ maxWidth: 440, margin: '0 auto', padding: '1rem 0.75rem' }}>

      {/* Balance card */}
      <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #e85d04 100%)', borderRadius: 16, padding: '1.5rem 1.25rem', color: '#fff', marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.75rem', opacity: 0.8, marginBottom: '0.25rem' }}>Salio la Mkoba — Mapato</div>
        <div style={{ fontSize: '2rem', fontWeight: 800 }}>TSh {balance.toLocaleString()}</div>
        <div style={{ fontSize: '0.75rem', opacity: 0.65, marginTop: '0.4rem' }}>{user?.full_name}</div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 100, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '0.65rem 0.75rem', textAlign: 'center' }}>
          <div style={{ fontWeight: 800, color: '#16a34a', fontSize: '0.95rem' }}>TSh {totalEarned.toLocaleString()}</div>
          <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 2 }}>Jumla Mapato</div>
        </div>
        <div style={{ flex: 1, minWidth: 80, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '0.65rem 0.75rem', textAlign: 'center' }}>
          <div style={{ fontWeight: 800, color: '#2563eb', fontSize: '0.95rem' }}>{credits.length}</div>
          <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 2 }}>Safari Zilipewa</div>
        </div>
        <div style={{ flex: 1, minWidth: 100, background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '0.65rem 0.75rem', textAlign: 'center' }}>
          <div style={{ fontWeight: 800, color: '#ca8a04', fontSize: '0.95rem' }}>TSh {avgEarning.toLocaleString()}</div>
          <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: 2 }}>Wastani/Safari</div>
        </div>
      </div>

      {/* Virtual card */}
      {card !== 'loading' && (
        <div style={{ marginBottom: '1.25rem' }}>
          {cardErr && <Alert type="error" message={cardErr} />}
          <VirtualCardDisplay card={card} userName={user?.full_name ?? ''} onGet={getCard} getting={getting} />
        </div>
      )}

      {/* Earnings history */}
      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#374151', marginBottom: '0.6rem' }}>Historia ya Mapato (90%)</div>
      {credits.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#94a3b8' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>💸</div>
          <p style={{ margin: 0 }}>Bado haujapokea malipo.<br />Kamilisha safari ili upate.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          {credits.slice(walletPage * PAGE_SIZE, (walletPage + 1) * PAGE_SIZE).map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.65rem 0.75rem', background: '#fff', border: '1px solid #f1f5f9', borderRadius: 10 }}>
              <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>⬆️</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.description}</div>
                <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{fmtTxDate(t.created_at)}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#16a34a' }}>+TSh {t.amount.toLocaleString()}</div>
                <div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>Sal: {t.balance_after.toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Paginator total={credits.length} page={walletPage} onPage={setWalletPage} />
    </div>
  );
}

// ── Nav items (role-aware) ────────────────────────────────────────────

function getNavItems(role: string, _unreadCount: number): NavItem[] {
  if (role === 'RIDER') {
    return [
      { tab: 'home',         label: 'Home',         icon: <IconHome />     },
      { tab: 'request-ride', label: 'Ride',         icon: <IconMoto />     },
      { tab: 'my-trips',     label: 'My Trips',     icon: <IconList />     },
      { tab: 'wallet',       label: 'Wallet',       icon: <span style={{fontSize:'1.1rem'}}>💰</span> },
      { tab: 'settings',     label: 'Settings',     icon: <IconSettings /> },
    ];
  }
  if (role === 'DRIVER') {
    return [
      { tab: 'home',          label: 'Home',     icon: <IconHome />     },
      { tab: 'offer-history', label: 'Safari',   icon: <IconList />     },
      { tab: 'wallet',        label: 'Mkoba',    icon: <span style={{fontSize:'1.1rem'}}>💰</span> },
      { tab: 'settings',      label: 'Mipangilio', icon: <IconSettings /> },
    ];
  }
  return [
    { tab: 'home',     label: 'Home',     icon: <IconHome />     },
    { tab: 'settings', label: 'Settings', icon: <IconSettings /> },
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

// ── Driver Offer Watcher (always mounted for driver, any tab) ─────────

function DriverOfferWatcher({ activeTab: _activeTab, setActiveTab }: {
  activeTab: Tab;
  setActiveTab: (t: Tab) => void;
}) {
  const [offer, setOffer]         = useState<Record<string, unknown> | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const clearOffer = useCallback(() => {
    setOffer(null);
    setCountdown(10);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const handleNewOffer = useCallback((payload: Record<string, unknown>) => {
    setOffer(payload);
    setCountdown(10);
    setActiveTab('home');
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearOffer(); return 10; }
        return c - 1;
      });
    }, 1000);

    // Browser push notification
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification('🏍️ Ombi Jipya la Safari!', {
        body: `${payload.pickup_address ?? ''} → ${payload.destination_address ?? ''}`,
        tag: `offer-${String(payload.trip_id)}`,
        requireInteraction: true,
      });
      n.onclick = () => { window.focus(); setActiveTab('home'); n.close(); };
    }
  }, [setActiveTab, clearOffer]);

  // Listen to both the raw ride event AND the driver-specific broadcast
  useMqtt(['drivers/available/rides'], useCallback((event: MqttEvent) => {
    if (event.event_type === 'RIDE_AVAILABLE') {
      handleNewOffer(event.payload as Record<string, unknown>);
    }
  }, [handleNewOffer]));

  useMqtt(['rides/new'], useCallback((event: MqttEvent) => {
    if (event.event_type === 'RIDE_REQUESTED') {
      handleNewOffer(event.payload as Record<string, unknown>);
    }
  }, [handleNewOffer]));

  const accept = async () => {
    if (!offer) return;
    setAccepting(true);
    const tripId = offer.trip_id ?? offer.id;
    try {
      const { data: acceptedTrip } = await driverApi.post(`/driver/trips/${tripId}/accept`);
      clearOffer();
      setActiveTab('home');
      window.dispatchEvent(new CustomEvent('driver-trip-accepted', { detail: { tripId, trip: acceptedTrip } }));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Imeshindwa kukubali safari.';
      alert(msg);
      clearOffer();
    }
    setAccepting(false);
  };

  if (!offer) return null;

  const fareStr = offer.fare_tzs ? `TSh ${Number(offer.fare_tzs).toLocaleString()}` : '';

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '0.75rem',
      paddingTop: 'max(2rem, env(safe-area-inset-top))',
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, width: '100%', maxWidth: 440,
        boxShadow: '0 12px 50px rgba(0,0,0,0.45)',
        overflow: 'hidden',
        animation: 'trip-notification-bounce 0.35s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #ff6b00, #ff8c00)',
          color: '#fff', padding: '1rem',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
          <span style={{ fontSize: '1.8rem' }}>🏍️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>Safari Mpya!</div>
            <div style={{ fontSize: '0.78rem', opacity: 0.9 }}>
              {String(offer.trip_name ?? `Safari #${offer.trip_id}`)}
            </div>
          </div>
          <div style={{
            background: 'rgba(255,255,255,0.25)',
            borderRadius: '50%', width: 40, height: 40,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1rem', fontWeight: 800, flexShrink: 0,
          }}>
            {countdown}s
          </div>
        </div>
        {/* Route */}
        <div style={{ padding: '0.875rem 1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', flexShrink: 0, marginTop: 4 }} />
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>{String(offer.pickup_address ?? '')}</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', flexShrink: 0, marginTop: 4 }} />
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b' }}>{String(offer.destination_address ?? '')}</span>
          </div>
          <div style={{
            display: 'flex', gap: '0.75rem', marginTop: '0.75rem',
            background: '#f8fafc', borderRadius: 10, padding: '0.5rem 0.75rem', flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>🏍️ {String(offer.ride_type ?? 'BODA')}</span>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>💵 {String(offer.payment_method ?? 'CASH')}</span>
            {fareStr && <span style={{ fontSize: '0.85rem', color: '#059669', fontWeight: 700 }}>{fareStr}</span>}
          </div>
        </div>
        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.5rem', padding: '0 1rem 1rem' }}>
          <button
            style={{ flex: 1, padding: '0.875rem', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' }}
            onClick={clearOffer} disabled={accepting}
          >✕ Kataa</button>
          <button
            style={{ flex: 2, padding: '0.875rem', background: 'linear-gradient(135deg, #ff6b00, #ff8c00)', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: '1rem', cursor: 'pointer', boxShadow: '0 4px 14px rgba(255,107,0,0.45)', opacity: accepting ? 0.7 : 1 }}
            onClick={accept} disabled={accepting}
          >
            {accepting ? '⏳ Inakubali…' : '✓ Kubali Safari'}
          </button>
        </div>
      </div>
    </div>,
    document.body
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
          {activeTab === 'settings'      && <SettingsTab    user={user} updateUser={updateUser} />}
          {activeTab === 'profile'       && <ProfileTab     user={user} setActiveTab={handleTabChange} />}
          {activeTab === 'edit-account'  && <EditAccountTab user={user} updateUser={updateUser} setActiveTab={handleTabChange} />}
          {activeTab === 'edit-profile'  && <EditProfileTab user={user} updateUser={updateUser} setActiveTab={handleTabChange} />}
          {activeTab === 'request-ride'  && isRider  && <RequestRideTab  setActiveTab={handleTabChange} />}
          {activeTab === 'my-trips'      && isRider  && <MyTripsTab      setActiveTab={handleTabChange} />}
          {activeTab === 'offer-history' && isDriver && <OfferHistoryTab />}
          {activeTab === 'wallet'        && isRider  && <WalletTab />}
          {activeTab === 'wallet'        && isDriver && <DriverWalletTab />}
          {activeTab === 'notifications' && <NotificationsTab onRead={() => setUnreadCount(0)} />}
        </div>
      </div>

      {isDriver && (
        <DriverOfferWatcher activeTab={activeTab} setActiveTab={handleTabChange} />
      )}
      <BottomNav user={user} activeTab={activeTab} setActiveTab={handleTabChange} onLogout={handleLogout} unreadCount={unreadCount} />
    </div>
  );
}
