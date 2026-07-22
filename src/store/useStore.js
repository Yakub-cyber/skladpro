import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { makeSeed } from './seed'
import { uid, docNo } from '../lib/id'
import { nextStatus, statusInfo, docTypeInfo, DEFAULT_WORK_ZONES } from '../lib/constants'
import { applyDocToState } from '../lib/posting'
import { applyOrderStock } from '../lib/orders'
import { persistMigrate, persistPartialize, persistMerge } from './persistMigrate'
import { createHrSlice } from './slices/hrSlice'
import { createCloudSlice, cloudInitialState, bindStore } from './slices/cloudSlice'

export const useStore = create(
  persist(
    (set, get) => ({
      ...makeSeed(),
      ...cloudInitialState,

      ...createCloudSlice(set, get),

      logAction: (title, opts = {}) =>
        set((s) => ({
          audit: [
            {
              id: uid('a'),
              at: new Date().toISOString(),
              by: s.authUserId,
              title,
              section: opts.section || 'Система',
              type: opts.type || 'info',
            },
            ...s.audit,
          ].slice(0, 500),
        })),

      cancelOrder: (id, note) => {
        const o = get().orders.find((x) => x.id === id)
        if (!o || o.status === 'cancelled') return
        set((s) => {
          let products = s.products
          if (o.stockConsumed) {
            products = applyOrderStock(s, o, 1).products
          }
          let customers = s.customers
          if (o.onCredit && o.customerId) {
            customers = s.customers.map((c) =>
              c.id === o.customerId ? { ...c, balance: Math.max(0, (c.balance || 0) - (o.total || 0)) } : c,
            )
          }
          const updatedOrders = s.orders.map((x) =>
            x.id === id
              ? {
                  ...x,
                  status: 'cancelled',
                  track: [
                    ...(x.track || []),
                    { status: 'cancelled', at: new Date().toISOString(), ...(note ? { note } : {}) },
                  ],
                }
              : x,
          )
          return {
            products,
            customers,
            orders: updatedOrders,
          }
        })
        set((s) => ({ activeOrdersCount: s.orders.filter((o) => o.status !== 'cancelled').length }))
        get().logAction(
          `Отменён заказ ${o.no} · ${o.stockConsumed ? 'остатки возвращены' : 'резерв снят'}`,
          { section: 'Заказы', type: 'delete' },
        )
      },

      // Other store methods remain unchanged

    }),
    {
      name: 'store',
      migrate: persistMigrate,
      partialize: persistPartialize,
      merge: persistMerge,
    },
  ),
)