// Инвентаризация: ввод фактического остатка → расхождение → документ.
// Пагинация: каждая строка — контролируемый input, полный рендер тысяч
// товаров даёт заметный лаг ввода.
import { useEffect, useMemo, useState } from 'react'
import { Check, FileEdit, Search } from 'lucide-react'
import { Card, Button, Badge } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { num } from '@/shared/lib/format'
import { Toast } from './_shared'
import { companyCache } from '@/shared/lib/scopedCache'
import { refreshWarehouseStock, syncOutbox } from '@/shared/lib/cloud'
import { getAuthContext, isAuthContextCurrent } from '@/shared/api'
import { inventoryView } from '@/shared/lib/inventoryView'

const PAGE_SIZE = 100

function InventoryForm() {
  const products = useStore((s) => s.products)
  const addDocument = useStore((s) => s.addDocument)
  const warehouses = useStore((s) => s.warehouses)
  const companyId = useStore((s) => s.companyId)
  const userId = useStore((s) => s.authAccountId)
  const cloud = useStore((s) => s.cloud)
  const [warehouseId, setWarehouseId] = useState('')
  const [projection, setProjection] = useState(new Map())
  const [busy, setBusy] = useState(false)
  const [counts, setCounts] = useState({})
  const [q, setQ] = useState('')
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')

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
  const productIds = shown.map((p) => p.id).join('\u0000')
  useEffect(() => {
    let alive = true, timer
    const context = getAuthContext()
    const repaint = () => {
      if (!alive || !isAuthContextCurrent(context)) return
      try { setProjection(companyCache.warehouseProjection(context)) }
      catch (e) { setProjection(new Map()); setErr(e.message) }
    }
    const refresh = async () => {
      if (!alive || !cloud || !productIds || navigator.onLine === false || !isAuthContextCurrent(context)) return
      try {
        await refreshWarehouseStock(productIds.split('\u0000'), context)
        if (alive && isAuthContextCurrent(context)) { setErr(''); repaint() }
      } catch (e) { if (alive && isAuthContextCurrent(context) && e.code !== 'STOCK_REQUEST_SUPERSEDED') setErr(`Снимок не обновлён: ${e.message}`) }
    }
    const changed = () => { repaint(); clearTimeout(timer); timer = setTimeout(refresh, 200) }
    const unsubscribe = syncOutbox.onChange(changed)
    window.addEventListener('storage', changed); window.addEventListener('online', changed)
    return () => { alive = false; clearTimeout(timer); unsubscribe(); window.removeEventListener('storage', changed); window.removeEventListener('online', changed) }
  }, [productIds, companyId, userId, cloud])

  const rows = inventoryView(shown, projection, warehouseId, counts)
  const changed = inventoryView(products, projection, warehouseId, counts).filter((row) => row.changed)

  const submit = async (post) => {
    if (busy) return
    setErr('')
    if (!warehouseId) { setErr('Выберите склад'); return }
    if (!changed.length) return
    if (changed.some((row) => row.fact < 0 || row.fact > 1000000)) { setErr('Факт должен быть от 0 до 1 000 000'); return }
    const items = changed.map(({ product: p, fact, previous }) => ({ productId: p.id, name: p.name, unit: p.unit, qty: fact, prevStock: previous }))
    // F2-3: раньше результат addDocument отбрасывался — если было
    // расхождение (например, отрицательный факт при post=true) тост
    // «Применено» всё равно показывался, а документ не создавался.
    setBusy(true)
    try {
    const r = await addDocument({ type: 'inventory', warehouseId, reason: 'Инвентаризация', items }, { post })
    if (r && typeof r === 'object' && r.ok === false) {
      setErr(r.error || 'Не удалось провести документ')
      return
    }
    setDone(post ? `Сохранено локально по ${changed.length} позициям; подтверждение — после синхронизации` : `Черновик инвентаризации на ${changed.length} поз.`)
    setProjection(companyCache.warehouseProjection(getAuthContext()))
    setCounts({})
    setTimeout(() => setDone(''), 3000)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
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
            <Button disabled={busy} variant="soft" icon={FileEdit} onClick={() => submit(false)}>
              Черновик
            </Button>
            <Button disabled={busy} icon={Check} onClick={() => submit(true)}>
              Применить ({changed.length})
            </Button>
          </div>
        )}
      </div>
      <label className="block mb-3 text-sm">Склад инвентаризации
        <select aria-label="Склад инвентаризации" value={warehouseId} disabled={busy} className="block mt-1 h-10 px-3 border border-line rounded bg-surface" onChange={(e) => { setWarehouseId(e.target.value); setCounts({}); setDone('') }}>
          <option value="">Выберите склад</option>
          {warehouses.filter((w) => !w.deletedAt).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </label>
      <p className="mb-3 text-xs text-muted">Учёт — предварительный остаток выбранного склада. Без проверенного снимка или при неоднозначной операции прогноз недоступен.</p>
      {done && <div className="mb-3"><Toast>{done}</Toast></div>}
      {err && <div className="mb-3 text-[13px] text-bad p-3 rounded-xl bg-bad-soft/30">{err}</div>}

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
            {rows.map((row) => {
              const p = row.product
              const raw = counts[p.id]
              const diff = row.diff
              return (
                <tr key={p.id}>
                  <td className="py-2 px-2">
                    <div className="truncate">{p.name}</div>
                    <div className="text-[11px] text-muted">{p.sku}</div>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-muted">
                    {row.available ? <><div>{num(row.previous)} {p.unit}</div><div className="text-[11px]">Подтверждено: {num(row.confirmed)} · Всего: {num(row.total)}</div></> : <span title={row.reason}>Прогноз недоступен</span>}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <input
                      type="number"
                      aria-label={`Факт ${p.name}`}
                      min="0"
                      disabled={!row.available || busy}
                      value={raw ?? ''}
                      onChange={(e) => setCounts((c) => ({ ...c, [p.id]: e.target.value }))}
                      placeholder={row.available ? String(row.previous) : '—'}
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

export default function InventoryTab() {
  const companyId = useStore((s) => s.companyId)
  const userId = useStore((s) => s.authAccountId)
  return <InventoryForm key={`${userId}:${companyId}`} />
}
