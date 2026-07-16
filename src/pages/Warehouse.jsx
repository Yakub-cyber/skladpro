import { useMemo, useState } from 'react'
import {
  Search,
  MapPin,
  Plus,
  Route as RouteIcon,
  X,
  PackageSearch,
  Navigation,
  Pencil,
  Trash2,
  Building2,
  Check,
  Move,
  Warehouse as WhIcon,
} from 'lucide-react'
import { Card, Button, Badge, Empty, Modal, Field, Input, Select, cx } from '../components/ui'
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
  const {
    products,
    cells,
    warehouses,
    activeWarehouseId,
    setActiveWarehouse,
    addCell,
    updateCell,
    removeCell,
    moveProduct,
    setWorkZone,
  } = useStore()
  const activeWh = warehouses.find((w) => w.id === activeWarehouseId)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState([])
  const [activeCell, setActiveCell] = useState(null)
  const [showRoute, setShowRoute] = useState(false)
  const [edit, setEdit] = useState(false)
  const [addWh, setAddWh] = useState(false)

  const whCells = cells.filter((c) => c.warehouseId === activeWarehouseId)
  const whProducts = products.filter((p) => p.warehouseId === activeWarehouseId)

  const found = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return whProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        p.sku.toLowerCase().includes(s) ||
        p.tags?.some((t) => t.includes(s)),
    )
  }, [whProducts, q])

  const pickProducts = pick.map((id) => products.find((p) => p.id === id)).filter(Boolean)
  const route = useMemo(() => {
    if (!showRoute || !pickProducts.length) return null
    const pts = pickProducts.map((p) => cellById(p.cell, activeWarehouseId)).filter(Boolean)
    return buildPickRoute(pts)
  }, [showRoute, pickProducts, activeWarehouseId])

  const highlight = route
    ? pickProducts.map((p) => p.cell)
    : pick.length
      ? pickProducts.map((p) => p.cell)
      : found.length
        ? [...new Set(found.map((p) => p.cell))]
        : activeCell
          ? [whCells.find((c) => c.id === activeCell)?.code]
          : []

  const selCell = whCells.find((c) => c.id === activeCell)
  const cellItems = selCell ? whProducts.filter((p) => p.cell === selCell.code) : []
  const togglePick = (id) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const onCellAdd = (x, y) => {
    const zone = String.fromCharCode(65 + Math.min(7, Math.floor((x - 1) / 2)))
    addCell({ code: `${zone}${y}`, zone, x, y })
  }

  return (
    <div className="animate-fadeUp">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Карта склада</h2>
          <p className="text-sm text-muted">
            {edit
              ? 'Режим редактирования: тащите ячейки и рабочие зоны (Приёмка / Выдача / Сборка), кликом по полу — добавляйте новые ячейки.'
              : 'Найдите товар — карта покажет ячейку. Соберите список и постройте маршрут.'}
          </p>
        </div>
        <Button
          variant={edit ? 'primary' : 'soft'}
          icon={edit ? Check : Pencil}
          onClick={() => {
            setEdit((v) => !v)
            setActiveCell(null)
            setQ('')
          }}
        >
          {edit ? 'Готово' : 'Редактировать'}
        </Button>
      </div>

      {/* Переключатель складов */}
      <div className="flex items-center gap-1.5 mb-4 overflow-x-auto no-scrollbar">
        {warehouses.map((w) => (
          <button
            key={w.id}
            onClick={() => {
              setActiveWarehouse(w.id)
              setActiveCell(null)
              setPick([])
            }}
            className={cx(
              'flex items-center gap-2 px-3.5 h-10 rounded-xl text-[13px] font-medium whitespace-nowrap transition',
              w.id === activeWarehouseId ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink',
            )}
          >
            <WhIcon size={15} /> {w.name}
            <span className="opacity-70">
              {cells.filter((c) => c.warehouseId === w.id).length}
            </span>
          </button>
        ))}
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => setAddWh(true)}>
          Склад
        </Button>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-5">
        <Card className="p-3">
          <WarehouseMap
            cells={whCells}
            products={whProducts}
            highlight={highlight}
            route={route}
            editable={edit}
            selectedCell={activeCell}
            workZones={activeWh?.workZones}
            onZoneMove={(zoneId, x, y) => setWorkZone(activeWarehouseId, zoneId, { x, y })}
            onCellMove={(id, x, y) => updateCell(id, { x, y })}
            onCellAdd={onCellAdd}
            onCellClick={(id) => {
              setActiveCell(id)
              setShowRoute(false)
            }}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-2 px-2 pt-3 mt-2 border-t border-line">
            {ZONES.map((z) => (
              <div key={z.z} className="flex items-center gap-1.5 text-[12px] text-muted">
                <span className="w-3 h-3 rounded" style={{ background: z.color }} />
                <span className="font-medium text-ink">{z.z}</span> {z.name}
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          {/* Редактор ячейки */}
          {edit && selCell ? (
            <CellEditor
              cell={selCell}
              items={cellItems}
              cells={whCells}
              warehouseId={activeWarehouseId}
              onRename={(patch) => updateCell(selCell.id, patch)}
              onRemove={() => {
                removeCell(selCell.id)
                setActiveCell(null)
              }}
              onMoveProduct={(pid, code) => moveProduct(pid, activeWarehouseId, code)}
              onClose={() => setActiveCell(null)}
            />
          ) : edit ? (
            <Card className="p-4">
              <Empty
                icon={Move}
                title="Редактор размещения"
                text="Перетащите ячейку, кликните пустое место для новой ячейки или выберите ячейку для переноса товара."
              />
            </Card>
          ) : (
            <>
              {/* Поиск */}
              <Card className="p-4">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
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
                      <p className="text-sm text-muted text-center py-4">Не найдено на этом складе</p>
                    )}
                    {found.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-surface-2 transition">
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
                            pick.includes(p.id) ? 'bg-brand text-brand-ink' : 'bg-surface-3 text-muted hover:text-ink',
                          )}
                        >
                          {pick.includes(p.id) ? <X size={14} /> : <Plus size={14} />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {!q && !activeCell && (
                  <Empty icon={PackageSearch} title="Поиск по складу" text="Введите название — подсветим ячейку." />
                )}
              </Card>

              {/* Содержимое ячейки (просмотр) */}
              {activeCell && selCell && (
                <Card className="p-4 animate-fadeUp">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold flex items-center gap-2">
                      <MapPin size={16} className="text-brand" /> Ячейка {selCell.code}
                    </h4>
                    <button onClick={() => setActiveCell(null)} className="text-muted hover:text-ink">
                      <X size={16} />
                    </button>
                  </div>
                  {cellItems.length ? (
                    <div className="space-y-1.5">
                      {cellItems.map((p) => (
                        <div key={p.id} className="flex justify-between items-center text-sm py-1">
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
                    <Button size="sm" icon={RouteIcon} className="flex-1" onClick={() => setShowRoute((v) => !v)}>
                      {showRoute ? 'Скрыть маршрут' : 'Маршрут'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setPick([]); setShowRoute(false) }}>
                      Очистить
                    </Button>
                  </div>
                  {route && (
                    <div className="mt-3 pt-3 border-t border-line text-[13px] text-muted">
                      Короткий обход: <span className="text-brand font-semibold">~{route.distance} м</span> и возврат.
                    </div>
                  )}
                </Card>
              )}
            </>
          )}
        </div>
      </div>

      <AddWarehouseModal open={addWh} onClose={() => setAddWh(false)} />
    </div>
  )
}

function CellEditor({ cell, items, cells, onRename, onRemove, onMoveProduct, onClose }) {
  return (
    <Card className="p-4 animate-fadeUp">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold flex items-center gap-2">
          <Pencil size={16} className="text-brand" /> Ячейка
        </h4>
        <button onClick={onClose} className="text-muted hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Код">
          <Input value={cell.code} onChange={(e) => onRename({ code: e.target.value, zone: e.target.value[0]?.toUpperCase() })} />
        </Field>
        <Field label="Зона">
          <Input value={cell.zone} onChange={(e) => onRename({ zone: e.target.value.toUpperCase() })} maxLength={1} />
        </Field>
      </div>

      <div className="mt-4">
        <div className="text-[13px] font-medium text-muted mb-2">
          Товары в ячейке ({items.length})
        </div>
        {items.length ? (
          <div className="space-y-2">
            {items.map((p) => (
              <div key={p.id} className="p-2 rounded-lg bg-surface-2">
                <div className="text-[13px] font-medium truncate">{p.name}</div>
                <div className="flex items-center gap-2 mt-1.5">
                  <Move size={13} className="text-muted shrink-0" />
                  <Select
                    value={cell.code}
                    onChange={(e) => onMoveProduct(p.id, e.target.value)}
                    className="h-8 text-[13px]"
                  >
                    {cells.map((c) => (
                      <option key={c.id} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Пусто</p>
        )}
      </div>

      <Button variant="ghost" icon={Trash2} className="text-bad mt-4 w-full" onClick={onRemove}>
        Удалить ячейку
      </Button>
    </Card>
  )
}

function AddWarehouseModal({ open, onClose }) {
  const addWarehouse = useStore((s) => s.addWarehouse)
  const [f, setF] = useState({ name: '', address: '' })
  const save = () => {
    if (!f.name) return
    addWarehouse(f)
    setF({ name: '', address: '' })
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новый склад"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={save} disabled={!f.name} icon={Check}>Создать</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Название">
          <Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="Напр. «Склад на Зорге»" />
        </Field>
        <Field label="Адрес">
          <Input value={f.address} onChange={(e) => setF((s) => ({ ...s, address: e.target.value }))} />
        </Field>
        <p className="text-[13px] text-muted flex items-center gap-2">
          <Building2 size={14} /> После создания добавьте ячейки в режиме редактирования.
        </p>
      </div>
    </Modal>
  )
}
