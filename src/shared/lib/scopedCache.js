import { projectCancellationHeaders } from './cancellationV2'
import { projectDeliveryHeaders } from './deliveryV2'
import { isShipmentV2, projectShipmentHeaders } from './shipmentV2'
import { getAuthContext, isAuthContextCurrent, hasApi } from '@/shared/api'
import { safeStorage, scopeKey, canonicalPayload } from './outbox'
import { deobfuscateSecret } from './crypto'
import { mergeProduct, projectStocks, projectWarehouseStocks, warehouseCommandIdentity } from './stockProjection'
import { projectReturnHeaders } from './offlineRefunds'
import { validateWarehouseSnapshot } from './warehouseSnapshot'
import { isSaleV2 } from './saleV2'
import { COMMERCIAL_KEYS, isCommercialOrder, projectCommercialOrders, validCommercial } from './commercialOrders'

export const CLOUD_COLLECTIONS = ['products', 'customers', 'suppliers', 'orders', 'employees',
  'movements', 'audit', 'shifts', 'priceTypes', 'invoices', 'documents', 'cells',
  'warehouses', 'accounts', 'moneyTx', 'purchaseOrders']
const DATA_FIELDS = [...CLOUD_COLLECTIONS, 'settings', 'activeShiftId', 'activeWarehouseId', 'pinFails']
export function emptyCloudData() {
  return { ...Object.fromEntries(CLOUD_COLLECTIONS.map((k) => [k, []])),
    activeShiftId: null, activeWarehouseId: null, pinFails: {}, settings: { company: '', currency: '₽' } }
}

