import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

function worker(apiOrigin = 'https://api.test.invalid') {
  const handlers = new Map(), cache = { addAll: vi.fn(async () => {}), match: vi.fn(async () => undefined), put: vi.fn(async () => {}) }
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ['skladpro-old-runtime', 'skladpro-new-runtime', 'another-app']), delete: vi.fn(async () => true) }
  const self = { location: { origin: 'https://test.invalid' }, registration: { scope: 'https://test.invalid/' },
    clients: { claim: vi.fn(async () => {}) }, skipWaiting: vi.fn(), addEventListener: (name, fn) => handlers.set(name, fn) }
  const fetch = vi.fn(async () => { throw new Error('offline') })
  const source = readFileSync(new URL('../../../public/sw.template.js', import.meta.url), 'utf8')
    .replace('__BUILD_ID__', 'new').replace('__API_ORIGIN__', apiOrigin)
    .replace('/*__PRECACHE_URLS__*/ []', JSON.stringify(['./index.html', './assets/cash-new.js', './assets/orders-new.js']))
  vm.runInNewContext(source, { self, caches, fetch, URL, Response })
  const request = (url, mode = 'cors') => ({ method: 'GET', url, mode, headers: { get: () => null } })
  return { handlers, cache, caches, self, fetch, request }
}
describe('versioned offline service worker', () => {
  it('installs every build resource atomically and does not force an update over old tabs', async () => {
    const w = worker(); let installed
    w.cache.match.mockResolvedValue(new Response('module', { headers: { 'content-type': 'text/javascript' } }))
    w.handlers.get('install')({ waitUntil: (p) => { installed = p } }); await installed
    expect(w.cache.addAll).toHaveBeenCalledWith(['./index.html', './assets/cash-new.js', './assets/orders-new.js'])
    expect(w.self.skipWaiting).not.toHaveBeenCalled()
    w.cache.addAll.mockRejectedValueOnce(new Error('missing critical asset'))
    w.handlers.get('install')({ waitUntil: (p) => { installed = p } })
    await expect(installed).rejects.toThrow('missing critical asset')
  })
  it('rejects a partial deployment returning HTML instead of a critical JS module', async () => {
    const w = worker(); let installed
    w.cache.match.mockResolvedValue(new Response('SPA fallback', { headers: { 'content-type': 'text/html' } }))
    w.handlers.get('install')({ waitUntil: (p) => { installed = p } })
    await expect(installed).rejects.toThrow('Invalid critical resource')
    expect(w.self.skipWaiting).not.toHaveBeenCalled(); expect(w.caches.delete).not.toHaveBeenCalled()
  })
  it('cleanup after activation preserves the new generation and unrelated caches', async () => {
    const w = worker(); let activated
    w.handlers.get('activate')({ waitUntil: (p) => { activated = p } }); await activated
    expect(w.caches.delete.mock.calls).toEqual([['skladpro-old-runtime']])
  })
  it('serves critical JS and HTML from the controlling build without requesting new versions', async () => {
    const w = worker(), cached = new Response('current build'); w.cache.match.mockResolvedValue(cached)
    for (const request of [w.request('https://test.invalid/assets/orders-new.js'), w.request('https://test.invalid/', 'navigate')]) {
      let response; w.handlers.get('fetch')({ request, respondWith: (p) => { response = p } })
      expect(await response).toBe(cached)
    }
    expect(w.fetch).not.toHaveBeenCalled()
    expect(w.caches.open).toHaveBeenCalledWith('skladpro-new-runtime')
    expect(w.cache.match).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://test.invalid/assets/orders-new.js' }), { ignoreVary: true })
  })
  it('returns an explicit failure for an unavailable module and never caches HTML as JS', async () => {
    const w = worker(); let response
    const event = () => ({ request: w.request('https://test.invalid/assets/missing.js'), respondWith: (p) => { response = p } })
    w.handlers.get('fetch')(event()); expect((await response).status).toBe(503)
    w.fetch.mockResolvedValueOnce({ ok: true, type: 'basic', headers: { get: () => 'text/html' } })
    w.handlers.get('fetch')(event()); await response
    expect(w.cache.put).not.toHaveBeenCalled()
  })
  it('never intercepts API calls or third-party resources', () => {
    const w = worker(), respondWith = vi.fn()
    for (const url of ['https://api.test.invalid/v1/sales', 'https://other.invalid/script.js']) w.handlers.get('fetch')({ request: w.request(url), respondWith })
    expect(respondWith).not.toHaveBeenCalled()
  })
  it('excludes authenticated requests and same-origin API aliases from the static cache', () => {
    const w = worker('https://test.invalid'), respondWith = vi.fn()
    w.handlers.get('fetch')({ request: w.request('https://test.invalid/api/v1/me'), respondWith })
    w.handlers.get('fetch')({ request: { ...w.request('https://test.invalid/private'), headers: { get: (key) => key === 'authorization' ? 'Bearer test' : null } }, respondWith })
    expect(respondWith).not.toHaveBeenCalled()
  })
})
