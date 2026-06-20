import { useMemo, useState } from 'react'
import {
  Search,
  MapPin,
  Plus,
  Route as RouteIcon,
  X,
  PackageSearch,
  Navigation,
} from 'lucide-react'
import { Card, Button, Badge, Empty, cx } from '../components/ui'
import WarehouseMap from '../components/WarehouseMap'
import { useStore } from '../store/useStore'
import { num } from '../lib/format'
import { buildPickRoute } from '../lib/ai'
import { cellById } from '../store/seed'

const ZONES = [
  { z: 'A–B', name: 'Крепёж', color: '#f59e0b' },
  { z: 'C–D', name: 'Инструмент', color: '#7c6cff' },
  { z: 'E', name: 'Электрика', color: '#38bdf8' },
  { z: 'F', name: 'Сантехника', color: '#10b981' },
  { z: 'G', name: 'ЛКМ', color: '#f43f5e' },
  { z: 'H', name: 'Расходники', color: '#94a3b8' },
]

export default function Warehouse() {
  const { products, cells } = useStore()
  const [q, setQ] = useState('')
  const [pick, setPick] = useState([]) // productId[]
  const [activeCell, setActiveCell] = useState(null)
  const [showRoute, setShowRoute] = useState(false)

  const found = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        p.sku.toLowerCase().includes(s) ||
        p.tags.some((t) => t.includes(s)),
    )
  }, [products, q])

  const pickProducts = pick
    .map((id) => products.find((p) => p.id === id))
    .filter(Boolean)

  const route = useMemo(() => {
    if (!showRoute || pickProducts.length === 0) return null
    const pts = pickProducts.map((p) => cellById(p.cell)).filter(Boolean)
    return buildPickRoute(pts)
  }, [showRoute, pickProducts])

  // что подсвечивать: маршрут > выбранное > результаты поиска > активная ячейка
  const highlight = route
    ? pickProducts.map((p) => p.cell)
    : pick.length
      ? pickProducts.map((p) => p.cell)
      : found.length
        ? [...new Set(found.map((p) => p.cell))]
        : activeCell
          ? [activeCell]
          : []

  const cellItems = activeCell
    ? products.filter((p) => p.cell === activeCell)
    : []

  const togglePick = (id) =>
    setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <div className="animate-fadeUp">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">Карта склада</h2>
        <p className="text-sm text-muted">
          Найдите товар — карта покажет ячейку. Соберите список и постройте короткий маршрут.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-5">
        <Card className="p-3">
          <WarehouseMap
            cells={cells}
            products={products}
            highlight={highlight}
            route={route}
            onCellClick={(id) => {
              setActiveCell(id)
              setShowRoute(false)
            }}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-2 px-2 pt-3 mt-2 border-t border-line">
            {ZONES.map((z) => (
              <div key={z.z} className="flex items-center gap-1.5 text-[12px] text-muted">
                <span
                  className="w-3 h-3 rounded"
                  style={{ background: z.color }}
                />
                <span className="font-medium text-ink">{z.z}</span> {z.name}
              </div>
            ))}
            <div className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className="w-2.5 h-2.5 rounded-full bg-bad" /> низкий остаток
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          {/* Поиск */}
          <Card className="p-4">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setActiveCell(null)
                  setShowRoute(false)
                }}
                placeholder="Где лежит товар?"
                className="w-full h-11 pl-9 pr-3 rounded-xl bg-surface-2 border border-line outline-none focus:border-brand text-sm"
              />
            </div>

            {q && (
              <div className="mt-3 space-y-1.5 max-h-[40vh] overflow-y-auto no-scrollbar">
                {found.length === 0 && (
                  <p className="text-sm text-muted text-center py-4">
                    Не найдено по «{q}»
                  </p>
                )}
                {found.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-surface-2 transition"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate">{p.name}</div>
                      <div className="text-[12px] text-muted flex items-center gap-1">
                        <MapPin size={11} /> Ячейка {p.cell} · ост. {num(p.stock)} {p.unit}
                      </div>
                    </div>
                    <button
                      onClick={() => togglePick(p.id)}
                      className={cx(
                        'h-7 w-7 grid place-items-center rounded-lg shrink-0 transition',
                        pick.includes(p.id)
                          ? 'bg-brand text-brand-ink'
                          : 'bg-surface-3 text-muted hover:text-ink',
                      )}
                      title="В список сборки"
                    >
                      {pick.includes(p.id) ? <X size={14} /> : <Plus size={14} />}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!q && !activeCell && (
              <Empty
                icon={PackageSearch}
                title="Поиск по складу"
                text="Введите название — подсветим ячейку на карте."
              />
            )}
          </Card>

          {/* Содержимое ячейки */}
          {activeCell && (
            <Card className="p-4 animate-fadeUp">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <MapPin size={16} className="text-brand" /> Ячейка {activeCell}
                </h4>
                <button onClick={() => setActiveCell(null)} className="text-muted hover:text-ink">
                  <X size={16} />
                </button>
              </div>
              {cellItems.length ? (
                <div className="space-y-1.5">
                  {cellItems.map((p) => (
                    <div
                      key={p.id}
                      className="flex justify-between items-center text-sm py-1"
                    >
                      <span className="truncate pr-2">{p.name}</span>
                      <Badge tone={p.stock <= p.minStock ? 'bad' : 'muted'}>
                        {num(p.stock)} {p.unit}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted py-2">Ячейка пуста</p>
              )}
            </Card>
          )}

          {/* Список сборки → маршрут */}
          {pick.length > 0 && (
            <Card className="p-4 animate-fadeUp">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold flex items-center gap-2">
                  <Navigation size={16} className="text-brand" /> Список сборки
                </h4>
                <Badge tone="brand">{pick.length}</Badge>
              </div>
              <div className="space-y-1 mb-3">
                {pickProducts.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-2 text-[13px]">
                    <span className="text-muted w-4">{i + 1}.</span>
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-muted">{p.cell}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  icon={RouteIcon}
                  className="flex-1"
                  onClick={() => setShowRoute((v) => !v)}
                >
                  {showRoute ? 'Скрыть маршрут' : 'Маршрут'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setPick([]); setShowRoute(false) }}>
                  Очистить
                </Button>
              </div>
              {route && (
                <div className="mt-3 pt-3 border-t border-line text-[13px] text-muted">
                  Короткий обход: <span className="text-brand font-semibold">~{route.distance} м</span>{' '}
                  через {route.order.length} {route.order.length === 1 ? 'точку' : 'точек'} и возврат на выдачу.
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
