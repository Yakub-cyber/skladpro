// Сотрудники и вход по PIN. PIN хэшируется на клиенте (SHA-256 + соль,
// см. lib/crypto.js) и НЕ уезжает в облако (см. LOCAL_ONLY_FIELDS в
// lib/cloud.js). Здесь же — login/logout с ленивой миграцией legacy raw
// PIN (для демо-seed и старых карточек) в хэш при первом успехе.
import { uid } from '../../lib/id'
import { hashPin, verifyPin } from '../../lib/crypto'

export const createHrSlice = (set, get) => ({
  addEmployee: async (e) => {
    const pinHash = e.pin ? await hashPin(e.pin) : ''
    set((s) => ({
      employees: [
        ...s.employees,
        { id: uid('e'), active: true, role: 'stock', ...e, pin: pinHash },
      ],
    }))
  },

  updateEmployee: async (id, patch) => {
    const next = { ...patch }
    if ('pin' in next) next.pin = next.pin ? await hashPin(next.pin) : ''
    set((s) => ({
      employees: s.employees.map((e) => (e.id === id ? { ...e, ...next } : e)),
    }))
  },

  removeEmployee: (id) =>
    set((s) => ({
      employees: s.employees.filter((e) => e.id !== id),
      authUserId: s.authUserId === id ? null : s.authUserId,
    })),

  // Авторизация по PIN. verifyPin понимает и хэш, и legacy raw (демо-seed
  // или карточки до миграции); при успехе с legacy — тут же перезаписываем
  // хранимый PIN хэшем, чтобы raw не остался в localStorage навсегда.
  login: async (id, pin) => {
    const e = get().employees.find((x) => x.id === id)
    if (!e) return { ok: false, error: 'Сотрудник не найден' }
    if (!e.active) return { ok: false, error: 'Учётная запись отключена' }
    const v = await verifyPin(pin, e.pin)
    if (!v.ok) return { ok: false, error: 'Неверный PIN' }
    if (v.legacy) {
      const h = await hashPin(pin)
      set((s) => ({
        employees: s.employees.map((x) => (x.id === id ? { ...x, pin: h } : x)),
      }))
    }
    set({ authUserId: e.id })
    get().logAction('Вход в систему', { section: 'Авторизация', type: 'login' })
    return { ok: true }
  },

  logout: () => {
    get().logAction('Выход из системы', { section: 'Авторизация', type: 'logout' })
    set({ authUserId: null })
  },
})
