import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { safeStorage } from '../../lib/outbox'
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } })
let api, cloud, cache, store, log, fetchMock, offline, delayedPull, delayedCompany, user, listeners, channels
beforeEach(async () => { vi.stubGlobal('navigator', { locks: { request: async (_name, run) => run() } });
  vi.resetModules(); vi.useFakeTimers(); vi.stubEnv('VITE_API_URL', 'https://test.invalid')
  vi.stubGlobal('sessionStorage', safeStorage()); vi.stubGlobal('localStorage', safeStorage())
  channels = []
  vi.stubGlobal('BroadcastChannel', class {
    constructor() { channels.push(this) }
    postMessage(message) { this.lastMessage = message }
    close() {}
  })
  listeners = new Map(); vi.stubGlobal('window', { addEventListener: (type, cb) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(cb) }, removeEventListener: (type, cb) => listeners.get(type)?.delete(cb) })
  log = []; offline = false; delayedPull = null; delayedCompany = null; user = 'u1'
  fetchMock = vi.fn(async (url, opts = {}) => {
    const path = new URL(url).pathname, company = opts.headers?.['x-company-id']
    log.push({ path, company, opts })
    if (offline) throw new Error('offline')
    if (path === '/v1/auth/login') return response({ user: { id: user, email: user + '@test.invalid' }, accessToken: 'access-' + user, refreshToken: 'refresh-' + user, memberships: [{ companyId: 'a' }, { companyId: 'b' }] })
    if (path === '/v1/auth/logout') return response({ ok: true })
    if (path === '/v1/companies') return delayedCompany ? delayedCompany.promise : response({ company: { id: 'b' } })
    if (path === '/v1/memberships') return response({ memberships: ['a', 'b'].map((id) => ({ companyId: id, companyName: id, role: 'admin' })) })
    if (path === '/v1/sync/pull') {
      if (delayedPull && company === 'a') return delayedPull.promise
      return response({ tables: { products: { rows: [{ id: 'p', name: 'product-' + company }], hasMore: false }, employees: { rows: [{ id: 'e-' + user, user_id: user, role: 'admin', active: true }], hasMore: false } } })
    }
    if (path === '/v1/settings') return response({ data: { company } })
    if (path === '/v1/employees/me') return response({ employee: { id: 'e-' + user } })
    if (path === '/v1/sales') return response({ ok: true })
    if (path === '/v1/sync/push') return response({ results: JSON.parse(opts.body).ops.map(() => ({ ok: true })) })
    return response({})
  })
  vi.stubGlobal('fetch', fetchMock)
  api = await import('../../api/index'); cloud = await import('../../lib/cloud'); cache = await import('../../lib/scopedCache')
  const { createCloudSlice, cloudInitialState, bindStore } = await import('./cloudSlice')
  const { create } = await import('zustand')
  store = create((set, get) => ({ ...cache.emptyCloudData(), ...cloudInitialState, ...createCloudSlice(set, get) }))
  bindStore(store); await store.getState().initAuth()
})
afterEach(() => { cloud.stopCloudSync(); cloud.syncOutbox.destroy(); api.__resetApiForTests(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
async function signIn() { expect((await store.getState().signIn('x@test.invalid', 'password')).ok).toBe(true) }
function saveCache() {
  const s = store.getState(); cache.companyCache.setItem('sklad.db', JSON.stringify({ version: 19, state: s }))
}
describe('cloud lifecycle integration (actual API client and outbox, mocked HTTP)', () => {
  it('online bootstrap restores local finance and purchase orders separately from server data', async () => {
    api.__resetApiForTests()
    const { useStore } = await import('../useStore')
    store = useStore; await store.getState().initAuth(); await signIn()
    store.setState({ accounts: [{ id: 'cash', kind: 'cash' }], moneyTx: [{ id: 'tx', accountId: 'cash', amount: 100 }], purchaseOrders: [{ id: 'po', status: 'draft' }] })
    await store.getState().cloudLogout(); expect(store.getState().moneyTx).toEqual([])
    await signIn()
    expect(store.getState().moneyTx).toEqual([{ id: 'tx', accountId: 'cash', amount: 100 }])
    expect(store.getState().accounts).toEqual([{ id: 'cash', kind: 'cash' }])
    expect(store.getState().purchaseOrders).toEqual([{ id: 'po', status: 'draft' }])
  })
  it('late createCompany from previous user cannot select a company in the new session', async () => {
    await signIn(); delayedCompany = deferred()
    const creating = store.getState().createCompany('New company')
    await vi.waitFor(() => expect(log.some((r) => r.path === '/v1/companies')).toBe(true))
    await store.getState().cloudLogout(); user = 'u2'; await signIn()
    const before = log.length, context = api.getAuthContext()
    delayedCompany.resolve(response({ company: { id: 'b' } }))
    expect(await creating).toMatchObject({ ok: false, code: 'CONTEXT_CHANGED' })
    expect(api.getAuthContext()).toEqual(context)
    expect(store.getState()).toMatchObject({ authAccountId: 'u2', companyId: 'a' })
    expect(log.slice(before)).toEqual([])
  })
  it('late createCompany after same-user company switch cannot switch back', async () => {
    await signIn(); delayedCompany = deferred()
    const creating = store.getState().createCompany('New company')
    await store.getState().switchCompany('b')
    const context = api.getAuthContext(), before = log.length
    delayedCompany.resolve(response({ company: { id: 'a' } }))
    expect(await creating).toMatchObject({ ok: false, code: 'CONTEXT_CHANGED' })
    expect(api.getAuthContext()).toEqual(context); expect(log.slice(before)).toEqual([])
  })
  it('peer logout clears visible state, stops outbox, and retains saved operations', async () => {
    await signIn(); offline = true; await cloud.enqueueSale({ id: 'saved' })
    channels.at(-1).onmessage({ data: { type: 'LOGOUT', userId: 'u1', source: 'peer', id: 'logout-1' } })
    expect(store.getState()).toMatchObject({ companyId: null, authAccountId: null, products: [], cloudReady: false })
    const before = log.length
    await cloud.syncOutbox.flushNow(); await vi.advanceTimersByTimeAsync(5000)
    expect(log).toHaveLength(before); expect(api.getSession()).toBe(null)
    expect(localStorage.getItem('sklad.outbox.v2.u1:a.op.' + 'missing')).toBe(null)
    expect(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).some((k) => k.startsWith('sklad.outbox.v2.u1:a.op.'))).toBe(true)
  })
  it('failed logout persistence and reload retain the actual unconfirmed outbox journal', async () => {
    await signIn(); offline = true; await cloud.enqueueSale({ id: 'durable-logout-sale' })
    const journal = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .filter((k) => k.startsWith('sklad.outbox.')).sort().map((k) => [k, localStorage.getItem(k)])
    const saved = journal(); expect(saved.some(([k]) => k.includes('.op.'))).toBe(true)
    const setLocal = localStorage.setItem.bind(localStorage)
    localStorage.setItem = (key, value) => { if (key.startsWith('skladpro-')) throw new Error('marker denied'); setLocal(key, value) }
    sessionStorage.setItem = sessionStorage.removeItem = () => { throw new Error('session denied') }
    await store.getState().cloudLogout()
    expect(store.getState()).toMatchObject({ companyId: null, authAccountId: null, products: [] })
    expect(journal()).toEqual(saved)
    api.__resetApiForTests(); vi.resetModules(); api = await import('../../api/index')
    const before = log.length
    expect(await api.apiBootstrap()).toEqual({ session: null }); expect(log).toHaveLength(before)
    expect(journal()).toEqual(saved)
  })
  it('real removeDocument persists deletion before removing the draft and fresh cache recovery stays empty', async () => {
    api.__resetApiForTests()
    const { useStore } = await import('../useStore')
    store = useStore; await store.getState().initAuth(); await signIn(); offline = true
    const id = store.getState().addDocument({ type: 'purchase', items: [], note: 'delete me' }, { post: false })
    expect(store.getState().documents.some((d) => d.id === id)).toBe(true)
    expect(store.getState().removeDocument(id)).toEqual({ ok: true })
    expect(store.getState().documents.some((d) => d.id === id)).toBe(false)
    const context = api.getAuthContext()
    const reload = cache.createScopedCache({ storage: localStorage, getContext: api.getAuthContext, isCurrent: api.isAuthContextCurrent })
    expect(reload.read(context).state.documents.some((d) => d.id === id)).toBe(false)
    const tombstones = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k) => k.includes('.local.tombstone-'))
    expect(tombstones()).toHaveLength(1)
    const saved = localStorage.getItem(tombstones()[0])
    expect(store.getState().removeDocument(id)).toMatchObject({ ok: true, duplicate: true })
    expect(tombstones()).toHaveLength(1); expect(localStorage.getItem(tombstones()[0])).toBe(saved)
  })
  it('real removeDocument leaves the draft visible and recoverable when tombstone persistence fails', async () => {
    api.__resetApiForTests()
    const { useStore } = await import('../useStore')
    store = useStore; await store.getState().initAuth(); await signIn(); offline = true
    const id = store.getState().addDocument({ type: 'purchase', items: [] }, { post: false })
    const save = localStorage.setItem.bind(localStorage)
    localStorage.setItem = (key, value) => { if (key.includes('.local.tombstone-')) throw new Error('tombstone quota'); save(key, value) }
    expect(store.getState().removeDocument(id)).toMatchObject({ ok: false, code: 'CACHE_DELETE_ERROR', error: 'tombstone quota' })
    expect(store.getState().documents.some((d) => d.id === id)).toBe(true)
    expect(cache.readCompanyCache(api.getAuthContext()).documents.some((d) => d.id === id)).toBe(true)
    localStorage.setItem = save
    expect(store.getState().removeDocument(id)).toEqual({ ok: true })
    expect(cache.readCompanyCache(api.getAuthContext()).documents.some((d) => d.id === id)).toBe(false)
  })
  it('real removeDocument does not delete a posted document or its pending business command', async () => {
    api.__resetApiForTests()
    const { useStore } = await import('../useStore')
    store = useStore; await store.getState().initAuth(); await signIn(); offline = true
    const id = await store.getState().addDocument({ type: 'purchase', items: [] })
    expect(typeof id).toBe('string')
    const pending = cloud.syncOutbox.items().map((op) => ({ id: op.id, entryId: op._entryId, obj: op.obj }))
    expect(pending.some((op) => op.id === id)).toBe(true)
    store.getState().removeDocument(id)
    expect(store.getState().documents.find((d) => d.id === id).status).toBe('posted')
    expect(cloud.syncOutbox.items().map((op) => ({ id: op.id, entryId: op._entryId, obj: op.obj }))).toEqual(pending)
    expect(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).some((key) => key.includes('.local.tombstone-'))).toBe(false)
  })
  it('successful createCompany still selects and loads the new company', async () => {
    await signIn()
    expect((await store.getState().createCompany('New company')).ok).toBe(true)
    expect(store.getState().companyId).toBe('b')
  })
  it('real store does not accept sale after journal quota error and retry keeps its ID', async () => {
    api.__resetApiForTests()
    const { useStore } = await import('../useStore')
    store = useStore; await store.getState().initAuth(); await signIn(); offline = true
    store.setState({ products: [{ id: 'p', name: 'Product', stock: 5, cost: 10, price: 100 }], orders: [], moneyTx: [] })
    store.setState({ warehouses: [{ id: 'A', name: 'A' }] })
    const input = { warehouseId: 'A', items: [{ productId: 'p', name: 'Product', qty: 1, price: 100 }], total: 100 }
    const original = localStorage.setItem.bind(localStorage)
    localStorage.setItem = (key, value) => { if (key.includes('.op.')) throw new Error('QuotaExceededError'); original(key, value) }
    const failed = await store.getState().createSaleDocument(input)
    expect(failed).toMatchObject({ ok: false, code: 'STORAGE_ERROR', unfinished: true })
    expect(store.getState().orders).toEqual([]); expect(store.getState().moneyTx).toEqual([])
    expect(store.getState().products[0].stock).toBe(5)
    localStorage.setItem = original
    const result = await store.getState().createSaleDocument(input)
    expect(result).toMatchObject({ ok: true, id: failed.id })
    expect(cloud.syncOutbox.items()[0].id).toBe(failed.id)
    expect(store.getState().products[0].stock).toBeUndefined() // this fixture has no server stock baseline
    expect(store.getState().products[0].warehouseProjection.available).toBe(false)
  })
  it('real store exposes accepted but unfinished sale if only cache write fails', async () => {
    api.__resetApiForTests()
    const { useStore } = await import('../useStore')
    store = useStore; await store.getState().initAuth(); await signIn(); offline = true
    store.setState({ products: [{ id: 'p', name: 'Product', stock: 5, cost: 10, price: 100 }], orders: [], moneyTx: [] })
    const original = localStorage.setItem.bind(localStorage)
    localStorage.setItem = (key, value) => { if (key.startsWith('sklad.db.v3.')) throw new Error('cache quota'); original(key, value) }
    store.setState({ warehouses: [{ id: 'A', name: 'A' }] })
    const result = await store.getState().createSaleDocument({ warehouseId: 'A', items: [{ productId: 'p', qty: 1, price: 100 }], total: 100 })
    expect(result).toMatchObject({ ok: false, accepted: true, unfinished: true, code: 'CACHE_STORAGE_ERROR' })
    expect(cloud.syncOutbox.items().filter((i) => i.key === 'sale')).toHaveLength(1)
    const { unfinishedBusinessIntents } = await import('../../lib/businessIntent')
    expect(unfinishedBusinessIntents()[0].prepared.id).toBe(result.id)
    localStorage.setItem = original
  })
  it('the actual persisted store writes only its scoped cache and keeps legacy cache untouched', async () => {
    api.__resetApiForTests() // detach the fixture auth listener before binding the real store
    const original = JSON.stringify({ state: { products: [{ id: 'legacy' }] }, version: 19 })
    localStorage.setItem('sklad.db', original)
    const { useStore } = await import('../useStore')
    store = useStore; await store.getState().initAuth(); await signIn()
    store.setState({ settings: { ...store.getState().settings, aiKey: 'local-u1-a' } })
    const saved = JSON.parse(localStorage.getItem('sklad.db.v3.u1:a.server'))
    expect(saved).toMatchObject({ userId: 'u1', companyId: 'a' })
    expect(saved.state.settings.aiKey).not.toBe('local-u1-a')
    expect(localStorage.getItem('sklad.db')).toBe(original)
    await store.getState().switchCompany('b')
    expect(store.getState().settings.aiKey).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('sklad.db.v3.u1:b.server')).companyId).toBe('b')
    await store.getState().cloudLogout(); expect(localStorage.getItem('sklad.db.v3.u1:a.server')).not.toBe(null)
  })
  it('selects active membership rather than first membership and preserves A queue when switching B', async () => {
    await signIn(); expect(store.getState().products[0].name).toBe('product-a')
    offline = true; await cloud.enqueueSale({ id: 'sale-a' }); await cloud.syncOutbox.flushNow(); saveCache()
    offline = false; await store.getState().switchCompany('b')
    expect(store.getState()).toMatchObject({ companyId: 'b', authAccountId: 'u1', cloudReady: true })
    expect(store.getState().products[0].name).toBe('product-b')
    expect(cloud.syncOutbox.items()).toEqual([])
    expect(log.filter((r) => r.path === '/v1/sales' && r.company === 'b')).toEqual([])
    cloud.activateCloudContext({ ...api.getAuthContext(), companyId: 'a' }, true)
    expect(cloud.syncOutbox.items()[0]).toMatchObject({ userId: 'u1', companyId: 'a', id: 'sale-a' })
  })
  it('late pull from A cannot overwrite B or cache B', async () => {
    delayedPull = deferred(); const sign = store.getState().signIn('x@test.invalid', 'password')
    await vi.waitFor(() => expect(log.some((r) => r.path === '/v1/sync/pull' && r.company === 'a')).toBe(true))
    await store.getState().switchCompany('b'); saveCache()
    delayedPull.resolve(response({ tables: { products: { rows: [{ id: 'p', name: 'late-a' }], hasMore: false } } })); await sign
    expect(store.getState().products[0].name).toBe('product-b')
    expect(cache.readCompanyCache(api.getAuthContext()).products[0].name).toBe('product-b')
  })
  it('logout clears visible data and preserves the original queue for same-user login', async () => {
    await signIn(); offline = true; await cloud.enqueueSale({ id: 'sale-a' }); await cloud.syncOutbox.flushNow(); saveCache()
    await store.getState().cloudLogout(); expect(store.getState()).toMatchObject({ companyId: null, authUserId: null, products: [] })
    await cloud.syncOutbox.flushNow(); const sales = log.filter((r) => r.path === '/v1/sales').length
    await vi.advanceTimersByTimeAsync(5000); expect(log.filter((r) => r.path === '/v1/sales')).toHaveLength(sales)
    offline = false; await signIn(); expect(log.filter((r) => r.path === '/v1/sales').at(-1).company).toBe('a')
    expect(cloud.syncOutbox.items()).toEqual([])
  })
  it('another user cannot send previous user operations or inherit local settings', async () => {
    await signIn(); store.setState({ settings: { ...store.getState().settings, aiKey: 'user-one-local' } }); saveCache()
    offline = true; await cloud.enqueueSale({ id: 'sale-a' }); await cloud.syncOutbox.flushNow(); await store.getState().cloudLogout()
    offline = false; user = 'u2'; const start = log.length; await signIn()
    expect(store.getState().authAccountId).toBe('u2'); expect(store.getState().settings.aiKey).toBeUndefined()
    expect(log.slice(start).filter((r) => r.path === '/v1/sales')).toEqual([])
    expect(cloud.syncOutbox.items()).toEqual([])
  })
  it('network loss can load only matching user/company cache', async () => {
    await signIn(); saveCache(); offline = true
    await store.getState().bootstrapCloud()
    expect(store.getState()).toMatchObject({ companyId: 'a', authAccountId: 'u1', cloudReady: true })
    expect(store.getState().products[0].name).toBe('product-a')
    expect(store.getState().cloudError).toContain('offline')
  })
  it('a late SSE-triggered pull cannot overwrite B', async () => {
    await signIn()
    // This tests the shared guarded loader used by the SSE callback; actual stream
    // delivery is deliberately not claimed by this mocked HTTP integration suite.
    delayedPull = deferred(); const pull = cloud.cloudLoadMerged(api.getAuthContext())
    await vi.waitFor(() => expect(log.filter((r) => r.path === '/v1/sync/pull' && r.company === 'a').length).toBeGreaterThan(1))
    await store.getState().switchCompany('b'); delayedPull.resolve(response({ tables: {} }))
    await expect(pull).rejects.toThrow('CONTEXT_CHANGED'); expect(store.getState().companyId).toBe('b')
  })
})
