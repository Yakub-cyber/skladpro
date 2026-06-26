import { useMemo, useRef, useState } from 'react'
import { GRID_W, GRID_H, ENTRANCE, RECEIVING } from '../lib/constants'

const U = 60
const W = GRID_W * U
const H = GRID_H * U
const S = 46 // размер ячейки

const ZONE_COLOR = {
  A: '#f59e0b',
  B: '#f59e0b',
  C: '#7c6cff',
  D: '#7c6cff',
  E: '#38bdf8',
  F: '#10b981',
  G: '#f43f5e',
  H: '#94a3b8',
}
const colorOf = (zone) => ZONE_COLOR[zone] || '#94a3b8'
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

export default function WarehouseMap({
  cells = [],
  products = [],
  highlight = [],
  route = null,
  onCellClick,
  editable = false,
  onCellMove,
  onCellAdd,
  selectedCell = null,
  className,
}) {
  const hi = useMemo(() => new Set(highlight), [highlight])
  const svgRef = useRef(null)
  const [drag, setDrag] = useState(null) // { id, x, y } во время перетаскивания

  // что лежит в ячейке (по коду)
  const byCell = useMemo(() => {
    const m = {}
    for (const p of products) (m[p.cell] ||= []).push(p)
    return m
  }, [products])

  const routePts = route?.order?.length
    ? [ENTRANCE, ...route.order, ENTRANCE].map((c) => ({ x: c.x * U, y: c.y * U }))
    : null

  const toGrid = (clientX, clientY) => {
    const r = svgRef.current.getBoundingClientRect()
    return {
      x: ((clientX - r.left) / r.width) * GRID_W,
      y: ((clientY - r.top) / r.height) * GRID_H,
    }
  }
  const onMove = (e) => {
    if (!drag) return
    const g = toGrid(e.clientX, e.clientY)
    setDrag((d) => ({ ...d, x: g.x, y: g.y }))
  }
  const endDrag = () => {
    if (!drag) return
    const x = clamp(Math.round(drag.x), 1, GRID_W - 1)
    const y = clamp(Math.round(drag.y), 1, GRID_H - 1)
    if (!cells.some((c) => c.id !== drag.id && c.x === x && c.y === y)) {
      onCellMove?.(drag.id, x, y)
    }
    setDrag(null)
  }
  const onBgClick = (e) => {
    if (!editable || drag) return
    const g = toGrid(e.clientX, e.clientY)
    const x = Math.round(g.x)
    const y = Math.round(g.y)
    if (x < 1 || x >= GRID_W || y < 1 || y >= GRID_H) return
    if (!cells.some((c) => c.x === x && c.y === y)) onCellAdd?.(x, y)
  }

  return (
    <div className={className}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto select-none"
        style={{ maxHeight: '64vh', cursor: editable ? 'crosshair' : 'default' }}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClick={onBgClick}
      >
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="var(--brand)" floodOpacity="0.9" />
          </filter>
          <pattern id="floor" width={U} height={U} patternUnits="userSpaceOnUse">
            <path d={`M ${U} 0 L 0 0 0 ${U}`} fill="none" stroke="var(--border)" strokeWidth="1" opacity="0.5" />
          </pattern>
        </defs>

        <rect width={W} height={H} fill="url(#floor)" rx="14" />
        <rect width={W} height={H} fill="none" stroke="var(--border)" strokeWidth="2" rx="14" />

        <ServicePoint x={RECEIVING.x * U} y={RECEIVING.y * U} label={RECEIVING.label} color="#38bdf8" />
        <ServicePoint x={ENTRANCE.x * U} y={ENTRANCE.y * U} label={ENTRANCE.label} color="var(--brand)" star />

        {routePts && (
          <>
            <polyline
              points={routePts.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
              className="route-flow"
              opacity="0.95"
            />
            {route.order.map((c, i) => (
              <g key={i}>
                <circle cx={c.x * U} cy={c.y * U - S / 2 - 10} r="11" fill="var(--brand)" />
                <text x={c.x * U} y={c.y * U - S / 2 - 10} textAnchor="middle" dominantBaseline="central" fontSize="13" fontWeight="700" fill="#fff">
                  {i + 1}
                </text>
              </g>
            ))}
          </>
        )}

        {cells.map((c) => {
          const isDragged = drag?.id === c.id
          const cx = (isDragged ? drag.x : c.x) * U
          const cy = (isDragged ? drag.y : c.y) * U
          const items = byCell[c.code] || []
          const isHi = hi.has(c.code) || hi.has(c.id)
          const isSel = selectedCell === c.id
          const low = items.some((p) => p.stock <= p.minStock)
          const color = colorOf(c.zone)
          return (
            <g
              key={c.id}
              onClick={(e) => {
                e.stopPropagation()
                if (!drag) onCellClick?.(c.id)
              }}
              onPointerDown={(e) => {
                if (editable) {
                  e.stopPropagation()
                  setDrag({ id: c.id, x: c.x, y: c.y })
                }
              }}
              style={{ cursor: editable ? 'grab' : onCellClick ? 'pointer' : 'default' }}
              filter={isHi ? 'url(#glow)' : undefined}
              opacity={isDragged ? 0.85 : 1}
            >
              <title>{`Ячейка ${c.code}${items.length ? ' · ' + items.map((p) => p.name).join(', ') : ' · пусто'}`}</title>
              <rect
                x={cx - S / 2}
                y={cy - S / 2}
                width={S}
                height={S}
                rx="8"
                fill={isHi ? color : `color-mix(in srgb, ${color} 22%, var(--surface))`}
                stroke={isSel ? 'var(--brand)' : isHi ? '#fff' : color}
                strokeWidth={isSel ? 3 : isHi ? 2.5 : 1.3}
                strokeOpacity={isSel || isHi ? 1 : 0.55}
              />
              <text x={cx} y={cy - 4} textAnchor="middle" fontSize="13" fontWeight="700" fill={isHi ? '#fff' : color}>
                {c.code}
              </text>
              <text x={cx} y={cy + 11} textAnchor="middle" fontSize="9" fill={isHi ? 'rgba(255,255,255,.85)' : 'var(--muted)'}>
                {items.length ? `${items.length} SKU` : '—'}
              </text>
              {low && !isHi && <circle cx={cx + S / 2 - 6} cy={cy - S / 2 + 6} r="3.5" fill="#f43f5e" />}
              {isHi && (
                <g>
                  <circle cx={cx + S / 2 - 2} cy={cy - S / 2 + 2} r="9" fill="#fff" />
                  <path d={`M ${cx + S / 2 - 6} ${cy - S / 2 + 2} l 2.5 2.5 l 5 -5`} stroke={color} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function ServicePoint({ x, y, label, color, star }) {
  return (
    <g>
      <rect x={x - S / 2} y={y - S / 2} width={S} height={S} rx="10" fill={`color-mix(in srgb, ${color} 18%, var(--surface))`} stroke={color} strokeWidth="2" strokeDasharray="5 4" />
      {star ? (
        <path d={starPath(x, y - 2, 11, 5)} fill={color} />
      ) : (
        <path d={`M ${x - 9} ${y - 6} h 18 v 12 h -18 z M ${x - 9} ${y - 2} h 18`} fill="none" stroke={color} strokeWidth="2" />
      )}
      <text x={x} y={y + S / 2 + 12} textAnchor="middle" fontSize="10" fontWeight="600" fill={color}>
        {label}
      </text>
    </g>
  )
}

function starPath(cx, cy, R, r) {
  let d = ''
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r
    const a = (Math.PI / 5) * i - Math.PI / 2
    d += `${i === 0 ? 'M' : 'L'} ${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)} `
  }
  return d + 'Z'
}
