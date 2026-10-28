import { describe, it, expect } from 'vitest'
import { createScopedCache } from './scopedCache'
import { safeStorage } from './outbox'
const A = { userId: 'u1', companyId: 'a', generation: 1 }
const B = { userId: 'u1', companyId: 'b', generation: 2 }
const U = { userId: 'u2', companyId: 'a', generation: 3 }
const data = (ctx, name) => JSON.stringify({ version: 19, state: { companyId: ctx.companyId, authAccountId: ctx.userId, products: [{ id: 'p', name }], settings: { aiKey: name }, authUserId: 'employee' } })
const localData = (rows, extra = {}) => JSON.stringify({ version: 19, state: { companyId: A.companyId, authAccountId: A.userId, moneyTx: rows, ...extra } })
function fixture(storage = safeStorage()) {
  let context = A
  const cache = createScopedCache({ storage, getContext: () => context, isCurrent: (ctx) => ctx.generation === context.generation && ctx.userId === context.userId && ctx.companyId === context.companyId })
  return { storage, cache, select: (ctx) => { context = ctx; cache.activate(ctx) } }
}
describe('scoped company cache', () => {
  it('interleaved conflicting writes retain both revisions and fail closed on read', () => {
    const storage = safeStorage(), a = fixture(storage), b = fixture(storage)
    a.select(A); b.select(A)
    const save = storage.setItem.bind(storage); let interleave = true
    storage.setItem = (key, value) => {
      if (interleave && key.includes('.local.')) {
        interleave = false
        b.cache.setItem('sklad.db', localData([{ id: 'tx', amount: 200 }]))
      }
      save(key, value)
    }
    expect(a.cache.setItem('sklad.db', localData([{ id: 'tx', amount: 100 }]))).toBe(false)
    expect(a.cache.error()).toContain('CONFLICT')
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k) => k.includes('.local.'))
    expect(keys).toHaveLength(2)
    expect(keys.map((key) => JSON.parse(storage.getItem(key)).row.amount).sort()).toEqual([100, 200])
    expect(() => b.cache.read(A)).toThrow('CONFLICT')
  })
  it('only the latest unconfirmed outbox revision protects a catalogue row', () => {
    const f = fixture(); f.select(A)
    const op = { ...A, key: 'products', id: 'p', op: 'upsert', _entryId: 'old', _order: 1 }
    f.storage.setItem('sklad.outbox.v2.u1:a.op.old', JSON.stringify(op))
    f.cache.setItem('sklad.db', localData([], { products: [{ id: 'p', name: 'local' }] }))
    f.storage.setItem('sklad.outbox.v2.u1:a.op.new', JSON.stringify({ ...op, _entryId: 'new', _order: 2 }))
    f.storage.setItem('sklad.outbox.v2.u1:a.ack.new', 'confirmed')
    expect(f.cache.overlayLocal(A, { products: [{ id: 'p', name: 'server' }] }).products[0].name).toBe('server')
  })
  it('two tabs preserve independent local money rows despite stale server snapshots', () => {
    const storage = safeStorage(), first = fixture(storage), second = fixture(storage)
    first.select(A); second.select(A)
    first.cache.setItem('sklad.db', localData([{ id: 'tx-a', amount: 100 }], { products: [{ id: 'p', name: 'new' }] }))
    second.cache.setItem('sklad.db', localData([{ id: 'tx-b', amount: 200 }], { products: [{ id: 'p', name: 'stale' }] }))
    expect(first.cache.read(A).state.moneyTx.map((tx) => tx.id).sort()).toEqual(['tx-a', 'tx-b'])
    second.cache.setItem('sklad.db', localData([{ id: 'tx-b', amount: 200 }]))
    expect(first.cache.read(A).state.moneyTx).toHaveLength(2)
    expect(JSON.parse(storage.getItem('sklad.db.v3.u1:a.server')).state.moneyTx).toBeUndefined()
  })
  it('refuses conflicting money identity without inventing provenance or adding amounts', () => {
    const storage = safeStorage(), a = fixture(storage), b = fixture(storage)
    a.select(A); b.select(A)
    a.cache.setItem('sklad.db', localData([{ id: 'tx', amount: 100 }]))
    expect(b.cache.setItem('sklad.db', localData([{ id: 'tx', amount: 200 }]))).toBe(false)
    expect(b.cache.error()).toContain('CONFLICT')
    expect(a.cache.read(A).state.moneyTx).toEqual([{ id: 'tx', amount: 100 }])
    expect(b.cache.setItem('sklad.db', localData([{ amount: 200 }]))).toBe(false)
    expect(b.cache.error()).toContain('stable ID')
  })
  it('rejects stale edits to an observed local record but keeps the newer revision', () => {
    const storage = safeStorage(), a = fixture(storage), b = fixture(storage)
    a.select(A); b.select(A)
    a.cache.setItem('sklad.db', localData([{ id: 'tx', amount: 100 }]))
    b.cache.read(A)
    a.cache.setItem('sklad.db', localData([{ id: 'tx', amount: 150 }]))
    expect(b.cache.setItem('sklad.db', localData([{ id: 'tx', amount: 200 }]))).toBe(false)
    expect(b.cache.error()).toContain('CONFLICT')
    expect(a.cache.read(A).state.moneyTx[0].amount).toBe(150)
  })
  it('stale omission cannot remove pending business header or its local money', () => {
    const storage = safeStorage(), a = fixture(storage), b = fixture(storage)
    const op = { ...A, key: 'sale', id: 'sale-a', _entryId: 'rev', obj: { id: 'sale-a' } }
    storage.setItem('sklad.outbox.v2.u1:a.op.rev', JSON.stringify(op))
    a.select(A); b.select(A)
    a.cache.setItem('sklad.db', localData([{ id: 'tx', orderId: 'sale-a', amount: 100 }], { orders: [{ id: 'sale-a', total: 100 }] }))
    b.cache.setItem('sklad.db', localData([], { orders: [] }))
    const recovered = a.cache.overlayLocal(A, { orders: [], moneyTx: [] })
    expect(recovered.orders).toEqual([{ id: 'sale-a', total: 100 }]); expect(recovered.moneyTx).toHaveLength(1)
    storage.setItem('sklad.outbox.v2.u1:a.ack.rev', 'confirmed')
    expect(a.cache.overlayLocal(A, { orders: [], moneyTx: [] }).orders).toEqual([])
    expect(storage.getItem('sklad.outbox.v2.u1:a.op.rev')).not.toBeNull()
  })
  it('legacy migration is repeatable, preserves original, and never overwrites local data', () => {
    const storage = safeStorage(), f = fixture(storage); f.select(A)
    const original = JSON.stringify({ ...JSON.parse(localData([{ id: 'tx', amount: 100 }])), userId: 'u1', companyId: 'a' })
    storage.setItem('sklad.db.v2.u1:a', original)
    f.cache.read(A); const size = storage.length; f.cache.read(A); expect(storage.length).toBe(size)
    f.cache.setItem('sklad.db', localData([{ id: 'tx', amount: 150 }]))
    expect(f.cache.read(A).state.moneyTx[0].amount).toBe(150)
    expect(storage.getItem('sklad.db.v2.u1:a')).toBe(original)
  })
  it('failed migration and server-cache write retain the original and already saved local rows', () => {
    const storage = safeStorage(), f = fixture(storage); f.select(A)
    const original = JSON.stringify({ ...JSON.parse(localData([{ id: 'tx', amount: 100 }])), userId: 'u1', companyId: 'a' })
    storage.setItem('sklad.db.v2.u1:a', original)
    const save = storage.setItem.bind(storage)
    storage.setItem = () => { throw new Error('quota') }
    expect(() => f.cache.read(A)).toThrow('quota'); expect(f.cache.error()).toBe('quota')
    expect(storage.getItem('sklad.db.v2.u1:a')).toBe(original)
    storage.setItem = save; f.cache.read(A)
    storage.setItem = (key, value) => { if (key.endsWith('.server')) throw new Error('server quota'); save(key, value) }
    expect(f.cache.setItem('sklad.db', localData([{ id: 'tx', amount: 150 }]))).toBe(false)
    expect(f.cache.error()).toBe('server quota')
    expect(f.cache.read(A).state.moneyTx[0].amount).toBe(150)
  })
  it('reports quota failure without aborting an in-memory business operation', () => {
    const storage = safeStorage(), f = fixture(storage); f.select(A)
    storage.setItem = () => { throw new Error('quota') }
    expect(f.cache.setItem('sklad.db', data(A, 'A'))).toBe(false)
    expect(f.cache.error()).toBe('quota')
  })
  it('isolates products and local secrets by user and company', () => {
    const f = fixture(); f.select(A); f.cache.setItem('sklad.db', data(A, 'A'))
    f.select(B); expect(f.cache.read(B)).toBe(null); f.cache.setItem('sklad.db', data(B, 'B'))
    f.select(U); expect(f.cache.read(U)).toBe(null); f.cache.setItem('sklad.db', data(U, 'U'))
    f.select(A); expect(f.cache.read(A).state.settings.aiKey).toBe('A')
    f.select(B); expect(f.cache.read(B).state.products[0].name).toBe('B')
    expect(f.cache.read(B).state.authUserId).toBeUndefined()
  })
  it('never adopts or overwrites legacy global cache', () => {
    const f = fixture(); const raw = data(A, 'legacy'); f.storage.setItem('sklad.db', raw)
    f.select(B); expect(f.cache.getItem('sklad.db')).toBe(null)
    f.cache.setItem('sklad.db', data(B, 'B')); expect(f.storage.getItem('sklad.db')).toBe(raw)
  })
  it('blocks old store state and late writes after switch or logout', () => {
    const f = fixture(); f.select(A); f.cache.setItem('sklad.db', data(A, 'A'))
    f.select(B); f.cache.setItem('sklad.db', data(A, 'late-A')); expect(f.cache.read(B)).toBe(null)
    f.cache.activate(null); f.cache.setItem('sklad.db', data(B, 'late-B')); expect(f.cache.read(B)).toBe(null)
    f.select(A); expect(f.cache.read(A).state.products[0].name).toBe('A')
  })
  it('different tabs keep their own cache binding', () => {
    const storage = safeStorage(), first = fixture(storage), second = fixture(storage)
    first.select(A); second.select(B)
    first.cache.setItem('sklad.db', data(A, 'A')); second.cache.setItem('sklad.db', data(B, 'B'))
    expect(first.cache.read(A).state.products[0].name).toBe('A'); expect(second.cache.read(B).state.products[0].name).toBe('B')
  })
  it('rejects a cache record whose ownership does not match its key', () => {
    const f = fixture(); f.select(A); f.storage.setItem('sklad.db.v2.u1:a', JSON.stringify({ userId: 'u2', companyId: 'a', state: {} }))
    expect(() => f.cache.read(A)).toThrow('ownership')
  })
})

