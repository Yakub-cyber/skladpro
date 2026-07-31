import { describe, it, expect } from 'vitest'
import {
  nextStatus,
  statusInfo,
  tierFor,
  canAccess,
  priceFor,
  docTypeInfo,
} from './constants'

describe('nextStatus — воронка заказа', () => {
  it('ведёт по этапам вперёд', () => {
    expect(nextStatus('new')).toBe('confirmed')
    expect(nextStatus('confirmed')).toBe('picking')
    expect(nextStatus('shipped')).toBe('delivered')
  })

  it('финальный и отменённый статусы не имеют следующего', () => {
    expect(nextStatus('delivered')).toBeNull()
    expect(nextStatus('cancelled')).toBeNull()
  })
})

describe('statusInfo', () => {
  it('возвращает дефолт для неизвестного статуса', () => {
    expect(statusInfo('nope').key).toBe('new')
  })
})

describe('tierFor — уровни лояльности', () => {
  it('подбирает уровень по сумме покупок', () => {
    expect(tierFor(0).key).toBe('base')
    expect(tierFor(200000).key).toBe('silver')
    expect(tierFor(600000).key).toBe('gold')
    expect(tierFor(2000000).key).toBe('platinum')
  })

  it('граница уровня включительна', () => {
    expect(tierFor(150000).key).toBe('silver')
  })
})

describe('canAccess — RBAC', () => {
  it('админ имеет доступ ко всему', () => {
    expect(canAccess('admin', 'settings')).toBe(true)
    expect(canAccess('admin', 'что-угодно')).toBe(true)
  })

  it('курьер видит доставку, но не товары', () => {
    expect(canAccess('courier', 'delivery')).toBe(true)
    expect(canAccess('courier', 'products')).toBe(false)
  })

  it('кладовщик не имеет доступа к аналитике', () => {
    expect(canAccess('stock', 'analytics')).toBe(false)
  })
})

describe('priceFor — цена по категории', () => {
  const product = { price: 100, prices: { pt_retail: 120, pt_opt: 95 } }

  it('берёт цену выбранной категории', () => {
    expect(priceFor(product, 'pt_opt')).toBe(95)
  })

  it('откатывается на базовую цену при отсутствии категории', () => {
    expect(priceFor(product, 'pt_unknown')).toBe(100)
  })

  it('0 для пустого товара', () => {
    expect(priceFor(null, 'pt_retail')).toBe(0)
  })
})

describe('docTypeInfo', () => {
  it('возвращает префиксы типов документов', () => {
    expect(docTypeInfo('purchase').prefix).toBe('ЗАК')
    expect(docTypeInfo('inventory').prefix).toBe('ИНВ')
  })
})
