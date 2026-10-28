// Filled from the final production graph. Incomplete installation must fail:
// it must never replace a working worker with missing critical resources.
const CACHE_VERSION = 'skladpro-__BUILD_ID__'
const API_ORIGIN = '__API_ORIGIN__'
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`
const PRECACHE_URLS = /*__PRECACHE_URLS__*/ []
const PRECACHED = new Set(PRECACHE_URLS.map((url) => new URL(url, self.registration.scope).href))

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(RUNTIME_CACHE)
    await cache.addAll(PRECACHE_URLS)
    // A partial deployment may return SPA HTML with status 200 for missing JS.
    // Validate cached modules before this worker is allowed to activate.
    for (const resource of PRECACHE_URLS) {
      const url = new URL(resource, self.registration.scope)
      const script = /\.m?js$/.test(url.pathname), style = /\.css$/.test(url.pathname)
      if (!script && !style) continue
      const response = await cache.match(url.href, { ignoreVary: true })
      const type = response?.headers.get('content-type') || ''
      if (script ? !/javascript|ecmascript/i.test(type) : !/text\/css/i.test(type)) throw new Error('Invalid critical resource: ' + url.href)
    }
  })())
})

self.addEventListener('activate', (event) => {
  // No skipWaiting: old tabs finish using their own build before activation.
  // Only our caches are eligible for cleanup; other applications are untouched.
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith('skladpro-') && key !== RUNTIME_CACHE)
    .map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})

const isApi = (url) => (API_ORIGIN && url.origin === API_ORIGIN &&
  (url.origin !== self.location.origin || /\/v1(?:\/|$)/.test(url.pathname))) ||
  url.hostname.includes('supabase.co') || url.hostname.includes('proxyapi.ru') ||
  url.hostname.includes('nominatim.openstreetmap.org')

self.addEventListener('fetch', (event) => {
  const request = event.request, url = new URL(request.url)
  if (request.method !== 'GET' || isApi(url) || request.headers.get('authorization') || url.origin !== self.location.origin) return
  const html = request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE)
    // Pin HTML and assets to this worker's build instead of mixing versions.
    // Module requests may carry Origin while cache.addAll requests do not.
    // Vary: Origin must not make immutable, public build resources miss offline.
    const cached = await cache.match(request, { ignoreVary: PRECACHED.has(url.href) }) ||
      (html && await cache.match(new URL('index.html', self.registration.scope).href, { ignoreVary: true }))
    if (cached) return cached
    try {
      const response = await fetch(request)
      // Cache noncritical assets on demand, but never store a SPA's HTML fallback
      // under a missing hashed JS/CSS filename.
      if (!html && response.ok && response.type === 'basic' &&
        !(response.headers.get('content-type') || '').includes('text/html')) await cache.put(request, response.clone())
      return response
    } catch {
      return new Response('Resource unavailable offline', { status: 503, headers: { 'content-type': 'text/plain' } })
    }
  })())
})
