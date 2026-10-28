import { useEffect, useState } from 'react'
import { useStore } from '@/shared/store/useStore'
import { companyCache } from '@/shared/lib/scopedCache'
import { refreshWarehouseStock, syncOutbox } from '@/shared/lib/cloud'
import { getAuthContext, isAuthContextCurrent } from '@/shared/api'
import { saleWarehouseError } from '@/shared/lib/saleV2'
import { num } from '@/shared/lib/format'

export default function SaleWarehouse({ value, onChange, onProjection, items = [], label = 'Склад продажи', disabled = false }) {
  const warehouses = useStore((s) => s.warehouses), products = useStore((s) => s.products)
  const companyId = useStore((s) => s.companyId), userId = useStore((s) => s.authAccountId), cloud = useStore((s) => s.cloud)
  const [projection, setProjection] = useState(new Map()), [error, setError] = useState('')
  const productIds = [...new Set(items.length ? items.map((i) => i.productId) : products.slice(0, 100).map((p) => p.id))].sort().join('\u0000')
  useEffect(() => { onChange('') }, [companyId, userId, onChange])
  useEffect(() => { onProjection?.(projection) }, [projection, onProjection])
  useEffect(() => {
    let alive = true, timer
    const context = getAuthContext()
    const repaint = () => {
      if (!alive || !isAuthContextCurrent(context)) return
      try { setProjection(companyCache.warehouseProjection(context)) }
      catch (e) { setProjection(new Map()); setError(e.message) }
    }
    const refresh = async () => {
      if (!cloud || !productIds || navigator.onLine === false || !alive || !isAuthContextCurrent(context)) return
      try { await refreshWarehouseStock(productIds.split('\u0000'), context); if (alive && isAuthContextCurrent(context)) { setError(''); repaint() } }
      catch (e) { if (alive && isAuthContextCurrent(context) && e.code !== 'STOCK_REQUEST_SUPERSEDED') setError(`Снимок не обновлён: ${e.message}`) }
    }
    const changed = () => { repaint(); clearTimeout(timer); timer = setTimeout(refresh, 200) }
    changed()
    const unsubscribe = syncOutbox.onChange(changed)
    window.addEventListener('storage', changed); window.addEventListener('online', changed)
    return () => { alive = false; clearTimeout(timer); unsubscribe(); window.removeEventListener('storage', changed); window.removeEventListener('online', changed) }
  }, [productIds, companyId, userId, cloud])
  return <div className="mb-3 space-y-1">
    <label className="text-sm">{label}
      <select disabled={disabled} aria-label={label} className="w-full rounded-lg border border-line bg-surface p-2" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Выберите склад</option>
        {(warehouses || []).filter((w) => !saleWarehouseError([w], w.id)).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
    </label>
    {value && items.map((item) => {
      const view = projection.get(item.productId), pair = view?.warehouses[value]
      return <div key={item.productId} className="text-xs text-muted" data-testid="sale-stock">
        {item.name || item.productId}: {view?.available && pair ? `Склад: ${num(pair.projected)} · Всего: ${num(view.total)}` : 'Прогноз недоступен'}
      </div>
    })}
    {error && <div role="status" className="text-xs text-bad">{error}</div>}
  </div>
}
