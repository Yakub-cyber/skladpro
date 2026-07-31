import { describe, it, expect } from 'vitest'
import {
  initialTrial,
  trialDaysLeft,
  effectivePlan,
  planAllows,
  paidDaysLeft,
  extendPlan,
  TRIAL_DAYS,
} from './subscription'

describe('initialTrial', () => {
  it('плане trial, длится TRIAL_DAYS', () => {
    const sub = initialTrial('2026-01-01T00:00:00.000Z')
    expect(sub.plan).toBe('trial')
    const start = new Date(sub.trialStartAt)
    const end = new Date(sub.trialEndAt)
    const daysDiff = Math.round((end - start) / 86_400_000)
    expect(daysDiff).toBe(TRIAL_DAYS)
  })
})

describe('trialDaysLeft', () => {
  it('положительное, пока триал не истёк', () => {
    const sub = initialTrial('2026-01-01T00:00:00.000Z')
    const days = trialDaysLeft(sub, new Date('2026-01-05T00:00:00.000Z'))
    expect(days).toBe(10) // 14 - 4
  })

  it('отрицательное после окончания', () => {
    const sub = initialTrial('2026-01-01T00:00:00.000Z')
    const days = trialDaysLeft(sub, new Date('2026-02-01T00:00:00.000Z'))
    expect(days).toBeLessThan(0)
  })
})

describe('effectivePlan', () => {
  it('trial активен → trial', () => {
    const sub = initialTrial('2026-01-01T00:00:00.000Z')
    expect(effectivePlan(sub, new Date('2026-01-05T00:00:00.000Z'))).toBe('trial')
  })

  it('trial истёк без оплаты → free', () => {
    const sub = initialTrial('2026-01-01T00:00:00.000Z')
    expect(effectivePlan(sub, new Date('2026-02-01T00:00:00.000Z'))).toBe('free')
  })

  it('оплачен и активен → выбранный план', () => {
    const sub = {
      plan: 'business',
      paidUntil: '2027-01-01T00:00:00.000Z',
    }
    expect(effectivePlan(sub, new Date('2026-06-01T00:00:00.000Z'))).toBe('business')
  })

  it('оплата истекла → free', () => {
    const sub = {
      plan: 'business',
      paidUntil: '2025-01-01T00:00:00.000Z',
    }
    expect(effectivePlan(sub, new Date('2026-06-01T00:00:00.000Z'))).toBe('free')
  })
})

describe('planAllows', () => {
  it('trial даёт всё', () => {
    const sub = initialTrial('2026-01-01T00:00:00.000Z')
    expect(planAllows(sub, 'crm', new Date('2026-01-05T00:00:00.000Z'))).toBe(true)
    expect(planAllows(sub, 'anything', new Date('2026-01-05T00:00:00.000Z'))).toBe(true)
  })

  it('free ограничен списком features', () => {
    const sub = { plan: 'free' }
    expect(planAllows(sub, 'pos')).toBe(true)
    expect(planAllows(sub, 'crm')).toBe(false)
  })

  it('business даёт всё', () => {
    const sub = { plan: 'business', paidUntil: '2099-01-01T00:00:00.000Z' }
    expect(planAllows(sub, 'crm')).toBe(true)
    expect(planAllows(sub, 'marking')).toBe(true)
  })
})

describe('extendPlan', () => {
  it('пустой paidUntil → +N месяцев от now', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const end = extendPlan(null, 3, now)
    expect(new Date(end).getMonth()).toBe(3) // apr (0-indexed)
  })

  it('paidUntil в будущем → продлеваем от него', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    const current = '2026-06-01T00:00:00.000Z'
    const end = extendPlan(current, 1, now)
    expect(new Date(end).getMonth()).toBe(6) // jul
  })
})

describe('paidDaysLeft', () => {
  it('без paidUntil → null', () => {
    expect(paidDaysLeft({ plan: 'free' })).toBeNull()
  })

  it('положительное для действующего плана', () => {
    const sub = { plan: 'business', paidUntil: '2027-01-01T00:00:00.000Z' }
    const days = paidDaysLeft(sub, new Date('2026-01-01T00:00:00.000Z'))
    expect(days).toBe(365)
  })
})
