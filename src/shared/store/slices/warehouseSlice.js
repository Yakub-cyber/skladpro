import { uid } from '../../lib/id'
import { DEFAULT_WORK_ZONES } from '../../lib/constants'
import { effectivePlan, PLAN_LIMITS } from '../../lib/subscription'

function planLimits(sub) {
  const eff = effectivePlan(sub, new Date())
  return PLAN_LIMITS[eff] || PLAN_LIMITS.free
}

export const createWarehouseSlice = (set, get) => ({
  // ── Складские операции (с журналом движений) ─────────────
  // Legacy actions receiveOp/writeOff/returnStock/supplierReturn
  // удалены — UI везде проводит движения через addDocument({type})
  // → applyDocToState (lib/posting.js), включая FIFO по партиям.
  // Инвентаризация — единственная operational-функция, оставшаяся
  // самостоятельной (движок для неё в posting.js есть, но раритетный
  // фолбэк без партий тоже сохранён).

  // Инвентаризация: counts = { productId: фактический остаток }
  applyInventory: (counts) => {
    let changed = 0
    set((s) => {
      const moves = []
      const products = s.products.map((p) => {
        if (!(p.id in counts)) return p
        const fact = Number(counts[p.id])
        const delta = fact - p.stock
        if (delta !== 0) {
          changed++
          moves.push({
            id: uid('mv'),
            type: 'inventory',
            productId: p.id,
            name: p.name,
            qty: Math.abs(delta),
            delta,
            reason: delta > 0 ? 'Излишек' : 'Недостача',
            by: s.authUserId,
            at: new Date().toISOString(),
          })
        }
        return { ...p, stock: fact }
      })
      return { products, movements: [...moves, ...s.movements] }
    })
    get().logAction(`Инвентаризация: скорректировано ${changed} поз.`, {
      section: 'Склад',
      type: 'inventory',
    })
  },
  // Перемещение между складами/ячейками (общий остаток не меняется)
  // B7: частичное перемещение. Раньше `transferStock` двигал ВЕСЬ
  // остаток (просто переписывал warehouseId), а параметр `qty`
  // ложился только в reason движения. Теперь:
  //   - `qty >= p.stock` (или не указан) — переезжает весь товар
  //     (backward compat, изменения нет);
  //   - `qty < p.stock` — на исходном складе создаём отдельную
  //     карточку-«близнеца» c оставшимся остатком, а сам товар
  //     переезжает с частичным `qty` на новый склад.
  // Идентичные копии на разных складах различаются `warehouseId`
  // и `cell`; поле `sku` и `id` разные. Это осознанный
  // компромисс: полноценный multi-store требует переработки
  // модели (product.stocks[whId]), но для типового склада с
  // 1-2 точками работает.
  transferStock: (productId, toWarehouseId, toCell, qty) => {
    const p = get().products.find((x) => x.id === productId)
    if (!p) return { ok: false, error: 'Товар не найден' }
    const whName = (id) => get().warehouses?.find((w) => w.id === id)?.name || '—'
    const from = `${whName(p.warehouseId)}${p.cell ? ' · ' + p.cell : ''}`
    const to = `${whName(toWarehouseId)}${toCell ? ' · ' + toCell : ''}`
    const n = Number(qty) || 0
    const stock = Number(p.stock) || 0
    const partial = n > 0 && n < stock
    set((s) => {
      const movement = {
        id: uid('mv'),
        type: 'transfer',
        productId,
        name: p.name,
        qty: partial ? n : stock,
        delta: 0,
        reason: `Перемещение: ${from} → ${to}${partial ? ` (частично ${n}/${stock})` : ''}`,
        by: s.authUserId,
        at: new Date().toISOString(),
      }
      if (!partial) {
        // Целиком: старый путь.
        return {
          products: s.products.map((x) =>
            x.id === productId
              ? { ...x, warehouseId: toWarehouseId || x.warehouseId, cell: toCell || x.cell }
              : x,
          ),
          movements: [movement, ...s.movements],
        }
      }
      // Частично: исходную карточку уменьшаем, создаём копию на
      // новом складе с перенесённой частью. batches, если есть,
      // «переезжают» пропорционально n/stock (округление вниз).
      const ratio = n / stock
      const copyBatches = (p.batches || []).map((b) => ({
        id: uid('b'),
        qty: Math.floor((Number(b.qty) || 0) * ratio),
        cost: b.cost,
        at: b.at,
      }))
      const remainBatches = (p.batches || []).map((b, i) => ({
        ...b,
        qty: (Number(b.qty) || 0) - (copyBatches[i]?.qty || 0),
      }))
      // F2-2: раньше копия несла тот же SKU — ломало импорт CSV
      // (bySku[sku]=p давал недетерминированный маппинг), поиск
      // и сканер штрихкода. Добавляем суффикс `·<whShort>` из
      // первых 2 символов имени склада или из его id, чтобы SKU
      // остался уникальным. При обратном перемещении суффикс
      // будет наращиваться — это лучше, чем дубль.
      const whShort = (whName(toWarehouseId) || String(toWarehouseId || 'wh'))
        .replace(/[^\wа-яА-Я]/g, '')
        .slice(0, 3)
        .toUpperCase()
      const suffix = whShort ? `·${whShort}` : `·${uid('w').slice(-3)}`
      const copy = {
        ...p,
        id: uid('p'),
        sku: p.sku + suffix,
        stock: n,
        warehouseId: toWarehouseId || p.warehouseId,
        cell: toCell || p.cell,
        batches: copyBatches,
      }
      return {
        products: [
          copy,
          ...s.products.map((x) =>
            x.id === productId ? { ...x, stock: stock - n, batches: remainBatches } : x,
          ),
        ],
        movements: [movement, ...s.movements],
      }
    })
    get().logAction(
      `Перемещение «${p.name}»: ${from} → ${to}${partial ? ` (${n}/${stock})` : ''}`,
      { section: 'Склад', type: 'transfer' },
    )
    return { ok: true }
  },

  // ── Склады и ячейки (редактор размещения) ────────────────
  setActiveWarehouse: (id) => set({ activeWarehouseId: id }),
  addWarehouse: (w) => {
    // F3-2: гейт по плану. У free — 1 склад.
    const st = get()
    const limits = planLimits(st.settings?.subscription)
    if (
      Number.isFinite(limits.warehouses) &&
      (st.warehouses || []).length >= limits.warehouses
    ) {
      return {
        ok: false,
        error: `План «${limits.label}» позволяет ${limits.warehouses} склад(ов). Улучшите тариф.`,
      }
    }
    const id = uid('wh')
    set((s) => ({ warehouses: [...s.warehouses, { id, ...w }], activeWarehouseId: id }))
    get().logAction(`Добавлен склад «${w.name}»`, { section: 'Склады', type: 'create' })
    return { ok: true, id }
  },
  removeWarehouse: (id) =>
    set((s) => {
      if (s.warehouses.length <= 1) return {}
      const hasGoods = s.products.some((p) => p.warehouseId === id)
      if (hasGoods) return {} // нельзя удалить склад с товарами
      return {
        warehouses: s.warehouses.filter((w) => w.id !== id),
        cells: s.cells.filter((c) => c.warehouseId !== id),
        activeWarehouseId:
          s.activeWarehouseId === id
            ? s.warehouses.find((w) => w.id !== id)?.id
            : s.activeWarehouseId,
      }
    }),
  addCell: (cell) =>
    set((s) => ({
      cells: [
        ...s.cells,
        {
          id: uid('cell'),
          warehouseId: s.activeWarehouseId,
          zone: cell.code?.[0]?.toUpperCase() || 'A',
          ...cell,
        },
      ],
    })),
  updateCell: (id, patch) =>
    set((s) => ({
      cells: s.cells.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),
  removeCell: (id) =>
    set((s) => ({ cells: s.cells.filter((c) => c.id !== id) })),
  // Переместить рабочую зону (Приёмка/Выдача/Сборка) на карте склада.
  // Хранится в warehouse.workZones (миграция v10). Если у склада ещё нет
  // своих зон, копируем DEFAULT_WORK_ZONES и правим нужную.
  setWorkZone: (warehouseId, zoneId, patch) =>
    set((s) => ({
      warehouses: s.warehouses.map((w) => {
        if (w.id !== warehouseId) return w
        const current = Array.isArray(w.workZones) && w.workZones.length
          ? w.workZones
          : DEFAULT_WORK_ZONES.map((z) => ({ ...z }))
        return {
          ...w,
          workZones: current.map((z) => (z.id === zoneId ? { ...z, ...patch } : z)),
        }
      }),
    })),
  // Переместить товар в другую ячейку/склад
  moveProduct: (productId, warehouseId, cellCode) =>
    set((s) => ({
      products: s.products.map((p) =>
        p.id === productId ? { ...p, warehouseId, cell: cellCode } : p,
      ),
    })),
})
