import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Мок Supabase-клиента ────────────────────────────────────────────────────
// h.impl подменяется в каждом тесте; log копит вызовы в порядке исполнения.
const h = vi.hoisted(() => ({ impl: null }))

vi.mock('./supabase', () => ({
  recoveryTokens: null,
  hasSupabase: true,
  supabase: { from: (table) => h.impl.from(table) },
}))

import { cloudLoadMerged, applyPendingToData, syncOutbox } from './cloud'

// Фабрика мока: rows — данные select по таблицам, upsert/del — поведение записи
function makeSupabase({ rows = {}, upsert, del, settingsRow = null } = {}) {
  const log = []
  return {
    log,
    from: (table) => ({
      select: () => ({
        // await supabase.from(t).select('*') — толкаемся как thenable
        then: (resolve) => {
          log.push(['select', table])
          resolve({ data: rows[table] || [], error: null })
        },
        // .select('data').maybeSingle() — ветка настроек
        maybeSingle: () => {
          log.push(['select', table])
          return Promise.resolve({ data: settingsRow, error: null })
        },
      }),
      upsert: (payload) => {
        log.push(['upsert', table, payload])
        return Promise.resolve(upsert ? upsert(table, payload) : { error: null })
      },
      delete: () => ({
        in: (_col, ids) => {
          log.push(['delete', table, ids])
          return Promise.resolve(del ? del(table, ids) : { error: null })
        },
      }),
    }),
  }
}

const up = (id, obj = {}, key = 'products') => ({
  op: 'upsert',
  key,
  id,
  obj: { id, ...obj },
  companyId: 'c1',
})

beforeEach(() => syncOutbox.reset())
afterEach(() => syncOutbox.reset()) // снять бэкофф-таймеры после неудачных отправок

describe('cloudLoadMerged — порядок bootstrap', () => {
  it('сначала досылает очередь (upsert), потом читает сервер (select)', async () => {
    const fake = makeSupabase({ rows: { products: [{ id: 'p1', name: 'Серверный' }] } })
    h.impl = fake
    syncOutbox.enqueue([up('p1', { name: 'Локальный', stock: 5 })])

    const data = await cloudLoadMerged()

    const firstSelect = fake.log.findIndex(([op]) => op === 'select')
    const firstUpsert = fake.log.findIndex(([op]) => op === 'upsert')
    expect(firstUpsert).toBeGreaterThanOrEqual(0)
    expect(firstUpsert).toBeLessThan(firstSelect) // очередь ушла ДО чтения
    expect(syncOutbox.status().pending).toBe(0)
    // сервер уже принял локальную правку; что вернул select — то и в сторе
    expect(data.products).toHaveLength(1)
  })

  it('офлайн: сервер прочитан, но неотправленное наложено поверх', async () => {
    h.impl = makeSupabase({
      rows: {
        products: [
          { id: 'p1', name: 'Серверный', stock: 99 },
          { id: 'p3', name: 'Удалён локально' },
        ],
      },
      upsert: () => ({ error: { message: 'fetch failed' } }), // сеть лежит
      del: () => ({ error: { message: 'fetch failed' } }),
    })
    syncOutbox.enqueue([
      up('p1', { name: 'Локальный', stock: 5 }),
      up('p2', { name: 'Новый локальный' }),
      { op: 'delete', key: 'products', id: 'p3', companyId: 'c1' },
    ])

    const data = await cloudLoadMerged()

    expect(syncOutbox.status().pending).toBe(3) // очередь цела, доставит позже
    expect(syncOutbox.status().state).toBe('error')
    const byId = Object.fromEntries(data.products.map((p) => [p.id, p]))
    expect(byId.p1.name).toBe('Локальный') // локальная правка победила
    expect(byId.p2).toBeTruthy() // локально созданное не потерялось
    expect(byId.p3).toBeUndefined() // локальное удаление применено
  })

  it('подтягивает настройки компании из таблицы settings', async () => {
    h.impl = makeSupabase({
      rows: { products: [{ id: 'p1' }] },
      settingsRow: { data: { company: 'ООО Облако', currency: '₽' } },
    })
    const data = await cloudLoadMerged()
    expect(data.settings).toEqual({ company: 'ООО Облако', currency: '₽' })
  })
})

