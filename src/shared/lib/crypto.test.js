import { describe, it, expect } from 'vitest'
import { hashPin, verifyPin, isHashedPin } from './crypto'

describe('hashPin', () => {
  it('одинаковый PIN даёт одинаковый хэш', async () => {
    const a = await hashPin('1234')
    const b = await hashPin('1234')
    expect(a).toBe(b)
  })

  it('разные PIN дают разные хэши', async () => {
    const a = await hashPin('1234')
    const b = await hashPin('4321')
    expect(a).not.toBe(b)
  })

  it('хэш — 64 hex-символа (SHA-256)', async () => {
    const h = await hashPin('1111')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('пустой PIN → пустая строка (нельзя войти)', async () => {
    expect(await hashPin('')).toBe('')
    expect(await hashPin(null)).toBe('')
    expect(await hashPin(undefined)).toBe('')
  })

  it('раскрытие оригинала невозможно из хэша (не совпадает с самим значением)', async () => {
    const h = await hashPin('1234')
    expect(h).not.toContain('1234')
  })
})

describe('isHashedPin', () => {
  it('64 hex → распознаётся как хэш', async () => {
    const h = await hashPin('9999')
    expect(isHashedPin(h)).toBe(true)
  })

  it('короткое / нехекс — не хэш (legacy)', () => {
    expect(isHashedPin('1234')).toBe(false)
    expect(isHashedPin('')).toBe(false)
    expect(isHashedPin('deadbeef')).toBe(false)
    expect(isHashedPin('z'.repeat(64))).toBe(false)
    expect(isHashedPin(null)).toBe(false)
    expect(isHashedPin(undefined)).toBe(false)
  })
})

describe('verifyPin', () => {
  it('успех против хэша: ok=true, без legacy', async () => {
    const stored = await hashPin('4321')
    const r = await verifyPin('4321', stored)
    expect(r).toEqual({ ok: true })
  })

  it('провал против хэша: ok=false', async () => {
    const stored = await hashPin('4321')
    const r = await verifyPin('0000', stored)
    expect(r.ok).toBe(false)
  })

  it('успех против legacy raw PIN: ok=true, legacy=true (лениво перехэшируется)', async () => {
    const r = await verifyPin('1111', '1111')
    expect(r).toEqual({ ok: true, legacy: true })
  })

  it('провал против legacy raw PIN', async () => {
    const r = await verifyPin('1111', '2222')
    expect(r.ok).toBe(false)
  })

  it('пустой сохранённый PIN — всегда провал (не позволяем пустой вход)', async () => {
    const r = await verifyPin('', '')
    expect(r.ok).toBe(false)
    const r2 = await verifyPin('0000', '')
    expect(r2.ok).toBe(false)
  })

  it('число как PIN приводится к строке (форма ввода даёт string, но подстрахуемся)', async () => {
    const stored = await hashPin('1234')
    const r = await verifyPin(1234, stored)
    expect(r.ok).toBe(true)
  })
})
