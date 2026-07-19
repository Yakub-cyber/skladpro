// Облачная авторизация и bootstrap мультитенанта Supabase.
//
// Особенность: attachSync/resumeSync принимают ссылку на useStore-объект
// (им нужен .subscribe/.setState). Внутри slice useStore ещё не создан,
// поэтому мы храним ссылку в модульной переменной и связываем её после
// create() вызовом bindStore(useStore).
import { makeSeed } from '../seed'
import { uid } from '../../lib/id'
import { hasSupabase } from '../../lib/supabase'
import { stockConsumedFromStatus } from '../../lib/orders'
import {
  cloudLoadMerged,
  cloudSeed,
  cloudUpsert,
  remapSeedForCompany,
  attachSync,
  pauseSync,
  resumeSync,
  getCloudSession,
  onAuthChange,
  cloudSignIn,
  cloudSignUp,
  cloudSignOut,
  getMembership,
  createCompanyCloud,
  acceptInvitation,
  checkRecovery,
  applyPasswordReset,
  subscribeToEvents,
} from '../../lib/cloud'

// Дебаунсим pull после SSE-события: за 500мс может прилететь пачка событий
// (например, продажа + PIN-верификация), делать pull после каждого дорого.
let sseDebounce = null
let sseUnsub = null
function scheduleRealtimeSync(fn) {
  if (sseDebounce) clearTimeout(sseDebounce)
  sseDebounce = setTimeout(() => { sseDebounce = null; fn() }, 500)
}

let storeRef = null

// Связать slice с созданным useStore. Вызывается один раз из useStore.js
// сразу после create() — до первого рендера, поэтому attachSync/resumeSync
// получат правильную ссылку.
export function bindStore(store) {
  storeRef = store
}

// Runtime-поля облака (не попадают в persist — см. persistPartialize).
export const cloudInitialState = {
  authUserId: null,
  cloud: hasSupabase,
  cloudReady: false,
  cloudError: null,
  syncPending: 0,
  syncState: 'ok',
  syncError: null,
  _authInited: false,
  needOnboarding: false,
  recoveryMode: false,
  resetToken: null,
  companyId: null,
  companyName: null,
}