describe('sendBatch (через outbox) — классификация ошибок', () => {
  it('неисправимая ошибка (RLS 42501): элемент выброшен, без ретраев', async () => {
    h.impl = makeSupabase({ upsert: () => ({ error: { code: '42501', message: 'RLS' } }) })
    syncOutbox.enqueue([up('p1')])
    await syncOutbox.flushNow()
    expect(syncOutbox.status()).toMatchObject({ pending: 0, state: 'ok' })
  })

  it('транзиентная ошибка: элемент остаётся и статус error', async () => {
    h.impl = makeSupabase({ upsert: () => ({ error: { message: 'timeout' } }) })
    syncOutbox.enqueue([up('p1')])
    await syncOutbox.flushNow()
    expect(syncOutbox.status()).toMatchObject({ pending: 1, state: 'error' })
  })

  it('настройки уезжают строкой {company_id, data} в таблицу settings', async () => {
    const fake = makeSupabase()
    h.impl = fake
    syncOutbox.enqueue([
      { op: 'upsert', key: 'settings', id: 'c1', obj: { company: 'X' }, companyId: 'c1' },
    ])
    await syncOutbox.flushNow()
    const call = fake.log.find(([op, table]) => op === 'upsert' && table === 'settings')
    expect(call[2]).toEqual({ company_id: 'c1', data: { company: 'X' } })
  })

  it('удаления батчатся в delete...in по таблице', async () => {
    const fake = makeSupabase()
    h.impl = fake
    syncOutbox.enqueue([
      { op: 'delete', key: 'products', id: 'p1', companyId: 'c1' },
      { op: 'delete', key: 'products', id: 'p2', companyId: 'c1' },
    ])
    await syncOutbox.flushNow()
    const call = fake.log.find(([op]) => op === 'delete')
    expect(call[1]).toBe('products')
    expect(call[2]).toEqual(['p1', 'p2'])
  })
})

describe('PIN сотрудника не уходит в облако и не приходит обратно', () => {
  it('upsert employees: поле pin вырезано из payload', async () => {
    const fake = makeSupabase()
    h.impl = fake
    syncOutbox.enqueue([
      {
        op: 'upsert',
        key: 'employees',
        id: 'e1',
        obj: { id: 'e1', name: 'Аюб', role: 'admin', pin: '1111', active: true },
        companyId: 'c1',
      },
    ])
    await syncOutbox.flushNow()
    const call = fake.log.find(([op, table]) => op === 'upsert' && table === 'employees')
    expect(call).toBeTruthy()
    const payload = call[2]
    const row = Array.isArray(payload) ? payload[0] : payload
    expect(row.pin).toBeUndefined()
    expect(row.name).toBe('Аюб') // остальное на месте
    expect(row.company_id).toBe('c1')
  })

  it('cloudLoadMerged: серверный pin (если вдруг остался в БД) не попадает в стор', async () => {
    h.impl = makeSupabase({
      rows: {
        employees: [{ id: 'e1', name: 'Аюб', role: 'admin', pin: 'server-secret' }],
      },
    })
    const data = await cloudLoadMerged()
    expect(data.employees).toHaveLength(1)
    expect(data.employees[0].pin).toBeUndefined()
    expect(data.employees[0].name).toBe('Аюб')
  })
})

describe('applyPendingToData — чистая функция оверлея', () => {
  it('upsert заменяет по id или добавляет; delete убирает; settings мержится', () => {
    const data = {
      products: [{ id: 'p1', stock: 1 }, { id: 'p2', stock: 2 }],
      settings: { company: 'Сервер', currency: '$' },
    }
    applyPendingToData(data, [
      up('p1', { stock: 100 }),
      up('p9', { stock: 9 }),
      { op: 'delete', key: 'products', id: 'p2', companyId: 'c1' },
      { op: 'upsert', key: 'settings', id: 'c1', obj: { currency: '₽' }, companyId: 'c1' },
      { op: 'upsert', key: 'нет_такой', id: 'x', obj: {}, companyId: 'c1' }, // не падает
    ])
    expect(data.products.map((p) => p.id).sort()).toEqual(['p1', 'p9'])
    expect(data.products.find((p) => p.id === 'p1').stock).toBe(100)
    expect(data.settings).toEqual({ company: 'Сервер', currency: '₽' })
  })
})
