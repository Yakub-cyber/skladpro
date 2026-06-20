import { DEPOT, MAP_W, MAP_H, geoFor } from '../lib/geo'

// orders — выбранные заказы; route — результат buildDeliveryRoute (order = индексы в orders)
export default function DeliveryMap({ orders = [], route = null, className }) {
  const points = orders.map((o) => ({ ...geoFor(o), o }))

  // последовательность точек по маршруту (или просто все точки)
  const seq = route?.order?.length
    ? [DEPOT, ...route.order.map((i) => points[i]), DEPOT]
    : null

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="w-full h-auto select-none">
        <defs>
          <pattern id="blocks" width="12" height="12" patternUnits="userSpaceOnUse">
            <rect width="12" height="12" fill="none" />
            <path d="M12 0 H0 V12" fill="none" stroke="var(--border)" strokeWidth="0.4" />
          </pattern>
          <filter id="dglow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="1.5" floodColor="var(--brand)" floodOpacity="0.8" />
          </filter>
        </defs>

        {/* фон-кварталы */}
        <rect width={MAP_W} height={MAP_H} rx="3" fill="var(--surface-2)" />
        <rect width={MAP_W} height={MAP_H} rx="3" fill="url(#blocks)" />
        {/* пара «главных дорог» для антуража */}
        <path d={`M0 ${MAP_H * 0.5} H${MAP_W}`} stroke="var(--border)" strokeWidth="1.2" />
        <path d={`M${MAP_W * 0.45} 0 V${MAP_H}`} stroke="var(--border)" strokeWidth="1.2" />

        {/* маршрут */}
        {seq && (
          <polyline
            points={seq.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="var(--brand)"
            strokeWidth="1.1"
            strokeLinejoin="round"
            strokeLinecap="round"
            className="route-flow"
          />
        )}

        {/* точки заказов */}
        {points.map((p, idx) => {
          const step = route ? route.order.indexOf(idx) : -1
          const label = step >= 0 ? step + 1 : '•'
          const prio = p.o.priority
          return (
            <g key={p.o.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r="2.6"
                fill={prio ? 'var(--color-bad)' : 'var(--brand)'}
                stroke="#fff"
                strokeWidth="0.5"
                filter={step >= 0 ? 'url(#dglow)' : undefined}
              />
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="2.6"
                fontWeight="700"
                fill="#fff"
              >
                {label}
              </text>
            </g>
          )
        })}

        {/* склад */}
        <g>
          <rect
            x={DEPOT.x - 3}
            y={DEPOT.y - 3}
            width="6"
            height="6"
            rx="1.2"
            fill="var(--color-ok)"
            stroke="#fff"
            strokeWidth="0.5"
          />
          <path
            d={`M${DEPOT.x - 1.6} ${DEPOT.y + 0.4} V${DEPOT.y - 0.6} L${DEPOT.x} ${DEPOT.y - 1.8} L${DEPOT.x + 1.6} ${DEPOT.y - 0.6} V${DEPOT.y + 0.4} Z`}
            fill="#fff"
          />
          <text x={DEPOT.x} y={DEPOT.y + 6} textAnchor="middle" fontSize="2.8" fontWeight="600" fill="var(--color-ok)">
            Склад
          </text>
        </g>
      </svg>
    </div>
  )
}