export const createCloudSlice = (set, get) => ({
  // Единая точка реакции на вход/выход через onAuthStateChange
  initAuth: async () => {
    if (!hasSupabase || get()._authInited) return
    set({ _authInited: true })
    // onAuthChange: обрабатываем оба события. SIGNED_OUT — чистим стор.
    // SIGNED_IN приходит, когда пользователь перешёл по confirmation-ссылке
    // из письма и Supabase поднял сессию в текущей вкладке. Раньше мы это
    // событие игнорировали — приглашённый застревал на экране входа до
    // ручного reload. Дедуп через authUserId + мьютекс bootstrap внутри.
    onAuthChange((event) => {
      if (event === 'SIGNED_OUT') {
        set({
          authUserId: null,
          needOnboarding: false,
          companyId: null,
          companyName: null,
          cloudReady: false,
        })
      } else if (event === 'SIGNED_IN' && !get().authUserId) {
        // Только если ещё не залогинены в UI — иначе `bootstrapCloud`
        // после ручного signIn/signUp уже был вызван явно, и повторный
        // запуск создал бы гонку.
        get().bootstrapCloud()
      }
    })
    // Переход по magic-link сброса пароля → экран нового пароля (без bootstrap).
    // Новая версия checkRecovery возвращает токен из URL или null.
    const resetToken = await checkRecovery()
    if (resetToken) {
      set({ recoveryMode: true, resetToken })
      return
    }
    // восстановление сессии при загрузке
    const s = await getCloudSession()
    if (s) get().bootstrapCloud()
  },

  bootstrapCloud: async (sessionArg, opts = {}) => {
    if (!hasSupabase) return
    // во время онбординга (создания компании) фоновые вызовы от
    // onAuthStateChange пропускаем — иначе перезаписывают результат
    if (get()._creating && !opts.fromOnboarding) return
    // мьютекс: не выполнять параллельно (иначе устаревший вызов
    // перезаписывает результат свежего и сбрасывает authUserId)
    if (get()._bootBusy) {
      await new Promise((res) => {
        const i = setInterval(() => {
          if (!get()._bootBusy) {
            clearInterval(i)
            res()
          }
        }, 60)
      })
    }
    set({ _bootBusy: true })
    try {
      // сессию берём свежую внутри мьютекса (а не из аргумента —
      // он мог устареть, пока ждали освобождения)
      const session = await getCloudSession()
      if (!session) {
        set({ authUserId: null, cloudReady: false, needOnboarding: false, companyId: null })
        return
      }
      let membership = await getMembership()
      if (!membership) {
        // вдруг пользователь приглашён в компанию → привязать
        const invitedCompany = await acceptInvitation()
        if (invitedCompany) membership = await getMembership()
      }
      if (!membership) {
        // пользователь без компании → онбординг (создать свою)
        set({ authUserId: null, needOnboarding: true, cloudReady: false })
        return
      }
      const companyId = membership.company_id
      // cloudLoadMerged: сначала досылает локальную очередь outbox, потом
      // читает сервер; недоставленное накладывает поверх (см. cloud.js)
      let data = await cloudLoadMerged()
      if (!data) {
        const seed = remapSeedForCompany(makeSeed(), companyId)
        await cloudSeed(seed, companyId)
        data = await cloudLoadMerged()
      }
      // Заказы из облака до модели резервирования приходят без stockConsumed
      // (в т.ч. пока не применён reservation_migration.sql) — выводим флаг из
      // статуса, иначе отгруженный заказ спишется повторно, а отмена не
      // вернёт остаток. Остаток здесь НЕ трогаем: разовый возврат для старых
      // открытых заказов делает серверная миграция (см. supabase/*.sql).
      if (data.orders) {
        data.orders = data.orders.map((o) =>
          o.stockConsumed != null
            ? o
            : { ...o, stockConsumed: stockConsumedFromStatus(o.status) },
        )
      }
      // PIN не приходит из облака (LOCAL_ONLY_FIELDS в cloud.js) — тянем
      // локальный по id сотрудника, иначе после перезагрузки все PIN
      // обнулятся, а на другом устройстве сотрудник просто задаст свой.
      const localPin = new Map(
        (get().employees || []).map((e) => [e.id, e.pin || '']),
      )
      let employees = (data.employees || []).map((e) => ({
        ...e,
        pin: localPin.get(e.id) ?? '',
      }))
      data.employees = employees
      let me = employees.find((e) => e.authUid === session.user.id)
      if (!me) {
        me = {
          id: uid('e'),
          name: membership.name || session.user.email?.split('@')[0] || 'Сотрудник',
          role: membership.role || 'admin',
          authUid: session.user.id,
          active: true,
          pin: '',
        }
        employees = [...employees, me]
        data.employees = employees
        // заливаем сразу: autosync стартует позже и пропустил бы нового сотрудника,
        // из-за чего при каждом входе создавался бы дубликат с новым id.
        // Не валим bootstrap, если RLS отклонит (тогда просто синхронизируется позже).
        try {
          await cloudUpsert('employees', me, companyId)
        } catch (e) {
          console.warn('Не удалось сохранить карточку сотрудника:', e?.message || e)
        }
      }
      // Настройки: серверные значения поверх локальных, но локальные
      // ключи, которых нет в облаке (aiKey и пр.), сохраняем.
      if (data.settings) data.settings = { ...get().settings, ...data.settings }
      // Применение серверных данных не должно эхом уехать обратно в outbox
      pauseSync()
      try {
        set({
          ...data,
          companyId,
          companyName: membership.companies?.name || 'Компания',
          authUserId: me.id,
          cloudReady: true,
          needOnboarding: false,
          cloudError: null,
        })
      } finally {
        if (storeRef) resumeSync(storeRef)
      }
      if (storeRef) attachSync(storeRef)

      // Realtime SSE: подписываемся на события компании и при их получении
      // делаем быстрый pull, чтобы UI мгновенно увидел продажу/платёж с другого
      // устройства. Одна подписка на сессию — снимаем при выходе (в cloudLogout).
      if (sseUnsub) { try { sseUnsub() } catch {} }
      sseUnsub = subscribeToEvents((ev) => {
        // Игнорируем чужие компании (сервер уже фильтрует, но подстраховка).
        if (ev?.companyId && ev.companyId !== companyId) return
        scheduleRealtimeSync(async () => {
          try {
            const fresh = await cloudLoadMerged()
            if (!fresh) return
            pauseSync()
            try {
              // Мержим только «серверные» коллекции: заказы, движения, документы, аудит.
              // Локальный settings.aiKey и т.п. оставляем.
              const patch = {}
              for (const k of ['orders', 'movements', 'audit', 'documents', 'customers', 'products', 'invoices', 'shifts']) {
                if (Array.isArray(fresh[k])) patch[k] = fresh[k]
              }
              set(patch)
            } finally {
              if (storeRef) resumeSync(storeRef)
            }
          } catch { /* сеть/отказ бэкенда — следующий event или ручной pull попозже */ }
        })
      })
    } catch (e) {
      set({ cloudError: e?.message || e?.code || String(e) })
    } finally {
      set({ _bootBusy: false })
    }
  },

  createCompany: async (name, userName) => {
    set({ _creating: true }) // блокируем фоновые bootstrap до завершения
    try {
      const r = await createCompanyCloud(name, userName)
      if (r.ok) await get().bootstrapCloud(undefined, { fromOnboarding: true })
      return r
    } finally {
      set({ _creating: false })
    }
  },

  // вход/регистрация: bootstrap зовём явно один раз (onAuthChange его не триггерит)
  signIn: async (email, password) => {
    const r = await cloudSignIn(email, password)
    if (r.ok) await get().bootstrapCloud()
    return r
  },

  signUp: async (email, password, name) => {
    const r = await cloudSignUp(email, password, name)
    if (r.ok && !r.needConfirm) await get().bootstrapCloud()
    return r
  },

  cloudLogout: async () => {
    if (sseUnsub) { try { sseUnsub() } catch {} sseUnsub = null }
    if (sseDebounce) { clearTimeout(sseDebounce); sseDebounce = null }
    await cloudSignOut()
    set({
      authUserId: null,
      cloudReady: false,
      needOnboarding: false,
      companyId: null,
      companyName: null,
    })
  },

  // Завершить сброс пароля: применить magic-link токен, затем показать логин.
  // Сессии после reset нет (сервер гасит все refresh-семьи), пользователь
  // должен ввести новый пароль на экране входа.
  completePasswordReset: async (newPassword) => {
    const token = get().resetToken
    if (!token) return { ok: false, error: 'Токен сброса не найден' }
    const r = await applyPasswordReset(token, newPassword)
    if (r.ok) {
      // Очистим URL от токена, чтобы обновление страницы не «зациклилось».
      try {
        if (typeof window !== 'undefined') {
          const clean = window.location.pathname + window.location.search
          window.history.replaceState({}, '', clean + '#/')
        }
      } catch {}
      set({ recoveryMode: false, resetToken: null })
    }
    return r
  },
})
