import { uid, nextNo } from '../../lib/id'
import { docTypeInfo } from '../../lib/constants'
import { applyDocToState } from '../../lib/posting'
import { enqueueDocument } from '../../lib/cloud'
import { normalizeItems } from '../../lib/units'
import { completeBusinessAction } from '../../lib/businessIntent'
import { companyCache } from '../../lib/scopedCache'
import { getAuthContext } from '@/shared/api'
import { saleWarehouseError } from '../../lib/saleV2'

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
    if (type === 'sale' && get().cloud) {
      const error = saleWarehouseError(get().warehouses, doc.warehouseId)
      if (error) return { ok: false, error }
      if (post) {
        if (!doc.payment && !doc.payMethod) return { ok: false, error: 'Выберите способ оплаты продажи' }
        const method = doc.payMethod
        return get().createSaleDocument({ ...doc, payment: doc.payment || (method === 'credit' ? { method } : {
          method, cashPaid: method === 'cash' ? doc.total : 0, cardPaid: method === 'card' ? doc.total : 0 }) })
      }
    }
    if (type === 'inventory' && !doc.warehouseId) return { ok: false, error: 'Выберите склад инвентаризации' }
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
    const prepare = () => {
      const s = get(), id = uid('doc'), prefix = docTypeInfo(type).prefix
      const header = {
        id,
        no: nextNo(s.documents.filter((d) => d.type === type), prefix),
        type,
        ...(['inventory', 'sale'].includes(type) && doc.warehouseId ? { warehouseId: doc.warehouseId } : {}),
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
        ...(doc.sourcePurchaseOrderId ? { sourcePurchaseOrderId: doc.sourcePurchaseOrderId } : {}),
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
      const command = { ...header, type: DOC_TYPE_TO_CLOUD[type] }
      if (type === 'inventory') delete command.supplierId
      delete command.sourcePurchaseOrderId
      if (type === 'transfer') { command.warehouseToId = header.toWarehouseId; command.warehouseId = header.items[0]?.fromWh || undefined }
      return { id, header, command }
    }
    const apply = ({ id, header }, accepted = {}) => {
      if (get().documents.some((d) => d.id === id)) return id
      if (accepted.acknowledged) return { ok: false, error: 'Команда уже подтверждена сервером. Обновите данные перед локальным завершением.' }
      const fields = ['documents', 'products', 'movements', 'customers', 'suppliers', 'shifts', 'audit', 'purchaseOrders']
      const before = Object.fromEntries(fields.map((k) => [k, get()[k]]))
      try {
        set((state) => {
          const base = { documents: [header, ...state.documents] }
          if (post && state.cloud && type === 'inventory') {
            return { ...base, products: companyCache.overlayLocal(getAuthContext(), { ...state, ...base }).products }
          }
          return post && !accepted.acknowledged ? { ...base, ...applyDocToState(state, header, 1, state.authUserId) } : base
        })
        if (header.sourcePurchaseOrderId) set((state) => ({ purchaseOrders: (state.purchaseOrders || []).map((po) =>
          po.id === header.sourcePurchaseOrderId ? { ...po, status: 'received', receivedAt: header.postedAt,
            receiveDocId: id, items: header.items } : po) }))
        get().logAction(`Документ ${header.no} · ${docTypeInfo(type).label} ${post ? 'проведён' : '— черновик'}`,
          { section: 'Документы', type: post ? 'create' : 'draft' })
        return id
      } catch (e) { try { set(before) } catch { /* state restored before persist */ } throw e }
    }
    if (!post || !DOC_TYPE_TO_CLOUD[type]) return apply(prepare())
    return completeBusinessAction(get(), 'doc_create', { doc, opts }, prepare,
      (prepared) => enqueueDocument(prepared.command), apply, `doc_create:${type}`)
  },
  // Провести черновик
  postDocument: (id) => {
    const d = get().documents.find((x) => x.id === id)
    if (!d || d.status !== 'draft') return
    if (d.type === 'inventory' && !d.warehouseId) return { ok: false, error: 'У старого черновика не указан склад. Создайте новую инвентаризацию с явным складом.' }
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
        warehouseId: d.warehouseId,
        sourceDocumentId: id,
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
      // Draft removal belongs to the same local completion as the sale.
      return r
    }
    const prepare = () => {
      const header = JSON.parse(JSON.stringify({ ...d, status: 'posted', postedAt: new Date().toISOString() }))
      const command = { ...header, type: DOC_TYPE_TO_CLOUD[d.type] }
      if (d.type === 'inventory') delete command.supplierId
      if (d.type === 'transfer') { command.warehouseToId = d.toWarehouseId; command.warehouseId = d.items?.[0]?.fromWh || undefined }
      return { id, header, command }
    }
    const apply = ({ header }, accepted) => {
      if (get().documents.find((x) => x.id === id)?.status === 'posted') return { ok: true, id }
      if (accepted.acknowledged) return { ok: false, error: 'Команда уже подтверждена сервером. Обновите данные перед локальным завершением.' }
      const fields = ['documents', 'products', 'movements', 'customers', 'suppliers', 'audit']
      const before = Object.fromEntries(fields.map((k) => [k, get()[k]]))
      try {
        set((state) => ({
          ...(accepted.acknowledged ? {} : applyDocToState(state, header, 1, state.authUserId)),
          ...(state.cloud && d.type === 'inventory' ? { products: companyCache.overlayLocal(getAuthContext(), state).products } : {}),
          documents: state.documents.map((x) => x.id === id ? header : x),
        }))
        get().logAction(`Документ ${d.no} проведён`, { section: 'Документы', type: 'update' })
        return { ok: true, id }
      } catch (e) { try { set(before) } catch { /* state restored before persist */ } throw e }
    }
    if (!DOC_TYPE_TO_CLOUD[d.type]) return apply(prepare(), {})
    return completeBusinessAction(get(), 'doc_post', { id }, prepare,
      (prepared) => enqueueDocument(prepared.command), apply, `doc_post:${id}`)
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
    if (!d) return { ok: true, duplicate: true }
    if (d.status === 'posted') return
    if (d.status === 'draft' && get().cloud) {
      const state = get()
      if (!state.authAccountId || !state.companyId) return { ok: false, code: 'CONTEXT_CHANGED', error: 'Сессия компании не готова' }
      const result = companyCache.deleteDraft(id, { userId: state.authAccountId, companyId: state.companyId })
      if (!result.ok) return result
    }
    set((s) => ({ documents: s.documents.filter((x) => x.id !== id) }))
    return { ok: true }
  },
})
