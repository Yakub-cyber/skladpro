import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createOutbox } from './outbox'

// localStorage-совместимое хранилище в памяти
const memStorage = () => {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  }
}

const up = (id, obj = {}, key = 'products') => ({
  op: 'upsert',
  key,
  id,
  obj: { id, ...obj },
  companyId: 'c1',
})
const del = (id, key = 'products') => ({ op: 'delete', key, id, companyId: 'c1' })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('outbox — персистентность', () => {
  it('очередь сохраняется в storage и переживает «перезагрузку»', () => {
    const storage = memStorage()
    const a = createOutbox({ send: vi.fn(), storage })
    a.enqueue([up('p1', { name: 'Гвозди' }), del('p2')])
    expect(a.status().pending).toBe(2)

    // «перезагрузка страницы»: новый экземпляр из того же storage
    const b = createOutbox({ send: vi.fn(), storage })
    expect(b.status().pending).toBe(2)
    expect(b.items().map((i) => i.id)).toEqual(['p1', 'p2'])
  })

  it('битый JSON в storage не роняет и даёт пустую очередь', () => {
    const storage = memStorage()
    storage.setItem('sklad.outbox', '{оборвано')
    const box = createOutbox({ send: vi.fn(), storage })
    expect(box.status().pending).toBe(0)
  })
})

describe('outbox — компакция по (key, id)', () => {
  it('повторный upsert того же id заменяет предыдущий (остаётся свежий)', () => {
    const box = createOutbox({ send: vi.fn(), storage: memStorage() })
    box.enqueue([up('p1', { stock: 1 })])
    box.enqueue([up('p1', { stock: 99 })])
    expect(box.status().pending).toBe(1)
    expect(box.items()[0].obj.stock).toBe(99)
  })

  it('delete вытесняет ранний upsert того же id', () => {
    const box = createOutbox({ send: vi.fn(), storage: memStorage() })
    box.enqueue([up('p1')])
    box.enqueue([del('p1')])
    expect(box.status().pending).toBe(1)
    expect(box.items()[0].op).toBe('delete')
  })

  it('одинаковые id в разных таблицах не схлопываются', () => {
    const box = createOutbox({ send: vi.fn(), storage: memStorage() })
    box.enqueue([up('x1', {}, 'products'), up('x1', {}, 'customers')])
    expect(box.status().pending).toBe(2)
  })
})

describe('outbox — подтверждение сервера', () => {
  it('очередь чистится ТОЛЬКО после resolve send (не до)', async () => {
    const storage = memStorage()
    let pendingDuringSend = -1
    const box = createOutbox({
      send: async (batch) => {
        pendingDuringSend = box.status().pending // в полёте — ещё в очереди
        return { sent: batch }
      },
      storage,
    })
    box.enqueue([up('p1'), up('p2')])
    await box.flushNow()
    expect(pendingDuringSend).toBe(2)
    expect(box.status().pending).toBe(0)
    expect(box.status().state).toBe('ok')
    expect(storage._map.has('sklad.outbox')).toBe(false) // storage очищен
  })

  it('dropped удаляются без ретрая (неисправимая ошибка)', async () => {
    const send = vi.fn(async (batch) => ({ sent: [], dropped: batch }))
    const box = createOutbox({ send, storage: memStorage() })
    box.enqueue([up('p1')])
    await box.flushNow()
    expect(box.status().pending).toBe(0)
    await vi.advanceTimersByTimeAsync(60000)
    expect(send).toHaveBeenCalledTimes(1) // повторов не было
  })

  it('элемент, заменённый компакцией во время отправки, не теряется', async () => {
    let box
    const send = vi.fn(async () => {
      // пока батч «летит», пришла свежая версия той же записи
      box.enqueue([up('p1', { stock: 42 })])
      return { sent: [up('p1', { stock: 1 })] } // ключи совпадают, но это старый элемент
    })
    box = createOutbox({ send, storage: memStorage() })
    box.enqueue([up('p1', { stock: 1 })])
    await box.flushNow()
    // свежая версия осталась в очереди и уйдёт следующим батчем
    expect(box.status().pending).toBe(1)
    expect(box.items()[0].obj.stock).toBe(42)
  })
})

describe('outbox — ретраи с экспоненциальным бэкоффом', () => {
  it('неудача: очередь цела, state=error, повторы через 1с → 2с → успех', async () => {
    let failures = 2
    const send = vi.fn(async (batch) => {
      if (failures-- > 0) throw new Error('fetch failed')
      return { sent: batch }
    })
    const box = createOutbox({ send, storage: memStorage() })
    box.enqueue([up('p1')])

    await box.flushNow() // попытка 1 — падает
    expect(send).toHaveBeenCalledTimes(1)
    expect(box.status()).toMatchObject({ pending: 1, state: 'error', error: 'fetch failed' })

    await vi.advanceTimersByTimeAsync(999) // бэкофф 1с ещё не истёк
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1) // попытка 2 — падает
    expect(send).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1999) // бэкофф теперь 2с
    expect(send).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1) // попытка 3 — успех
    expect(send).toHaveBeenCalledTimes(3)
    expect(box.status()).toMatchObject({ pending: 0, state: 'ok', error: null })
  })

  it('задержка бэкоффа не превышает потолок', async () => {
    const send = vi.fn(async () => {
      throw new Error('down')
    })
    const box = createOutbox({ send, storage: memStorage(), maxDelayMs: 4000 })
    box.enqueue([up('p1')])
    await box.flushNow()
    // 1с → 2с → 4с → 4с (потолок): после 11с суммарно — 4 повтора
    await vi.advanceTimersByTimeAsync(11000)
    expect(send).toHaveBeenCalledTimes(5)
  })

  it('новый enqueue не сбивает бэкофф-таймер', async () => {
    const send = vi.fn(async () => {
      throw new Error('down')
    })
    const box = createOutbox({ send, storage: memStorage() })
    box.enqueue([up('p1')])
    await box.flushNow()
    box.enqueue([up('p2')]) // во время бэкоффа
    await vi.advanceTimersByTimeAsync(400) // дебаунс не запускает отправку
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(600) // а бэкофф (1с) — запускает
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0]).toHaveLength(2) // ушли оба элемента
  })
})

