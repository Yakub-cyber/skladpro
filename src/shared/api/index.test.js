import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { safeStorage } from '../lib/outbox'
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } })
const login = (user = 'u1', company = 'a') => response({ user: { id: user, email: user + '@test.invalid' }, accessToken: 'access-' + user, refreshToken: 'refresh-' + user, memberships: [{ companyId: company }] })
const memberships = () => response({ memberships: [{ companyId: 'a' }, { companyId: 'b' }] })
let api, fetchMock, handlers, peers
beforeEach(async () => {
  vi.resetModules(); vi.stubEnv('VITE_API_URL', 'https://test.invalid')
  vi.stubGlobal('BroadcastChannel', undefined); peers = []
  vi.stubGlobal('sessionStorage', safeStorage()); vi.stubGlobal('localStorage', safeStorage())
  handlers = new Map(); vi.stubGlobal('window', { addEventListener: (type, fn) => handlers.set(type, fn), removeEventListener: () => {} })
  fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
  api = await import('./index')
})
afterEach(() => { for (const client of [api, ...peers]) client.__resetApiForTests(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
async function signIn(user = 'u1', company = 'a') { fetchMock.mockResolvedValueOnce(login(user, company)); expect((await api.apiSignIn('x@test.invalid', 'password')).ok).toBe(true) }
it('shipment transport sends the immutable HTTP body without inserting URL orderId', async () => {
  await signIn(); const saved = { contractVersion: 2, status: 'shipped', shipmentId: crypto.randomUUID(), warehouseId: 'A', orderSnapshot: { items: [] } }
  fetchMock.mockResolvedValueOnce(response({ ok: true }))
  await api.apiOrderStatus('order-id', saved, `shipment:${saved.shipmentId}`, api.getAuthContext())
  const [url, opts] = fetchMock.mock.calls.at(-1)
  expect(url).toBe('https://test.invalid/v1/orders/order-id/status'); expect(opts.body).toBe(JSON.stringify(saved))
  expect(opts.headers['idempotency-key']).toBe(`shipment:${saved.shipmentId}`)
})
it.each(['create', 'replace'])('commercial %s sends the original envelope, key and captured company', async operation => {
  await signIn()
  const payload = { contractVersion: 2, commandId: 'cmd', orderId: 'order/one', commercial: { items: [] }, ...(operation === 'replace' ? { expectedRowVersion: '20' } : {}) }
  fetchMock.mockResolvedValueOnce(response({ ok: true }, 201))
  await api.apiCommercialOrder(operation, payload, 'fixed-key', api.getAuthContext())
  const [url, opts] = fetchMock.mock.calls.at(-1)
  expect(url).toBe(`https://test.invalid/v1/orders${operation === 'replace' ? '/order%2Fone/commercial' : ''}`)
  expect(opts.method).toBe(operation === 'create' ? 'POST' : 'PUT'); expect(opts.body).toBe(JSON.stringify(payload))
  expect(opts.headers['x-company-id']).toBe('a'); expect(opts.headers['idempotency-key']).toBe('fixed-key')
})
it.each([true, false])('sale transport preserves v2 envelope or legacy contract, v2=%s', async v2 => {
  await signIn()
  const order = { id: 'sale-id', warehouseId: 'A', items: [{ productId: 'p', qty: 2, price: 50 }], discount: 0, onCredit: false }
  const saved = v2 ? { contractVersion: 2, order } : order, before = JSON.stringify(saved)
  fetchMock.mockResolvedValueOnce(response({ ok: true }, 201))
  expect((await api.apiSale(saved, 'sale-sale-id', api.getAuthContext())).ok).toBe(true)
  const [url, options] = fetchMock.mock.calls.at(-1)
  expect(url).toBe('https://test.invalid/v1/sales')
  expect(options.headers['idempotency-key']).toBe('sale-sale-id')
  expect(options.body).toBe(JSON.stringify(v2 ? saved : { order }))
  expect(JSON.stringify(saved)).toBe(before)
})
it('stock reconciliation posts the original payload in the captured company context', async () => {
  await signIn()
  const context = api.getAuthContext(), request = { contractVersion: 1, requestId: crypto.randomUUID(), productIds: ['p'], commands: [] }
  fetchMock.mockResolvedValueOnce(response({ requestId: request.requestId }))
  expect((await api.apiStockReconcile(request, context)).ok).toBe(true)
  const [url, options] = fetchMock.mock.calls.at(-1)
  expect(url).toBe('https://test.invalid/v1/stock/reconcile')
  expect(options.headers['x-company-id']).toBe('a')
  expect(JSON.parse(options.body)).toEqual(request)
})
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
async function reloadApi() {
  api.__resetApiForTests(); vi.resetModules(); api = await import('./index')
  return api
}
async function twoTabs() {
  let active = 1
  const firstSession = sessionStorage
  vi.stubGlobal('sessionStorage', undefined)
  const sessions = { 1: firstSession, 2: safeStorage() }, channels = []
  vi.stubGlobal('sessionStorage', {
    getItem: (key) => sessions[active].getItem(key), setItem: (key, value) => sessions[active].setItem(key, value),
    removeItem: (key) => sessions[active].removeItem(key),
  })
  vi.stubGlobal('BroadcastChannel', class {
    constructor() { this.tab = active; channels.push(this) }
    postMessage(message) {
      for (const channel of channels) if (channel !== this && !channel.closed) {
        const original = active; active = channel.tab
        try { channel.onmessage?.({ data: message }) } finally { active = original }
      }
    }
    close() { this.closed = true }
  })
  await signIn()
  active = 2; vi.resetModules(); const second = await import('./index'); peers.push(second)
  fetchMock.mockResolvedValueOnce(login())
  expect((await second.apiSignIn('x@test.invalid', 'password')).ok).toBe(true)
  return { first: api, second, sessions, channels, select: (tab) => { active = tab } }
}

describe('API request ownership and session generation', () => {
  it('BroadcastChannel propagates logout even when localStorage write fails', async () => {
    const tabs = await twoTabs(), events = []
    tabs.second.onAuthChange((event) => events.push(event))
    localStorage.setItem = () => { throw new Error('quota') }
    tabs.select(1); fetchMock.mockResolvedValueOnce(response({}))
    expect(await tabs.first.apiSignOut()).toMatchObject({ ok: true })
    expect(tabs.first.getAuthConsistencyError()).toContain('quota')
    expect(tabs.second.getSession()).toBe(null); expect(events).toContain('SIGNED_OUT')
    tabs.select(2); const before = fetchMock.mock.calls.length
    expect((await tabs.second.apiSale({ id: 'x' }, 'sale-x')).error.code).toBe('CONTEXT_CHANGED')
    expect(fetchMock).toHaveBeenCalledTimes(before)
  })
  it('peer logout invalidates a pending refresh and prevents bootstrap resurrection', async () => {
    const tabs = await twoTabs(), pending = deferred()
    fetchMock.mockResolvedValueOnce(response({}, 401)).mockReturnValueOnce(pending.promise).mockResolvedValue(response({}))
    const sale = tabs.second.apiSale({ id: 'x' }, 'sale-x')
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/v1/auth/refresh'))).toBe(true))
    tabs.select(1); await tabs.first.apiSignOut()
    tabs.select(2); pending.resolve(response({ accessToken: 'late', refreshToken: 'late-refresh' })); await sale
    expect(tabs.second.getSession()).toBe(null); expect(tabs.sessions[2].getItem('skladpro-v2-refresh')).toBe(null)
    const before = fetchMock.mock.calls.length
    expect(await tabs.second.apiBootstrap()).toEqual({ session: null }); expect(fetchMock).toHaveBeenCalledTimes(before)
  })
  it('context notifications do not rotate another tab company or its pinned generation', async () => {
    const tabs = await twoTabs(), context = tabs.second.getAuthContext(), events = []
    tabs.second.onAuthChange((event) => events.push(event))
    tabs.select(1); fetchMock.mockResolvedValueOnce(memberships()); await tabs.first.setActiveCompany('b')
    expect(events).toContain('PEER_CONTEXT_CHANGED'); expect(tabs.second.getAuthContext()).toEqual(context)
    expect(tabs.first.getCompanyId()).toBe('b'); expect(tabs.second.getCompanyId()).toBe('a')
  })
  it('reports failure of both notification mechanisms while still clearing local session', async () => {
    vi.stubGlobal('BroadcastChannel', class { postMessage() { throw new Error('channel failed') } close() {} })
    await signIn(); localStorage.setItem = () => { throw new Error('quota') }; fetchMock.mockResolvedValueOnce(response({}))
    expect(await api.apiSignOut()).toMatchObject({ ok: false })
    expect(api.getAuthConsistencyError()).toContain('могли не получить')
    expect(api.getSession()).toBe(null)
  })
  it('storage fallback delivers structured logout and cannot restart a session if removal fails', async () => {
    await signIn(); sessionStorage.removeItem = () => { throw new Error('denied') }
    handlers.get('storage')({ key: 'skladpro-v2-logout:u1', newValue: JSON.stringify({ type: 'LOGOUT', userId: 'u1', source: 'peer', id: 'storage-logout' }) })
    expect(api.getSession()).toBe(null); expect(api.getAuthConsistencyError()).toContain('denied')
    const before = fetchMock.mock.calls.length
    expect(await api.apiBootstrap()).toEqual({ session: null }); expect(fetchMock).toHaveBeenCalledTimes(before)
  })
  it('sets the original company header and preserves idempotency key after refresh', async () => {
    await signIn(); fetchMock.mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response({ accessToken: 'new', refreshToken: 'new-refresh' })).mockResolvedValueOnce(response({ ok: true }))
    const result = await api.apiSale({ id: 'o' }, 'sale-o', api.getAuthContext())
    expect(result.ok).toBe(true)
    for (const index of [1, 3]) expect(fetchMock.mock.calls[index][1].headers).toMatchObject({ 'x-company-id': 'a', 'idempotency-key': 'sale-o' })
  })
  it('does not replay a delayed 401 under another company', async () => {
    await signIn(); const pending = deferred(); fetchMock.mockReturnValueOnce(pending.promise)
    const sale = api.apiSale({ id: 'o' }, 'sale-o', api.getAuthContext())
    fetchMock.mockResolvedValueOnce(memberships()); await api.setActiveCompany('b')
    pending.resolve(response({}, 401)); expect((await sale).error.code).toBe('CONTEXT_CHANGED')
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/v1/sales'))).toHaveLength(1)
  })
  it('switching during refresh preserves the rotated token and never replays into B', async () => {
    await signIn(); const refresh = deferred()
    fetchMock.mockResolvedValueOnce(response({}, 401)).mockReturnValueOnce(refresh.promise)
    const sale = api.apiSale({ id: 'o' }, 'sale-o')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    fetchMock.mockResolvedValueOnce(memberships()).mockResolvedValue(response({ ok: true }))
    const switching = api.setActiveCompany('b')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(api.getCompanyId()).toBe('a')
    refresh.resolve(response({ accessToken: 'rotated', refreshToken: 'rotated-refresh' }))
    await switching; await sale
    expect(api.getCompanyId()).toBe('b'); expect(sessionStorage.getItem('skladpro-v2-refresh')).toBe('rotated-refresh')
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/v1/sales')).every(([, opts]) => opts.headers['x-company-id'] === 'a')).toBe(true)
  })
  it('returns a late successful write to its caller without changing its captured header', async () => {
    await signIn(); const pending = deferred(); fetchMock.mockReturnValueOnce(pending.promise)
    const context = api.getAuthContext(), sale = api.apiSale({ id: 'o' }, 'sale-o', context)
    fetchMock.mockResolvedValueOnce(memberships()); await api.setActiveCompany('b')
    pending.resolve(response({ ok: true })); expect((await sale).ok).toBe(true)
    expect(api.isAuthContextCurrent(context)).toBe(false)
    expect(fetchMock.mock.calls[1][1].headers['x-company-id']).toBe('a')
  })
  it('rejects stale explicit context before any network call', async () => {
    await signIn(); const context = api.getAuthContext(); fetchMock.mockResolvedValueOnce(memberships()); await api.setActiveCompany('b')
    const calls = fetchMock.mock.calls.length
    expect((await api.apiSyncPush([], context)).error.code).toBe('CONTEXT_CHANGED'); expect(fetchMock).toHaveBeenCalledTimes(calls)
  })
  it('logout immediately clears auth and late refresh cannot resurrect it', async () => {
    await signIn(); const pending = deferred()
    fetchMock.mockResolvedValueOnce(response({}, 401)).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response({}))
    const sale = api.apiSale({ id: 'o' }, 'sale-o'); await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await api.apiSignOut(); pending.resolve(response({ accessToken: 'late', refreshToken: 'late-refresh' })); await sale
    expect(api.getSession()).toBe(null); expect(sessionStorage.getItem('skladpro-v2-refresh')).toBe(null)
  })
  it('an old refresh cannot replace another user session', async () => {
    await signIn(); const pending = deferred()
    fetchMock.mockResolvedValueOnce(response({}, 401)).mockReturnValueOnce(pending.promise)
    const sale = api.apiSale({ id: 'o' }, 'sale-o'); await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await signIn('u2', 'b'); pending.resolve(response({ accessToken: 'late', refreshToken: 'late-refresh' })); await sale
    expect(api.getCurrentUser().id).toBe('u2'); expect(sessionStorage.getItem('skladpro-v2-refresh')).toBe('refresh-u2')
  })
  it('a late login response cannot overwrite a later login', async () => {
    const pending = deferred(); fetchMock.mockReturnValueOnce(pending.promise)
    const first = api.apiSignIn('one@test.invalid', 'password'); await signIn('u2', 'b')
    pending.resolve(login('u1', 'a')); expect((await first).error.code).toBe('CONTEXT_CHANGED'); expect(api.getCurrentUser().id).toBe('u2')
  })
  it('network failure during refresh preserves tab credentials and does not emit logout', async () => {
    await signIn(); const events = []; api.onAuthChange((event) => events.push(event))
    fetchMock.mockResolvedValueOnce(response({}, 401)).mockRejectedValueOnce(new Error('offline'))
    await api.apiSale({ id: 'o' }, 'sale-o'); expect(api.getCurrentUser().id).toBe('u1')
    expect(events).not.toContain('SIGNED_OUT'); expect(sessionStorage.getItem('skladpro-v2-refresh')).toBe('refresh-u1')
  })
  it('bootstrap offline does not erase stored refresh credentials', async () => {
    await signIn(); handlers.get('pagehide')(); await reloadApi(); fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await api.apiBootstrap()).toMatchObject({ offline: true }); expect(sessionStorage.getItem('skladpro-v2-refresh')).toBe('refresh-u1')
  })
  it('denies company selection outside memberships', async () => {
    await signIn(); fetchMock.mockResolvedValueOnce(memberships()); expect((await api.setActiveCompany('other')).status).toBe(403); expect(api.getCompanyId()).toBe('a')
  })
  it('company selection is tab-local; logout broadcast targets only the same user', async () => {
    await signIn(); expect(localStorage.getItem('skladpro-company')).toBe(null)
    handlers.get('storage')({ key: 'skladpro-v2-logout:u2' }); expect(api.getCurrentUser().id).toBe('u1')
    handlers.get('storage')({ key: 'skladpro-v2-logout:u1' }); expect(api.getSession()).toBe(null)
  })
  it('does not adopt global legacy credentials', async () => {
    localStorage.setItem('skladpro-refresh', 'legacy'); localStorage.setItem('skladpro-user', JSON.stringify({ id: 'other' }))
    expect((await api.apiBootstrap()).session).toBe(null); expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem('skladpro-refresh')).toBe('legacy')
  })
})

