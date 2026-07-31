// Сотрудники и вход по PIN. PIN хэшируется на клиенте (SHA-256 + соль,
// см. lib/crypto.js) и НЕ уезжает в облако (см. LOCAL_ONLY_FIELDS в
// lib/cloud.js). Здесь же — login/logout с ленивой миграцией legacy raw
// PIN (для демо-seed и старых карточек) в хэш при первом успехе.
import { uid } from '../../lib/id'
import { hashPin, verifyPin } from '../../lib/crypto'
import { updateMemberRole } from '../../lib/cloud'
import { effectivePlan, PLAN_LIMITS } from '../../lib/subscription'

export const createHrSlice = (set, get) => ({
  addEmployee: async (e) => {
    // F3-2: гейт по плану. free — 3 сотрудника, business — 15.
    const st = get()
    const eff = effectivePlan(st.settings?.subscription, new Date())
    const limits = PLAN_LIMITS[eff] || PLAN_LIMITS.free
    const active = (st.employees || []).filter((x) => x.active !== false).length
    if (Number.isFinite(limits.employees) && active >= limits.employees) {
      return {
        ok: false,
        error: `План «${limits.label}» позволяет ${limits.employees} активных сотрудников. Улучшите тариф.`,
      }
    }
    const pinHash = e.pin ? await hashPin(e.pin) : ''
    set((s) => ({
      employees: [
        ...s.employees,
        { id: uid('e'), active: true, role: 'stock', ...e, pin: pinHash },
      ],
    }))
    return { ok: true }
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

  // F4-1: явный флаг recovery — только админ выставляет `recoveryRequestedAt`
  // (через requestPinRecovery), после чего пользователь может 1 раз войти
  // по любому 4-значному коду и задать себе новый PIN. Раньше вход
  // допускался при `!e.pin` — это бэкдор: любой сотрудник, у которого
  // случайно очистили PIN, оставался входом «по любому 4-значному».
  requestPinRecovery: (empId) => {
    // Помечает сотрудника флагом. Ожидается, что вызывается только
    // из UI-действия, доступного admin (см. Employees.jsx).
    set((s) => ({
      employees: s.employees.map((x) =>
        x.id === empId ? { ...x, recoveryRequestedAt: Date.now() } : x,
      ),
    }))
    get().logAction('Разрешено восстановление PIN', {
      section: 'Авторизация',
      type: 'security',
    })
  },

  // F4-2: rate-limit. Хранится в отдельной мапе pinFails (persist), чтобы
  // счётчик не терялся при refresh страницы. После 5 ошибок — блок 30 с,
  // после 10 — 5 мин. Инвариант: успех сбрасывает счётчик, любое обращение
  // к login после blockedUntil тоже сбрасывает.
  pinFails: {},

  // Авторизация по PIN. verifyPin понимает и хэш, и legacy raw (демо-seed
  // или карточки до миграции); при успехе с legacy — тут же перезаписываем
  // хранимый PIN хэшем, чтобы raw не остался в localStorage навсегда.
  login: async (id, pin) => {
    const e = get().employees.find((x) => x.id === id)
    if (!e) return { ok: false, error: 'Сотрудник не найден' }
    if (!e.active) return { ok: false, error: 'Учётная запись отключена' }

    // F4-2: проверка блокировки до любых вычислений (иначе брут может
    // просто выжидать миллисекунды между попытками).
    const now = Date.now()
    const fail = (get().pinFails || {})[id]
    if (fail?.blockedUntil && fail.blockedUntil > now) {
      const sec = Math.ceil((fail.blockedUntil - now) / 1000)
      return {
        ok: false,
        error: `Слишком много ошибок. Повторите через ${sec} сек.`,
      }
    }

    // F4-1: recovery — только по явному флагу от админа.
    const recoveryAllowed = !!e.recoveryRequestedAt
    if (recoveryAllowed && !e.pin && /^\d{4}$/.test(String(pin || ''))) {
      const h = await hashPin(pin)
      set((s) => ({
        employees: s.employees.map((x) =>
          x.id === id ? { ...x, pin: h, recoveryRequestedAt: null } : x,
        ),
        pinFails: { ...(s.pinFails || {}), [id]: undefined },
        authUserId: e.id,
        authAt: Date.now(),
      }))
      get().logAction('PIN восстановлен · вход', {
        section: 'Авторизация',
        type: 'login',
      })
      return { ok: true, recovered: true }
    }

    // Пустой PIN без recovery — вход невозможен (админ должен либо
    // выставить PIN, либо разрешить recovery).
    if (!e.pin) {
      return {
        ok: false,
        error: 'PIN не задан. Обратитесь к администратору для восстановления.',
      }
    }

    const v = await verifyPin(pin, e.pin)
    if (!v.ok) {
      // F4-2: копим ошибки и, при переходе через порог, ставим блок.
      set((s) => {
        const prev = (s.pinFails || {})[id] || { count: 0, blockedUntil: 0 }
        const count = prev.count + 1
        let blockedUntil = 0
        if (count >= 10) blockedUntil = now + 5 * 60 * 1000
        else if (count >= 5) blockedUntil = now + 30 * 1000
        return {
          pinFails: {
            ...(s.pinFails || {}),
            [id]: { count, blockedUntil },
          },
        }
      })
      return { ok: false, error: 'Неверный PIN' }
    }
    if (v.legacy) {
      const h = await hashPin(pin)
      set((s) => ({
        employees: s.employees.map((x) => (x.id === id ? { ...x, pin: h } : x)),
      }))
    }
    // Успех — сбрасываем счётчик и авторизуем.
    set((s) => ({
      pinFails: { ...(s.pinFails || {}), [id]: undefined },
      authUserId: e.id,
      authAt: Date.now(),
    }))
    get().logAction('Вход в систему', { section: 'Авторизация', type: 'login' })
    return { ok: true }
  },

  logout: () => {
    get().logAction('Выход из системы', { section: 'Авторизация', type: 'logout' })
    set({ authUserId: null, authAt: null })
  },
})
