import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOutbox, safeStorage } from './outbox'
import { commandResources } from './outboxDependencies'

const A = { userId: 'u', companyId: 'a' }, B = { userId: 'u', companyId: 'b' }
const boxes = []
const locks = () => {
  const tails = new Map(), names = []
  return { names, request: (name, run) => { names.push(name); const task = (tails.get(name) || Promise.resolve()).then(run); tails.set(name, task.catch(() => {})); return task } }
}
const inventory = (id, warehouseId = 'a', products = ['p']) => ({ id, key: 'doc_post', op: 'create', obj: { id, type: 'adjust', warehouseId, items: products.map((productId) => ({ productId, qty: id === 'first' ? 30 : 25 })) } })
const status = (id, orderId, next = 'cancelled') => ({ id, key: 'order_status', obj: { orderId, status: next } })
function seed(storage, commands, owner = A) {
  commands.forEach((op, i) => {
    const { quarantine, ...command } = op, entry = { ...owner, ...command, _entryId: op.id + '-rev', _order: i + 1 }
    storage.setItem(`sklad.outbox.v2.${owner.userId}:${owner.companyId}.op.${entry._entryId}`, JSON.stringify(entry))
    if (quarantine) storage.setItem(`sklad.outbox.v2.${owner.userId}:${owner.companyId}.meta.${entry._entryId}`, JSON.stringify({ _quarantined: true, _quarantineReason: { code: quarantine } }))
  })
}
function box(commands = [], options = {}) {
  const storage = options.storage || safeStorage()
  if (commands.length) seed(storage, commands, options.context || A)
  const send = options.send || vi.fn(async (batch) => ({ sent: batch }))
  const b = createOutbox({ context: A, storage, locks: locks(), yieldControl: async () => {}, debounceMs: 60000, baseDelayMs: 60000, send, ...options })
  boxes.push(b); return { b, storage, send }
}
afterEach(() => boxes.splice(0).forEach((b) => b.destroy()))

