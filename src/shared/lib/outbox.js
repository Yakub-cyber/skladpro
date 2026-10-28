// Per-operation journal: tabs never overwrite a shared array or resurrect acknowledgements.
import { buildDependencyPlan, isBusinessCommand } from './outboxDependencies'
const STORAGE_KEY = 'sklad.outbox'
const copy = (v) => JSON.parse(JSON.stringify(v))
const valid = (s) => typeof s?.userId === 'string' && !!s.userId && typeof s?.companyId === 'string' && !!s.companyId
export const scopeKey = (s) => `${encodeURIComponent(s.userId)}:${encodeURIComponent(s.companyId)}`
const same = (a, b) => valid(a) && valid(b) && a.userId === b.userId && a.companyId === b.companyId
const itemKey = (it) => JSON.stringify([it.key, it.id])
const BUSINESS_KEYS = new Set(['sale', 'doc_post', 'order_status', 'return_v2', 'commercial_create', 'commercial_edit', 'order_delivery', 'order_cancel'])
export function canonicalPayload(value) {
  const normalized = copy(value)
  const sort = (v) => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v
  return JSON.stringify(sort(normalized))
}
const commandPayload = (it) => canonicalPayload({ userId: it.userId, companyId: it.companyId,
  key: it.key, id: it.id, op: it.op, obj: it.obj, ...(it.idempotencyKey ? { idempotencyKey: it.idempotencyKey } : {}),
  ...(it.sourceDocumentId ? { sourceDocumentId: it.sourceDocumentId } : {}) })
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
let sequence = 0
const clock = () => globalThis.performance?.now?.() ?? Date.now()
const unique = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`
export function safeStorage() {
  try { if (typeof localStorage !== 'undefined') return localStorage } catch { /* unavailable */ }
  const mem = new Map()
  return { volatile: typeof window !== 'undefined', get length() { return mem.size }, key: (i) => [...mem.keys()][i] ?? null,
    getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, String(v)) }, removeItem: (k) => { mem.delete(k) } }
}
const keys = (storage) => Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(Boolean)
// Preserve every legacy snapshot verbatim. Never infer ownership from the current login.
export function migrateLegacyOutbox(storage, legacyKey = STORAGE_KEY) {
  const raw = storage.getItem(legacyKey)
  if (raw == null) return
  let hash = 2166136261
  for (let i = 0; i < raw.length; i++) hash = Math.imul(hash ^ raw.charCodeAt(i), 16777619)
  const key = `${legacyKey}.legacy.${raw.length}-${hash >>> 0}`
  const old = storage.getItem(key)
  if (old != null && old !== raw) throw new Error('Legacy backup collision; original preserved')
  if (old == null) storage.setItem(key, raw)
  if (storage.getItem(key) !== raw) throw new Error('Legacy backup not saved; original preserved')
  return key
}
export function createOutbox({ send, storage = safeStorage(), storageKey = STORAGE_KEY,
  context = null, debounceMs = 400, baseDelayMs = 1000, maxDelayMs = 30000,
  maxItemAttempts = 100, locks, batchSize = 250, scanChunkSize = 128,
  yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)) } = {}) {
  let scope = valid(context) ? { userId: context.userId, companyId: context.companyId } : null
  let generation = 0, paused = !scope, timer = null, flushing = null, attempts = 0
  let lastError = null, migrationError = null
  let lastNotified = null
  let notificationQueued = false, destroyed = false
  const listeners = new Set(), pendingWrites = new Map(), indexes = new Map()
  const limit = Math.max(1, Math.min(250, Math.floor(batchSize) || 250))
  const scanLimit = Math.max(1, Math.min(256, Math.floor(scanChunkSize) || 128))
  const legacyKeys = new Set()
  let legacyCount = 0
  const prefixFor = (s) => `${storageKey}.v2.${scopeKey(s)}.`
  const notify = () => {
    if (notificationQueued || destroyed) return
    notificationQueued = true
    queueMicrotask(() => {
      notificationQueued = false
      if (destroyed) return
      const next = status(), signature = JSON.stringify([scope, next])
      if (signature === lastNotified) return
      lastNotified = signature
      for (const fn of listeners) fn(next)
    })
  }
  function migrate() {
    try {
      const key = migrateLegacyOutbox(storage, storageKey)
      if (key) legacyKeys.add(key)
      if (storage.length <= scanLimit) for (const k of keys(storage)) if (k.startsWith(storageKey + '.legacy.')) legacyKeys.add(k)
      legacyCount = legacyKeys.size; migrationError = null
    }
    catch (e) { migrationError = e.message }
  }
  migrate()
  function indexFor(s) {
    if (!valid(s)) return null
    const key = scopeKey(s)
    if (!indexes.has(key)) indexes.set(key, { scope: { ...s }, entries: new Map(), latest: new Map(),
      payloads: new Map(), meta: new Map(), ack: new Set(), views: new Map(), active: new Map(), returns: new Map(),
      quarantined: 0, blocked: [], blockedCount: 0, maxOrder: Date.now() - 1, initialized: false, refreshing: null })
    return indexes.get(key)
  }
  function updateView(index, logical) {
    const old = index.views.get(logical)
    if (old?.key === 'return_v2') index.returns.delete(old._entryId)
    if (old && index.active.delete(old._entryId) && old._quarantined) index.quarantined--
    const record = index.entries.get(index.latest.get(logical))
    if (!record) return
    const r = { ...copy(record), ...(index.meta.get(record._entryId) || {}) }
    if (index.payloads.get(logical)?.size > 1) {
      r._quarantined = true
      r._quarantineReason = { code: 'COMMAND_CONFLICT', error: 'Сохранены разные payload одного бизнес-ключа; нужен разбор' }
    }
    if (BUSINESS_KEYS.has(r.key) && index.meta.get(record._entryId)?._unverifiedRemoval) {
      r._quarantined = true
      r._quarantineReason = { code: 'UNVERIFIED_REMOVAL', error: 'Удаление из очереди не доказывает проведение; требуется сверка' }
    }
    for (const f of ['userId', 'companyId']) Object.defineProperty(r, f, { value: index.scope[f], enumerable: true, writable: false })
    if (BUSINESS_KEYS.has(r.key)) freeze(r)
    index.views.set(logical, r)
    if (!index.ack.has(r._entryId)) { index.active.set(r._entryId, r); if (r._quarantined) index.quarantined++ }
    if (!index.ack.has(r._entryId) && r.key === 'return_v2') index.returns.set(r._entryId, r)
  }
  function observe(index, record) {
    if (!same(record, index.scope)) throw new Error('Outbox ownership mismatch')
    const logical = itemKey(record), previous = index.entries.get(index.latest.get(logical))
    if (BUSINESS_KEYS.has(record.key)) {
      if (!index.payloads.has(logical)) index.payloads.set(logical, new Set())
      index.payloads.get(logical).add(commandPayload(record))
    }
    index.entries.set(record._entryId, record)
    index.maxOrder = Math.max(index.maxOrder, record._order)
    if (!previous || record._order > previous._order || (record._order === previous._order && record._entryId > previous._entryId)) index.latest.set(logical, record._entryId)
    const prefix = prefixFor(index.scope)
    const acknowledgement = storage.getItem(prefix + 'ack.' + record._entryId)
    if (acknowledgement && (!BUSINESS_KEYS.has(record.key) || acknowledgement === 'confirmed')) index.ack.add(record._entryId)
    else index.ack.delete(record._entryId)
    const raw = storage.getItem(prefix + 'meta.' + record._entryId)
    index.meta.set(record._entryId, { ...(raw ? JSON.parse(raw) : {}),
      ...(BUSINESS_KEYS.has(record.key) && acknowledgement && acknowledgement !== 'confirmed' ? { _unverifiedRemoval: true } : {}) })
    updateView(index, logical)
  }
  function scanKey(index, key) {
    if (key?.startsWith(storageKey + '.legacy.')) { legacyKeys.add(key); legacyCount = legacyKeys.size }
    if (key?.startsWith(prefixFor(index.scope) + 'op.')) {
      const raw = storage.getItem(key)
      if (raw != null) observe(index, JSON.parse(raw))
    }
  }
  function scanSync(index) {
    for (const key of keys(storage)) scanKey(index, key)
    for (const r of pendingWrites.values()) if (same(r, index.scope)) observe(index, copy(r))
    index.initialized = true
  }
  function refreshIndex(index) {
    if (index.refreshing) return index.refreshing
    if (storage.length <= scanLimit) { scanSync(index); return null }
    const epoch = generation
    const run = async () => {
      let stable = false
      // Storage key order may change when a peer appends keys during a yield.
      // At most two passes; a still-changing snapshot is deferred, never sent.
      for (let pass = 0; pass < 2; pass++) {
        const length = storage.length
        let turn = clock()
        for (let i = 0; i < length; i++) {
          if (epoch !== generation) return
          scanKey(index, storage.key(i))
          if ((i + 1) % scanLimit === 0 || clock() - turn >= 8) { await yieldControl(); turn = clock() }
        }
        if (storage.length === length) { stable = true; break }
      }
      if (!stable) { index.initialized = false; return }
      for (const r of pendingWrites.values()) if (same(r, index.scope)) observe(index, copy(r))
      index.initialized = true
    }
    index.refreshing = run().finally(() => { index.refreshing = null })
    return index.refreshing
  }
  function sorted(index, all = false) {
    return [...(all ? index.views : index.active).values()].sort((a, b) => a._order - b._order || a._entryId.localeCompare(b._entryId))
  }
  function read(s = scope, includeAcknowledged = false) {
    const index = indexFor(s)
    if (!index) return []
    // Small synchronous callers retain immediate visibility across tabs. Large
    // partitions are hydrated cooperatively; status never scans per operation.
    if (storage.length <= scanLimit) scanSync(index)
    else if (!index.initialized) void refreshIndex(index).then(notify).catch((e) => { lastError = e.message; notify() })
    return sorted(index, includeAcknowledged)
  }
  function currentItems() {
    try { return read() } catch (e) { lastError = e.message; return [] }
  }
  function legacy() {
    return [...legacyKeys].map((k) => {
      const raw = storage.getItem(k)
      let count = null
      try { count = JSON.parse(raw)?.items?.length ?? null } catch { /* preserve damaged JSON */ }
      return { key: k, raw, count, reason: 'LEGACY_UNBOUND' }
    })
  }
  function status() {
    const index = indexFor(scope)
    if (index && !index.initialized && !index.refreshing) {
      try {
        const pending = refreshIndex(index)
        if (pending) void pending.then(notify).catch((e) => { lastError = e.message; notify() })
      } catch (e) { lastError = e.message }
    }
    const pending = index?.active.size || 0, quarantined = index?.quarantined || 0
    const blockedLegacy = legacyCount, error = migrationError || lastError || (storage.volatile ? 'Локальное хранилище недоступно: очередь только в памяти' : null)
    const blocked = index?.blockedCount || 0
    return { pending, quarantined, blocked, blockedLegacy, paused, hydrating: !!index?.refreshing,
      state: migrationError ? 'error' : quarantined || blocked || blockedLegacy ? 'attention' : error ? 'error' : flushing || index?.refreshing ? 'syncing' : pending ? 'pending' : 'ok', error }
  }
  function schedule(delay) {
    if (paused || !scope) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; void flushNow() }, delay)
  }
  function savePending() {
    for (const [id, r] of pendingWrites) {
      storage.setItem(prefixFor(r) + 'op.' + id, JSON.stringify(r)); pendingWrites.delete(id)
      observe(indexFor(r), copy(r))
    }
  }
  function savePendingCooperatively(guard) {
    if (pendingWrites.size <= scanLimit) { savePending(); return null }
    const entries = [...pendingWrites]
    return (async () => {
      let processed = 0, turn = clock()
      for (const [id, r] of entries) {
        if (!guard()) return
        storage.setItem(prefixFor(r) + 'op.' + id, JSON.stringify(r))
        pendingWrites.delete(id); observe(indexFor(r), copy(r))
        if (++processed % scanLimit === 0 || clock() - turn >= 8) { await yieldControl(); turn = clock() }
      }
    })()
  }
  function enqueue(batch) {
    if (!batch?.length) return true
    if (batch.some((it) => BUSINESS_KEYS.has(it.key))) {
      lastError = 'Бизнес-команда требует подтверждённого сохранения через enqueueCommand'; notify(); return false
    }
    if (!scope || batch.some((it) => !same(it, scope))) {
      lastError = 'Outbox requires the original user and company'; notify(); return false
    }
    try {
      const index = indexFor(scope)
      if (storage.length <= scanLimit) scanSync(index)
      else if (!index.initialized) {
        const refreshing = refreshIndex(index)
        if (refreshing) void refreshing.then(notify).catch((e) => { lastError = e.message; notify() })
        lastError = 'Очередь загружается; повторите сохранение после загрузки'; notify(); return false
      }
      let order = Math.max(Date.now(), index.maxOrder + 1)
      for (const it of batch) {
        const r = { ...copy(it), _entryId: unique(), _order: order++ }; pendingWrites.set(r._entryId, r)
        observe(index, copy(r))
      }
      savePending(); lastError = null
      if (!timer && !flushing) schedule(debounceMs)
      notify(); return !storage.volatile
    } catch (e) { lastError = e.message; notify(); return false }
  }
  async function enqueueCommand(input) {
    const s = scope ? { ...scope } : null, epoch = generation
    const fail = (code, error) => { lastError = error; notify(); return { ok: false, code, error } }
    if (!s || !same(input, s) || !BUSINESS_KEYS.has(input.key)) return fail('CONTEXT_CHANGED', 'Не подтверждены пользователь и компания команды')
    const item = copy(input), lockService = locks || globalThis.navigator?.locks
    if (!lockService?.request) return fail('LOCK_UNAVAILABLE', 'Без блокировки вкладок бизнес-команда не принята. Используйте браузер с Web Locks.')
    if (storage.volatile) return fail('STORAGE_UNAVAILABLE', 'Команда не принята: постоянное хранилище недоступно')
    try {
      const lifecycle = ['order_cancel', 'order_delivery'].includes(item.key)
      const admissionKey = lifecycle ? 'lifecycle.' + encodeURIComponent(item.obj.orderId) : 'command.' + encodeURIComponent(itemKey(item))
      return await lockService.request(prefixFor(s) + admissionKey, async () => {
        if (epoch !== generation || !same(s, scope) || paused) return fail('CONTEXT_CHANGED', 'Контекст изменился; команда не принята')
        const index = indexFor(s), refreshing = refreshIndex(index)
        if (refreshing) await refreshing
        if (epoch !== generation || !same(s, scope) || paused) return fail('CONTEXT_CHANGED', 'Контекст изменился; команда не принята')
        if (!index.initialized) return fail('OUTBOX_LOADING', 'Журнал изменился во время загрузки; повторите ту же команду')
        const previous = index.views.get(itemKey(item))
        if (previous) {
          if (previous._quarantineReason?.code === 'COMMAND_CONFLICT' || commandPayload(previous) !== commandPayload(item)) {
            return fail('COMMAND_CONFLICT', 'Этот ключ уже связан с другой бизнес-командой. Повтор с изменёнными данными отклонён.')
          }
          lastError = null; notify()
          return { ok: true, duplicate: true, acknowledged: !!storage.getItem(prefixFor(s) + 'ack.' + previous._entryId), entryId: previous._entryId }
        }
        if (lifecycle) {
          const conflict = [...index.views.values()].find(op => (op.obj?.orderId === item.obj.orderId || op.key === 'return_v2' && op.obj?.request?.orderId === item.obj.orderId) &&
            (['order_delivery', 'order_cancel'].includes(op.key) || !index.ack.has(op._entryId)))
          if (conflict) return fail('ORDER_LIFECYCLE_CONFLICT', `Есть неразрешённая или несовместимая команда заказа: ${conflict.id}`)
          const shipment = [...index.views.values()].find(op => op.key === 'order_status' && op.id === item.obj.orderId && op.obj?.shipmentId === item.obj.request.shipmentId)
          if (item.key === 'order_cancel' && (!shipment || !index.ack.has(shipment._entryId) || shipment._quarantined)) return fail('SHIPMENT_NOT_CONFIRMED', 'Исходная отгрузка не подтверждена')
        }
        const record = { ...item, _entryId: unique(), _order: Math.max(Date.now(), index.maxOrder + 1) }
        const key = prefixFor(s) + 'op.' + record._entryId, raw = JSON.stringify(record)
        storage.setItem(key, raw)
        if (storage.getItem(key) !== raw) throw new Error('Запись команды не подтверждена хранилищем')
        observe(index, record)
        lastError = null
        if (!timer && !flushing) schedule(debounceMs)
        notify()
        return { ok: true, entryId: record._entryId, acknowledged: false }
      })
    } catch (e) { return fail('STORAGE_ERROR', `Команда не принята: ${e.message || String(e)}`) }
  }
  function writeMeta(it, meta) {
    storage.setItem(prefixFor(it) + 'meta.' + it._entryId, JSON.stringify(meta))
    const index = indexFor(it); index.meta.set(it._entryId, meta); updateView(index, itemKey(it))
  }
  async function performFlush(s, epoch) {
    const guard = () => !paused && epoch === generation && same(s, scope)
    if (!guard()) return false
    // Migration is unchanged; the expensive snapshot is taken once per flush.
    migrate()
    if (migrationError) return false
    const saving = savePendingCooperatively(guard)
    if (saving) await saving
    if (!guard()) return false
    const index = indexFor(s), refreshing = refreshIndex(index)
    if (refreshing) await refreshing
    if (!guard() || !index.initialized) return false
    const plan = await buildDependencyPlan(sorted(index), { yieldControl, chunkSize: scanLimit })
    if (!guard()) return false
    const updateBlocked = () => { index.blocked = plan.blocked(); index.blockedCount = plan.blockedCount() }
    updateBlocked()
    let flushFailure = null
    let lockUnavailable = false
    for (let candidates = plan.take(limit); candidates.length; candidates = plan.take(limit)) {
      if (!guard()) return false
      // A peer may have confirmed/quarantined a revision while we yielded.
      const batch = []
      let prepared = 0, turn = clock()
      for (const it of candidates) {
        const raw = storage.getItem(prefixFor(s) + 'op.' + it._entryId)
        if (raw != null) observe(index, JSON.parse(raw))
        const current = index.active.get(it._entryId)
        if (current && !current._quarantined && isBusinessCommand(current) && !(locks || globalThis.navigator?.locks)?.request) {
          lockUnavailable = true
          flushFailure = new Error('Web Locks недоступен: складские бизнес-команды не отправлены')
          lastError = flushFailure.message
        } else if (current && !current._quarantined && (!isBusinessCommand(current) || raw != null)) batch.push(current)
        else if (index.ack.has(it._entryId)) plan.confirm(it._entryId)
        else if (current) plan.reject(it._entryId, current)
        if (++prepared % scanLimit === 0 || clock() - turn >= 8) {
          await yieldControl(); turn = clock()
          if (!guard()) return false
        }
      }
      if (!batch.length) continue
      const byEntryId = new Map(batch.map((it) => [it._entryId, it]))
      const byLogical = new Map(batch.map((it) => [itemKey(it), it]))
      const originalFor = (it) => it._entryId ? byEntryId.get(it._entryId) : byLogical.get(itemKey(it))
      let failure = null
      try {
        const res = await send(batch, { ...s, generation: epoch, isCurrent: guard,
          canSendBusiness: (it) => {
            if (!guard() || !plan.canSend(it._entryId)) return false
            const raw = storage.getItem(prefixFor(s) + 'op.' + it._entryId)
            if (raw == null) return false
            observe(index, JSON.parse(raw))
            const current = index.active.get(it._entryId)
            if (current?._quarantined) plan.reject(it._entryId, current)
            if (index.ack.has(it._entryId)) plan.confirm(it._entryId)
            return !!current && !current._quarantined
          } }) || {}
        turn = clock()
        let processed = 0
        for (const it of res.sent || []) {
          const original = originalFor(it)
          if (original) {
            storage.setItem(prefixFor(s) + 'ack.' + original._entryId, 'confirmed')
            index.ack.add(original._entryId); updateView(index, itemKey(original))
            plan.confirm(original._entryId)
          }
          if (++processed % scanLimit === 0 || clock() - turn >= 8) { await yieldControl(); turn = clock() }
        }
        for (const it of res.dropped || []) {
          const original = originalFor(it)
          if (original) { writeMeta(original, { _quarantined: true, _quarantineReason: { code: 'REJECTED', error: 'Server did not confirm operation' } }); plan.reject(original._entryId, index.views.get(itemKey(original))) }
          if (++processed % scanLimit === 0 || clock() - turn >= 8) { await yieldControl(); turn = clock() }
        }
        for (const q of res.quarantined || []) {
          const original = originalFor(q.it)
          if (original && !index.ack.has(original._entryId)) { writeMeta(original, { _quarantined: true, _quarantineReason: q.reason }); plan.reject(original._entryId, index.views.get(itemKey(original))) }
          if (++processed % scanLimit === 0 || clock() - turn >= 8) { await yieldControl(); turn = clock() }
        }
        if (res.error) failure = res.error
      } catch (e) { failure = e }
      if (failure) {
        if (!guard()) return false
        attempts++; lastError = failure.message || String(failure)
        turn = clock()
        let processed = 0
        for (const it of batch) {
          // Direct revision reads replace a full journal scan per operation.
          const raw = storage.getItem(prefixFor(s) + 'op.' + it._entryId)
          if (raw != null) observe(index, JSON.parse(raw))
          const current = index.active.get(it._entryId)
          if (current && !current._quarantined) {
            const n = (current._attempts || 0) + 1
            writeMeta(it, n > maxItemAttempts ? { _attempts: n, _quarantined: true, _quarantineReason: { code: 'RETRY_LIMIT', error: lastError } } : { _attempts: n })
            plan.reject(it._entryId, index.views.get(itemKey(it)))
          }
          if (++processed % scanLimit === 0 || clock() - turn >= 8) {
            await yieldControl(); turn = clock()
            if (!guard()) return false
          }
        }
        flushFailure = failure
        if (!batch.some(isBusinessCommand)) {
          updateBlocked()
          if (index.active.size > index.quarantined) schedule(Math.min(baseDelayMs * 2 ** (attempts - 1), maxDelayMs))
          return false
        }
      }
      if (!guard()) return false
      if (!flushFailure) { attempts = 0; lastError = null }
      updateBlocked()
      notify()
      if (plan.hasReady()) await yieldControl()
    }
    updateBlocked()
    if (flushFailure) {
      lastError = flushFailure.message || String(flushFailure)
      if (!lockUnavailable && index.active.size > index.quarantined) schedule(Math.min(baseDelayMs * 2 ** (attempts - 1), maxDelayMs))
    }
    return !flushFailure && index.active.size === index.quarantined
  }
  async function flushNow() {
    if (paused || !scope) return false
    if (flushing) return flushing
    if (timer) clearTimeout(timer)
    timer = null
    const s = { ...scope }, epoch = generation, run = () => performFlush(s, epoch)
    const lockService = locks || globalThis.navigator?.locks
    flushing = Promise.resolve().then(() => lockService?.request ? lockService.request(prefixFor(s) + 'flush', run) : run())
      .catch((e) => { if (epoch === generation) lastError = e.message; return false })
    notify()
    const result = await flushing
    flushing = null
    const index = indexFor(scope)
    if (!paused && index && index.active.size > index.quarantined + index.blockedCount && !timer && !lastError) schedule(debounceMs)
    notify(); return result
  }
  function setContext(next, { suspended = false } = {}) {
    generation++
    if (timer) clearTimeout(timer)
    timer = null; scope = valid(next) ? { userId: next.userId, companyId: next.companyId } : null
    paused = suspended || !scope; attempts = 0; lastError = null
    if (!paused) schedule(0)
    notify()
  }
  function quarantine(id, key, reason, target = scope, entryId) {
    if (!target) return false
    const index = indexFor(target)
    const revision = entryId || index.latest.get(itemKey({ id, key }))
    if (revision && !index.entries.has(revision)) {
      const raw = storage.getItem(prefixFor(target) + 'op.' + revision)
      if (raw) observe(index, JSON.parse(raw))
    }
    const it = revision ? index.entries.get(revision) : null
    if (it && (it.id !== id || it.key !== key)) return false
    if (!it || index.ack.has(it._entryId)) return false
    writeMeta(it, { _quarantined: true, _quarantineReason: reason || {} }); notify(); return true
  }
  function retryQuarantined(id, key) {
    const it = indexFor(scope)?.views.get(itemKey({ id, key }))
    if (!it?._quarantined || indexFor(scope).ack.has(it._entryId)) return false
    writeMeta(it, {}); schedule(0); notify(); return true
  }
  function removeQuarantined(id, key) {
    if (BUSINESS_KEYS.has(key)) return false // Deletion is not proof of resolution of a predecessor.
    const it = indexFor(scope)?.views.get(itemKey({ id, key }))
    if (!it?._quarantined || indexFor(scope).ack.has(it._entryId)) return false
    storage.setItem(prefixFor(it) + 'ack.' + it._entryId, 'explicit-user-removal')
    const index = indexFor(it); index.ack.add(it._entryId); updateView(index, itemKey(it)); notify(); return true
  }
  function onStorage(e) {
    if (!e?.key || !(e.key.startsWith(storageKey + '.') || e.key === storageKey)) return
    if (e.key === storageKey || e.key.startsWith(storageKey + '.legacy.')) migrate()
    for (const index of indexes.values()) {
      const prefix = prefixFor(index.scope)
      if (!e.key.startsWith(prefix)) continue
      const revision = e.key.slice(prefix.length).replace(/^(op|ack|meta)\./, '')
      const raw = storage.getItem(prefix + 'op.' + revision)
      if (raw) observe(index, JSON.parse(raw))
    }
    notify()
    if (!timer && !flushing) schedule(debounceMs)
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return { enqueue, enqueueCommand, flushNow, status, setContext,
    suspend: () => { generation++; paused = true; if (timer) clearTimeout(timer); timer = null; notify() },
    resume: () => { if (scope) { paused = false; schedule(0); notify() } },
    items: (key) => copy(key === 'return_v2' ? [...(indexFor(scope)?.returns.values() || [])] : currentItems()),
    quarantined: () => copy(currentItems().filter((it) => it._quarantined)),
    blocked: () => copy(indexFor(scope)?.blocked || []),
    legacy, quarantine, retryQuarantined, removeQuarantined,
    onChange: (fn) => { listeners.add(fn); fn(status()); return () => listeners.delete(fn) },
    // Tests only: logout and switching must not clear persisted operations.
    reset: () => { if (timer) clearTimeout(timer); timer = null; generation++; pendingWrites.clear()
      for (const k of keys(storage)) if (scope && k.startsWith(prefixFor(scope))) storage.removeItem(k)
      if (scope) indexes.delete(scopeKey(scope))
      attempts = 0; lastError = null },
    destroy: () => { destroyed = true; generation++; paused = true; if (timer) clearTimeout(timer); listeners.clear()
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage) },
    _onStorageEvent: onStorage }
}
