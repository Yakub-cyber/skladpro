// Залы и столы — экран общепита. План-схема (SVG) с draggable-столами
// в режиме редактирования; в обычном режиме клик по столу открывает его
// заказ (создаёт если не был начат). Цвет стола:
//   свободен  — брендовый outline (нет открытого заказа)
//   занят     — зелёный fill (order.status='open', есть блюда)
//   готов к оплате — оранжевый (флаг order.readyToPay — на будущее)
// В шапке — селектор зала и переключатель «Редактор».
//
// Заказ на столик хранится в orders со статусом 'open' и полем tableId.
// «Оплатить» вызывает существующий сценарий кассы: переход на страницу
// заказа, где обычная кнопка «Провести/Оплатить» финализирует.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Plus,
  Trash2,
  Users,
  Pencil,
  Check,
  UtensilsCrossed,
  Coffee,
  Building,
  ArrowRight,
} from 'lucide-react'
import { Card, Button, Badge, Empty, Modal, Field, Input, Select, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'

const CELL = 60 // размер клетки в SVG-виеве

export default function Halls() {
  const halls = useStore((s) => s.halls) || []
  const tables = useStore((s) => s.tables) || []
  const orders = useStore((s) => s.orders) || []
  const addHall = useStore((s) => s.addHall)
  const addTable = useStore((s) => s.addTable)
  const updateTable = useStore((s) => s.updateTable)
  const removeTable = useStore((s) => s.removeTable)
  const openTableOrder = useStore((s) => s.openTableOrder)
  const nav = useNavigate()

  const [activeHallId, setActiveHallId] = useState(halls[0]?.id || null)
  useEffect(() => {
    // Если активный зал удалён — переключаемся на первый.
    if (!halls.find((h) => h.id === activeHallId)) setActiveHallId(halls[0]?.id || null)
  }, [halls, activeHallId])

  const [edit, setEdit] = useState(false)
  const [addHallOpen, setAddHallOpen] = useState(false)
  const [editingTable, setEditingTable] = useState(null) // { id, ... } или null

  const activeHall = halls.find((h) => h.id === activeHallId)
  const hallTables = tables.filter((t) => t.hallId === activeHallId)

  // Быстрый map: tableId → его открытый заказ (для отрисовки цветов/сумм)
  const openOrderByTable = useMemo(() => {
    const m = {}
    for (const o of orders) if (o.status === 'open' && o.tableId) m[o.tableId] = o
    return m
  }, [orders])

  const onTableClick = (t) => {
    if (edit) {
      setEditingTable(t)
      return
    }
    const id = openTableOrder(t.id)
    nav(`/orders?id=${id}`)
  }

  const onAddTable = () => {
    if (!activeHall) return
    const no = (hallTables.reduce((m, t) => Math.max(m, t.no || 0), 0) || 0) + 1
    addTable({
      hallId: activeHall.id,
      no,
      x: Math.floor((activeHall.w || 12) / 2),
      y: Math.floor((activeHall.h || 8) / 2),
      seats: 4,
      shape: 'round',
    })
  }

  if (!halls.length) {
    return (
      <div className="animate-fadeUp">
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight">Залы и столы</h2>
          <p className="text-sm text-muted">
            Для общепита. Клик по столу открывает его чек, редактор — расставит их на плане.
          </p>
        </div>
        <Empty
          icon={UtensilsCrossed}
          title="Нет ни одного зала"
          text="Создайте первый зал, чтобы разместить в нём столы."
          action={
            <Button icon={Plus} onClick={() => setAddHallOpen(true)}>
              Создать зал
            </Button>
          }
        />
        <AddHallModal
          open={addHallOpen}
          onClose={() => setAddHallOpen(false)}
          onCreate={(data) => {
            const id = addHall(data)
            setActiveHallId(id)
            setAddHallOpen(false)
          }}
        />
      </div>
    )
  }

  return (
    <div className="animate-fadeUp">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Залы и столы</h2>
          <p className="text-sm text-muted">
            {edit
              ? 'Редактор: тащите столы по плану, кликом открывайте настройки. Клик по пустому месту — новый стол.'
              : 'Клик по столу открывает его заказ. Цвет = состояние стола.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={activeHallId || ''}
            onChange={(e) => setActiveHallId(e.target.value)}
            className="min-w-[160px]"
          >
            {halls.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
          <Button
            variant="soft"
            icon={Plus}
            onClick={() => setAddHallOpen(true)}
            title="Новый зал"
          />
          <Button
            variant={edit ? 'primary' : 'soft'}
            icon={edit ? Check : Pencil}
            onClick={() => setEdit((v) => !v)}
          >
            {edit ? 'Готово' : 'Редактор'}
          </Button>
          {edit && (
            <Button variant="soft" icon={Plus} onClick={onAddTable}>
              Стол
            </Button>
          )}
        </div>
      </div>

      {activeHall && (
        <Card className="p-3">
          <HallMap
            hall={activeHall}
            tables={hallTables}
            openOrderByTable={openOrderByTable}
            editable={edit}
            onMove={(tid, x, y) => updateTable(tid, { x, y })}
            onTableClick={onTableClick}
          />
          {/* Легенда состояний */}
          <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-line text-[12px]">
            <Legend color="var(--surface-2)" label="свободен" />
            <Legend color="var(--ok, #10b981)" label="занят" />
            <Legend color="var(--warn, #f59e0b)" label="ждёт оплаты" />
          </div>
        </Card>
      )}

      <AddHallModal
        open={addHallOpen}
        onClose={() => setAddHallOpen(false)}
        onCreate={(data) => {
          const id = addHall(data)
          setActiveHallId(id)
          setAddHallOpen(false)
        }}
      />

      <TableSettingsModal
        table={editingTable}
        onClose={() => setEditingTable(null)}
        onSave={(patch) => {
          if (editingTable) updateTable(editingTable.id, patch)
          setEditingTable(null)
        }}
        onRemove={() => {
          if (editingTable) removeTable(editingTable.id)
          setEditingTable(null)
        }}
      />
    </div>
  )
}

function Legend({ color, label }) {
  return (
    <div className="flex items-center gap-1.5 text-muted">
      <span
        className="inline-block h-3 w-3 rounded-full border border-line"
        style={{ background: color }}
      />
      {label}
    </div>
  )
}

// SVG-план зала. Draggable-столы (только в editable-режиме). Форма
// стола — round / square. Открытый заказ подсвечивает стол зелёным,
// показывает сумму и число позиций.
function HallMap({ hall, tables, openOrderByTable, editable, onMove, onTableClick }) {
  const W = (hall.w || 12) * CELL
  const H = (hall.h || 8) * CELL
  const svgRef = useRef(null)
  const [drag, setDrag] = useState(null) // { id, x, y }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const toGrid = (clientX, clientY) => {
    const r = svgRef.current.getBoundingClientRect()
    return {
      x: ((clientX - r.left) / r.width) * (hall.w || 12),
      y: ((clientY - r.top) / r.height) * (hall.h || 8),
    }
  }
  const onPointerMove = (e) => {
    if (!drag) return
    const g = toGrid(e.clientX, e.clientY)
    setDrag((d) => ({ ...d, x: g.x, y: g.y }))
  }
  const endDrag = () => {
    if (!drag) return
    const x = clamp(Math.round(drag.x), 1, (hall.w || 12) - 1)
    const y = clamp(Math.round(drag.y), 1, (hall.h || 8) - 1)
    onMove?.(drag.id, x, y)
    setDrag(null)
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto select-none"
      style={{ maxHeight: '68vh', cursor: editable ? 'crosshair' : 'default' }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <defs>
        <pattern id="floorH" width={CELL} height={CELL} patternUnits="userSpaceOnUse">
          <path
            d={`M ${CELL} 0 L 0 0 0 ${CELL}`}
            fill="none"
            stroke="var(--border)"
            strokeWidth="1"
            opacity="0.4"
          />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#floorH)" rx="14" />
      <rect
        width={W}
        height={H}
        fill="none"
        stroke="var(--border)"
        strokeWidth="2"
        rx="14"
      />

      {tables.map((t) => {
        const isDragged = drag?.id === t.id
        const cx = (isDragged ? drag.x : t.x) * CELL
        const cy = (isDragged ? drag.y : t.y) * CELL
        const order = openOrderByTable[t.id]
        const occupied = !!order && (order.items?.length > 0)
        const opened = !!order
        const size = t.shape === 'square' ? 52 : 46
        const fill = occupied
          ? 'var(--ok, #10b981)'
          : opened
            ? 'var(--brand-soft)'
            : 'var(--surface-2)'
        const stroke = occupied ? '#fff' : 'var(--brand)'
        return (
          <g
            key={t.id}
            onClick={(e) => {
              if (drag) return
              e.stopPropagation()
              onTableClick?.(t)
            }}
            onPointerDown={(e) => {
              if (editable) {
                e.stopPropagation()
                setDrag({ id: t.id, x: t.x, y: t.y })
              }
            }}
            style={{ cursor: editable ? 'grab' : 'pointer' }}
            opacity={isDragged ? 0.85 : 1}
          >
            <title>
              {`Стол ${t.no} · ${t.seats} мест`}
              {order ? ` · ${order.items.length} поз., ${money(order.total)}` : ''}
            </title>
            {t.shape === 'square' ? (
              <rect
                x={cx - size / 2}
                y={cy - size / 2}
                width={size}
                height={size}
                rx="8"
                fill={fill}
                stroke={stroke}
                strokeWidth={occupied ? 3 : 2}
                strokeOpacity={occupied ? 1 : 0.7}
              />
            ) : (
              <circle
                cx={cx}
                cy={cy}
                r={size / 2}
                fill={fill}
                stroke={stroke}
                strokeWidth={occupied ? 3 : 2}
                strokeOpacity={occupied ? 1 : 0.7}
              />
            )}
            <text
              x={cx}
              y={cy - 3}
              textAnchor="middle"
              fontSize="16"
              fontWeight="800"
              fill={occupied ? '#fff' : 'var(--brand)'}
            >
              {t.no}
            </text>
            <text
              x={cx}
              y={cy + 12}
              textAnchor="middle"
              fontSize="9"
              fill={occupied ? 'rgba(255,255,255,.85)' : 'var(--muted)'}
            >
              {t.seats} мест
            </text>
            {/* Бейдж суммы над столом, если есть открытый заказ */}
            {order && order.items?.length > 0 && (
              <g>
                <rect
                  x={cx - 28}
                  y={cy - size / 2 - 24}
                  width={56}
                  height={18}
                  rx="8"
                  fill="var(--ok, #10b981)"
                />
                <text
                  x={cx}
                  y={cy - size / 2 - 11}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="700"
                  fill="#fff"
                >
                  {money(order.total)}
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function AddHallModal({ open, onClose, onCreate }) {
  const [name, setName] = useState('')
  useEffect(() => {
    if (open) setName('')
  }, [open])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новый зал"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            icon={Check}
            onClick={() => name.trim() && onCreate({ name: name.trim() })}
            disabled={!name.trim()}
          >
            Создать
          </Button>
        </>
      }
    >
      <Field label="Название зала">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Основной зал / Летняя веранда / VIP"
          autoFocus
        />
      </Field>
      <p className="text-[12px] text-muted mt-3">
        Столы добавляются на плане следующим шагом. Один зал вмещает до 96
        столов (12×8 клеток).
      </p>
    </Modal>
  )
}

function TableSettingsModal({ table, onClose, onSave, onRemove }) {
  const [no, setNo] = useState(1)
  const [seats, setSeats] = useState(4)
  const [shape, setShape] = useState('round')
  useEffect(() => {
    if (table) {
      setNo(table.no || 1)
      setSeats(table.seats || 4)
      setShape(table.shape || 'round')
    }
  }, [table])
  if (!table) return null
  return (
    <Modal
      open={!!table}
      onClose={onClose}
      title={`Стол №${table.no}`}
      footer={
        <>
          <Button variant="ghost" className="text-bad mr-auto" onClick={onRemove}>
            Удалить
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button icon={Check} onClick={() => onSave({ no: Number(no), seats: Number(seats), shape })}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Номер">
          <Input
            type="number"
            min="1"
            value={no}
            onChange={(e) => setNo(e.target.value)}
          />
        </Field>
        <Field label="Мест">
          <Input
            type="number"
            min="1"
            max="30"
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3">
        <span className="block text-[13px] font-medium text-muted mb-2">Форма</span>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'round', label: 'Круглый' },
            { key: 'square', label: 'Квадратный' },
          ].map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setShape(s.key)}
              className={cx(
                'h-10 rounded-xl text-[13px] font-medium border transition',
                shape === s.key
                  ? 'bg-brand text-brand-ink border-brand'
                  : 'bg-surface-2 border-line text-muted hover:text-ink',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
