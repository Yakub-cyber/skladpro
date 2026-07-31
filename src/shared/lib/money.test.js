import { describe, it, expect } from 'vitest'
import {
  accountBalance,
  accountBalances,
  rangeFor,
  summarize,
} from './money'

const iso = (d) => new Date(d).toISOString()

// Небольшой набор транзакций: 2 счёта, разные типы, одна отменённая.
const ACCS = [
  { id: 'acc_cash', name: 'Касса', kind: 'cash' },
  { id: 'acc_bank', name: 'Р/с', kind: 'bank' },
]
const TX = [
  { id: 't1', type: 'in',  accountId: 'acc_cash', amount: 10000, purpose: 'initial', at: iso('2026-07-01T09:00:00Z'), status: 'posted' },
  { id: 't2', type: 'in',  accountId: 'acc_bank', amount: 5000,  purpose: 'debt-in', at: iso('2026-07-15T10:00:00Z'), status: 'posted' },
  { id: 't3', type: 'out', accountId: 'acc_bank', amount: 2000,  purpose: 'debt-out',at: iso('2026-07-15T11:00:00Z'), status: 'posted' },
  { id: 't4', type: 'out', accountId: 'acc_cash', amount: 1500,  purpose: 'rent',    at: iso('2026-07-20T12:00:00Z'), status: 'posted' },
  { id: 't5', type: 'transfer', accountId: 'acc_cash', toAccountId: 'acc_bank', amount: 3000, purpose: 'transfer', at: iso('2026-07-20T13:00:00Z'), status: 'posted' },
  // Отменённая — должна игнорироваться везде.
  { id: 't6', type: 'in',  accountId: 'acc_cash', amount: 999999, purpose: 'other', at: iso('2026-07-21T08:00:00Z'), status: 'cancelled' },
]

describe('accountBalance / accountBalances', () => {
  it('баланс счёта считает in/out по этому счёту + перевод как -amount источник, +amount получатель', () => {
    // Касса: +10000 − 1500 − 3000 = 5500
    expect(accountBalance('acc_cash', TX)).toBe(5500)
    // Р/с: +5000 − 2000 + 3000 = 6000
    expect(accountBalance('acc_bank', TX)).toBe(6000)
  })

  it('отменённые транзакции не учитываются', () => {
    // t6 отменена, поэтому не добавляется к кассе
    expect(accountBalance('acc_cash', TX)).toBe(5500)
  })

  it('accountBalances за один проход возвращает объект по всем счетам', () => {
    expect(accountBalances(ACCS, TX)).toEqual({
      acc_cash: 5500,
      acc_bank: 6000,
    })
  })

  it('счёт без транзакций → 0', () => {
    expect(accountBalance('acc_bank', [])).toBe(0)
    expect(accountBalances([{ id: 'x' }], [])).toEqual({ x: 0 })
  })
})

describe('rangeFor', () => {
  // Функция режет по локальному дню (setHours(0,0,0,0)), поэтому в
  // тестах сравниваем компоненты Date, а не сырой ISO-строкой.
  const NOW = new Date('2026-07-24T15:30:00')

  const localDayEqual = (isoStr, targetLocalDate) => {
    const d = new Date(isoStr)
    return (
      d.getFullYear() === targetLocalDate.getFullYear() &&
      d.getMonth() === targetLocalDate.getMonth() &&
      d.getDate() === targetLocalDate.getDate()
    )
  }

  it('today — from и to попадают на «сегодня» по локальному дню', () => {
    const r = rangeFor('today', NOW)
    expect(localDayEqual(r.from, NOW)).toBe(true)
    expect(localDayEqual(r.to, NOW)).toBe(true)
    // from ровно в 00:00 локального дня
    expect(new Date(r.from).getHours()).toBe(0)
    expect(new Date(r.from).getMinutes()).toBe(0)
  })

  it('week — from на 6 дней назад по локальному календарю', () => {
    const r = rangeFor('week', NOW)
    const expected = new Date(NOW)
    expected.setDate(expected.getDate() - 6)
    expect(localDayEqual(r.from, expected)).toBe(true)
  })

  it('month — from на 29 дней назад по локальному календарю', () => {
    const r = rangeFor('month', NOW)
    const expected = new Date(NOW)
    expected.setDate(expected.getDate() - 29)
    expect(localDayEqual(r.from, expected)).toBe(true)
  })

  it('all — from=null (открытый интервал слева)', () => {
    const r = rangeFor('all', NOW)
    expect(r.from).toBeNull()
    expect(localDayEqual(r.to, NOW)).toBe(true)
  })
})

describe('summarize', () => {
  it('без фильтра по счёту: переводы не идут в приход/расход', () => {
    const s = summarize(TX, {})
    // Приход = t1 (10000) + t2 (5000) = 15000
    expect(s.inTotal).toBe(15000)
    // Расход = t3 (2000) + t4 (1500) = 3500
    expect(s.outTotal).toBe(3500)
    // Чистое = 15000 − 3500 = 11500 (перевод t5 внутренний, не считается)
    expect(s.net).toBe(11500)
    // Счётчик — 4 (t5 не входит, t6 отменена)
    expect(s.count).toBe(4)
  })

  it('фильтр по счёту: перевод считается приход/расход этого счёта', () => {
    const cash = summarize(TX, { accountId: 'acc_cash' })
    // Касса приход: t1 (10000). Расход: t4 (1500) + t5-исход (3000)
    expect(cash.inTotal).toBe(10000)
    expect(cash.outTotal).toBe(4500)
    expect(cash.net).toBe(5500) // == accountBalance('acc_cash')

    const bank = summarize(TX, { accountId: 'acc_bank' })
    // Р/с приход: t2 (5000) + t5-приход (3000). Расход: t3 (2000)
    expect(bank.inTotal).toBe(8000)
    expect(bank.outTotal).toBe(2000)
    expect(bank.net).toBe(6000)
  })

  it('разбивка по назначениям', () => {
    const s = summarize(TX, {})
    expect(s.inByPurpose).toEqual({ initial: 10000, 'debt-in': 5000 })
    expect(s.outByPurpose).toEqual({ 'debt-out': 2000, rent: 1500 })
  })

  it('фильтр по периоду from/to', () => {
    // Только 15 июля — попадают t2 и t3
    const s = summarize(TX, {
      from: iso('2026-07-15T00:00:00Z'),
      to: iso('2026-07-15T23:59:59Z'),
    })
    expect(s.inTotal).toBe(5000)
    expect(s.outTotal).toBe(2000)
    expect(s.count).toBe(2)
  })

  it('отменённые транзакции игнорируются в сводке', () => {
    const s = summarize(TX, {})
    // Приход БЕЗ t6 (999999)
    expect(s.inTotal).toBe(15000)
  })

  it('пустой массив → нули', () => {
    const s = summarize([], {})
    expect(s).toMatchObject({ inTotal: 0, outTotal: 0, net: 0, count: 0 })
  })
})