describe('local draft deletion tombstones', () => {
  const draft = { id: 'draft-1', status: 'draft', type: 'purchase', note: 'original' }
  const snapshot = (ctx = A, documents = [draft]) => JSON.stringify({ version: 19,
    state: { authAccountId: ctx.userId, companyId: ctx.companyId, documents } })
  const entries = (storage) => Array.from({ length: storage.length }, (_, i) => storage.key(i))
    .filter((key) => key.includes('.local.')).map((key) => [key, JSON.parse(storage.getItem(key))])
  it('create, delete and reload retains history and does not restore the draft', () => {
    const f = fixture(); f.select(A); f.cache.setItem('sklad.db', snapshot())
    expect(f.cache.deleteDraft(draft.id)).toEqual({ ok: true })
    f.cache.setItem('sklad.db', snapshot(A, []))
    const reloaded = fixture(f.storage); reloaded.select(A)
    expect(reloaded.cache.read(A).state.documents).toEqual([])
    expect(entries(f.storage).filter(([, record]) => record.deleted)).toHaveLength(1)
    expect(entries(f.storage).some(([, record]) => record.row?.id === draft.id)).toBe(true)
  })
  it('stale snapshots and stale edited snapshots from another tab cannot resurrect a deleted draft', () => {
    const storage = safeStorage(), a = fixture(storage), b = fixture(storage)
    a.select(A); b.select(A); a.cache.setItem('sklad.db', snapshot()); b.cache.read(A)
    expect(a.cache.deleteDraft(draft.id).ok).toBe(true)
    expect(b.cache.setItem('sklad.db', snapshot())).not.toBe(false)
    expect(b.cache.setItem('sklad.db', snapshot(A, [{ ...draft, note: 'late edit' }]))).not.toBe(false)
    expect(a.cache.read(A).state.documents).toEqual([])
    expect(b.cache.overlayLocal(A, { documents: [draft] }).documents).toEqual([])
    expect(entries(storage)).toHaveLength(2)
  })
  it('repeated deletion is idempotent and never rewrites the tombstone', () => {
    const f = fixture(); f.select(A); f.cache.setItem('sklad.db', snapshot())
    f.cache.deleteDraft(draft.id); const before = entries(f.storage)
    f.storage.setItem = () => { throw new Error('should not write') }
    expect(f.cache.deleteDraft(draft.id)).toEqual({ ok: true, duplicate: true })
    expect(entries(f.storage)).toEqual(before)
  })
  it('a revision prepared before deletion and physically appended afterward cannot cancel the tombstone', () => {
    const f = fixture(); f.select(A); f.cache.setItem('sklad.db', snapshot())
    const [[, original]] = entries(f.storage)
    f.cache.deleteDraft(draft.id)
    f.storage.setItem('sklad.db.v3.u1:a.local.late', JSON.stringify({ ...original,
      revision: 'late', parent: original.revision, row: { ...draft, note: 'late response' } }))
    expect(f.cache.read(A).state.documents).toEqual([])
    expect(entries(f.storage)).toHaveLength(3)
  })
  it('deletion interleaved between another tab planning and appending an edit wins over that edit', () => {
    const storage = safeStorage(), a = fixture(storage), b = fixture(storage)
    a.select(A); b.select(A); a.cache.setItem('sklad.db', snapshot()); b.cache.read(A)
    const save = storage.setItem.bind(storage); let interleave = true
    storage.setItem = (key, raw) => {
      if (interleave && key.includes('.local.')) {
        interleave = false
        expect(a.cache.deleteDraft(draft.id)).toEqual({ ok: true })
      }
      save(key, raw)
    }
    expect(b.cache.setItem('sklad.db', snapshot(A, [{ ...draft, note: 'concurrent' }]))).not.toBe(false)
    expect(a.cache.read(A).state.documents).toEqual([])
    expect(entries(storage)).toHaveLength(3)
  })
  it('isolates identical document IDs by both company and user', () => {
    const f = fixture()
    for (const ctx of [A, B, U]) { f.select(ctx); f.cache.setItem('sklad.db', snapshot(ctx)) }
    f.select(A); f.cache.deleteDraft(draft.id)
    expect(f.cache.read(A).state.documents).toEqual([])
    f.select(B); expect(f.cache.read(B).state.documents).toEqual([draft])
    expect(f.cache.deleteDraft(draft.id, A)).toMatchObject({ ok: false, error: 'CONTEXT_CHANGED' })
    f.select(U); expect(f.cache.read(U).state.documents).toEqual([draft])
  })
  it('tombstone write failure keeps the draft recoverable and reports the failure', () => {
    const f = fixture(); f.select(A); f.cache.setItem('sklad.db', snapshot())
    const before = entries(f.storage)
    f.storage.setItem = () => { throw new Error('quota') }
    expect(f.cache.deleteDraft(draft.id)).toMatchObject({ ok: false, code: 'CACHE_DELETE_ERROR', error: 'quota' })
    expect(f.cache.error()).toBe('quota'); expect(entries(f.storage)).toEqual(before)
    const reload = fixture(f.storage); reload.select(A)
    expect(reload.cache.read(A).state.documents).toEqual([draft])
  })
  it('detects a silent tombstone write failure by read-back', () => {
    const f = fixture(); f.select(A); f.cache.setItem('sklad.db', snapshot())
    f.storage.setItem = () => {}
    expect(f.cache.deleteDraft(draft.id)).toMatchObject({ ok: false, error: 'Cache write not confirmed' })
    expect(f.cache.read(A).state.documents).toEqual([draft])
  })
  it('damaged journals fail closed without rewriting or deleting the original data', () => {
    const f = fixture(); f.select(A); f.cache.setItem('sklad.db', snapshot())
    f.storage.setItem('sklad.db.v3.u1:a.local.broken', '{broken')
    expect(f.cache.deleteDraft(draft.id).ok).toBe(false)
    expect(() => f.cache.read(A)).toThrow()
    expect(f.storage.getItem('sklad.db.v3.u1:a.local.broken')).toBe('{broken')
    expect(entriesSafeTombstones(f.storage)).toHaveLength(0)
  })
  function entriesSafeTombstones(storage) {
    return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key) => key.includes('.local.tombstone-'))
  }
  it('a damaged tombstone ancestry prevents recovery rather than restoring the draft', () => {
    const f = fixture(); f.select(A); f.cache.setItem('sklad.db', snapshot()); f.cache.deleteDraft(draft.id)
    const [key, tombstone] = entries(f.storage).find(([, record]) => record.deleted)
    f.storage.setItem(key, JSON.stringify({ ...tombstone, origin: 'missing', parent: 'missing' }))
    expect(() => f.cache.read(A)).toThrow('ancestry')
    expect(f.cache.deleteDraft(draft.id).ok).toBe(false)
    expect(f.storage.getItem(key)).toContain('missing')
  })
  it('legacy draft migration stays repeatable after deletion and preserves the v2 original', () => {
    const f = fixture(); f.select(A)
    const original = JSON.stringify({ ...JSON.parse(snapshot()), userId: A.userId, companyId: A.companyId })
    f.storage.setItem('sklad.db.v2.u1:a', original)
    expect(f.cache.read(A).state.documents).toEqual([draft])
    expect(f.cache.deleteDraft(draft.id).ok).toBe(true)
    const count = f.storage.length
    for (let i = 0; i < 3; i++) expect(f.cache.read(A).state.documents).toEqual([])
    expect(f.storage.length).toBe(count); expect(f.storage.getItem('sklad.db.v2.u1:a')).toBe(original)
    const reload = fixture(f.storage); reload.select(A); expect(reload.cache.read(A).state.documents).toEqual([])
  })
  it('preserves server and posted documents and refuses drafts with pending posting commands', () => {
    const f = fixture(); f.select(A); f.cache.setItem('sklad.db', snapshot())
    const op = { ...A, key: 'doc_post', id: draft.id, _entryId: 'post', _order: 1, obj: { id: draft.id } }
    f.storage.setItem('sklad.outbox.v2.u1:a.op.post', JSON.stringify(op))
    expect(f.cache.deleteDraft(draft.id).ok).toBe(false)
    f.storage.removeItem('sklad.outbox.v2.u1:a.op.post')
    f.cache.deleteDraft(draft.id)
    const posted = { ...draft, status: 'posted' }
    expect(f.cache.overlayLocal(A, { documents: [posted] }).documents).toEqual([posted])
    f.cache.setItem('sklad.db', snapshot(A, [posted]))
    expect(f.cache.read(A).state.documents).toEqual([posted])
    expect(f.cache.deleteDraft(draft.id)).toMatchObject({ ok: true, duplicate: true })
  })
  it('a concurrent posting header remains recoverable even with a prior draft tombstone', () => {
    const f = fixture(); f.select(A); f.cache.setItem('sklad.db', snapshot())
    const [[, original]] = entries(f.storage); f.cache.deleteDraft(draft.id)
    const posted = { ...draft, status: 'posted', postedAt: '2026-10-13T00:00:00Z' }
    f.storage.setItem('sklad.outbox.v2.u1:a.op.post', JSON.stringify({ ...A, key: 'doc_post', id: draft.id, _entryId: 'post', _order: 1 }))
    f.storage.setItem('sklad.db.v3.u1:a.local.post', JSON.stringify({ ...original, revision: 'post', parent: original.revision, row: posted }))
    expect(f.cache.read(A).state.documents).toEqual([posted])
    expect(f.cache.deleteDraft(draft.id).ok).toBe(false)
    f.storage.setItem('sklad.outbox.v2.u1:a.ack.post', 'confirmed')
    expect(f.cache.overlayLocal(A, { documents: [draft] }).documents).toEqual([])
    expect(f.cache.overlayLocal(A, { documents: [posted] }).documents).toEqual([posted])
    const before = entries(f.storage).length
    expect(f.cache.setItem('sklad.db', snapshot())).not.toBe(false)
    expect(entries(f.storage)).toHaveLength(before)
    expect(f.cache.read(A).state.documents).toEqual([])
  })
  it('confirmed posting and sales sourced from a draft also prevent intentional draft deletion', () => {
    for (const key of ['doc_post', 'sale']) {
      const f = fixture(); f.select(A); f.cache.setItem('sklad.db', snapshot())
      f.storage.setItem('sklad.outbox.v2.u1:a.op.confirmed', JSON.stringify({ ...A, key,
        id: key === 'doc_post' ? draft.id : 'sale-1', _entryId: 'confirmed', _order: 1, obj: { sourceDocumentId: draft.id } }))
      f.storage.setItem('sklad.outbox.v2.u1:a.ack.confirmed', 'confirmed')
      expect(f.cache.deleteDraft(draft.id)).toMatchObject({ ok: false })
      expect(entriesSafeTombstones(f.storage)).toHaveLength(0)
      expect(f.storage.getItem('sklad.outbox.v2.u1:a.op.confirmed')).not.toBeNull()
    }
  })
  it('a late posting command never makes an old draft snapshot visible again and the command stays intact', () => {
    const f = fixture(); f.select(A); f.cache.setItem('sklad.db', snapshot()); f.cache.deleteDraft(draft.id)
    const command = JSON.stringify({ ...A, key: 'doc_post', id: draft.id, _entryId: 'late-command', _order: 1, obj: { ...draft, status: 'posted' } })
    f.storage.setItem('sklad.outbox.v2.u1:a.op.late-command', command)
    expect(f.cache.overlayLocal(A, { documents: [draft] }).documents).toEqual([])
    expect(f.storage.getItem('sklad.outbox.v2.u1:a.op.late-command')).toBe(command)
    expect(f.cache.overlayLocal(A, { documents: [{ ...draft, status: 'posted' }] }).documents).toEqual([{ ...draft, status: 'posted' }])
  })
})
