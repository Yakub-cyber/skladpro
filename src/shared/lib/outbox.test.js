import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createOutbox, safeStorage, migrateLegacyOutbox } from './outbox'
const A = { userId: 'u1', companyId: 'a' }, B = { userId: 'u1', companyId: 'b' }, U = { userId: 'u2', companyId: 'a' }
const op = (scope = A, id = 'o', obj = { total: 900 }) => ({ ...scope, key: 'products', id, obj })
const boxes = []
const box = (opts = {}) => { const b = createOutbox({ context: A, storage: safeStorage(), send: async (batch) => ({ sent: batch }), ...opts }); boxes.push(b); return b }
beforeEach(() => vi.useFakeTimers())
afterEach(() => { boxes.splice(0).forEach((b) => b.destroy()); vi.useRealTimers() })

describe('scoped outbox', () => {
  it('isolates both users and companies, including identical operation ids', async () => {
    const storage = safeStorage(), send = vi.fn(async (batch) => ({ sent: batch })), b = box({ storage, send })
    b.enqueue([op()]); b.setContext(B); b.enqueue([op(B)]); b.setContext(U); b.enqueue([op(U)])
    await b.flushNow(); expect(send.mock.calls[0][0][0]).toMatchObject(U)
    b.setContext(A); expect(b.items()).toHaveLength(1)
    b.setContext(B); expect(b.items()).toHaveLength(1)
    b.setContext(U); expect(b.items()).toHaveLength(0)
  })
  it('requires explicit matching ownership and never adopts an unbound operation', () => {
    const b = box(); expect(b.enqueue([{ key: 'sale', id: 'legacy' }])).toBe(false)
    expect(b.enqueue([op(B)])).toBe(false); expect(b.items()).toEqual([])
  })
  it('copies payload and protects ownership passed to transport', async () => {
    const input = op(), b = box({ send: async (batch) => {
      expect(() => { batch[0].companyId = 'b' }).toThrow(); return { sent: batch }
    } })
    b.enqueue([input]); input.companyId = 'b'; input.obj.total = 1
    const view = b.items(); view[0].userId = 'u2'; view[0].obj.total = 2
    expect(b.items()[0]).toMatchObject({ ...A, obj: { total: 900 } }); await b.flushNow()
  })
  it('persists operations and compacts updates only in the same scope', () => {
    const storage = safeStorage(), b = box({ storage })
    b.enqueue([op(A, 'o', { total: 10 })]); b.enqueue([op(A, 'o', { total: 20 })])
    expect(box({ storage }).items()).toMatchObject([{ obj: { total: 20 } }])
  })
  it('retains newer revision when an older in-flight operation is confirmed', async () => {
    let resolve; const b = box({ send: (batch) => new Promise((r) => { resolve = () => r({ sent: batch }) }) })
    b.enqueue([op()]); const flushing = b.flushNow(); await Promise.resolve(); await Promise.resolve()
    b.enqueue([op(A, 'o', { total: 42 })]); resolve(); await flushing
    expect(b.items()[0].obj.total).toBe(42)
  })
  it('a new update after acknowledgement is visible even within the same millisecond', async () => {
    const b = box(); b.enqueue([op()]); await b.flushNow()
    b.enqueue([op(A, 'o', { total: 42 })]); expect(b.items()).toHaveLength(1)
    expect(b.items()[0].obj.total).toBe(42)
  })
  it('late confirmation from A cannot acknowledge B after a switch', async () => {
    let resolve; const b = box({ send: (batch) => new Promise((r) => { resolve = () => r({ sent: batch }) }) })
    b.enqueue([op()]); const flushing = b.flushNow(); await Promise.resolve(); await Promise.resolve()
    b.setContext(B); b.enqueue([op(B)]); resolve(); await flushing
    expect(b.items()).toHaveLength(1); b.setContext(A); expect(b.items()).toEqual([])
  })
  it('logout stops timers, retains operations, and same user can resume after reload', async () => {
    const storage = safeStorage(), send = vi.fn(async (batch) => ({ sent: batch })), b = box({ storage, send })
    b.enqueue([op()]); b.setContext(null); await vi.advanceTimersByTimeAsync(60000)
    await b.flushNow(); expect(send).not.toHaveBeenCalled()
    const restored = box({ storage, send }); expect(restored.items()).toHaveLength(1)
    await restored.flushNow(); expect(restored.items()).toEqual([])
  })
  it('retries lost responses without changing operation payload or identity', async () => {
    let fail = true; const send = vi.fn(async (batch) => { if (fail) throw new Error('offline'); return { sent: batch } })
    const b = box({ send }); b.enqueue([op()]); await b.flushNow()
    expect(b.status()).toMatchObject({ pending: 1, state: 'error' }); fail = false
    await vi.advanceTimersByTimeAsync(1000); expect(b.items()).toEqual([])
    expect(send.mock.calls[0][0][0]._entryId).toBe(send.mock.calls[1][0][0]._entryId)
  })
  it('preserves rejected operations and retry-limit quarantine across reload', async () => {
    const storage = safeStorage(), b = box({ storage, maxItemAttempts: 1, send: async () => { throw new Error('offline') } })
    b.enqueue([op()]); await b.flushNow(); await b.flushNow()
    const restored = box({ storage }); expect(restored.status()).toMatchObject({ pending: 1, quarantined: 1 })
    restored.retryQuarantined('o', 'products'); await restored.flushNow(); expect(restored.items()).toEqual([])
    const rejected = box({ send: async (batch) => ({ dropped: batch }) })
    rejected.enqueue([op()]); await rejected.flushNow(); expect(rejected.status()).toMatchObject({ pending: 1, quarantined: 1 })
  })
  it('keeps failed persistence in memory and flushes only after durable write', async () => {
    const storage = safeStorage(), set = storage.setItem; let fail = true
    storage.setItem = (k, v) => { if (fail) throw new Error('quota'); set(k, v) }
    const send = vi.fn(async (batch) => ({ sent: batch })), b = box({ storage, send })
    expect(b.enqueue([op()])).toBe(false); expect(b.items()).toHaveLength(1)
    await b.flushNow(); expect(send).not.toHaveBeenCalled(); fail = false
    await b.flushNow(); expect(send).toHaveBeenCalledOnce()
  })
  it('does not claim durable persistence when browser storage is unavailable', () => {
    const storage = safeStorage(); storage.volatile = true
    const b = box({ storage }); expect(b.enqueue([op()])).toBe(false)
    expect(b.status()).toMatchObject({ pending: 1, state: 'error' })
    expect(b.status().error).toContain('только в памяти')
  })
})
describe('multiple tabs', () => {
  it('serializes concurrent flushes and the waiting tab sees the acknowledgement', async () => {
    let tail = Promise.resolve(), release
    const locks = { request: (_name, run) => {
      const next = tail.then(run); tail = next.catch(() => {}); return next
    } }
    const storage = safeStorage(), send = vi.fn((batch) => new Promise((resolve) => { release = () => resolve({ sent: batch }) }))
    const a = box({ storage, send, locks }), b = box({ storage, send, locks })
    a.enqueue([op()]); const first = a.flushNow()
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    const second = b.flushNow(); await Promise.resolve(); await Promise.resolve()
    expect(send).toHaveBeenCalledOnce(); release(); await first; await second
    expect(send).toHaveBeenCalledOnce(); expect(b.items()).toEqual([])
  })
  it('independent writes are visible without waiting for storage events', () => {
    const storage = safeStorage(), a = box({ storage }), b = box({ storage })
    a.enqueue([op(A, 'one')]); b.enqueue([op(A, 'two')])
    expect(a.items().map((r) => r.id)).toEqual(['one', 'two'])
    expect(b.items()).toHaveLength(2)
  })
  it('a stale tab does not resurrect an acknowledged operation', async () => {
    const storage = safeStorage(), a = box({ storage }), b = box({ storage })
    a.enqueue([op()]); expect(b.items()).toHaveLength(1); await a.flushNow()
    b.enqueue([op(A, 'new')]); expect(b.items().map((r) => r.id)).toEqual(['new'])
    expect(box({ storage }).items().map((r) => r.id)).toEqual(['new'])
  })
  it('uses the same Web Lock for the same partition and different locks for other companies', async () => {
    const storage = safeStorage(), names = [], locks = { request: async (name, run) => { names.push(name); return run() } }
    const a = box({ storage, locks }), b = box({ storage, locks }), c = box({ storage, locks, context: B })
    a.enqueue([op()]); c.enqueue([op(B)]); await a.flushNow(); await b.flushNow(); await c.flushNow()
    expect(names[0]).toBe(names[1]); expect(names[2]).not.toBe(names[0])
  })
})
describe('legacy migration', () => {
  it.each([JSON.stringify({ v: 1, items: [{ key: 'sale', id: 'o' }] }), JSON.stringify({ items: [op()] }), '{broken'])('archives original without adopting ownership: %s', (raw) => {
    const storage = safeStorage(); storage.setItem('sklad.outbox', raw)
    const b = box({ storage }); expect(b.items()).toEqual([]); expect(b.legacy()[0].raw).toBe(raw)
    migrateLegacyOutbox(storage); expect(b.legacy()).toHaveLength(1)
    expect(storage.getItem('sklad.outbox')).toBe(raw)
  })
  it('preserves original on failure and repeats migration safely', async () => {
    const storage = safeStorage(), raw = JSON.stringify({ items: [op()] })
    storage.setItem('sklad.outbox', raw); const set = storage.setItem; let fail = true
    storage.setItem = (k, v) => { if (fail && k.includes('.legacy.')) throw new Error('quota'); set(k, v) }
    const send = vi.fn(), b = box({ storage, send }); b.enqueue([op()]); await b.flushNow()
    expect(send).not.toHaveBeenCalled(); expect(storage.getItem('sklad.outbox')).toBe(raw)
    fail = false; b._onStorageEvent({ key: 'sklad.outbox' }); expect(b.legacy()).toHaveLength(1)
    migrateLegacyOutbox(storage); expect(b.legacy()).toHaveLength(1)
  })
  it('keeps separate snapshots if an old tab modifies legacy data later', () => {
    const storage = safeStorage(), b = box({ storage })
    storage.setItem('sklad.outbox', '{one'); b._onStorageEvent({ key: 'sklad.outbox' })
    storage.setItem('sklad.outbox', '{two'); b._onStorageEvent({ key: 'sklad.outbox' })
    expect(b.legacy().map((r) => r.raw).sort()).toEqual(['{one', '{two'])
  })
})