describe('outbox — автоотправка и статус', () => {
  it('enqueue запускает flush по дебаунсу', async () => {
    const send = vi.fn(async (batch) => ({ sent: batch }))
    const box = createOutbox({ send, storage: memStorage() })
    box.enqueue([up('p1')])
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(send).toHaveBeenCalledTimes(1)
    expect(box.status().pending).toBe(0)
  })

  it('onChange уведомляет о смене статуса и умеет отписываться', async () => {
    const send = vi.fn(async (batch) => ({ sent: batch }))
    const box = createOutbox({ send, storage: memStorage() })
    const seen = []
    const off = box.onChange((s) => seen.push(`${s.state}:${s.pending}`))
    expect(seen).toEqual(['ok:0']) // текущее состояние сразу при подписке
    box.enqueue([up('p1')])
    await box.flushNow()
    expect(seen[seen.length - 1]).toBe('ok:0')
    expect(seen).toContain('pending:1')
    off()
    box.enqueue([up('p2')])
    expect(seen.filter((s) => s === 'pending:1')).toHaveLength(1) // после отписки тишина
  })
})

describe('outbox — мультивкладочность', () => {
  it('другая вкладка добавила элемент → in-memory сливаем без потерь', () => {
    const storage = memStorage()
    const box = createOutbox({ send: vi.fn(), storage })
    box.enqueue([up('p1', { name: 'A' })]) // локальное изменение
    expect(box.status().pending).toBe(1)

    // «другая вкладка» кладёт свой элемент в тот же storage
    const external = { v: 1, items: [up('p2', { name: 'B' })] }
    storage.setItem('sklad.outbox', JSON.stringify(external))
    box._onStorageEvent({ key: 'sklad.outbox', newValue: JSON.stringify(external) })

    // после слияния — оба элемента, локальный не потерян
    expect(box.status().pending).toBe(2)
    const ids = box.items().map((it) => it.id).sort()
    expect(ids).toEqual(['p1', 'p2'])

    // и на диске тоже оба (persist после merge)
    const saved = JSON.parse(storage.getItem('sklad.outbox'))
    expect(saved.items.map((it) => it.id).sort()).toEqual(['p1', 'p2'])
  })

  it('внешний upsert того же id обновляет нашу версию', () => {
    const storage = memStorage()
    const box = createOutbox({ send: vi.fn(), storage })
    box.enqueue([up('p1', { name: 'старый' })])

    const external = { v: 1, items: [up('p1', { name: 'новый из B' })] }
    storage.setItem('sklad.outbox', JSON.stringify(external))
    box._onStorageEvent({ key: 'sklad.outbox', newValue: JSON.stringify(external) })

    expect(box.items()).toHaveLength(1)
    expect(box.items()[0].obj.name).toBe('новый из B')
  })

  it('пустое newValue (другая вкладка очистила после flush) не тронет локальные', () => {
    const storage = memStorage()
    const box = createOutbox({ send: vi.fn(), storage })
    box.enqueue([up('p_local')])
    box._onStorageEvent({ key: 'sklad.outbox', newValue: null })
    expect(box.items().map((it) => it.id)).toEqual(['p_local'])
  })

  it('storage-событие с чужим ключом игнорируется', () => {
    const storage = memStorage()
    const box = createOutbox({ send: vi.fn(), storage })
    box.enqueue([up('p1')])
    box._onStorageEvent({ key: 'unrelated', newValue: '{}' })
    expect(box.items()).toHaveLength(1)
  })
})

describe('outbox — защита от «ядовитой» записи (кап попыток)', () => {
  it('после MAX_ITEM_ATTEMPTS транзиентных ошибок элемент сбрасывается', async () => {
    // сеть всегда падает транзиентом (не в isPermanentError, ретраится)
    const send = vi.fn(async () => ({ error: { message: 'timeout' } }))
    const box = createOutbox({
      send, storage: memStorage(), maxItemAttempts: 3, baseDelayMs: 1, maxDelayMs: 1,
    })
    box.enqueue([up('p1')])
    // 4 попытки: 1-3 копят attempts, 4-я превышает cap → drop
    for (let i = 0; i < 4; i++) {
      await box.flushNow()
      await vi.advanceTimersByTimeAsync(2)
    }
    expect(box.items()).toHaveLength(0) // «ядовитый» сброшен
    expect(box.status().pending).toBe(0)
  })

  it('успех сбрасывает счётчик попыток', async () => {
    let calls = 0
    const send = vi.fn(async (batch) => {
      calls++
      if (calls === 1) return { error: { message: 'flaky' } }
      return { sent: batch }
    })
    const box = createOutbox({
      send, storage: memStorage(), maxItemAttempts: 2, baseDelayMs: 1, maxDelayMs: 1,
    })
    box.enqueue([up('p1')])
    await box.flushNow() // фейл, attempts=1
    await vi.advanceTimersByTimeAsync(2)
    await box.flushNow() // успех, отправлено
    expect(box.status().pending).toBe(0)
  })
})
