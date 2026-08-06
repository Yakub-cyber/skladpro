import { uid } from '../../lib/id'
import { effectivePlan, PLAN_LIMITS } from '../../lib/subscription'

function planLimits(sub) {
  const eff = effectivePlan(sub, new Date())
  return PLAN_LIMITS[eff] || PLAN_LIMITS.free
}

export const createProductsSlice = (set, get) => ({
  // ── Товары / услуги / комплекты ─────────────────────────────
  // type: 'product' | 'service' | 'kit' (default 'product'). Услуга и
  // комплект пропускают ленту складских полей (stock/batches/cell);
  // seed по умолчанию оставляем безопасный — движок posting.js это
  // корректно обрабатывает.
  addProduct: (p) => {
    // F3-2: гейт по плану подписки. После триала free-план имеет
    // лимит 100 позиций. planLimits() читает subscription из settings.
    const st = get()
    const limits = planLimits(st.settings?.subscription)
    if (
      Number.isFinite(limits.products) &&
      (st.products || []).length >= limits.products
    ) {
      return {
        ok: false,
        error: `Достигнут лимит плана «${limits.label}»: ${limits.products} товаров. Улучшите тариф в разделе «Подписка».`,
      }
    }
    const pts = st.priceTypes || []
    const prices =
      p.prices || Object.fromEntries(pts.map((t) => [t.id, p.price || 0]))
    set((s) => ({
      products: [
        {
          id: uid('p'),
          type: 'product',
          stock: 0,
          minStock: 0,
          tags: [],
          weighted: false,
          marked: false,
          codes: [],
          components: [],
          prices,
          ...p,
        },
        ...s.products,
      ],
    }))
    const label =
      p.type === 'service' ? 'услуга' : p.type === 'kit' ? 'комплект' : 'товар'
    get().logAction(`Добавлен ${label} «${p.name || 'без названия'}»`, {
      section: 'Товары',
      type: 'create',
    })
    return { ok: true }
  },
  updateProduct: (id, patch) => {
    set((s) => ({
      products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))
    const p = get().products.find((x) => x.id === id)
    if (p) get().logAction(`Изменён товар «${p.name}»`, { section: 'Товары', type: 'update' })
  },
  // Удаление товара защищено от «висячих» ссылок. Если товар
  // упоминается в открытых заказах — резерв «замораживается на
  // фантоме» (reservedByProduct продолжает копить qty на удалённом
  // id). То же для документов/заявок поставщикам с этим товаром.
  // Возвращает { ok:false, error } — UI показывает подсказку что
  // перед удалением надо закрыть/отменить связанные документы.
  removeProduct: (id) => {
    const s = get()
    const inOpenOrders = (s.orders || []).some(
      (o) =>
        !['cancelled', 'delivered'].includes(o.status) &&
        (o.items || []).some((it) => it.productId === id),
    )
    if (inOpenOrders) {
      return {
        ok: false,
        error: 'Товар используется в открытых заказах — закройте или отмените их сначала',
      }
    }
    const inDraftDocs = (s.documents || []).some(
      (d) => d.status !== 'cancelled' && (d.items || []).some((it) => it.productId === id),
    )
    if (inDraftDocs) {
      return {
        ok: false,
        error: 'Товар есть в документах — удалить нельзя (нарушит остатки и историю)',
      }
    }
    const inPo = (s.purchaseOrders || []).some(
      (po) => po.status !== 'closed' && (po.items || []).some((it) => it.productId === id),
    )
    if (inPo) {
      return {
        ok: false,
        error: 'Товар есть в открытых заказах поставщикам — закройте их сначала',
      }
    }
    const p = s.products.find((x) => x.id === id)
    set((st) => ({ products: st.products.filter((x) => x.id !== id) }))
    if (p) get().logAction(`Удалён товар «${p.name}»`, { section: 'Товары', type: 'delete' })
    return { ok: true }
  },

  // ── Маркировка «Честный знак» ────────────────────────────
  // Приёмка кодов маркировки (DataMatrix) в пул товара
  addMarkCodes: (productId, codes) => {
    const clean = (Array.isArray(codes) ? codes : [codes])
      .map((c) => String(c).trim())
      .filter(Boolean)
    if (!clean.length) return
    set((s) => ({
      products: s.products.map((p) =>
        p.id === productId
          ? { ...p, codes: [...new Set([...(p.codes || []), ...clean])] }
          : p,
      ),
    }))
    const p = get().products.find((x) => x.id === productId)
    get().logAction(`Маркировка: принято ${clean.length} КМ для «${p?.name}»`, {
      section: 'Маркировка',
      type: 'in',
    })
  },

  // ── Категории цен ────────────────────────────────────────
  addPriceType: (pt) => {
    const id = uid('pt')
    set((s) => ({
      priceTypes: [...s.priceTypes, { id, color: '#94a3b8', ...pt }],
      // у всех товаров новая категория = базовая цена
      products: s.products.map((p) => ({
        ...p,
        prices: { ...p.prices, [id]: p.prices?.[id] ?? p.price ?? 0 },
      })),
    }))
    get().logAction(`Добавлена категория цен «${pt.name}»`, { section: 'Цены', type: 'create' })
  },
  updatePriceType: (id, patch) =>
    set((s) => ({
      priceTypes: s.priceTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  removePriceType: (id) =>
    set((s) => {
      if (s.priceTypes.find((t) => t.id === id)?.default) return {}
      return { priceTypes: s.priceTypes.filter((t) => t.id !== id) }
    }),
  setDefaultPriceType: (id) =>
    set((s) => ({
      priceTypes: s.priceTypes.map((t) => ({ ...t, default: t.id === id })),
    })),
  // Установить цену товара по категории
  setProductPrice: (productId, priceTypeId, value) =>
    set((s) => ({
      products: s.products.map((p) =>
        p.id === productId
          ? { ...p, prices: { ...p.prices, [priceTypeId]: Number(value) || 0 } }
          : p,
      ),
    })),
})
