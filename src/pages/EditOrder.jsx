// Правка оптового заказа — отдельная страница, а не модалка. Для оптовика
// с 100+ позициями модалка со вложенным скроллом мучительна; здесь —
// плотная таблица во всю ширину, Tab-навигация по qty/price, Ctrl+S
// сохраняет, «/» фокусирует поиск для добавления новой строки.
//
// Обращения к сторе те же, что были в старом EditOrderModal:
// updateOrder(id, patch) возвращает {ok:false, error} при недопустимом
// состоянии (например, отгружённый заказ).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Plus, Search, Trash2, Save, X } from 'lucide-react'
import { Card, Button, Badge, Empty, cx } from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'

export default function EditOrder() {
  const nav = useNavigate()
  const { id } = useParams()
  const order = useStore((s) => s.orders.find((o) => o.id === id))
  const products = useStore((s) => s.products)
  const updateOrder = useStore((s) => s.updateOrder)

  const [rows, setRows] = useState([])
  const [discount, setDiscount] = useState(0)
  const [onCredit, setOnCredit] = useState(false)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const searchRef = useRef(null)
  const qtyRefs = useRef({})

  // Инициализация формы из заказа. Если заказ пришёл позже (лениво из
  // useStore.subscribe) — пересинхронизируемся, но только пока пользователь
  // ещё не изменил ничего (dirty=false).
  useEffect(() => {
    if (!order) return
    if (dirty) return
    setRows((order.items || []).map((it) => ({ ...it })))
    setDiscount(Number(order.discount) || 0)
    setOnCredit(!!order.onCredit)
  }, [order, dirty])

  const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000

  const setQty = (pid, qty) => {
    setDirty(true)
    setRows((r) =>
      qty <= 0
        ? r.filter((x) => x.productId !== pid)
        : r.map((x) => (x.productId === pid ? { ...x, qty } : x)),
    )
  }
  const setPrice = (pid, price) => {
    setDirty(true)
    setRows((r) =>
      r.map((x) => (x.productId === pid ? { ...x, price: Math.max(0, Number(price) || 0) } : x)),
    )
  }
  const addProduct = (p) => {
    setDirty(true)
    setRows((r) =>
      r.find((x) => x.productId === p.id)
        ? r.map((x) => (x.productId === p.id ? { ...x, qty: round3(x.qty + 1) } : x))
        : [
            ...r,
            {
              productId: p.id,
              name: p.name,
              sku: p.sku,
              qty: 1,
              price: Number(p.price) || 0,
              basePrice: Number(p.price) || 0,
              unit: p.unit,
              cell: p.cell,
              weighted: p.weighted,
            },
          ],
    )
    setQ('')
    searchRef.current?.focus()
  }

  const subtotal = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.price) || 0), 0)
  const total = Math.round(subtotal * (1 - (Number(discount) || 0) / 100))

  const suggest = useMemo(() => {
    if (!q) return []
    const s = q.toLowerCase()
    return products
      .filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s))
      .slice(0, 8)
  }, [q, products])

  const save = () => {
    setErr('')
    if (!rows.length) {
      setErr('В заказе не может быть 0 позиций — отмените заказ вместо редактирования')
      return
    }
    const r = updateOrder(order.id, {
      items: rows,
      subtotal,
      total,
      discount: Number(discount) || 0,
      onCredit,
    })
    if (r && r.ok === false) return setErr(r.error)
    setDirty(false)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1200)
  }

  // Хоткеи: Ctrl+S сохранить, «/» фокус поиска (если не в поле).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      } else if (
        e.key === '/' &&
        !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
      ) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, discount, onCredit, subtotal, total])

  if (!order) {
    return (
      <div className="animate-fadeUp">
        <Empty icon={Search} title="Заказ не найден" text="Возможно, он удалён или отменён." />
      </div>
    )
  }

  const canEdit = !order.stockConsumed && order.status !== 'cancelled'

  return (
    <div className="animate-fadeUp pb-24">
      <div className="flex items-center gap-3 mb-4">
        <Button
          variant="ghost"
          size="icon"
          icon={ArrowLeft}
          onClick={() => nav(`/orders?id=${order.id}`)}
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight truncate">
            Правка заказа {order.no}
          </h2>
          <p className="text-sm text-muted truncate">
            {order.customerName} · {rows.length} поз. · итого {money(total)}
          </p>
        </div>
        {savedFlash && <Badge tone="ok">Сохранено</Badge>}
        <Button
          variant="ghost"
          onClick={() => nav(`/orders?id=${order.id}`)}
          className="hidden sm:inline-flex"
        >
          Отмена
        </Button>
        <Button icon={dirty ? Save : Check} onClick={save} disabled={!canEdit || !rows.length}>
          Сохранить <kbd className="ml-1 text-[10px] hidden md:inline">Ctrl+S</kbd>
        </Button>
      </div>

      {!canEdit && (
        <div className="mb-4 p-3 rounded-xl bg-warn-soft text-warn text-[13px]">
          Заказ отгружён или отменён — правка недоступна.
        </div>
      )}

      {/* Быстрый поиск для добавления новой строки. Enter добавляет
          первый результат — типичный ввод оптовика. */}
      <div className="relative mb-3">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && suggest[0]) {
              e.preventDefault()
              addProduct(suggest[0])
            } else if (e.key === 'Escape') {
              setQ('')
            }
          }}
          placeholder='Добавить товар: название / SKU / штрихкод… (клавиша «/»)'
          className="w-full h-11 pl-9 pr-3 rounded-xl bg-surface-2 border border-line outline-none focus:border-brand text-[15px]"
        />
        {suggest.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-20 card p-1 max-h-72 overflow-y-auto">
            {suggest.map((p) => (
              <button
                key={p.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addProduct(p)}
                className="w-full flex items-center justify-between gap-3 px-3 h-10 rounded-lg hover:bg-surface-2 text-left text-[13px]"
              >
                <span className="truncate flex-1">{p.name}</span>
                <span className="text-muted text-[11px] shrink-0 tabular-nums">
                  {p.sku}
                </span>
                <span className="font-medium tabular-nums shrink-0 w-20 text-right">
                  {money(p.price)}
                </span>
                <span className="text-[11px] text-muted shrink-0 w-12 text-right">
                  {num(p.stock)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty
          icon={Trash2}
          title="Все позиции удалены"
          text="Добавьте товар через поиск сверху или отмените заказ."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2/60 border-b border-line">
              <tr className="text-muted text-left">
                <th className="py-2 px-3 font-medium w-20">SKU</th>
                <th className="py-2 px-3 font-medium">Название</th>
                <th className="py-2 px-3 font-medium text-right w-28">Кол-во</th>
                <th className="py-2 px-3 font-medium text-right w-32">Цена</th>
                <th className="py-2 px-3 font-medium text-right w-28">Сумма</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, idx) => {
                const base = Number(r.basePrice ?? r.price) || 0
                const price = Number(r.price) || 0
                const discounted = base > 0 && price < base
                return (
                  <tr key={r.productId} className="hover:bg-surface-2/40">
                    <td className="py-1.5 px-3 tabular-nums text-muted">{r.sku || '—'}</td>
                    <td className="py-1.5 px-3">
                      <div className="font-medium truncate max-w-[420px]">{r.name}</div>
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      <input
                        ref={(el) => (qtyRefs.current[r.productId] = el)}
                        type="number"
                        value={r.qty}
                        min="0"
                        step={r.weighted ? '0.1' : '1'}
                        onChange={(e) => setQty(r.productId, Math.max(0, +e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            const nextRow = rows[idx + 1]
                            if (nextRow) qtyRefs.current[nextRow.productId]?.focus()
                            else searchRef.current?.focus()
                          }
                        }}
                        className="w-full h-8 px-2 rounded-lg bg-surface border border-line text-sm text-right tabular-nums"
                      />
                    </td>
                    <td className="py-1.5 px-3 text-right">
                      <input
                        type="number"
                        value={r.price}
                        min="0"
                        step="0.01"
                        onChange={(e) => setPrice(r.productId, e.target.value)}
                        className={cx(
                          'w-full h-8 px-2 rounded-lg bg-surface border text-sm text-right tabular-nums',
                          discounted ? 'border-ok text-ok font-medium' : 'border-line',
                        )}
                      />
                      {discounted && (
                        <div className="text-[10px] text-muted line-through tabular-nums mt-0.5">
                          {money(base)}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-right font-semibold tabular-nums">
                      {money((Number(r.qty) || 0) * price)}
                    </td>
                    <td className="py-1.5 pr-2">
                      <button
                        onClick={() => setQty(r.productId, 0)}
                        className="text-muted hover:text-bad grid place-items-center h-7 w-7 rounded-lg"
                        title="Убрать строку"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Итог + скидка + в долг */}
      <div className="mt-4 rounded-2xl bg-surface p-4 flex flex-wrap items-center gap-4 border border-line">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={onCredit}
            onChange={(e) => {
              setOnCredit(e.target.checked)
              setDirty(true)
            }}
            className="accent-[var(--brand)] w-4 h-4"
          />
          В долг
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] text-muted">Скидка</span>
          <input
            type="number"
            min="0"
            max="100"
            value={discount}
            onChange={(e) => {
              setDiscount(e.target.value)
              setDirty(true)
            }}
            className="w-16 h-9 px-2 rounded-lg bg-surface-2 border border-line text-sm text-center"
          />
          <span className="text-[13px] text-muted">%</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {discount > 0 && (
            <span className="text-sm text-muted line-through tabular-nums">
              {money(subtotal)}
            </span>
          )}
          <span className="text-2xl font-bold tabular-nums">{money(total)}</span>
        </div>
      </div>

      {err && <div className="mt-3 text-[13px] text-bad">{err}</div>}
    </div>
  )
}
