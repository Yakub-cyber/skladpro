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
// «Ядовитая» запись: транзиентная ошибка с кодом вне списка перманентных
// (isPermanentError) сама по себе ретраится бесконечно. Отсечка страхует
// от бесконечных попыток одной битой записи. Кап высокий — оффлайн-режим
// с большой очередью успевает залогинить много неудач подряд.
const MAX_ITEM_ATTEMPTS = 100

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
  maxItemAttempts = MAX_ITEM_ATTEMPTS,
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

  // Слить внешние items (из другой вкладки) с in-memory. Компакция по (key,id):
  // если элемент есть и там, и тут — оставляем внешний (он свежее в persist —
  // другая вкладка только что записала). Такая же семантика, как enqueue.
  function mergeExternal(external) {
    if (!Array.isArray(external)) return false
    let changed = false
    const memKeys = new Set(items.map(itemKey))
    // 1. Внешние элементы, которых у нас нет — добавляем.
    for (const it of external) {
      if (memKeys.has(itemKey(it))) continue
      items.push(it)
      changed = true
    }
    // 2. Пересечение: заменяем нашу версию внешней (другая вкладка успела
    //    обновить объект после нашего снимка).
    for (const it of external) {
      const k = itemKey(it)
      const i = items.findIndex((x) => itemKey(x) === k)
      if (i >= 0 && items[i] !== it) {
        items[i] = it
        changed = true
      }
    }
    // 3. Наши локальные, которых нет во внешних — оставляем (они ещё не
    //    успели уйти в storage, persist() их сохранит следующим ходом).
    return changed
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
      // сбрасываем per-item попытки на успешном flush (переживший элемент —
      // это тот, что был компактирован во время отправки, а не «плохой»)
      for (const it of items) delete it._attempts
      attempts = 0
      lastError = null
      ok = items.length === 0
    } catch (e) {
      attempts += 1
      lastError = e?.message || String(e)
      // Cap per-item: неисправимо застрявший элемент дропаем после
      // maxItemAttempts подряд неудач. Логируем, чтобы не терялось тихо.
      const kept = []
      const dead = []
      for (const it of batch) {
        it._attempts = (it._attempts || 0) + 1
        if (it._attempts > maxItemAttempts) dead.push(it)
        else kept.push(it)
      }
      if (dead.length) {
        console.warn(
          `outbox: сброшено ${dead.length} «застрявших» записей после ${maxItemAttempts} попыток`,
          dead.map(itemKey),
        )
        const drop = new Set(dead.map(itemKey))
        items = items.filter((it) => !drop.has(itemKey(it)))
      }
      persist()
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

  // Мультивкладочность: другая вкладка изменила sklad.outbox → сливаем.
  // Без этого persist() каждой вкладки перезаписывал ключ целиком, теряя
  // элементы, которые ещё не увидела эта вкладка. storage-event срабатывает
  // только на КРОСС-вкладочные записи (не на нашу же), так что цикла нет.
  function onStorage(e) {
    if (!e || e.key !== storageKey) return
    let external = []
    try {
      external = e.newValue ? JSON.parse(e.newValue)?.items || [] : []
    } catch {
      return
    }
    if (mergeExternal(external)) {
      persist() // сохранить объединённое (наши локальные + чужие)
      notify()
      // проснуться и попробовать отправить — вдруг у другой вкладки был офлайн
      if (!timer && !flushing) schedule(debounceMs)
    }
  }
  let detachStorage = null
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', onStorage)
    detachStorage = () => window.removeEventListener('storage', onStorage)
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
    // для тестов и unmount: снять глобальный слушатель storage
    destroy: () => {
      if (timer) clearTimeout(timer)
      timer = null
      listeners.clear()
      detachStorage?.()
    },
    // для тестов: имитировать сообщение из другой вкладки
    _onStorageEvent: onStorage,
  }
}
