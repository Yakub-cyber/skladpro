// Service Worker для СкладПро.
//
// Стратегия:
//   1) Статика (JS/CSS/шрифты/иконки) — cache-first с обновлением
//      в фоне (stale-while-revalidate). Ускоряет офлайн-запуск.
//   2) HTML (index.html) — network-first с фолбэком на кэш. Иначе
//      после деплоя пользователь застревает на старой версии.
//   3) API (supabase.co, api.proxyapi.ru) — network-only. Их
//      кэшировать нельзя (оффлайн-мутации уже уходят в outbox.js
//      с локальной очередью — SW тут не помогает).
//
// Версия кэша меняется при каждом деплое — эта константа регулирует,
// когда SW считает кэш «протухшим» и чистит его.
const CACHE_VERSION = 'skladpro-v3'
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`
const PRECACHE_URLS = [
  './',
  './index.html',
  './favicon.svg',
  './manifest.webmanifest',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(RUNTIME_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  )
})

const isApi = (url) =>
  url.hostname.includes('supabase.co') ||
  url.hostname.includes('proxyapi.ru') ||
  url.hostname.includes('nominatim.openstreetmap.org')

const isHtml = (req) =>
  req.mode === 'navigate' ||
  (req.headers.get('accept') || '').includes('text/html')

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // API — не трогаем, идут напрямую (и подхватываются outbox при офлайне).
  if (isApi(url)) return

  // HTML — network-first. При офлайне отдаём последнюю удачную копию,
  // чтобы приложение хотя бы загрузилось.
  if (isHtml(req)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone()
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, clone))
          return res
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('./index.html'))),
    )
    return
  }

  // Статика — stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone()
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, clone))
          }
          return res
        })
        .catch(() => cached)
      return cached || fetched
    }),
  )
})
