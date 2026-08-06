import { uid, nextNo } from '../../lib/id'
import { docTypeInfo } from '../../lib/constants'
import { applyDocToState } from '../../lib/posting'
import { postDocumentCloud } from '../../lib/cloud'
import { normalizeItems } from '../../lib/units'
import { pushEvent } from '../../lib/diagRing'

const DOC_TYPE_TO_CLOUD = {
  purchase: 'receive',
  stockin: 'receive',
  writeoff: 'writeoff',
  supplier_return: 'writeoff',
  inventory: 'adjust',
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
        by: s.authUserId,
        createdAt: new Date().toISOString(),
        postedAt: post ? new Date().toISOString() : null,
        cancelledAt: null,
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
      postDocumentCloud(cloudDoc).then(r => {
        if (r && !r.ok) {
          pushEvent('doc_sync_error', { docId: id, code: r.code, error: r.error, traceId: r.traceId })
          set((s) => ({ syncError: r.error || r.code || 'Ошибка синхронизации документа' }))
        }
      }).catch(err => {
        pushEvent('doc_sync_error', { docId: id, error: err?.message || 'network' })
      })
    }
    return id
  },
  // Провести черновик
  postDocument: (id) => {
    const d = get().documents.find((x) => x.id === id)
    if (!d || d.status !== 'draft') return
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
      postDocumentCloud(cloudDoc).then(r => {
        if (r && !r.ok) {
          pushEvent('doc_sync_error', { docId: id, code: r.code, error: r.error, traceId: r.traceId })
          set((s) => ({ syncError: r.error || r.code || 'Ошибка синхронизации документа' }))
        }
      }).catch(err => {
        pushEvent('doc_sync_error', { docId: id, error: err?.message || 'network' })
      })
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
