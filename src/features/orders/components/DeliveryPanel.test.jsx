import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DeliveryPanel from './DeliveryPanel'
vi.mock('@/shared/store/useStore', () => ({ useStore: selector => selector({ deliverOrder: vi.fn() }) }))
vi.mock('@/shared/api', () => ({ getAuthContext: vi.fn(), isAuthContextCurrent: vi.fn() }))
beforeEach(() => vi.stubGlobal('React', React))
afterEach(() => vi.unstubAllGlobals())
describe('delivery confirmation UI', () => {
  it('pending durable delivery is never presented as confirmed', () => {
    const html = renderToStaticMarkup(<DeliveryPanel order={{ id: 'o', status: 'shipped', deliveryPending: { commandId: 'delivery' } }} />)
    expect(html).toContain('Доставка ожидает подтверждения сервера'); expect(html).not.toContain('Доставка подтверждена сервером')
  })
  it('a conflict exposes review instructions and the original error', () => {
    const html = renderToStaticMarkup(<DeliveryPanel order={{ id: 'o', status: 'cancelled', deliveryPending: { needsReview: true, code: 'DELIVERY_STATUS_CONFLICT', error: 'Заказ отменён' } }} />)
    expect(html).toContain('Доставка требует сверки'); expect(html).toContain('Заказ отменён'); expect(html).not.toContain('Доставка подтверждена сервером')
  })
  it('waiting for shipment disables delivery; actual delivered state shows confirmation', () => {
    expect(renderToStaticMarkup(<DeliveryPanel order={{ id: 'o', status: 'shipped', shipmentPending: {} }} />)).toContain('disabled')
    expect(renderToStaticMarkup(<DeliveryPanel order={{ id: 'o', status: 'delivered' }} />)).toContain('Доставка подтверждена сервером')
  })
})