describe('durable logout and one-use resumption (fresh module reloads)', () => {
  const sessionKey = 'skladpro-v3-session'
  it('deletion failure and lost logout request cannot restore credentials after reload', async () => {
    await signIn(); const id = api.getAuthContext().sessionId
    sessionStorage.removeItem = () => { throw new Error('remove denied') }
    fetchMock.mockRejectedValueOnce(new Error('lost logout'))
    await api.apiSignOut()
    expect(localStorage.getItem('skladpro-v3-ended:' + id)).toBe('ended')
    expect(sessionStorage.getItem('skladpro-v2-refresh')).toBe('refresh-u1')
    handlers.get('pagehide')(); await reloadApi()
    const calls = fetchMock.mock.calls.length
    expect(await api.apiBootstrap()).toEqual({ session: null })
    expect(fetchMock).toHaveBeenCalledTimes(calls)
  })
  it('fails closed when marker writes, session writes, deletion and logout all fail', async () => {
    await signIn()
    const setLocal = localStorage.setItem.bind(localStorage), setSession = sessionStorage.setItem.bind(sessionStorage), removeSession = sessionStorage.removeItem.bind(sessionStorage)
    localStorage.setItem = sessionStorage.setItem = sessionStorage.removeItem = () => { throw new Error('storage denied') }
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await api.apiSignOut()).toMatchObject({ ok: false })
    expect(api.getAuthConsistencyError()).toBeTruthy()
    expect(JSON.parse(sessionStorage.getItem(sessionKey)).state).toBe('running')
    handlers.get('pagehide')()
    localStorage.setItem = setLocal; sessionStorage.setItem = setSession; sessionStorage.removeItem = removeSession
    await reloadApi(); const calls = fetchMock.mock.calls.length
    expect(await api.apiBootstrap()).toEqual({ session: null }); expect(fetchMock).toHaveBeenCalledTimes(calls)
  })
  it('session record independently revokes logout if the localStorage marker fails', async () => {
    await signIn(); localStorage.setItem = () => { throw new Error('marker denied') }
    sessionStorage.removeItem = () => { throw new Error('remove denied') }
    fetchMock.mockRejectedValueOnce(new Error('offline')); await api.apiSignOut()
    expect(JSON.parse(sessionStorage.getItem(sessionKey)).state).toBe('ended')
    await reloadApi(); expect(await api.apiBootstrap()).toEqual({ session: null })
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/refresh'))).toHaveLength(0)
  })
  it('storage-event logout remains revoked after reloading with undeletable credentials', async () => {
    await signIn(); sessionStorage.removeItem = () => { throw new Error('remove denied') }
    const value = JSON.stringify({ type: 'LOGOUT', userId: 'u1', source: 'peer', id: 'stored-logout' })
    localStorage.setItem('skladpro-v2-logout:u1', value)
    handlers.get('storage')({ key: 'skladpro-v2-logout:u1', newValue: value })
    await reloadApi(); const before = fetchMock.mock.calls.length
    expect(await api.apiBootstrap()).toEqual({ session: null }); expect(fetchMock).toHaveBeenCalledTimes(before)
  })
  it('permits a graceful reload, consumes the permit before refresh, and preserves session identity', async () => {
    await signIn(); const id = api.getAuthContext().sessionId
    handlers.get('pagehide')(); expect(JSON.parse(sessionStorage.getItem(sessionKey)).state).toBe('resume')
    await reloadApi()
    fetchMock.mockImplementationOnce(async () => {
      expect(JSON.parse(sessionStorage.getItem(sessionKey)).state).toBe('running')
      return response({ accessToken: 'new', refreshToken: 'rotated' })
    })
    expect((await api.apiBootstrap()).session.user.id).toBe('u1')
    expect(api.getAuthContext().sessionId).toBe(id)
  })
  it('refuses credentials if consuming the resume permit fails', async () => {
    await signIn(); handlers.get('pagehide')(); await reloadApi()
    sessionStorage.setItem = () => { throw new Error('write denied') }
    const before = fetchMock.mock.calls.length
    expect(await api.apiBootstrap()).toEqual({ session: null }); expect(fetchMock).toHaveBeenCalledTimes(before)
    expect(api.getAuthConsistencyError()).toBeTruthy()
  })
  it('late refresh cannot overwrite a revoked session record', async () => {
    await signIn(); const pending = deferred()
    fetchMock.mockResolvedValueOnce(response({}, 401)).mockReturnValueOnce(pending.promise)
    const sale = api.apiSale({ id: 'sale' }, 'sale-key')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    sessionStorage.removeItem = () => { throw new Error('remove denied') }
    fetchMock.mockRejectedValueOnce(new Error('offline')); await api.apiSignOut()
    pending.resolve(response({ accessToken: 'late', refreshToken: 'late' })); await sale
    expect(JSON.parse(sessionStorage.getItem(sessionKey)).state).toBe('ended')
    expect(sessionStorage.getItem('skladpro-v2-refresh')).toBe('refresh-u1')
    await reloadApi(); expect(await api.apiBootstrap()).toEqual({ session: null })
  })
  it('peer logout survives a fresh import in the other tab when credential deletion fails', async () => {
    const tabs = await twoTabs()
    tabs.sessions[2].removeItem = () => { throw new Error('remove denied') }
    tabs.select(1); fetchMock.mockRejectedValueOnce(new Error('offline')); await tabs.first.apiSignOut()
    tabs.select(2); expect(tabs.second.getSession()).toBe(null)
    tabs.second.__resetApiForTests(); vi.resetModules(); const reloaded = await import('./index'); peers.push(reloaded)
    const before = fetchMock.mock.calls.length
    expect(await reloaded.apiBootstrap()).toEqual({ session: null }); expect(fetchMock).toHaveBeenCalledTimes(before)
  })
  it('a suspended peer misses notifications but checks the shared logout stamp on reload', async () => {
    const tabs = await twoTabs(); handlers.get('pagehide')() // tab 2
    tabs.channels[1].closed = true
    tabs.select(1); fetchMock.mockRejectedValueOnce(new Error('offline')); await tabs.first.apiSignOut()
    tabs.select(2); expect(JSON.parse(tabs.sessions[2].getItem(sessionKey)).state).toBe('resume')
    tabs.second.__resetApiForTests(); vi.resetModules(); const reloaded = await import('./index'); peers.push(reloaded)
    const before = fetchMock.mock.calls.length
    expect(await reloaded.apiBootstrap()).toEqual({ session: null }); expect(fetchMock).toHaveBeenCalledTimes(before)
  })
  it('new same-user login has a fresh identity and can resume despite old logout markers', async () => {
    await signIn(); const oldId = api.getAuthContext().sessionId
    fetchMock.mockRejectedValueOnce(new Error('offline')); await api.apiSignOut(); await signIn()
    expect(api.getAuthContext().sessionId).not.toBe(oldId)
    expect(localStorage.getItem('skladpro-v3-ended:' + oldId)).toBe('ended')
    handlers.get('pagehide')(); await reloadApi()
    fetchMock.mockResolvedValueOnce(response({ accessToken: 'new', refreshToken: 'new' }))
    expect((await api.apiBootstrap()).session.user.id).toBe('u1')
  })
  it('legacy saved credentials require explicit login without touching other storage', async () => {
    sessionStorage.setItem('skladpro-v2-refresh', 'legacy')
    sessionStorage.setItem('skladpro-v2-user', JSON.stringify({ id: 'u1' }))
    localStorage.setItem('legacy-outbox', 'preserved')
    expect(await api.apiBootstrap()).toEqual({ session: null }); expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem('legacy-outbox')).toBe('preserved')
  })
  it('does not accept a login if the durable running fence cannot be established', async () => {
    sessionStorage.setItem = () => { throw new Error('write denied') }
    fetchMock.mockResolvedValueOnce(login())
    expect(await api.apiSignIn('x@test.invalid', 'password')).toMatchObject({ ok: false })
    expect(api.getSession()).toBe(null)
  })
  it('BFCache re-entry consumes the permit before allowing sends', async () => {
    await signIn(); handlers.get('pagehide')({ persisted: true })
    expect(JSON.parse(sessionStorage.getItem(sessionKey)).state).toBe('running')
    expect((await api.apiSale({ id: 'x' }, 'sale-x')).ok).toBe(false)
    handlers.get('pageshow')({ persisted: true })
    expect(JSON.parse(sessionStorage.getItem(sessionKey)).state).toBe('running')
    fetchMock.mockResolvedValueOnce(response({}))
    expect((await api.apiSale({ id: 'x' }, 'sale-x')).ok).toBe(true)
  })
  it('a session-specific ended marker rejects a remaining resume record', async () => {
    await signIn(); const id = api.getAuthContext().sessionId
    handlers.get('pagehide')(); localStorage.setItem('skladpro-v3-ended:' + id, 'ended')
    await reloadApi(); const before = fetchMock.mock.calls.length
    expect(await api.apiBootstrap()).toEqual({ session: null }); expect(fetchMock).toHaveBeenCalledTimes(before)
  })
  it('cannot trust a marker check when localStorage reads fail', async () => {
    await signIn(); handlers.get('pagehide')(); await reloadApi()
    localStorage.getItem = () => { throw new Error('read denied') }
    const before = fetchMock.mock.calls.length
    expect(await api.apiBootstrap()).toEqual({ session: null }); expect(fetchMock).toHaveBeenCalledTimes(before)
  })
  it('silent session record write failure is detected by read-back before login acceptance', async () => {
    sessionStorage.setItem = () => {}
    fetchMock.mockResolvedValueOnce(login())
    expect(await api.apiSignIn('x@test.invalid', 'password')).toMatchObject({ ok: false })
    expect(api.getSession()).toBe(null); expect(api.getAuthConsistencyError()).toContain('read-back')
  })
  it('a new login cannot resume old credentials if overwriting the refresh token fails', async () => {
    await signIn(); sessionStorage.removeItem = () => { throw new Error('remove denied') }
    fetchMock.mockRejectedValueOnce(new Error('offline')); await api.apiSignOut()
    const original = sessionStorage.setItem.bind(sessionStorage)
    sessionStorage.setItem = (key, value) => { if (key === 'skladpro-v2-refresh') throw new Error('refresh write denied'); original(key, value) }
    fetchMock.mockResolvedValueOnce(response({ user: { id: 'u1' }, accessToken: 'new-access', refreshToken: 'new-refresh', memberships: [{ companyId: 'a' }] }))
    expect(await api.apiSignIn('x@test.invalid', 'password')).toMatchObject({ ok: false })
    expect(api.getSession()).toBe(null); expect(sessionStorage.getItem('skladpro-v2-refresh')).toBe('refresh-u1')
    handlers.get('pagehide')(); await reloadApi(); const before = fetchMock.mock.calls.length
    expect(await api.apiBootstrap()).toEqual({ session: null }); expect(fetchMock).toHaveBeenCalledTimes(before)
  })
  it('BroadcastChannel revokes both tabs despite complete failure to write logout markers', async () => {
    const tabs = await twoTabs()
    const restore = localStorage.setItem.bind(localStorage)
    localStorage.setItem = () => { throw new Error('marker denied') }
    for (const storage of Object.values(tabs.sessions)) storage.setItem = storage.removeItem = () => { throw new Error('session denied') }
    tabs.select(1); fetchMock.mockRejectedValueOnce(new Error('offline')); await tabs.first.apiSignOut()
    expect(tabs.second.getSession()).toBe(null)
    tabs.select(2); tabs.second.__resetApiForTests(); vi.resetModules(); const reloaded = await import('./index'); peers.push(reloaded)
    localStorage.setItem = restore
    const before = fetchMock.mock.calls.length
    expect(await reloaded.apiBootstrap()).toEqual({ session: null }); expect(fetchMock).toHaveBeenCalledTimes(before)
  })
})