describe('durable resource dependency barriers', () => {
  it('sends sequential inventories only after the first acknowledgement, preserving order and payloads', async () => {
    const sent = [], { b, storage } = box([inventory('first'), inventory('second')], { send: vi.fn(async (batch) => { sent.push(batch.map((c) => c.id)); return { sent: batch } }) })
    const original = storage.getItem('sklad.outbox.v2.u:a.op.first-rev')
    expect(await b.flushNow()).toBe(true)
    expect(sent).toEqual([['first'], ['second']])
    expect(storage.getItem('sklad.outbox.v2.u:a.op.first-rev')).toBe(original)
  })
  it.each(['VALIDATION_ERROR', 'STALE', 'RETURN_RETRY_REQUIRED'])('%s predecessor survives repeated flushes and blocks the next inventory', async (quarantine) => {
    const { b, send } = box([{ ...inventory('first'), quarantine }, inventory('second')])
    for (let i = 0; i < 3; i++) await b.flushNow()
    expect(send).not.toHaveBeenCalled()
    expect(b.status()).toMatchObject({ pending: 2, quarantined: 1, blocked: 1 })
    expect(b.blocked()[0]).toMatchObject({ id: 'second', predecessorId: 'first', scope: 'warehouse_product', reason: quarantine })
  })
  it.each([1, 250])('new quarantine cannot be crossed inside or across batches (batch size %s)', async (batchSize) => {
    const calls = [], { b } = box([inventory('first'), inventory('second'), inventory('independent', 'b')], { batchSize,
      send: async (batch) => { calls.push(...batch.map((c) => c.id)); return { sent: batch.filter((c) => c.id !== 'first'), quarantined: batch.filter((c) => c.id === 'first').map((it) => ({ it, reason: { code: 'STALE' } })) } } })
    await b.flushNow(); await b.flushNow()
    expect(calls).toEqual(['first', 'independent'])
    expect(b.blocked()[0]).toMatchObject({ id: 'second', reason: 'STALE' })
  })
  it('known products without a warehouse block every warehouse of those products, but not other products', async () => {
    const first = inventory('first', undefined); delete first.obj.warehouseId
    const { b, send } = box([{ ...first, quarantine: 'STALE' }, inventory('second', 'b'), inventory('other', 'a', ['p2'])])
    await b.flushNow()
    expect(send.mock.calls.flatMap(([batch]) => batch.map((c) => c.id))).toEqual(['other'])
    expect(b.blocked()[0].scope).toBe('product_any_warehouse')
  })
  it('unknown order composition blocks company stock, while catalogue, settings and unrelated nonstock status pass', async () => {
    const { b, send } = box([{ ...status('first', 'order1'), quarantine: 'STALE' }, inventory('second'),
      { id: 'product', key: 'products', obj: { id: 'product' } }, { id: 'settings', key: 'settings', obj: { currency: 'RUB' } }, status('packed', 'other', 'packed')])
    await b.flushNow()
    expect(send.mock.calls.flatMap(([batch]) => batch.map((c) => c.id))).toEqual(['product', 'settings', 'packed'])
    expect(b.blocked()[0]).toMatchObject({ id: 'second', scope: 'company_stock' })
  })
  it('does not infer the resource scope of status commands from ignored payload hints', () => {
    const op = status('first', 'o'); op.obj.items = [{ productId: 'p' }]; op.obj.warehouseId = 'a'
    expect(commandResources(op).scope).toBe('company_stock')
  })
  it('a v2 return retains its identity and blocks its products on every warehouse; inconsistent projection falls back to company scope', async () => {
    const first = { id: 'return-id', key: 'return_v2', obj: { request: { returnId: 'return-id', orderId: 'o', items: [{ saleLineId: 'line', qtyBase: '1.0000' }] },
      projection: { items: [{ productId: 'p', saleLineId: 'line', qtyBase: '1.0000' }] } } }
    const { b, storage, send } = box([{ ...first, quarantine: 'STALE' }, inventory('second', 'b'), inventory('other', 'a', ['p2'])])
    const original = storage.getItem('sklad.outbox.v2.u:a.op.return-id-rev')
    await b.flushNow()
    expect(send.mock.calls.flatMap(([batch]) => batch.map((c) => c.id))).toEqual(['other'])
    expect(b.blocked()[0]).toMatchObject({ predecessorId: 'return-id', scope: 'product_any_warehouse' })
    expect(storage.getItem('sklad.outbox.v2.u:a.op.return-id-rev')).toBe(original)
    first.obj.projection.items[0].saleLineId = 'wrong-line'
    expect(commandResources(first).scope).toBe('company_stock')
  })
  it('multiple product lines and transitive dependencies are all covered', async () => {
    const { b, send } = box([{ ...inventory('first', 'a', ['p', 'p2']), quarantine: 'STALE' }, inventory('second', 'a', ['p2', 'p3']), inventory('third', 'a', ['p3']), inventory('other', 'a', ['p4'])])
    await b.flushNow()
    expect(send.mock.calls.flatMap(([batch]) => batch.map((c) => c.id))).toEqual(['other'])
    expect(b.blocked().map((c) => c.id)).toEqual(['second', 'third'])
  })
  it('a transfer covers source and destination but leaves a third warehouse independent', async () => {
    const transfer = inventory('first', 'a'); transfer.obj.type = 'transfer'; transfer.obj.warehouseToId = 'b'
    const { b, send } = box([{ ...transfer, quarantine: 'STALE' }, inventory('second', 'b'), inventory('other', 'c')])
    await b.flushNow()
    expect(send.mock.calls.flatMap(([batch]) => batch.map((c) => c.id))).toEqual(['other'])
    expect(b.blocked().map((c) => c.id)).toEqual(['second'])
  })
  it('the same source order introduces a dependency even between disjoint stock resources or nonstock statuses', async () => {
    const first = inventory('first'); first.obj.orderId = 'o'
    const second = inventory('second', 'b', ['p2']); second.obj.orderId = 'o'
    const { b, send } = box([{ ...first, quarantine: 'STALE' }, second, status('packed', 'o', 'packed')])
    await b.flushNow()
    expect(send).not.toHaveBeenCalled(); expect(b.blocked()).toHaveLength(2)
  })
  it('reload and a waiting tab reconstruct the barrier under the same Web Lock', async () => {
    const shared = locks(), storage = safeStorage(), send = vi.fn(async (batch) => ({ sent: batch }))
    seed(storage, [{ ...inventory('first'), quarantine: 'STALE' }, inventory('second')])
    const a = box([], { storage, send, locks: shared }), c = box([], { storage, send, locks: shared })
    await Promise.all([a.b.flushNow(), c.b.flushNow()])
    expect(send).not.toHaveBeenCalled()
    expect(a.b.blocked()).toEqual(c.b.blocked())
    expect(shared.names[0]).toBe(shared.names[1])
  })
  it('two flushing tabs never send a business command twice and observe durable predecessor acknowledgements', async () => {
    const shared = locks(), storage = safeStorage(), requests = []; let release
    seed(storage, [inventory('first'), inventory('second')])
    const send = vi.fn(async (batch) => {
      requests.push(batch.map((c) => c.id))
      if (batch[0].id === 'first') await new Promise((resolve) => { release = resolve })
      return { sent: batch }
    })
    const a = box([], { storage, send, locks: shared }), b = box([], { storage, send, locks: shared })
    const first = a.b.flushNow()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const second = b.b.flushNow()
    expect(requests).toEqual([['first']])
    release(); await first; await second
    expect(requests).toEqual([['first'], ['second']])
    expect(b.b.items()).toEqual([])
  })
  it('keeps a thousand-command blocked chain without repeated sending and reports a bounded diagnostic sample', async () => {
    const commands = Array.from({ length: 1000 }, (_, i) => inventory('inv' + i))
    commands[0].quarantine = 'STALE'
    const { b, send } = box(commands)
    await b.flushNow()
    expect(send).not.toHaveBeenCalled()
    expect(b.status().blocked).toBe(999)
    expect(b.blocked()).toHaveLength(100)
    expect(b.items()).toHaveLength(1000)
  })
  it('company and user partitions do not share barriers', async () => {
    const storage = safeStorage(); seed(storage, [{ ...status('first', 'o'), quarantine: 'STALE' }, inventory('second')]); seed(storage, [inventory('second')], B)
    const { b, send } = box([], { storage })
    await b.flushNow(); expect(send).not.toHaveBeenCalled()
    b.setContext(B); await b.flushNow()
    expect(send.mock.calls[0][0][0]).toMatchObject(B)
    b.setContext(A); await b.flushNow(); expect(b.blocked()).toHaveLength(1)
  })
  it('manual retry retains identity and confirmation unlocks the successor, never retrying quarantine automatically', async () => {
    const { b, storage, send } = box([{ ...inventory('first'), quarantine: 'STALE' }, inventory('second')])
    const original = storage.getItem('sklad.outbox.v2.u:a.op.first-rev')
    await b.flushNow(); expect(send).not.toHaveBeenCalled()
    expect(b.removeQuarantined('first', 'doc_post')).toBe(false)
    expect(b.retryQuarantined('first', 'doc_post')).toBe(true)
    await b.flushNow()
    expect(send.mock.calls.map(([batch]) => batch[0].id)).toEqual(['first', 'second'])
    expect(b.blocked()).toEqual([]); expect(storage.getItem('sklad.outbox.v2.u:a.op.first-rev')).toBe(original)
  })
  it('a historical explicit removal is not confirmation and cannot silently unlock successors', async () => {
    const { b, storage, send } = box([inventory('first'), inventory('second')])
    storage.setItem('sklad.outbox.v2.u:a.ack.first-rev', 'explicit-user-removal')
    await b.flushNow()
    expect(send).not.toHaveBeenCalled()
    expect(b.quarantined()[0]._quarantineReason.code).toBe('UNVERIFIED_REMOVAL')
    expect(b.blocked()[0].predecessorId).toBe('first')
  })
  it('does not bypass missing Web Locks for restored business commands, while catalogue data still sends', async () => {
    const previous = globalThis.navigator
    vi.stubGlobal('navigator', {})
    try {
      const { b, send } = box([inventory('first'), { id: 'catalog', key: 'products', obj: { id: 'catalog' } }], { locks: undefined })
      await b.flushNow()
      expect(send.mock.calls.flatMap(([batch]) => batch.map((c) => c.id))).toEqual(['catalog'])
      expect(b.status().error).toContain('Web Locks')
    } finally { vi.stubGlobal('navigator', previous) }
  })
  it('lost response keeps the predecessor unresolved; replay confirms the same ID without a second modeled posting', async () => {
    const postings = new Set(), requests = []; let lose = true
    const { b } = box([inventory('first'), inventory('second')], { send: async (batch) => {
      requests.push(batch.map((c) => c.id))
      for (const c of batch) postings.add(c.id)
      if (lose) { lose = false; return { error: new Error('lost response') } }
      return { sent: batch }
    } })
    await b.flushNow(); expect(postings.size).toBe(1); expect(b.blocked()).toHaveLength(1)
    await b.flushNow(); expect(requests).toEqual([['first'], ['first'], ['second']]); expect(postings.size).toBe(2)
  })
})
