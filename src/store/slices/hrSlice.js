// Сотрудники и вход по PIN. PIN хэшируется на клиенте (SHA-256 + соль,
// см. lib/crypto.js) и НЕ уезжает в облако (см. LOCAL_ONLY_FIELDS в
// lib/cloud.js). Здесь же — login/logout с ленивой миграцией legacy raw
// PIN (для демо-seed и старых карточек) в хэш при первом успехе.
import { uid } from '../../lib/id'
import { hashPin, verifyPin } from '../../lib/crypto'
import { updateMemberRole } from '../../lib/cloud'

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
    // Защита от аккаунт-lockout: если в patch пришёл пустой pin (форма
    // не заполнена или пользователь очистил prompt), НЕ затираем PIN —
    // просто игнорируем поле. Смена PIN должна быть явной: 4-значное
    // значение. Иначе легко потерять доступ к учётной записи, а войти
    // без PIN нельзя (verifyPin вернёт ok:false).
    if ('pin' in next) {
      if (next.pin) next.pin = await hashPin(next.pin)
      else delete next.pin
    }

    // Если меняется РОЛЬ сотрудника, привязанного к аккаунту Supabase
    // (authUid есть), синхронно правим и `memberships.role`. Иначе RLS
    // (`auth_role()` читает из memberships) не увидит новую роль, и
    // пользователь получит расширенный UI, но запись в БД будет падать
    // с permission denied. Ошибку сервера не блокируем — локальный стор
    // всё равно обновляем, а рассинхрон решится при повторной попытке.
    if ('role' in next) {
      const emp = get().employees.find((e) => e.id === id)
      const companyId = get().companyId
      if (emp?.authUid && companyId) {
        try {
          await updateMemberRole(emp.authUid, companyId, next.role)
        } catch (e) {
          console.warn('Не удалось обновить роль в memberships:', e?.message || e)
        }
      }
    }

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
    // Восстановление: если у сотрудника нет заданного PIN (например,
    // случайно стёрли в форме), разрешаем разовый вход по любому 4-знач.
    // значению и сразу сохраняем его как новый PIN. Иначе аккаунт с
    // e.pin === '' полностью залочен: verifyPin вернёт ok:false, войти
    // невозможно, никто уже не задаст новый PIN изнутри. Небезопасно для
    // публичного продакшна, но для многотенантного демо это единственный
    // способ восстановиться без прямой правки БД.
    if (!e.pin && /^\d{4}$/.test(String(pin || ''))) {
      const h = await hashPin(pin)
      set((s) => ({
        employees: s.employees.map((x) => (x.id === id ? { ...x, pin: h } : x)),
        authUserId: e.id,
        authAt: Date.now(),
      }))
      get().logAction('PIN восстановлен · вход', {
        section: 'Авторизация',
        type: 'login',
      })
      return { ok: true, recovered: true }
    }
    const v = await verifyPin(pin, e.pin)
    if (!v.ok) return { ok: false, error: 'Неверный PIN' }
    if (v.legacy) {
      const h = await hashPin(pin)
      set((s) => ({
        employees: s.employees.map((x) => (x.id === id ? { ...x, pin: h } : x)),
      }))
    }
    set({ authUserId: e.id, authAt: Date.now() })
    get().logAction('Вход в систему', { section: 'Авторизация', type: 'login' })
    return { ok: true }
  },

  logout: () => {
    get().logAction('Выход из системы', { section: 'Авторизация', type: 'logout' })
    set({ authUserId: null, authAt: null })
  },
})
