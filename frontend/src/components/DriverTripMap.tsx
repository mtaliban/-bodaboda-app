import { useEffect, useRef } from 'react';
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

interface Props {
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  destinationLat: number;
  destinationLng: number;
  destinationAddress: string;
}

export default function DriverTripMap({
  pickupLat,
  pickupLng,
  pickupAddress,
  destinationLat,
  destinationLng,
  destinationAddress,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    // Green marker for pickup
    const greenIcon = new L.Icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
      shadowUrl: markerShadow,
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    });

    // Red marker for destination
    const redIcon = new L.Icon({
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
      shadowUrl: markerShadow,
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    });

    L.marker([pickupLat, pickupLng], { icon: greenIcon })
      .addTo(map)
      .bindPopup(pickupAddress)
      .openPopup();

    L.marker([destinationLat, destinationLng], { icon: redIcon })
      .addTo(map)
      .bindPopup(destinationAddress);

    map.fitBounds(
      [[pickupLat, pickupLng], [destinationLat, destinationLng]],
      { padding: [40, 40] }
    );

    return () => {
      map.remove();
    };
  }, [pickupLat, pickupLng, pickupAddress, destinationLat, destinationLng, destinationAddress]);

  return <div ref={containerRef} className="driver-trip-map" />;
}

// Wrapper that safely handles null/undefined lat/lng
export function DriverTripMapSafe(props: Partial<Props> & { pickupAddress: string; destinationAddress: string }) {
  const { pickupLat, pickupLng, destinationLat, destinationLng } = props;
  if (
    pickupLat == null || pickupLng == null ||
    destinationLat == null || destinationLng == null
  ) {
    return null;
  }
  return (
    <DriverTripMap
      pickupLat={pickupLat}
      pickupLng={pickupLng}
      pickupAddress={props.pickupAddress}
      destinationLat={destinationLat}
      destinationLng={destinationLng}
      destinationAddress={props.destinationAddress}
    />
  );
}
