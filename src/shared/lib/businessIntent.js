// Tab-local recovery of an unaccepted/unfinished business action. The outbox
// remains the durable authority; this reservation prevents a retry generating
// another business ID when localStorage is full.
import { getAuthContext, isAuthContextCurrent } from '@/shared/api'
import { canonicalPayload, scopeKey } from './outbox'
import { companyCache } from './scopedCache'

const PREFIX = 'sklad.business-intent.v1.'
const clone = (v) => JSON.parse(JSON.stringify(v))
export function prepareBusinessIntent(kind, input, prepare, slot = kind) {
  const context = getAuthContext()
  if (!context.userId || !context.companyId) return { ok: false, code: 'CONTEXT_CHANGED', error: 'Сессия компании не готова' }
  const storageKey = PREFIX + scopeKey(context) + '.' + encodeURIComponent(slot)
  try {
    const raw = sessionStorage.getItem(storageKey)
    const fingerprint = canonicalPayload(input)
    if (raw) {
      const intent = JSON.parse(raw)
      if (intent.userId !== context.userId || intent.companyId !== context.companyId || intent.fingerprint !== fingerprint) {
        return { ok: false, code: 'INTENT_CONFLICT', id: intent.prepared?.id,
          error: 'Есть незавершённая попытка с другими данными. Продолжите её в панели синхронизации.' }
      }
      return { ok: true, intent, storageKey, context }
    }
    const intent = { kind, slot, input: clone(input), fingerprint, userId: context.userId,
      companyId: context.companyId, prepared: prepare() }
    const saved = JSON.stringify(intent)
    sessionStorage.setItem(storageKey, saved)
    if (sessionStorage.getItem(storageKey) !== saved) throw new Error('Сохранение попытки не подтверждено')
    return { ok: true, intent, storageKey, context }
  } catch (e) {
    return { ok: false, code: 'INTENT_STORAGE_ERROR', error: `Действие не принято: не удалось сохранить попытку (${e.message}).` }
  }
}
export function finishBusinessIntent(prepared) { sessionStorage.removeItem(prepared.storageKey) }
export function unfinishedBusinessIntents() {
  const context = getAuthContext()
  if (!context.userId || !context.companyId) return []
  try {
    const prefix = PREFIX + scopeKey(context) + '.', result = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(prefix)) result.push({ ...JSON.parse(sessionStorage.getItem(key)), storageKey: key })
    }
    return result
  } catch { return [] }
}
export async function resumeBusinessIntent(state, storageKey) {
  const intent = unfinishedBusinessIntents().find((i) => i.storageKey === storageKey)
  if (!intent) return { ok: false, error: 'Попытка не найдена в текущей компании' }
  let result
  if (intent.kind === 'sale') result = await state.createSaleDocument(intent.input)
  else if (intent.kind === 'cancellation_v2') result = await state.cancelProtectedOrder(intent.input.id)
  else if (intent.kind === 'delivery_v2') result = await state.deliverOrder(intent.input.id)
  else if (intent.kind === 'shipment_v2') result = await state.shipOrder(intent.input.id, intent.input.warehouseId)
  else if (intent.kind === 'commercial_create') result = await state.addOrder(intent.input)
  else if (intent.kind === 'commercial_edit') result = await state.updateOrder(intent.input.id, intent.input.patch, intent.input.options)
  else if (intent.kind === 'return_v2') result = await state.refundOrder(intent.input.origOrderId, intent.input.opts)
  else if (intent.kind === 'doc_create') result = await state.addDocument(intent.input.doc, intent.input.opts)
  else if (intent.kind === 'doc_post') {
    const doc = state.documents.find((d) => d.id === intent.input.id)
    if (!doc) return { ok: false, error: 'Исходный документ отсутствует; требуется восстановление кеша' }
    result = doc.status === 'posted' ? doc.id : await state.postDocument(intent.input.id)
  } else if (intent.kind === 'order_status') {
    const order = state.orders.find((o) => o.id === intent.input.id)
    if (!order) return { ok: false, error: 'Исходный заказ отсутствует; требуется восстановление кеша' }
    result = order.status === 'cancelled' ? { ok: true } : await state.cancelOrder(intent.input.id, intent.input.note)
  } else return { ok: false, error: 'Неизвестный тип попытки' }
  if (result?.ok !== false) finishBusinessIntent({ storageKey })
  return result
}
export function completeBusinessAction(state, kind, input, prepare, enqueue, apply, slot = kind) {
  if (!state.cloud) return apply(prepare(), { acknowledged: false })
  const reservation = prepareBusinessIntent(kind, input, prepare, slot)
  if (!reservation.ok) return reservation
  return (async () => {
    let accepted
    try { accepted = await enqueue(reservation.intent.prepared) }
    catch (e) { accepted = { ok: false, code: 'STORAGE_ERROR', error: e.message } }
    const id = reservation.intent.prepared.id
    if (!accepted?.ok) return { ...accepted, ok: false, id, unfinished: true }
    if (!isAuthContextCurrent(reservation.context)) return { ok: false, id, accepted: true,
      unfinished: true, code: 'CONTEXT_CHANGED', error: 'Команда сохранена для исходной компании; локальное завершение отложено' }
    try {
      const result = apply(reservation.intent.prepared, accepted)
      if (result?.ok === false) return { ...result, id, accepted: true, unfinished: true }
      if (companyCache.error()) return { ok: false, id, accepted: true, unfinished: true,
        code: 'CACHE_STORAGE_ERROR', error: 'Команда сохранена, но локальный кеш не записан. Требуется восстановление синхронизации.' }
      finishBusinessIntent(reservation)
      return result
    } catch (e) {
      return { ok: false, id, accepted: true, unfinished: true, code: 'LOCAL_APPLY_ERROR',
        error: `Команда сохранена. Локальное завершение требует повтора: ${e.message}` }
    }
  })()
}
