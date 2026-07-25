// ──────────────────────────────────────────────────────────────────────────
//  Доставка по реальной карте (Казань). Координаты lat/lng, метрика —
//  гаверсинус. Порядок объезда — TSP (nearest-neighbour + 2-opt).
//  Реальный маршрут по дорогам — OSRM (с откатом на прямые линии).
// ──────────────────────────────────────────────────────────────────────────

// Склад (промзона на въезде в город)
export const DEPOT = { lat: 55.748, lng: 49.213, label: 'Склад' }

// Центр зоны доставки
const CENTER = { lat: 55.796, lng: 49.106 }
const SPREAD = 0.07 // ~7 км разброс точек

const SPEED_KMH = 28
const MIN_PER_STOP = 8

function hash(str = '') {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Детерминированные координаты точки доставки заказа в пределах города
export function geoLatLng(order) {
  if (order.geo?.lat) return order.geo
  const h = hash(order.id + (order.address || ''))
  const dx = ((h % 1000) / 1000 - 0.5) * 2 * SPREAD
  const dy = (((h >> 10) % 1000) / 1000 - 0.5) * 2 * SPREAD
  return {
    lat: +(CENTER.lat + dy).toFixed(5),
    lng: +(CENTER.lng + dx * 1.6).toFixed(5),
  }
}

export function haversineKm(a, b) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// Оптимальный порядок объезда. points: [{lat,lng,...}]
export function buildDeliveryRoute(points, depot = DEPOT) {
  const n = points.length
  if (!n) return { order: [], distanceKm: 0, minutes: 0, legs: [] }

  // nearest-neighbour
  const visited = new Array(n).fill(false)
  let order = []
  let cur = depot
  for (let k = 0; k < n; k++) {
    let bi = -1
    let bd = Infinity
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue
      const d = haversineKm(cur, points[i])
      if (d < bd) {
        bd = d
        bi = i
      }
    }
    visited[bi] = true
    order.push(bi)
    cur = points[bi]
  }

  const total = (ord) => {
    let d = haversineKm(depot, points[ord[0]])
    for (let i = 0; i < ord.length - 1; i++) d += haversineKm(points[ord[i]], points[ord[i + 1]])
    return d + haversineKm(points[ord[ord.length - 1]], depot)
  }

  // 2-opt
  let improved = true
  let guard = 0
  while (improved && guard++ < 60) {
    improved = false
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)]
        if (total(cand) + 1e-9 < total(order)) {
          order = cand
          improved = true
        }
      }
    }
  }

  const km = total(order)
  const seq = [depot, ...order.map((i) => points[i]), depot]
  const legs = []
  for (let i = 0; i < seq.length - 1; i++) {
    legs.push(Math.round(haversineKm(seq[i], seq[i + 1]) * 10) / 10)
  }
  return {
    order,
    distanceKm: Math.round(km * 10) / 10,
    minutes: Math.round((km / SPEED_KMH) * 60 + n * MIN_PER_STOP),
    legs,
  }
}

// Реальный маршрут по дорогам через OSRM. waypoints: [{lat,lng}].
// Возвращает { line: [[lat,lng]...], km, min } или null при ошибке.
export async function fetchOsrmRoute(waypoints) {
  if (waypoints.length < 2) return null
  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    const data = await res.json()
    const r = data.routes?.[0]
    if (!r) return null
    return {
      line: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      km: Math.round((r.distance / 1000) * 10) / 10,
      min: Math.round(r.duration / 60),
    }
  } catch {
    return null
  }
}

export const fmtDuration = (min) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h} ч ${m} мин` : `${m} мин`
}

// Геокодирование адреса через Nominatim (OpenStreetMap, публичный,
// без ключа). Простой in-memory кэш + троттлинг 1 запрос в секунду
// (условие честного использования). Возвращает { lat, lng } или null.
//
// Реальная работа: юзер вводит адрес в NewOrder → debounce 800 мс →
// вызывает geocodeAddress → сохраняем в order.geo. На Delivery.jsx
// geoLatLng сразу подхватывает order.geo первым делом.
const _geoCache = new Map()
let _geoLastAt = 0

export async function geocodeAddress(query) {
  const q = String(query || '').trim()
  if (q.length < 4) return null
  if (_geoCache.has(q)) return _geoCache.get(q)

  // Троттлинг: не чаще 1 запроса в секунду (Nominatim usage policy).
  const now = Date.now()
  const wait = Math.max(0, _geoLastAt + 1000 - now)
  if (wait) await new Promise((r) => setTimeout(r, wait))
  _geoLastAt = Date.now()

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=ru`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(t)
    const arr = await res.json()
    const hit = arr?.[0]
    if (!hit?.lat || !hit?.lon) {
      _geoCache.set(q, null)
      return null
    }
    const geo = {
      lat: +Number(hit.lat).toFixed(5),
      lng: +Number(hit.lon).toFixed(5),
      displayName: hit.display_name || q,
    }
    _geoCache.set(q, geo)
    return geo
  } catch {
    return null
  }
}
