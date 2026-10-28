import { it, expect } from 'vitest'
import { soldByProduct } from './ai'
import { buildAssistantContext } from './assistant'
import { createOutbox, safeStorage } from './outbox'

it('заявки не являются продажами, возврат уменьшает продажи и выручку', () => {
  const orders = [
    { status: 'delivered', total: 900, items: [{ productId: 'p', qty: 10 }] },
    { status: 'new', total: 5000, items: [{ productId: 'p', qty: 50 }] },
    { kind: 'refund', status: 'delivered', total: 180, items: [{ productId: 'p', qty: 2 }] },
  ]
  expect(soldByProduct(orders).p).toBe(8)
  expect(buildAssistantContext({ orders })).toContain('выручка 720.')
})

it('очередь сохраняет неотправленную продажу после лимита и позволяет повторить', async () => {
  const storage = safeStorage()
  const context = { userId: 'u1', companyId: 'c1' }
  let fail = true
  const send = async (batch) => (fail ? { error: new Error('offline') } : { sent: batch })
  const box = createOutbox({ send, storage, context, locks: { request: async (_name, run) => run() }, maxItemAttempts: 1 })
  try {
    await box.enqueueCommand({ ...context, key: 'sale', id: 'o', obj: { total: 900 } })
    await box.flushNow()
    await box.flushNow()
    expect(box.status()).toMatchObject({ pending: 1, quarantined: 1, state: 'attention' })
    const restored = createOutbox({ send, storage, context, locks: { request: async (_name, run) => run() } })
    try {
      expect(restored.items()[0].obj.total).toBe(900)
      fail = false
      restored.retryQuarantined('o', 'sale')
      await restored.flushNow()
      expect(restored.status().pending).toBe(0)
    } finally {
      restored.destroy()
    }
  } finally {
    box.destroy()
  }
})
