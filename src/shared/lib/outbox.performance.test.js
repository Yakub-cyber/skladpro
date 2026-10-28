import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOutbox } from './outbox'

const A = { userId: 'u1', companyId: 'a' }, B = { userId: 'u1', companyId: 'b' }
function fixture(count, context = A, storage) {
  const values = new Map(), names = [], reads = { get: 0, key: 0 }
  const target = storage || {
    get length() { return names.length }, key: (i) => { reads.key++; return names[i] ?? null },
    getItem: (key) => { reads.get++; return values.get(key) ?? null },
    setItem: (key, value) => { if (!values.has(key)) names.push(key); values.set(key, String(value)) },
    removeItem: (key) => { values.delete(key); const i = names.indexOf(key); if (i >= 0) names.splice(i, 1) },
  }
  for (let i = 0; i < count; i++) target.setItem(`sklad.outbox.v2.${context.userId}:${context.companyId}.op.r${i}`, JSON.stringify({
    ...context, key: 'products', op: 'upsert', id: 'p' + i, obj: { id: 'p' + i, name: 'Product ' + i }, _entryId: 'r' + i, _order: i + 1,
  }))
  return { storage: target, reads }
}
const boxes = []
function box(storage, opts = {}) {
  const b = createOutbox({ storage, context: A, debounceMs: 60000, baseDelayMs: 60000,
    locks: { request: async (_name, run) => run() },
    yieldControl: async () => {}, send: async (batch) => ({ sent: batch }), ...opts })
  boxes.push(b); return b
}
afterEach(() => { boxes.splice(0).forEach((b) => b.destroy()) })

