// ──────────────────────────────────────────────────────────────────────────
//  Маршрут доставки заказов по городу.
//  Решает задачу коммивояжёра (TSP): склад → точки клиентов → склад,
//  минимизируя путь. Жадный nearest-neighbour + улучшение 2-opt.
// ──────────────────────────────────────────────────────────────────────────

export const DEPOT = { x: 9, y: 32, label: 'Склад' }

// Карта зоны доставки (условные единицы). 1 ед ≈ 0.3 км.
export const MAP_W = 100
export const MAP_H = 64
const KM_PER_UNIT = 0.3
const SPEED_KMH = 30 // средняя скорость по городу
const MIN_PER_STOP = 8 // разгрузка/передача на точке

// Детерминированные координаты точки доставки из id заказа
function hash(str = '') {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function geoFor(order) {
  if (order.geo) return order.geo
  const h = hash(order.id + (order.address || ''))
  const x = 16 + ((h % 1000) / 1000) * 78 // 16..94
  const y = 7 + (((h >> 10) % 1000) / 1000) * 50 // 7..57
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

function totalDist(points, order, depot) {
  let d = dist(depot, points[order[0]])
  for (let i = 0; i < order.length - 1; i++) {
    d += dist(points[order[i]], points[order[i + 1]])
  }
  d += dist(points[order[order.length - 1]], depot)
  return d
}

// Главная: массив точек {x,y,...} → оптимальный порядок объезда
export function buildDeliveryRoute(points, depot = DEPOT) {
  const n = points.length
  if (n === 0) return { order: [], distanceKm: 0, minutes: 0, legs: [] }

  // 1) nearest-neighbour от склада
  const visited = new Array(n).fill(false)
  let order = []
  let cur = depot
  for (let k = 0; k < n; k++) {
    let bi = -1
    let bd = Infinity
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue
      const d = dist(cur, points[i])
      if (d < bd) {
        bd = d
        bi = i
      }
    }
    visited[bi] = true
    order.push(bi)
    cur = points[bi]
  }

  // 2) улучшение 2-opt
  let improved = true
  let guard = 0
  while (improved && guard++ < 60) {
    improved = false
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = order.slice(0, i)
        const b = order.slice(i, j + 1).reverse()
        const c = order.slice(j + 1)
        const cand = [...a, ...b, ...c]
        if (totalDist(points, cand, depot) + 1e-6 < totalDist(points, order, depot)) {
          order = cand
          improved = true
        }
      }
    }
  }

  const units = totalDist(points, order, depot)
  const distanceKm = Math.round(units * KM_PER_UNIT * 10) / 10
  const minutes = Math.round((distanceKm / SPEED_KMH) * 60 + n * MIN_PER_STOP)

  // плечи маршрута (для подписи расстояний между точками)
  const seq = [depot, ...order.map((i) => points[i]), depot]
  const legs = []
  for (let i = 0; i < seq.length - 1; i++) {
    legs.push(Math.round(dist(seq[i], seq[i + 1]) * KM_PER_UNIT * 10) / 10)
  }

  return { order, distanceKm, minutes, legs }
}

export const fmtDuration = (min) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h} ч ${m} мин` : `${m} мин`
}
