// Инвентаризация: ввод фактического остатка → расхождение → документ.
// Пагинация: каждая строка — контролируемый input, полный рендер тысяч
// товаров даёт заметный лаг ввода.
import { useEffect, useMemo, useState } from 'react'
import { Check, FileEdit, Search } from 'lucide-react'
import { Card, Button, Badge } from '../../components/ui'
import { useStore } from '../../store/useStore'
import { num } from '../../lib/format'
import { Toast } from './_shared'

const PAGE_SIZE = 100

export default function InventoryTab() {
  const products = useStore((s) => s.products)
  const addDocument = useStore((s) => s.addDocument)
  const [counts, setCounts] = useState({})
  const [q, setQ] = useState('')
  const [done, setDone] = useState('')

  const list = useMemo(() => {
    const s = q.toLowerCase()
    return products.filter((p) => {
      // Услуги и комплекты не инвентаризируются — у них нет собственных
      // партий/остатка. Комплект считается через составляющие.
      if (p.type && p.type !== 'product') return false
      return !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)
    })
  }, [products, q])

  const [visible, setVisible] = useState(PAGE_SIZE)
  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [q])
  const shown = list.slice(0, visible)

  const changed = Object.entries(counts).filter(([id, v]) => {
    const p = products.find((x) => x.id === id)
    return p && v !== '' && Number(v) !== p.stock
  })

  const submit = (post) => {
    const items = changed.map(([id, v]) => {
      const p = products.find((x) => x.id === id)
      return { productId: id, name: p.name, unit: p.unit, qty: Number(v), prevStock: p.stock }
    })
    addDocument({ type: 'inventory', reason: 'Инвентаризация', items }, { post })
    setDone(post ? `Применено по ${changed.length} позициям` : `Черновик инвентаризации на ${changed.length} поз.`)
    setCounts({})
    setTimeout(() => setDone(''), 3000)
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold">Инвентаризация</h3>
          <p className="text-[13px] text-muted">Введите фактический остаток — система покажет расхождения.</p>
        </div>
        {changed.length > 0 && (
          <div className="flex gap-2">
            <Button variant="soft" icon={FileEdit} onClick={() => submit(false)}>
              Черновик
            </Button>
            <Button icon={Check} onClick={() => submit(true)}>
              Применить ({changed.length})
            </Button>
          </div>
        )}
      </div>
      {done && <div className="mb-3"><Toast>{done}</Toast></div>}

      <div className="relative mb-3 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск товара…"
          className="w-full h-10 pl-9 pr-3 rounded-xl bg-surface-2 border border-line outline-none focus:border-brand text-sm"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-[12px] text-left border-b border-line">
              <th className="font-medium py-2 px-2">Товар</th>
              <th className="font-medium py-2 px-2 text-right">Учёт</th>
              <th className="font-medium py-2 px-2 text-right">Факт</th>
              <th className="font-medium py-2 px-2 text-right">Расхождение</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((p) => {
              const raw = counts[p.id]
              const fact = raw === '' || raw == null ? null : Number(raw)
              const diff = fact == null ? null : fact - p.stock
              return (
                <tr key={p.id}>
                  <td className="py-2 px-2">
                    <div className="truncate">{p.name}</div>
                    <div className="text-[11px] text-muted">{p.sku}</div>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-muted">
                    {num(p.stock)} {p.unit}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <input
                      type="number"
                      value={raw ?? ''}
                      onChange={(e) => setCounts((c) => ({ ...c, [p.id]: e.target.value }))}
                      placeholder={String(p.stock)}
                      className="w-20 h-9 px-2 rounded-lg bg-surface-2 border border-line text-sm text-right outline-none focus:border-brand"
                    />
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {diff == null || diff === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <Badge tone={diff > 0 ? 'ok' : 'bad'}>
                        {diff > 0 ? '+' : ''}
                        {num(diff)}
                      </Badge>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {visible < list.length && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-[12px] text-muted">
            Показано {shown.length} из {list.length}
          </div>
          <Button variant="soft" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            Показать ещё {Math.min(PAGE_SIZE, list.length - visible)}
          </Button>
        </div>
      )}
    </Card>
  )
}
