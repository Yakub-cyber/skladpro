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
