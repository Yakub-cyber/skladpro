import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const isDark = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

function depotIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:9px;background:#10b981;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);display:grid;place-items:center;color:#fff;font-size:15px">🏭</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}
function stopIcon(n, priority) {
  const bg = priority ? '#f43f5e' : '#7c6cff'
  return L.divIcon({
    className: '',
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);display:grid;place-items:center;color:#fff;font-weight:700;font-size:13px">${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

function FitBounds({ pts }) {
  const map = useMap()
  useEffect(() => {
    if (pts.length) {
      map.fitBounds(
        pts.map((p) => [p.lat, p.lng]),
        { padding: [40, 40], maxZoom: 14 },
      )
    }
  }, [pts, map])
  return null
}

export default function DeliveryMapLeaflet({ depot, stops = [], line = null, className }) {
  const dark = isDark()
  const tile = dark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

  const allPts = useMemo(() => [depot, ...stops], [depot, stops])
  // линия маршрута: реальные дороги (OSRM) или прямые между точками
  const routeLine = line || [depot, ...stops, depot].map((p) => [p.lat, p.lng])

  return (
    <div className={className}>
      <MapContainer
        center={[depot.lat, depot.lng]}
        zoom={12}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%', borderRadius: '12px', background: 'var(--surface-2)' }}
      >
        <TileLayer
          url={tile}
          attribution='&copy; OpenStreetMap &copy; CARTO'
          subdomains="abcd"
        />
        <FitBounds pts={allPts} />
        <Polyline positions={routeLine} pathOptions={{ color: '#7c6cff', weight: 4, opacity: 0.85 }} />
        <Marker position={[depot.lat, depot.lng]} icon={depotIcon()}>
          <Popup>{depot.label || 'Склад'}</Popup>
        </Marker>
        {stops.map((s) => (
          <Marker key={s.id || s.n} position={[s.lat, s.lng]} icon={stopIcon(s.n, s.priority)}>
            <Popup>
              <b>
                {s.n}. {s.title}
              </b>
              <br />
              {s.label}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