describe('bounded outbox processing', () => {
  it.each([100, 500, 1000, 10000])('%i operations: full batch failure uses linear reads and retains every operation', async (count) => {
    const f = fixture(count), send = vi.fn(async () => ({ error: new Error('offline') })), b = box(f.storage, { send })
    b.onChange(() => {})
    await b.flushNow()
    expect(send).toHaveBeenCalledOnce(); expect(send.mock.calls[0][0]).toHaveLength(Math.min(count, 250))
    expect(b.status()).toMatchObject({ pending: count, state: 'error' })
    expect(f.reads.get).toBeLessThan(10 * count + 3000); expect(f.reads.key).toBeLessThan(3 * count + 512)
    const before = { ...f.reads }
    for (let i = 0; i < 100; i++) b.status()
    expect(f.reads).toEqual(before)
    expect(b.items().filter((r) => r._attempts === 1)).toHaveLength(Math.min(count, 250))
    expect(b.items()).toHaveLength(count)
  })
  it.each([100, 500, 1000, 10000])('%i operations: confirms in bounded batches with stable order and ownership', async (count) => {
    const f = fixture(count), sent = [], yields = vi.fn(async () => {})
    const b = box(f.storage, { yieldControl: yields, send: async (batch, context) => {
      expect(batch.length).toBeLessThanOrEqual(250); expect(context).toMatchObject(A)
      for (const r of batch) { expect(r).toMatchObject(A); sent.push(r.id) }
      return { sent: batch }
    } })
    expect(await b.flushNow()).toBe(true)
    expect(sent).toEqual(Array.from({ length: count }, (_, i) => 'p' + i)); expect(b.status().pending).toBe(0)
    expect(f.reads.get).toBeLessThan(10 * count + 3000); expect(f.reads.key).toBeLessThan(3 * count + 512)
    if (count >= 500) expect(yields).toHaveBeenCalled()
    expect(f.storage.getItem('sklad.outbox.v2.u1:a.op.r0')).not.toBeNull()
    expect(f.storage.getItem('sklad.outbox.v2.u1:a.ack.r0')).toBe('confirmed')
  })
  it('partial confirmations affect only matching revisions; the remainder is retained', async () => {
    const f = fixture(1000), b = box(f.storage, { send: async (batch) => ({
      sent: [...batch.filter((r) => Number(r.id.slice(1)) % 2 === 0), { ...batch[1], _entryId: 'not-in-this-batch' }],
    }) })
    expect(await b.flushNow()).toBe(false); expect(b.status().pending).toBe(500)
    expect(b.items().every((r) => Number(r.id.slice(1)) % 2 === 1)).toBe(true)
  })
  it('transport quarantine is applied cooperatively with original rejection reasons', async () => {
    const f = fixture(1000), yielding = vi.fn(async () => {}), b = box(f.storage, { yieldControl: yielding,
      send: async (batch) => ({ quarantined: batch.map((it) => ({ it, reason: { code: 'VALIDATION_ERROR', traceId: it.id } })) }),
    })
    await b.flushNow()
    expect(b.status()).toMatchObject({ pending: 1000, quarantined: 1000, state: 'attention' })
    expect(b.items()[0]._quarantineReason).toEqual({ code: 'VALIDATION_ERROR', traceId: 'p0' })
    expect(yielding).toHaveBeenCalled(); expect(f.reads.get).toBeLessThan(10000)
    expect(f.storage.getItem('sklad.outbox.v2.u1:a.ack.r0')).toBeNull()
  })
  it('lost response retries original revisions/payloads before proceeding to later operations', async () => {
    const f = fixture(500), server = new Map(), requests = []; let lost = true
    const b = box(f.storage, { send: async (batch) => {
      requests.push(batch.map((r) => r._entryId))
      for (const r of batch) {
        const payload = JSON.stringify(r.obj)
        if (server.has(r._entryId)) expect(server.get(r._entryId)).toBe(payload)
        else server.set(r._entryId, payload)
      }
      if (lost) { lost = false; throw new Error('response lost') }
      return { sent: batch }
    } })
    await b.flushNow(); expect(b.status().pending).toBe(500)
    await b.flushNow(); expect(requests[0]).toEqual(requests[1]); expect(server.size).toBe(500)
    expect(b.status().pending).toBe(0)
  })
  it('sale precedes cancellation across a batch boundary without changing business payloads', async () => {
    const f = fixture(249), requests = []
    const sale = { ...A, key: 'sale', id: 's', op: 'create', obj: { id: 's', items: [{ qty: 1 }] }, _entryId: 'sale-rev', _order: 250 }
    const cancel = { ...A, key: 'order_status', id: 's:cancelled', op: 'update', obj: { orderId: 's', status: 'cancelled' }, _entryId: 'cancel-rev', _order: 251 }
    for (const r of [sale, cancel]) f.storage.setItem('sklad.outbox.v2.u1:a.op.' + r._entryId, JSON.stringify(r))
    const b = box(f.storage, { send: async (batch) => {
      requests.push(batch)
      for (const r of batch.filter((it) => it.key !== 'products')) expect(Object.isFrozen(r.obj)).toBe(true)
      return { sent: batch }
    } })
    await b.flushNow()
    expect(requests).toHaveLength(2)
    expect(requests[0].at(-1)).toMatchObject(sale); expect(requests[1][0]).toMatchObject(cancel)
    expect(JSON.parse(f.storage.getItem('sklad.outbox.v2.u1:a.op.sale-rev'))).toEqual(sale)
  })
  it('company switch during flush acknowledges captured A revisions and stops subsequent A batches', async () => {
    const f = fixture(500); fixture(5, B, f.storage)
    let resolve; const send = vi.fn((batch) => new Promise((r) => { resolve = () => r({ sent: batch }) }))
    const b = box(f.storage, { send }), flushing = b.flushNow()
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    b.setContext(B, { suspended: true }); resolve(); await flushing
    await vi.waitFor(() => expect(b.status().hydrating).toBe(false))
    expect(b.status().pending).toBe(5); expect(send).toHaveBeenCalledOnce()
    b.setContext(A, { suspended: true }); expect(b.status().pending).toBe(250)
  })
  it.each(['confirmed', 'failed'])('concurrent peer revision survives an older %s request', async (outcome) => {
    const f = fixture(500); let resolve
    const a = box(f.storage, { send: (batch) => new Promise((r) => { resolve = () => r(outcome === 'confirmed' ? { sent: batch } : { error: new Error('offline') }) }) })
    const b = box(f.storage); b.status(); await vi.waitFor(() => expect(b.status().hydrating).toBe(false))
    const flushing = a.flushNow(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    expect(b.enqueue([{ ...A, key: 'products', id: 'p0', op: 'upsert', obj: { id: 'p0', name: 'newer' } }])).toBe(true)
    const newer = b.items().find((r) => r.id === 'p0')
    a._onStorageEvent({ key: 'sklad.outbox.v2.u1:a.op.' + newer._entryId })
    // Stop after the first response to avoid another deferred transport call.
    if (outcome === 'confirmed') a.suspend()
    resolve(); await flushing
    expect(a.items().find((r) => r.id === 'p0')).toMatchObject({ _entryId: newer._entryId, obj: { name: 'newer' } })
    expect(a.items().find((r) => r.id === 'p0')._attempts).toBeUndefined()
    expect(f.storage.getItem('sklad.outbox.v2.u1:a.ack.' + newer._entryId)).toBeNull()
  })
  it('ten thousand status/quarantine updates do not reread the journal', async () => {
    const f = fixture(10000), b = box(f.storage), listener = vi.fn()
    b.onChange(listener)
    await vi.waitFor(() => expect(b.status().hydrating).toBe(false))
    const before = { ...f.reads }, notified = listener.mock.calls.length
    for (let i = 0; i < 10000; i++) expect(b.quarantine('p' + i, 'products', { code: 'REJECTED' }, A, 'r' + i)).toBe(true)
    expect(b.status()).toMatchObject({ pending: 10000, quarantined: 10000 })
    expect(f.reads).toEqual(before)
    await Promise.resolve()
    expect(listener.mock.calls.length - notified).toBe(1)
  })
  it('peer additions that reorder storage keys during hydration cannot hide an operation', async () => {
    const f = fixture(500), originalKey = f.storage.key.bind(f.storage)
    let reordered = false
    f.storage.key = (i) => originalKey(reordered ? (i + f.storage.length - 1) % f.storage.length : i)
    const sent = [], b = box(f.storage, { yieldControl: async () => {
      if (reordered) return
      f.storage.setItem('sklad.outbox.v2.u1:a.op.peer', JSON.stringify({ ...A, key: 'products', id: 'peer', obj: {}, _entryId: 'peer', _order: 501 }))
      reordered = true
    }, send: async (batch) => { sent.push(...batch.map((r) => r.id)); return { sent: batch } } })
    expect(await b.flushNow()).toBe(true)
    expect(sent).toEqual([...Array.from({ length: 500 }, (_, i) => 'p' + i), 'peer'])
  })
  it('the default scheduler yields to an actual timer while hydrating a large journal', async () => {
    const f = fixture(1000), b = box(f.storage, { yieldControl: undefined }); let ticked = false
    setTimeout(() => { ticked = true }, 0)
    await b.flushNow(); expect(ticked).toBe(true)
  })
})
