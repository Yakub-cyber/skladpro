import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Package, ClipboardList, Users, CornerDownLeft } from 'lucide-react'
import { useStore } from '../store/useStore'
import { NAV } from './Layout'
import { cx } from './ui'
import { money } from '../lib/format'

export default function CommandPalette({ open, setOpen }) {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const products = useStore((s) => s.products)
  const orders = useStore((s) => s.orders)
  const customers = useStore((s) => s.customers)

  // Глобальный хоткей Ctrl/Cmd+K
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
    }
  }, [open])

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = []
    NAV.filter((n) => !s || n.label.toLowerCase().includes(s))
      .slice(0, s ? 3 : NAV.length)
      .forEach((n) =>
        out.push({ type: 'Разделы', label: n.label, to: n.to, icon: n.icon }),
      )
    if (s) {
      products
        .filter(
          (p) =>
            p.name.toLowerCase().includes(s) ||
            p.sku.toLowerCase().includes(s) ||
            p.tags.some((t) => t.includes(s)),
        )
        .slice(0, 5)
        .forEach((p) =>
          out.push({
            type: 'Товары',
            label: p.name,
            hint: `${p.sku} · ${money(p.price)} · ост. ${p.stock}`,
            to: `/products?q=${encodeURIComponent(p.name)}`,
            icon: Package,
          }),
        )
      orders
        .filter(
          (o) =>
            o.no.toLowerCase().includes(s) ||
            o.customerName.toLowerCase().includes(s),
        )
        .slice(0, 4)
        .forEach((o) =>
          out.push({
            type: 'Заказы',
            label: o.no,
            hint: `${o.customerName} · ${money(o.total)}`,
            to: `/orders?id=${o.id}`,
            icon: ClipboardList,
          }),
        )
      customers
        .filter((c) => c.name.toLowerCase().includes(s))
        .slice(0, 4)
        .forEach((c) =>
          out.push({
            type: 'Клиенты',
            label: c.name,
            hint: c.city,
            to: `/customers?id=${c.id}`,
            icon: Users,
          }),
        )
    }
    return out
  }, [q, products, orders, customers])

  useEffect(() => setActive(0), [q])

  const go = (r) => {
    if (!r) return
    nav(r.to)
    setOpen(false)
  }

  if (!open) return null

  // Группировка по type
  const groups = results.reduce((acc, r, i) => {
    ;(acc[r.type] ||= []).push({ ...r, i })
    return acc
  }, {})

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="card w-full max-w-xl overflow-hidden animate-fadeUp"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 h-14 border-b border-line">
          <Search size={19} className="text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown')
                setActive((a) => Math.min(results.length - 1, a + 1))
              if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1))
              if (e.key === 'Enter') go(results[active])
            }}
            placeholder="Найти товар, заказ, клиента или раздел…"
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-muted"
          />
          <kbd className="text-[11px] px-1.5 h-5 grid place-items-center rounded bg-surface-2 border border-line text-muted">
            ESC
          </kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <div className="text-center text-muted text-sm py-10">
              Ничего не найдено по «{q}»
            </div>
          )}
          {Object.entries(groups).map(([type, items]) => (
            <div key={type} className="mb-1">
              <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-muted font-medium">
                {type}
              </div>
              {items.map((r) => (
                <button
                  key={r.i}
                  onMouseEnter={() => setActive(r.i)}
                  onClick={() => go(r)}
                  className={cx(
                    'w-full flex items-center gap-3 px-2.5 h-11 rounded-lg text-left',
                    active === r.i ? 'bg-brand-soft' : 'hover:bg-surface-2',
                  )}
                >
                  <r.icon
                    size={17}
                    className={active === r.i ? 'text-brand' : 'text-muted'}
                  />
                  <span className="flex-1 text-sm truncate">{r.label}</span>
                  {r.hint && (
                    <span className="text-[12px] text-muted truncate">{r.hint}</span>
                  )}
                  {active === r.i && (
                    <CornerDownLeft size={14} className="text-muted" />
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