const LOCAL_COLLECTIONS = new Set(['accounts', 'moneyTx', 'purchaseOrders'])
const storageKeys = (storage) => Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(Boolean)
const recordKey = (field, id) => JSON.stringify([field, id])
const newRevision = () => globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2)
export function createScopedCache({ storage, getContext, isCurrent, cloudEnabled = true }) {
  let bound = null, lastError = null, stockClock = 0
  const observed = new Map()
  const stockCaptures = new Map()
  const prefixFor = (ctx) => 'sklad.db.v3.' + scopeKey(ctx) + '.'
  const deletionRevision = (id) => 'tombstone-' + encodeURIComponent(recordKey('documents', id))
  const verifyWrite = (key, raw) => {
    storage.setItem(key, raw)
    if (storage.getItem(key) !== raw) throw new Error('Cache write not confirmed')
    if (storage.volatile) throw new Error('Локальное хранилище недоступно: кеш только в памяти')
  }
  function stockCommands(ctx) {
    const prefix = 'sklad.outbox.v2.' + scopeKey(ctx) + '.', latest = new Map()
    for (const key of storageKeys(storage)) {
      if (!key.startsWith(prefix + 'op.')) continue
      const op = loadEnvelope(key, ctx)
      if (!['sale', 'order_status', 'doc_post', 'orders', 'return_v2', 'order_cancel'].includes(op.key)) continue
      if (op.key !== 'orders') {
        const meta = JSON.parse(storage.getItem(prefix + 'meta.' + op._entryId) || '{}')
        op._quarantined = meta._quarantined; op._quarantineReason = meta._quarantineReason
        op._acknowledged = storage.getItem(prefix + 'ack.' + op._entryId) === 'confirmed'
      }
      const logical = recordKey(op.key, op.id), old = latest.get(logical)
      if (old && op.key !== 'orders' && canonicalPayload(old.obj) !== canonicalPayload(op.obj)) throw new Error('COMMAND_CONFLICT: ' + logical)
      if (!old || op._order > old._order || (op._order === old._order && op._entryId > old._entryId)) latest.set(logical, op)
    }
    return [...latest.values()].sort((a, b) => a._order - b._order || a._entryId.localeCompare(b._entryId))
  }
  function stockBases(ctx) {
    const prefix = prefixFor(ctx) + 'stock.', result = new Map()
    let newest = null
    for (const key of storageKeys(storage)) {
      if (!key.startsWith(prefix)) continue
      const snapshot = loadEnvelope(key, ctx)
      if (!Array.isArray(snapshot.products) || !Array.isArray(snapshot.orders) ||
        !Array.isArray(snapshot.documents) || !Array.isArray(snapshot.covered)) throw new Error('Invalid stock snapshot')
      if (!newest || snapshot.revision > newest.revision) newest = snapshot
      for (const product of snapshot.products) {
        const previous = result.get(product.id)
        const version = BigInt(product.rowVersion || 0), oldVersion = BigInt(previous?.product.rowVersion || 0)
        if (!previous || version > oldVersion || (version === oldVersion && snapshot.revision > previous.snapshot.revision)) {
          result.set(product.id, { product, snapshot })
        }
      }
    }
    const live = new Set((newest?.products || []).map((p) => p.id))
    for (const id of result.keys()) if (!live.has(id)) result.delete(id)
    return result
  }
  function pendingIds(ctx, includeConfirmed = false) {
    const result = new Set(), latest = new Map(), prefix = 'sklad.outbox.v2.' + scopeKey(ctx) + '.'
    for (const key of storageKeys(storage)) {
      if (!key.startsWith(prefix + 'op.')) continue
      const op = JSON.parse(storage.getItem(key))
      if (op.userId !== ctx.userId || op.companyId !== ctx.companyId) throw new Error('Outbox ownership mismatch')
      const logical = recordKey(op.key, op.id), previous = latest.get(logical)
      if (!previous || op._order > previous._order || (op._order === previous._order && op._entryId > previous._entryId)) latest.set(logical, op)
    }
    for (const op of latest.values()) {
      if (!includeConfirmed && storage.getItem(prefix + 'ack.' + op._entryId)) continue
      if (op.op === 'delete') continue
      if (op.key === 'sale') result.add(recordKey('orders', op.id))
      if (includeConfirmed && op.key === 'sale' && (op.sourceDocumentId || op.obj?.sourceDocumentId)) result.add(recordKey('documents', op.sourceDocumentId || op.obj.sourceDocumentId))
      if (op.key === 'doc_post') result.add(recordKey('documents', op.id))
      if (op.key === 'order_status') result.add(recordKey('orders', op.obj?.orderId))
      if (CLOUD_COLLECTIONS.includes(op.key)) result.add(recordKey(op.key, op.id))
    }
    return result
  }
  const isLocal = (field, row, pending) => !(field === 'orders' && isCommercialOrder(row)) && (LOCAL_COLLECTIONS.has(field) ||
    (field === 'documents' && row.status === 'draft') || pending.has(recordKey(field, row.id)))
  function commercialCommands(ctx, keys = COMMERCIAL_KEYS) {
    const prefix = 'sklad.outbox.v2.' + scopeKey(ctx) + '.', result = []
    for (const key of storageKeys(storage)) if (key.startsWith(prefix + 'op.')) {
      const op = loadEnvelope(key, ctx)
      if (!keys.includes(op.key)) continue
      const meta = JSON.parse(storage.getItem(prefix + 'meta.' + op._entryId) || '{}')
      result.push({ ...op, _acknowledged: storage.getItem(prefix + 'ack.' + op._entryId) === 'confirmed',
        _quarantined: meta._quarantined, _quarantineReason: meta._quarantineReason })
    }
    return result.sort((a, b) => a._order - b._order || a._entryId.localeCompare(b._entryId))
  }
  function commercialAuthorities(ctx) {
    const prefix = prefixFor(ctx) + 'commercial.', result = new Map()
    for (const key of storageKeys(storage)) if (key.startsWith(prefix)) {
      const a = loadEnvelope(key, ctx)
      if (!a || typeof a.orderId !== 'string' || !/^[1-9]\d{0,18}$/.test(a.rowVersion) || !validCommercial(a.snapshot)) throw new Error('Повреждено подтверждение коммерческого заказа')
      const old = result.get(a.orderId)
      if (!old || BigInt(a.rowVersion) > BigInt(old.rowVersion)) result.set(a.orderId, a)
    }
    return result
  }
  function saveCommercial(ctx, row) {
    if (!isCurrent(ctx) || !ctx.userId || !ctx.companyId) throw new Error('CONTEXT_CHANGED')
    const record = { userId: ctx.userId, companyId: ctx.companyId, orderId: row.id, rowVersion: String(row.rowVersion),
      snapshot: row.commercialSnapshot, status: row.status, stockConsumed: !!row.stockConsumed,
      shipmentDocId: row.shipmentDocId || null, createdAt: row.createdAt || null }
    if (!/^[1-9]\d{0,18}$/.test(record.rowVersion) || !validCommercial(record.snapshot)) throw new Error('Не подтверждены версия и состав серверного заказа')
    const key = prefixFor(ctx) + 'commercial.' + encodeURIComponent(record.orderId) + '.' + record.rowVersion
    const previous = storage.getItem(key)
    if (previous && canonicalPayload(JSON.parse(previous)) !== canonicalPayload(record)) throw new Error('Конфликт подтверждённой версии заказа')
    verifyWrite(key, JSON.stringify(record))
    lastError = null
  }
  function loadEnvelope(key, ctx) {
    const raw = storage.getItem(key)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (data.userId !== ctx.userId || data.companyId !== ctx.companyId) throw new Error('Cache ownership mismatch')
    return data
  }
  function loadLocal(ctx) {
    const prefix = prefixFor(ctx), groups = new Map()
    for (const key of storageKeys(storage)) {
      if (!key.startsWith(prefix + 'local.')) continue
      const r = loadEnvelope(key, ctx)
      if (!r || !CLOUD_COLLECTIONS.includes(r.field) || typeof r.id !== 'string' || !r.id ||
        typeof r.origin !== 'string' || !r.origin || typeof r.revision !== 'string' || !r.revision || (r.deleted === true
          ? r.field !== 'documents' || r.row !== null || r.revision !== deletionRevision(r.id) ||
            key !== prefix + 'local.' + r.revision || r.parent !== r.origin
          : r.deleted != null || r.row?.id !== r.id)) throw new Error('Invalid local cache provenance')
      const k = recordKey(r.field, r.id)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(r)
    }
    const result = new Map()
    for (const [key, records] of groups) {
      const byRevision = new Map(records.map((r) => [r.revision, r]))
      for (const r of records) {
        if (r.parent && (!byRevision.has(r.parent) || byRevision.get(r.parent).origin !== r.origin)) throw new Error('Invalid local cache ancestry: ' + key)
        if (r.deleted && byRevision.get(r.parent)?.row?.status !== 'draft') throw new Error('Invalid draft tombstone ancestry: ' + key)
      }
      const parents = new Set(records.map((r) => r.parent).filter(Boolean))
      let tips = records.filter((r) => !parents.has(r.revision))
      const tombstone = records.find((r) => r.deleted)
      if (tombstone) {
        if (records.some((r) => r.origin !== tombstone.origin)) throw new Error('LOCAL_CACHE_CONFLICT: ' + key)
        // Deletion dominates every draft branch, including late old revisions.
        // Posted business headers retain their existing recovery path.
        tips = tips.filter((r) => !r.deleted && r.row.status !== 'draft')
        if (!tips.length) { result.set(key, tombstone); continue }
      }
      // Never sum or choose a last writer for conflicting financial identities.
      if (!tips.length || new Set(tips.map((r) => r.origin)).size !== 1 ||
        new Set(tips.map((r) => canonicalPayload(r.row))).size !== 1) throw new Error('LOCAL_CACHE_CONFLICT: ' + key)
      const latest = tips.sort((a, b) => a.revision.localeCompare(b.revision))[0]
      result.set(key, tombstone ? { ...latest, draftDeleted: true } : latest)
    }
    return result
  }
  function importLegacy(ctx) {
    const legacy = loadEnvelope('sklad.db.v2.' + scopeKey(ctx), ctx)
    if (!legacy) return null
    const pending = pendingIds(ctx)
    for (const field of CLOUD_COLLECTIONS) for (const row of legacy.state?.[field] || []) {
      if (!isLocal(field, row, pending)) continue
      if (typeof row.id !== 'string' || !row.id) throw new Error('Local cache row requires a stable ID')
      const revision = 'legacy-' + encodeURIComponent(recordKey(field, row.id))
      const key = prefixFor(ctx) + 'local.' + revision
      const record = { userId: ctx.userId, companyId: ctx.companyId, field, id: row.id,
        origin: revision, revision, parent: null, row }
      const raw = JSON.stringify(record), saved = storage.getItem(key)
      if (saved != null && saved !== raw) throw new Error('Legacy local cache conflict; original preserved')
      if (saved == null) verifyWrite(key, raw)
    }
    return legacy // Original v2 envelope is never overwritten or deleted.
  }
  function overlay(ctx, data, locals = loadLocal(ctx)) {
    const result = { ...data }, pending = pendingIds(ctx)
    const deletedDrafts = new Set([...locals.values()].filter((r) => r.deleted || r.draftDeleted).map((r) => r.id))
    if (deletedDrafts.size) result.documents = (result.documents || []).filter((row) => row.status !== 'draft' || !deletedDrafts.has(row.id))
    for (const field of LOCAL_COLLECTIONS) for (const row of data[field] || []) {
      const saved = locals.get(recordKey(field, row.id))
      if (!saved || canonicalPayload(saved.row) !== canonicalPayload(row)) throw new Error('LOCAL_CACHE_UNSAVED: ' + recordKey(field, row.id))
    }
    for (const field of LOCAL_COLLECTIONS) result[field] = []
    for (const r of locals.values()) {
      if (r.deleted) continue
      if (!isLocal(r.field, r.row, pending)) continue
      const rows = result[r.field] || [], index = rows.findIndex((row) => row.id === r.id)
      const copy = r.field === 'products' && index >= 0
        ? mergeProduct(r.row, rows[index]) : JSON.parse(JSON.stringify(r.row))
      result[r.field] = index < 0 ? [...rows, copy] : rows.map((row, i) => i === index ? copy : row)
    }
    const bases = stockBases(ctx), commands = bases.size ? stockCommands(ctx) : [], projections = new Map()
    result.products = (result.products || []).map((row) => {
      const base = bases.get(row.id)
      if (!base) return row
      if (!projections.has(base.snapshot)) projections.set(base.snapshot, projectStocks(base.snapshot, commands))
      return mergeProduct(row, projections.get(base.snapshot).get(row.id))
    })
    const warehouse = warehouseProjection(ctx)
    const consumedDrafts = new Set(warehouseCommands(ctx).filter((op) => op.key === 'sale' && isSaleV2(op.obj) && op.sourceDocumentId).map((op) => op.sourceDocumentId))
    if (consumedDrafts.size) result.documents = (result.documents || []).filter((d) => d.status !== 'draft' || !consumedDrafts.has(d.id))
    const pendingSaleProducts = new Set(warehouseCommands(ctx).filter((op) => op.key === 'sale' && isSaleV2(op.obj)).flatMap((op) => op.obj.order.items.map((it) => it.productId)))
    result.products = (result.products || []).map((row) => {
      const view = warehouse.get(row.id)
      if (!view) return pendingSaleProducts.has(row.id) ? { ...row, warehouseProjection: { available: false, reason: 'SNAPSHOT_MISSING' } } : row
      return { ...row, warehouseProjection: view, ...(view.available ? { stock: view.total,
        confirmedStock: view.confirmedTotal, pendingStockDelta: view.total - view.confirmedTotal } : {}) }
    })
    const projected = projectReturnHeaders(result, bases.size ? commands : stockCommands(ctx))
    projected.orders = projectShipmentHeaders(projectCommercialOrders(projected.orders || [], commercialCommands(ctx), commercialAuthorities(ctx)), stockCommands(ctx))
    projected.orders = projectDeliveryHeaders(projected.orders, commercialCommands(ctx, ['order_delivery']))
    projected.orders = projectCancellationHeaders(projected.orders, stockCommands(ctx).filter(op => op.key === 'order_cancel'))
    return projected
  }
  function warehouseCommands(ctx) { return stockCommands(ctx).filter((op) => op.key !== 'orders') }
  function readWarehouseRecord(ctx = getContext()) {
    if (!cloudEnabled || !ctx?.userId || !ctx.companyId || !isCurrent(ctx)) return null
    if (storage.volatile) throw new Error('Локальное хранилище недоступно: складской снимок не сохранён надёжно')
    const raw = storage.getItem(prefixFor(ctx) + 'warehouseSnapshot.v1')
    if (raw === null) return null
    const record = JSON.parse(raw)
    if (record.version !== 1 || record.userId !== ctx.userId || record.companyId !== ctx.companyId) throw new Error('Invalid warehouse snapshot owner/version')
    const proof = record.projectionContext
    const observed = new Set(Array.isArray(proof?.observed) ? proof.observed : [])
    if (proof && (!Array.isArray(proof.observed) || proof.observed.some((v) => typeof v !== 'string') ||
      new Set(proof.observed).size !== proof.observed.length || !Array.isArray(proof.covered) ||
      proof.covered.some((v) => typeof v?.entryId !== 'string' || typeof v.identity !== 'string' || !observed.has(v.entryId)) ||
      new Set(proof.covered.map((v) => v.entryId)).size !== proof.covered.length)) throw new Error('Invalid warehouse snapshot receipt context')
    return { ...record, snapshot: validateWarehouseSnapshot(record.snapshot, record.request, ctx.companyId) }
  }
  function warehouseProjection(ctx = getContext()) {
    const record = readWarehouseRecord(ctx)
    return record ? projectWarehouseStocks(record, warehouseCommands(ctx), ctx) : new Map()
  }
  function read(ctx) {
    if (!ctx?.userId || !ctx.companyId || !isCurrent(ctx)) return null
    try {
      const legacy = importLegacy(ctx)
      const server = loadEnvelope(prefixFor(ctx) + 'server', ctx) || legacy
      const locals = loadLocal(ctx)
      observed.set(scopeKey(ctx), new Map(locals))
      if (!server && !locals.size) return null
      return { ...server, userId: ctx.userId, companyId: ctx.companyId,
        state: overlay(ctx, Object.fromEntries(DATA_FIELDS.filter((k) => k in (server?.state || {}) && !LOCAL_COLLECTIONS.has(k)).map((k) => [k, server.state[k]])), locals) }
    } catch (e) { lastError = e.message; throw e }
  }
  function deleteDraft(id, owner = getContext()) {
    try {
      if (!cloudEnabled || !bound || !isCurrent(bound) ||
        owner?.userId !== bound.userId || owner.companyId !== bound.companyId) throw new Error('CONTEXT_CHANGED')
      if (typeof id !== 'string' || !id) throw new Error('Draft requires a stable ID')
      importLegacy(bound)
      const locals = loadLocal(bound), key = recordKey('documents', id), draft = locals.get(key)
      if (draft?.deleted) { lastError = null; return { ok: true, duplicate: true } }
      const server = loadEnvelope(prefixFor(bound) + 'server', bound)
      if (!draft || draft.row.status !== 'draft' || draft.row.postedAt || draft.row.cancelledAt ||
        server?.state?.documents?.some((row) => row.id === id) || pendingIds(bound, true).has(key)) {
        throw new Error('Удаление разрешено только для сохранённого локального черновика без команды проведения')
      }
      // One permanent, deterministic record per scoped document. Repeated deletes
      // neither create revisions nor remove history. Never infer deletion from omission.
      const revision = deletionRevision(id), record = { userId: bound.userId, companyId: bound.companyId,
        field: 'documents', id, origin: draft.origin, revision, parent: draft.origin, deleted: true, row: null }
      verifyWrite(prefixFor(bound) + 'local.' + revision, JSON.stringify(record))
      loadLocal(bound) // Validate provenance, including a concurrently appended branch.
      lastError = null
      return { ok: true }
    } catch (e) { lastError = e.message; return { ok: false, code: 'CACHE_DELETE_ERROR', error: e.message } }
  }
  return {
    activate: (ctx) => { bound = ctx ? { ...ctx } : null },
    read,
    deleteDraft,
    warehouseCommands,
    warehouseProjection,
    prepareWarehouseSnapshot: (ctx) => {
      if (!isCurrent(ctx)) throw new Error('CONTEXT_CHANGED')
      const commands = warehouseCommands(ctx)
      return { observed: commands.map((op) => op._entryId), covered: commands.filter((op) => op._acknowledged)
        .map((op) => ({ entryId: op._entryId, identity: warehouseCommandIdentity(op) })) }
    },
    saveWarehouseSnapshot: (ctx, request, snapshot, beforeRead) => {
      try {
        if (!cloudEnabled || !ctx?.userId || !ctx.companyId || !isCurrent(ctx)) throw new Error('CONTEXT_CHANGED')
        const verified = validateWarehouseSnapshot(snapshot, request, ctx.companyId)
        // Separate namespace: legacy product baselines and row journals never consume this record.
        const record = { version: 1, userId: ctx.userId, companyId: ctx.companyId, request, snapshot: verified,
          projectionContext: { observed: [...new Set([...(beforeRead?.observed || []), ...warehouseCommands(ctx).map((op) => op._entryId)])], covered: beforeRead?.covered || [] } }
        verifyWrite(prefixFor(ctx) + 'warehouseSnapshot.v1', JSON.stringify(record))
        lastError = null
      } catch (e) { lastError = e.message; throw e }
    },
    readWarehouseSnapshot: (ctx = getContext()) => {
      try {
        const verified = readWarehouseRecord(ctx)?.snapshot || null
        lastError = null
        return verified
      } catch (e) { lastError = e.message; throw e }
    },
    confirmedStockCommands: (ctx) => stockCommands(ctx).filter((op) =>
      storage.getItem('sklad.outbox.v2.' + scopeKey(ctx) + '.ack.' + op._entryId)).map((op) => op._entryId),
    captureStock: (ctx, data, covered = []) => {
      if (!isCurrent(ctx)) throw new Error('CONTEXT_CHANGED')
      stockClock = Math.max(Date.now(), stockClock + 1)
      const revision = stockClock.toString().padStart(16, '0') + '-' + newRevision()
      const snapshot = { userId: ctx.userId, companyId: ctx.companyId, revision,
        products: data.products || [],
        orders: (data.orders || []).map(({ id, status, items, stockConsumed, kind, returns }) => ({ id, status, items, stockConsumed, kind, returns })),
        documents: (data.documents || []).filter((d) => d.status !== 'draft').map((d) => d.id), covered }
      const content = canonicalPayload({ ...snapshot, revision: null }), previous = stockCaptures.get(scopeKey(ctx))
      if (previous?.content === content && storage.getItem(previous.key) === previous.raw) return
      const key = prefixFor(ctx) + 'stock.' + revision, raw = JSON.stringify(snapshot)
      try { verifyWrite(key, raw); stockCaptures.set(scopeKey(ctx), { key, raw, content }) }
      catch (e) { lastError = e.message; throw e }
    },
    overlayLocal: (ctx, state) => {
      try {
        if (!isCurrent(ctx)) throw new Error('CONTEXT_CHANGED')
        return overlay(ctx, state)
      } catch (e) { lastError = e.message; throw e }
    },
    saveCommercialOrder: (ctx, row) => { try { saveCommercial(ctx, row) } catch (e) { lastError = e.message; throw e } },
    pendingOrderCommands: (ctx, id) => [...commercialCommands(ctx), ...commercialCommands(ctx, ['order_delivery']), ...stockCommands(ctx)].filter(op => !op._acknowledged && (op.obj.orderId === id || op.key === 'return_v2' && op.obj.request?.orderId === id || isShipmentV2(op.obj) && op.id === id)),
    deliverySource: (ctx, id) => {
      if (!isCurrent(ctx)) throw new Error('CONTEXT_CHANGED')
      const authority = commercialAuthorities(ctx).get(id)
      if (!authority || authority.status !== 'shipped' || !authority.stockConsumed || !authority.shipmentDocId) throw new Error('Нужна подтверждённая проведённая отгрузка защищённого заказа')
      const op = stockCommands(ctx).find(op => op.key === 'order_status' && op.id === id && isShipmentV2(op.obj))
      if (!op?._acknowledged || op._quarantined || authority.shipmentDocId !== `shipment-${op.obj.shipmentId}` || canonicalPayload(authority.snapshot) !== canonicalPayload(op.obj.orderSnapshot)) throw new Error('Исходная shipment-команда ещё не подтверждена или недоступна на этом устройстве')
      const record = readWarehouseRecord(ctx)
      const request = record?.request.commands.find(c => c.kind === 'order_status' && c.commandId === id)
      const proof = record?.snapshot.commands.find(c => c.commandId === id)
      if (!request || canonicalPayload(request) !== warehouseCommandIdentity(op) || proof?.resolution !== 'applied' || proof.effectIncluded !== true || proof.documentId !== authority.shipmentDocId) throw new Error('Нет applied-доказательства исходной shipment в согласованном снимке; обновите данные онлайн')
      return { orderId: id, shipmentId: op.obj.shipmentId, payload: JSON.parse(JSON.stringify(op.obj)) }
    },
    commercialOrder: (ctx, id) => {
      if (!isCurrent(ctx)) throw new Error('CONTEXT_CHANGED')
      return commercialAuthorities(ctx).get(id) || null
    },
    error: () => lastError,
    getItem: (name) => {
      if (!cloudEnabled) return storage.getItem(name + '.demo.v2')
      const data = bound ? read(bound) : null
      return data ? JSON.stringify(data) : null
    },
    setItem: (name, raw) => {
      if (!cloudEnabled) { storage.setItem(name + '.demo.v2', raw); return }
      if (!bound || !isCurrent(bound)) return
      try {
        const current = getContext(), parsed = JSON.parse(raw), state = parsed.state
        if (current.userId !== bound.userId || state.authAccountId !== bound.userId || state.companyId !== bound.companyId) return
        importLegacy(bound)
        const persisted = loadLocal(bound), pending = pendingIds(bound)
        const baseline = observed.get(scopeKey(bound)) || new Map(), next = new Map(baseline), planned = []
        for (const field of CLOUD_COLLECTIONS) for (const row of state[field] || []) {
          if (!isLocal(field, row, pending)) continue
          if (typeof row.id !== 'string' || !row.id) throw new Error('Local cache row requires a stable ID')
          const key = recordKey(field, row.id), old = baseline.get(key), disk = persisted.get(key)
          if ((disk?.deleted || disk?.draftDeleted) && field === 'documents' && row.status === 'draft') { next.set(key, disk); continue }
          if (old && canonicalPayload(old.row) === canonicalPayload(row)) continue
          if (disk && disk.revision !== old?.revision) throw new Error('LOCAL_CACHE_CONFLICT: ' + key)
          const revision = newRevision(), record = { userId: bound.userId, companyId: bound.companyId, field, id: row.id,
            origin: old?.origin || revision, revision, parent: old?.revision || null, row: JSON.parse(JSON.stringify(row)) }
          planned.push(record); next.set(key, record)
        }
        // Append independent row revisions first. Missing rows never delete another tab's data.
        for (const record of planned) verifyWrite(prefixFor(bound) + 'local.' + record.revision, JSON.stringify(record))
        observed.set(scopeKey(bound), next)
        loadLocal(bound) // Detect a concurrent fork before reporting success.
        const data = Object.fromEntries(DATA_FIELDS.filter((k) => k in state && !LOCAL_COLLECTIONS.has(k)).map((k) =>
          [k, Array.isArray(state[k]) ? state[k].filter((row) => !row.refundContractVersion && (k === 'products' || !isLocal(k, row, pending))) : state[k]]))
        verifyWrite(prefixFor(bound) + 'server', JSON.stringify({ version: parsed.version, userId: bound.userId, companyId: bound.companyId, state: data }))
        lastError = null
      } catch (e) { lastError = e.message; return false }
    },
    removeItem: (name) => { if (!cloudEnabled) storage.removeItem(name + '.demo.v2') },
  }
}

export const companyCache = createScopedCache({ storage: safeStorage(), getContext: getAuthContext,
  isCurrent: isAuthContextCurrent, cloudEnabled: hasApi })
export function readCompanyCache(context) {
  const cached = companyCache.read(context)?.state
  if (!cached) return null
  if (cached.settings?.aiKey) cached.settings.aiKey = deobfuscateSecret(cached.settings.aiKey)
  if (Array.isArray(cached.settings?.webhooks)) cached.settings.webhooks = cached.settings.webhooks.map((w) =>
    w.secret ? { ...w, secret: deobfuscateSecret(w.secret) } : w)
  return cached
}
