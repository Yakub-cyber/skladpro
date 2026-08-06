import { uid, nextNo } from '../../lib/id'
import { docTypeInfo } from '../../lib/constants'
import { applyDocToState } from '../../lib/posting'
import { enqueueDocument } from '../../lib/cloud'
import { normalizeItems } from '../../lib/units'

const DOC_TYPE_TO_CLOUD = {
  purchase: 'receive',
  stockin: 'receive',
  writeoff: 'writeoff',
  supplier_return: 'writeoff',
  inventory: 'adjust',
  transfer: 'transfer',
}

export const createDocumentsSlice = (set, get) => ({
  // ── Документы (реестр складских документов) ───────────────
  // doc: { type, items:[{productId,name,unit,qty,(prevStock|fromWh)}], toWarehouseId?, reason?, note? }
  // opts.post=false → черновик (без влияния на остатки)
  // Возвращает id (успех) или { ok: false, error } — превышение остатка
  // на списании/продаже/возврате поставщику блокируется, чтобы не
  // прятать расхождение с фактом через Math.max(0, ...).
  addDocument: (doc, opts = {}) => {
    const post = opts.post !== false
    const type = doc.type
    const items = normalizeItems(doc.items || [], get().products)
    // Предпроверка остатков — только для типов, которые списывают со
    // склада, и только при проведении. Draft можно сохранить в минус.
    if (post && (type === 'sale' || type === 'writeoff' || type === 'supplier_return')) {
      const products = get().products
      for (const it of items) {
        const p = products.find((x) => x.id === it.productId)
        const need = Number(it.qty) || 0
        const have = p ? p.stock : 0
        if (need > have) {
          const label = docTypeInfo(type).label
          return {
            ok: false,
            error: `${label}: «${it.name}» — не хватает остатка (${have} из ${need} ${p?.unit || 'шт'})`,
          }
        }
      }
    }
    const id = uid('doc')
    set((s) => {
      const prefix = docTypeInfo(type).prefix
      const header = {
        id,
        no: nextNo(s.documents.filter((d) => d.type === type), prefix),
        type,
        status: post ? 'posted' : 'draft',
        items: items.map((it) => ({ ...it })),
        toWarehouseId: doc.toWarehouseId || null,
        reason: doc.reason || '',
        note: doc.note || '',
        totalQty: items.reduce((a, x) => a + (Number(x.qty) || 0), 0),
        // Поставщик закупки. Раньше header его отбрасывал: сервер получал
        // receive без supplierId → stock_income вместо purchase_receipt,
        // долг поставщику не рос. Черновик терял поставщика молча.
        supplierId: doc.supplierId ?? null,
        by: s.authUserId,
        createdAt: new Date().toISOString(),
        postedAt: post ? new Date().toISOString() : null,
        cancelledAt: null,
        // Черновик продажи хранит коммерческие поля целиком — иначе
        // проведение из реестра (postDocument → createSaleDocument)
        // потеряло бы клиента/скидку/способ оплаты и провело бы не то,
        // что оператор сохранял.
        ...(type === 'sale'
          ? {
              customerId: doc.customerId ?? null,
              customerName: doc.customerName ?? null,
              priceTypeId: doc.priceTypeId ?? null,
              discount: Number(doc.discount) || 0,
              subtotal: doc.subtotal ?? null,
              total: doc.total ?? null,
              onCredit: !!doc.onCredit,
              payMethod: doc.payMethod ?? null,
            }
          : {}),
      }
      const base = { documents: [header, ...s.documents] }
      return post ? { ...base, ...applyDocToState(s, header, 1, s.authUserId) } : base
    })
    const d = get().documents.find((x) => x.id === id)
    get().logAction(
      `Документ ${d?.no} · ${docTypeInfo(type).label} ${post ? 'проведён' : '— черновик'}`,
      { section: 'Документы', type: post ? 'create' : 'draft' },
    )
    const cloudType = DOC_TYPE_TO_CLOUD[type]
    if (d && post && cloudType) {
      const cloudDoc = { ...d, type: cloudType }
      if (type === 'transfer') {
        cloudDoc.warehouseToId = d.toWarehouseId
        cloudDoc.warehouseId = d.items?.[0]?.fromWh || undefined
      }
      enqueueDocument(cloudDoc)
    }
    return id
  },
  // Провести черновик
  postDocument: (id) => {
    const d = get().documents.find((x) => x.id === id)
    if (!d || d.status !== 'draft') return
    // Продажа проводится ТОЛЬКО движком createSaleDocument. Старый путь
    // (applyDocToState) двигал остатки локально, но не знал ни сервера,
    // ни денег, ни долга — черновик выглядел проведённым, а учёта не было.
    if (d.type === 'sale') {
      if (!d.payMethod) {
        // Черновик до появления селектора оплаты: способа оплаты и клиента
        // в нём нет — угадывать нельзя. Честный отказ вместо молчаливо
        // неполной проводки.
        return {
          ok: false,
          error: `Черновик ${d.no} создан в старом формате (без способа оплаты). Создайте продажу заново из формы — черновик можно удалить.`,
        }
      }
      const total = Number(d.total) || (d.items || []).reduce(
        (a, x) => a + (Number(x.qty) || 0) * (Number(x.price) || 0), 0,
      )
      const r = get().createSaleDocument({
        customerId: d.customerId || 'retail',
        customerName: d.customerName || 'Розничный',
        items: d.items,
        subtotal: d.subtotal ?? undefined,
        discount: Number(d.discount) || 0,
        total,
        onCredit: d.payMethod === 'credit',
        priceTypeId: d.priceTypeId || undefined,
        payment:
          d.payMethod === 'credit'
            ? { method: 'credit' }
            : {
                method: d.payMethod,
                cashPaid: d.payMethod === 'cash' ? total : 0,
                cardPaid: d.payMethod === 'card' ? total : 0,
              },
      })
      if (r && r.ok === false) return r
      // Черновик стал продажей (ЧК-заказ) — заготовку убираем, чтобы
      // одна продажа не отображалась двумя записями.
      set((s) => ({ documents: s.documents.filter((x) => x.id !== id) }))
      get().logAction(`Черновик ${d.no} проведён как продажа`, {
        section: 'Документы',
        type: 'update',
      })
      return r
    }
    set((s) => ({
      ...applyDocToState(s, d, 1, s.authUserId),
      documents: s.documents.map((x) =>
        x.id === id ? { ...x, status: 'posted', postedAt: new Date().toISOString() } : x,
      ),
    }))
    get().logAction(`Документ ${d.no} проведён`, { section: 'Документы', type: 'update' })
    const cloudType = DOC_TYPE_TO_CLOUD[d.type]
    if (cloudType) {
      const cloudDoc = { ...get().documents.find((x) => x.id === id), type: cloudType }
      if (d.type === 'transfer') {
        cloudDoc.warehouseToId = d.toWarehouseId
        cloudDoc.warehouseId = d.items?.[0]?.fromWh || undefined
      }
      enqueueDocument(cloudDoc)
    }
  },
  // Отменить проводку (откатить влияние на остатки)
  cancelDocument: (id) => {
    const d = get().documents.find((x) => x.id === id)
    if (!d || d.status !== 'posted') return
    set((s) => ({
      ...applyDocToState(s, d, -1, s.authUserId),
      documents: s.documents.map((x) =>
        x.id === id ? { ...x, status: 'cancelled', cancelledAt: new Date().toISOString() } : x,
      ),
    }))
    get().logAction(`Отменён документ ${d.no}`, { section: 'Документы', type: 'delete' })
  },
  // Удалить документ (только черновик или отменённый — проведённый сначала отменить)
  removeDocument: (id) => {
    const d = get().documents.find((x) => x.id === id)
    if (!d || d.status === 'posted') return
    set((s) => ({ documents: s.documents.filter((x) => x.id !== id) }))
  },
})
