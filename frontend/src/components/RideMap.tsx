import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

export interface MapLocation {
  name: string;
  lat: number;
  lng: number;
}

interface RideMapProps {
  onPickupChange: (loc: MapLocation | null) => void;
  onDestinationChange: (loc: MapLocation | null) => void;
  pickup: MapLocation | null;
  destination: MapLocation | null;
}

// University of Dodoma — default map center
const DODOMA = { lat: -6.1711, lng: 35.7402 };

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    village?: string;
    town?: string;
    city?: string;
  };
}

function shortName(s: NominatimResult): string {
  const a = s.address;
  return a?.road || a?.neighbourhood || a?.suburb || a?.village || a?.town || a?.city || s.display_name.split(',')[0];
}

function subName(s: NominatimResult): string {
  return s.display_name.split(',').slice(1, 3).join(',').trim();
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'sw,en' } }
    );
    const data = await res.json();
    if (data.address) {
      const a = data.address;
      const main = a.road || a.neighbourhood || a.suburb || a.village || a.town || a.city || '';
      const sub = a.suburb || a.city_district || a.city || '';
      return main ? (sub && sub !== main ? `${main}, ${sub}` : main) : data.display_name;
    }
    return data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

async function searchPlaces(query: string): Promise<NominatimResult[]> {
  if (query.length < 3) return [];
  try {
    // viewbox biases toward Dodoma region, no bounded restriction so suggestions always appear
    const viewbox = '34.5,-5.0,37.0,-8.0';
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&countrycodes=tz&addressdetails=1&viewbox=${viewbox}`,
      { headers: { 'Accept-Language': 'sw,en' } }
    );
    return await res.json();
  } catch {
    return [];
  }
}

function useDebounce<T>(value: T, delay: number): T {
  const [d, setD] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setD(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return d;
}

const greenIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: markerShadow,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});
const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: markerShadow,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

// ─── Autocomplete Input ───────────────────────────────────────────────────────
interface AutoInputProps {
  placeholder: string;
  value: string;
  coords: { lat: number; lng: number } | null;
  onChange: (v: string) => void;
  onSelect: (loc: MapLocation) => void;
  onClear: () => void;
  dotClass: string;
  label: string;
  extra?: React.ReactNode;
}

function AutoInput({ placeholder, value, coords, onChange, onSelect, onClear, dotClass, extra }: AutoInputProps) {
  const [suggestions, setSuggestions] = useState<NominatimResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounced = useDebounce(value, 450);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSuggestions([]);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!open || debounced.length < 3) { setSuggestions([]); return; }
    setLoading(true);
    searchPlaces(debounced).then(r => { setSuggestions(r); setLoading(false); });
  }, [debounced, open]);

  return (
    <div className="ride-map-field">
      <div className="ride-map-input-row" ref={wrapRef}>
        <span className={`ride-map-dot ${dotClass}`} />
        <div className="ride-map-input-group">
          {/* Input + X wrapped together so X stays inside */}
          <div className="ride-map-input-inner">
            <input
              type="text"
              className="ride-map-input"
              placeholder={placeholder}
              value={value}
              onChange={e => { onChange(e.target.value); setOpen(true); if (!e.target.value) onClear(); }}
              onFocus={() => setOpen(true)}
              autoComplete="off"
              style={{ paddingRight: value ? '2rem' : undefined }}
            />
            {value && (
              <button type="button" className="ride-map-clear-btn" onMouseDown={e => { e.preventDefault(); onChange(''); onClear(); setSuggestions([]); setOpen(false); }}>
                ×
              </button>
            )}
            {loading && <span className="ride-map-autocomplete-loading">…</span>}
            {open && suggestions.length > 0 && (
              <ul className="ride-map-suggestions">
                {suggestions.map(s => (
                  <li
                    key={s.place_id}
                    onMouseDown={e => {
                      e.preventDefault();
                      const name = shortName(s);
                      const loc: MapLocation = { name, lat: parseFloat(s.lat), lng: parseFloat(s.lon) };
                      onChange(name);
                      onSelect(loc);
                      setSuggestions([]);
                      setOpen(false);
                    }}
                  >
                    <span className="sugg-main">{shortName(s)}</span>
                    <span className="sugg-sub">{subName(s)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* 📍 button stays outside input as sibling */}
          {extra}
        </div>
      </div>
      {/* Location name + coordinates shown below input */}
      {coords && value ? (
        <div className="ride-map-coords">
          <span className="coords-label">📍 {value}</span>
          <span className="coords-value">{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</span>
        </div>
      ) : (
        <div className="ride-map-coords-placeholder">
          Chagua kutoka orodha au bonyeza ramani
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function RideMap({ onPickupChange, onDestinationChange, pickup, destination }: RideMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<L.Map | null>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const destMarkerRef = useRef<L.Marker | null>(null);

  const [pickupInput, setPickupInput] = useState(pickup?.name ?? '');
  const [destInput, setDestInput] = useState(destination?.name ?? '');
  const [locLoading, setLocLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapClickHint, setMapClickHint] = useState<'pickup' | 'destination' | null>(null);

  // Always-fresh refs for use inside map closure
  const onPickupRef = useRef(onPickupChange);
  const onDestRef = useRef(onDestinationChange);
  const pickupRef = useRef(pickup);
  const destRef = useRef(destination);

  useEffect(() => { onPickupRef.current = onPickupChange; }, [onPickupChange]);
  useEffect(() => { onDestRef.current = onDestinationChange; }, [onDestinationChange]);
  useEffect(() => { pickupRef.current = pickup; }, [pickup]);
  useEffect(() => { destRef.current = destination; }, [destination]);

  // ── Init map once ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || mapObjRef.current) return;

    const map = L.map(mapRef.current, { center: [DODOMA.lat, DODOMA.lng], zoom: 13 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    mapObjRef.current = map;
    setMapReady(true);

    map.on('click', async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      // Auto-detect: pickup first, then destination
      const target = !pickupRef.current ? 'pickup' : !destRef.current ? 'destination' : 'destination';
      const name = await reverseGeocode(lat, lng);
      const loc: MapLocation = { name, lat, lng };
      if (target === 'pickup') {
        onPickupRef.current(loc);
        setPickupInput(name);
        setMapClickHint('destination');
      } else {
        onDestRef.current(loc);
        setDestInput(name);
        setMapClickHint(null);
      }
    });

    return () => { map.remove(); mapObjRef.current = null; };
  }, []);

  // Show hint on first load
  useEffect(() => {
    if (!pickup) setMapClickHint('pickup');
  }, []);

  // ── Pickup marker ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map || !mapReady) return;
    if (pickup) {
      if (pickupMarkerRef.current) {
        pickupMarkerRef.current.setLatLng([pickup.lat, pickup.lng]);
      } else {
        pickupMarkerRef.current = L.marker([pickup.lat, pickup.lng], { icon: greenIcon })
          .addTo(map).bindPopup('Pickup');
      }
      setPickupInput(pickup.name);
    } else {
      pickupMarkerRef.current?.remove();
      pickupMarkerRef.current = null;
    }
  }, [pickup, mapReady]);

  // ── Destination marker ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map || !mapReady) return;
    if (destination) {
      if (destMarkerRef.current) {
        destMarkerRef.current.setLatLng([destination.lat, destination.lng]);
      } else {
        destMarkerRef.current = L.marker([destination.lat, destination.lng], { icon: redIcon })
          .addTo(map).bindPopup('Destination');
      }
      setDestInput(destination.name);
      if (pickup) {
        map.fitBounds(
          [[pickup.lat, pickup.lng], [destination.lat, destination.lng]],
          { padding: [40, 40] }
        );
      }
    } else {
      destMarkerRef.current?.remove();
      destMarkerRef.current = null;
    }
  }, [destination, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── GPS ───────────────────────────────────────────────────────────────
  const handleGPS = () => {
    if (!navigator.geolocation) { alert('Browser yako haiauni geolocation.'); return; }
    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude: lat, longitude: lng } }) => {
        const name = await reverseGeocode(lat, lng);
        onPickupRef.current({ name, lat, lng });
        mapObjRef.current?.setView([lat, lng], 15);
        setLocLoading(false);
        setMapClickHint('destination');
      },
      () => { setLocLoading(false); alert('Imeshindwa kupata eneo lako.'); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div className="ride-map-wrap">

      {/* ── Pickup ── */}
      <AutoInput
        label="Pickup GPS"
        placeholder="Mahali pa kuanzia (pickup)"
        value={pickupInput}
        coords={pickup ? { lat: pickup.lat, lng: pickup.lng } : null}
        onChange={setPickupInput}
        onSelect={loc => { onPickupRef.current(loc); setMapClickHint('destination'); }}
        onClear={() => { onPickupRef.current(null); setMapClickHint('pickup'); }}
        dotClass="dot-green"
        extra={
          <button type="button" className="ride-map-loc-btn" onClick={handleGPS} disabled={locLoading} title="Eneo langu sasa">
            {locLoading ? '…' : '📍'}
          </button>
        }
      />

      {/* ── Destination ── */}
      <AutoInput
        label="Destination GPS"
        placeholder="Unaenda wapi? (destination)"
        value={destInput}
        coords={destination ? { lat: destination.lat, lng: destination.lng } : null}
        onChange={setDestInput}
        onSelect={loc => { onDestRef.current(loc); setMapClickHint(null); }}
        onClear={() => { onDestRef.current(null); }}
        dotClass="dot-red"
      />

      {/* ── Map hint ── */}
      {mapClickHint && (
        <p className="ride-map-hint">
          {mapClickHint === 'pickup'
            ? '📌 Bonyeza sehemu yoyote kwenye ramani kuweka pickup'
            : '🏁 Sasa bonyeza destination kwenye ramani'}
        </p>
      )}

      {/* ── Map ── */}
      <div ref={mapRef} className="ride-map-canvas" />
    </div>
  );
}
