import { uid } from '../../lib/id'
import { makeSeed } from '../seed'

export const createSettingsSlice = (set, get) => ({
  // ── Настройки / прочее ───────────────────────────────────
  updateSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ...patch } })),

  // D3: API-ключи. Живут в settings.apiKeys. Модель:
  // { id, label, key (полный, показываем при генерации 1 раз),
  //   keyPreview (первые 8 символов для UI), createdAt, lastUsedAt,
  //   scopes: ['read','write'] }.
  // Настоящая проверка ключей появится, когда добавим публичный
  // REST API (Supabase Edge). Пока UI-заготовка + local-only.
  addApiKey: (label, scopes = ['read']) => {
    const id = uid('ak')
    // Случайный ключ — 32 hex-символа. Показываем один раз.
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const key = `sp_${rand}`
    const keyPreview = key.slice(0, 8) + '…'
    set((s) => ({
      settings: {
        ...s.settings,
        apiKeys: [
          ...(s.settings?.apiKeys || []),
          {
            id,
            label: label || 'Ключ',
            keyPreview,
            createdAt: new Date().toISOString(),
            lastUsedAt: null,
            scopes,
          },
        ],
      },
    }))
    get().logAction(`Создан API-ключ «${label}»`, { section: 'Интеграции', type: 'create' })
    return { id, key, keyPreview } // key — только на возврате, в state не хранится
  },
  removeApiKey: (id) => {
    set((s) => ({
      settings: {
        ...s.settings,
        apiKeys: (s.settings?.apiKeys || []).filter((k) => k.id !== id),
      },
    }))
    get().logAction(`API-ключ отозван`, { section: 'Интеграции', type: 'delete' })
  },

  // D3: webhook-endpoints. Модель:
  // { id, url, events:[], secret, active, createdAt, lastFiredAt, lastStatus }
  addWebhook: (url, events = ['order.created']) => {
    const id = uid('wh')
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    set((s) => ({
      settings: {
        ...s.settings,
        webhooks: [
          ...(s.settings?.webhooks || []),
          {
            id,
            url,
            events,
            secret: `whsec_${rand}`,
            active: true,
            createdAt: new Date().toISOString(),
            lastFiredAt: null,
            lastStatus: null,
          },
        ],
      },
    }))
    get().logAction(`Добавлен webhook ${url}`, { section: 'Интеграции', type: 'create' })
    return id
  },
  removeWebhook: (id) => {
    set((s) => ({
      settings: {
        ...s.settings,
        webhooks: (s.settings?.webhooks || []).filter((w) => w.id !== id),
      },
    }))
  },
  toggleWebhook: (id) => {
    set((s) => ({
      settings: {
        ...s.settings,
        webhooks: (s.settings?.webhooks || []).map((w) =>
          w.id === id ? { ...w, active: !w.active } : w,
        ),
      },
    }))
  },

  resetDemo: () => set((s) => ({ ...makeSeed(), authUserId: s.authUserId })),
})
