// ──────────────────────────────────────────────────────────────────────────
//  Outbox: персистентная очередь исходящих изменений для облачного синка.
//
//  Гарантии:
//  - элемент удаляется из очереди ТОЛЬКО после подтверждения сервера
//    (или явного «drop» для неисправимых ошибок вроде отсутствия таблицы);
//  - очередь хранится в localStorage и переживает перезагрузку страницы;
//  - неудачная отправка ретраится с экспоненциальным бэкоффом
//    (1с → 2с → 4с … до 30с), счётчик сбрасывается при успехе;
//  - по (key, id) хранится только последняя операция (компакция): новый
//    upsert заменяет старый, delete вытесняет upsert и наоборот.
//
//  Транспорт инжектируется: send(items) → { sent, dropped, error? }.
//  sent/dropped удаляются из очереди; error (транзиент) оставляет остальное
//  и планирует ретрай. Благодаря инъекции send/storage модуль тестируется
//  без Supabase и браузера (vitest, node).
// ──────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sklad.outbox'
const DEBOUNCE_MS = 400
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30000

// localStorage может отсутствовать (node/тесты) или бросать (приватный режим)
export function safeStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* нет доступа */
  }
  const mem = new Map()
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
  }
}

const itemKey = (it) => `${it.key}|${it.id}`

export function createOutbox({
  send,
  storage = safeStorage(),
  storageKey = STORAGE_KEY,
  debounceMs = DEBOUNCE_MS,
  baseDelayMs = BASE_DELAY_MS,
  maxDelayMs = MAX_DELAY_MS,
} = {}) {
  let items = restore()
  let attempts = 0 // подряд неудачных flush (для бэкоффа)
  let flushing = null // Promise активного flush (защита от параллельных)
  let rerun = false // во время flush пришли новые элементы → повторить
  let timer = null // отложенный flush (дебаунс или бэкофф)
  let lastError = null
  const listeners = new Set()
  let lastNotified = null

  function restore() {
    try {
      const raw = storage.getItem(storageKey)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed?.items) ? parsed.items : []
    } catch {
      return []
    }
  }

  // → true, если очередь надёжно сохранена (иначе элементы живут в памяти
  //   и вызывающий не должен двигать свой снапшот — диф захватит их снова)
  function persist() {
    try {
      if (items.length) storage.setItem(storageKey, JSON.stringify({ v: 1, items }))
      else storage.removeItem(storageKey)
      return true
    } catch {
      return false
    }
  }

  function status() {
    return {
      pending: items.length,
      state: lastError ? 'error' : flushing ? 'syncing' : items.length ? 'pending' : 'ok',
      error: lastError,
    }
  }

  function notify() {
    const s = status()
    const sig = `${s.pending}|${s.state}|${s.error || ''}`
    if (sig === lastNotified) return // без шума: только реальные изменения
    lastNotified = sig
    for (const cb of listeners) cb(s)
  }

  function schedule(delay) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      flushNow()
    }, delay)
  }

  // Добавить операции. Компакция по (key, id): остаётся последняя.
  function enqueue(batch) {
    if (!batch?.length) return true
    for (const it of batch) {
      const k = itemKey(it)
      const i = items.findIndex((x) => itemKey(x) === k)
      if (i >= 0) items.splice(i, 1)
      items.push(it)
    }
    const persisted = persist()
    // бэкофф-таймер не сбиваем (не будим упавший сервер чаще), иначе — дебаунс
    if (!timer && !flushing) schedule(debounceMs)
    notify()
    return persisted
  }

  // Отправить всё, что накопилось. Очередь чистится только по подтверждению.
  async function flushNow() {
    if (flushing) {
      rerun = true
      return flushing
    }
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!items.length) {
      lastError = null
      notify()
      return true
    }
    let resolveDone
    flushing = new Promise((r) => (resolveDone = r))
    notify() // state: syncing
    let ok = false
    const batch = items.slice()
    try {
      const res = (await send(batch)) || {}
      const gone = new Set([...(res.sent || []), ...(res.dropped || [])].map(itemKey))
      // удаляем только элементы отправленного батча: если во время отправки
      // элемент заменила компакция (данные новее) — он останется в очереди
      items = items.filter((it) => !(gone.has(itemKey(it)) && batch.includes(it)))
      persist()
      if (res.error) throw res.error
      attempts = 0
      lastError = null
      ok = items.length === 0
    } catch (e) {
      attempts += 1
      lastError = e?.message || String(e)
      schedule(Math.min(baseDelayMs * 2 ** (attempts - 1), maxDelayMs))
    }
    flushing = null
    resolveDone(ok)
    if (rerun || (items.length && !lastError && !timer)) {
      rerun = false
      schedule(debounceMs)
    }
    notify()
    return ok
  }

  return {
    enqueue,
    flushNow,
    status,
    items: () => items.slice(),
    onChange: (cb) => {
      listeners.add(cb)
      cb(status())
      return () => listeners.delete(cb)
    },
    // для тестов и повторной инициализации: очистить состояние и таймеры
    reset: () => {
      if (timer) clearTimeout(timer)
      timer = null
      items = []
      attempts = 0
      lastError = null
      rerun = false
      persist()
      lastNotified = null
    },
  }
}
