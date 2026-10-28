import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { makeSeed } from './seed'
import { uid } from '../lib/id'
import { obfuscateSecret, deobfuscateSecret } from '../lib/crypto'
import { persistMigrate, persistPartialize, persistMerge } from './persistMigrate'
import { createHrSlice } from './slices/hrSlice'
import { createCloudSlice, cloudInitialState, bindStore } from './slices/cloudSlice'
import { createShiftsSlice } from './slices/shiftsSlice'
import { createProductsSlice } from './slices/productsSlice'
import { createWarehouseSlice } from './slices/warehouseSlice'
import { createDocumentsSlice } from './slices/documentsSlice'
import { createOrdersSlice } from './slices/ordersSlice'
import { createMoneySlice } from './slices/moneySlice'
import { createSettingsSlice } from './slices/settingsSlice'
import { hasApi } from '@/shared/api'
import { companyCache, emptyCloudData } from '../lib/scopedCache'

// F4-4: обёртка над localStorage, которая обфусцирует aiKey и
// webhook.secret на диске. State в памяти — plain (UI работает без
// изменений); read/write в localStorage — прозрачно шифруется.
const secureStorage = {
  getItem: (name) => {
    if (typeof window === 'undefined') return null
    const raw = companyCache.getItem(name)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      const s = parsed?.state?.settings
      if (s) {
        if (s.aiKey) s.aiKey = deobfuscateSecret(s.aiKey)
        if (Array.isArray(s.webhooks)) {
          s.webhooks = s.webhooks.map((w) =>
            w?.secret ? { ...w, secret: deobfuscateSecret(w.secret) } : w,
          )
        }
      }
      return JSON.stringify(parsed)
    } catch {
      return raw
    }
  },
  setItem: (name, value) => {
    if (typeof window === 'undefined') return
    try {
      const parsed = JSON.parse(value)
      const s = parsed?.state?.settings
      if (s) {
        if (s.aiKey) s.aiKey = obfuscateSecret(s.aiKey)
        if (Array.isArray(s.webhooks)) {
          s.webhooks = s.webhooks.map((w) =>
            w?.secret ? { ...w, secret: obfuscateSecret(w.secret) } : w,
          )
        }
      }
      companyCache.setItem(name, JSON.stringify(parsed))
    } catch {
      companyCache.setItem(name, value)
    }
  },
  removeItem: (name) => {
    if (typeof window !== 'undefined') companyCache.removeItem(name)
  },
}

// Слой данных. Сейчас источник истины — localStorage (persist).
// Чтобы переключиться на реальный API/Supabase, эти actions заменяются
// на сетевые вызовы — компоненты менять не нужно.

export const useStore = create(
  persist(
    (set, get) => ({
      ...(hasApi ? emptyCloudData() : makeSeed()),
      ...cloudInitialState, // authUserId, cloud, companyId, runtime-флаги…

      // ── Облако (Supabase, мультитенант) — см. slices/cloudSlice.js ──
      ...createCloudSlice(set, get),

      // ── Аудит / лог действий ─────────────────────────────────
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

      // ── Кассовые смены — см. slices/shiftsSlice.js ─────────
      ...createShiftsSlice(set, get),

      // ── Товары / маркировка / цены — см. slices/productsSlice.js
      ...createProductsSlice(set, get),

      // ── Складские операции / склады / ячейки — см. slices/warehouseSlice.js
      ...createWarehouseSlice(set, get),

      // ── Документы — см. slices/documentsSlice.js ────────────
      ...createDocumentsSlice(set, get),

      // ── Заказы / накладные / PO — см. slices/ordersSlice.js ─
      ...createOrdersSlice(set, get),

      // ── Клиенты / поставщики / деньги — см. slices/moneySlice.js
      ...createMoneySlice(set, get),

      // ── Сотрудники / роли + PIN — см. slices/hrSlice.js ─────
      ...createHrSlice(set, get),

      // ── Настройки / API-ключи / webhooks — см. slices/settingsSlice.js
      ...createSettingsSlice(set, get),
    }),
    {
      name: 'sklad.db',
      version: 19,
      partialize: persistPartialize,
      merge: persistMerge,
      migrate: persistMigrate,
      // F4-4: storage-обёртка не меняет layout — только обфусцирует
      // aiKey/webhook.secret на выходе и расшифровывает на входе.
      storage: createJSONStorage(() => secureStorage),
    },
  ),
)

// Связываем облачный slice с готовым useStore — attachSync/resumeSync
// принимают ссылку на этот объект. До bindStore() cloud-actions не могут
// узнать про useStore (при их описании его ещё не существовало).
bindStore(useStore)

// Удобные хуки-селекторы
export const useProducts = () => useStore((s) => s.products)
export const useOrders = () => useStore((s) => s.orders)
export const useCustomers = () => useStore((s) => s.customers)
export const useSettings = () => useStore((s) => s.settings)
