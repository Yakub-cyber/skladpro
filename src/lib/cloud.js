// ──────────────────────────────────────────────────────────────────────────
//  Облачный слой: загрузка/заливка данных в Supabase + автосинхронизация +
//  авторизация. Активен только если задан Supabase (hasSupabase).
//  Стор остаётся локальным кэшем (быстро, оффлайн), а изменения уходят в БД.
// ──────────────────────────────────────────────────────────────────────────
import { supabase, recoveryTokens } from './supabase'
import { createOutbox } from './outbox'

const toSnake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

// storeKey ↔ таблица БД; rename — поля с нестандартным переименованием
const TABLES = [
  { key: 'priceTypes', table: 'price_types', rename: { default: 'is_default' } },
  { key: 'warehouses', table: 'warehouses' },
  { key: 'cells', table: 'cells' },
  { key: 'products', table: 'products' },
  { key: 'customers', table: 'customers' },
  { key: 'suppliers', table: 'suppliers' },
  { key: 'employees', table: 'employees' },
  { key: 'orders', table: 'orders' },
  { key: 'invoices', table: 'invoices' },
  { key: 'documents', table: 'documents' },
  { key: 'movements', table: 'movements' },
  { key: 'shifts', table: 'shifts' },
  { key: 'audit', table: 'audit' },
]
const byKey = Object.fromEntries(TABLES.map((t) => [t.key, t]))

// Таблица ещё не создана в БД (новая фича до применения SQL) — не валим приложение
const isMissingTable = (e) => {
  const m = `${e?.message || ''} ${e?.code || ''}`
  return /PGRST205|42P01|does not exist|find the table|schema cache/i.test(m)
}

function toRow(obj, cfg) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    const col = cfg.rename?.[k] || toSnake(k)
    out[col] = v
  }
  return out
}
function fromRow(row, cfg) {
  const rev = cfg.rename
    ? Object.fromEntries(Object.entries(cfg.rename).map(([a, b]) => [b, a]))
    : {}
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    if (v === null) continue
    const key = rev[k] || toCamel(k)
    out[key] = v
  }
  return out
}

// Загрузить все таблицы из БД. Возвращает объект для стора или null, если пусто.
export async function cloudLoadAll() {
  const result = {}
  let total = 0
  await Promise.all([
    ...TABLES.map(async (cfg) => {
      const { data, error } = await supabase.from(cfg.table).select('*')
      if (error) {
        if (isMissingTable(error)) {
          console.warn('cloudLoad: таблица отсутствует, пропуск', cfg.table)
          result[cfg.key] = []
          return
        }
        throw error
      }
      result[cfg.key] = (data || []).map((r) => fromRow(r, cfg))
      total += result[cfg.key].length
    }),
    // настройки компании — одна jsonb-строка на компанию (RLS сузит выборку);
    // в total не считаем: пустая компания определяется по таблицам данных
    (async () => {
      const { data, error } = await supabase.from('settings').select('data').maybeSingle()
      if (error) {
        if (isMissingTable(error)) return // миграция ещё не применена
        throw error
      }
      if (data?.data) result.settings = data.data
    })(),
  ])
  return total > 0 ? result : null
}

// Сделать id seed-записей уникальными для компании (иначе фиксированные id
// вроде pt_retail / wh1 / A1 конфликтуют между тенантами по первичному ключу).
// Префиксуем id и все ссылки на них; коды ячеек (cell) остаются как есть.
export function remapSeedForCompany(state, companyId) {
  const p = companyId.slice(0, 8) + '_'
  const rid = (id) => (id ? p + id : id)
  const remapItems = (items) =>
    (items || []).map((it) => ({ ...it, productId: rid(it.productId) }))
  return {
    ...state,
    priceTypes: state.priceTypes.map((t) => ({ ...t, id: rid(t.id) })),
    warehouses: state.warehouses.map((w) => ({ ...w, id: rid(w.id) })),
    cells: state.cells.map((c) => ({ ...c, id: rid(c.id), warehouseId: rid(c.warehouseId) })),
    products: state.products.map((pr) => ({
      ...pr,
      id: rid(pr.id),
      warehouseId: rid(pr.warehouseId),
      prices: Object.fromEntries(
        Object.entries(pr.prices || {}).map(([k, v]) => [rid(k), v]),
      ),
    })),
    customers: state.customers.map((c) => ({ ...c, id: rid(c.id), priceTypeId: rid(c.priceTypeId) })),
    suppliers: state.suppliers.map((s) => ({ ...s, id: rid(s.id) })),
    employees: state.employees.map((e) => ({ ...e, id: rid(e.id) })),
    orders: state.orders.map((o) => ({
      ...o,
      id: rid(o.id),
      customerId: rid(o.customerId),
      priceTypeId: rid(o.priceTypeId),
      assignedTo: rid(o.assignedTo),
      items: remapItems(o.items),
    })),
    invoices: state.invoices.map((i) => ({
      ...i,
      id: rid(i.id),
      partyId: rid(i.partyId),
      priceTypeId: rid(i.priceTypeId),
      items: remapItems(i.items),
    })),
    documents: (state.documents || []).map((d) => ({
      ...d,
      id: rid(d.id),
      toWarehouseId: rid(d.toWarehouseId),
      items: remapItems(d.items),
    })),
    movements: state.movements.map((m) => ({ ...m, id: rid(m.id), productId: rid(m.productId) })),
    shifts: state.shifts.map((s) => ({ ...s, id: rid(s.id) })),
    audit: state.audit.map((a) => ({ ...a, id: rid(a.id) })),
  }
}

// Явно записать одну сущность в БД (autosync стартует позже и пропустил бы её)
export async function cloudUpsert(storeKey, obj, companyId) {
  const cfg = TABLES.find((t) => t.key === storeKey)
  if (!cfg) return
  const { error } = await supabase.from(cfg.table).upsert({ ...toRow(obj, cfg), company_id: companyId })
  if (error) throw error
}

// Залить начальное состояние (seed) в БД, пометив записи компанией
export async function cloudSeed(state, companyId) {
  for (const cfg of TABLES) {
    const rows = (state[cfg.key] || []).map((o) => ({ ...toRow(o, cfg), company_id: companyId }))
    if (!rows.length) continue
    const { error } = await supabase.from(cfg.table).upsert(rows)
    if (error) {
      if (isMissingTable(error)) {
        console.warn('cloudSeed: таблица отсутствует, пропуск', cfg.table)
        continue
      }
      throw error
    }
  }
}

// ── Автосинхронизация: diff коллекций стора → персистентный outbox → БД ──────
//  Изменения стора попадают в outbox (localStorage) и удаляются оттуда только
//  после подтверждения сервера; неудачи ретраятся с бэкоффом (см. outbox.js).
const snap = (state) =>
  Object.fromEntries(
    TABLES.map((t) => [
      t.key,
      new Map((state[t.key] || []).map((o) => [o.id, o])),
    ]),
  )

// Локальные секреты не выгружаем в облако: ключ ИИ по задумке живёт только
// в браузере (см. ai.js) — в облачной строке настроек его быть не должно.
const LOCAL_ONLY_SETTINGS = ['aiKey']
const settingsForCloud = (s = {}) => {
  const out = { ...s }
  for (const k of LOCAL_ONLY_SETTINGS) delete out[k]
  return out
}

// Неисправимая ошибка: ретраить бессмысленно, элемент выбрасываем с warn.
// 42xxx — права/несуществующий объект, 23xxx — нарушение ограничений,
// PGRST204 — неизвестная колонка (миграция не применена).
const isPermanentError = (e) => {
  const code = String(e?.code || '')
  return isMissingTable(e) || /^(42|23)\d+/.test(code) || code === 'PGRST204'
}

// Транспорт outbox: батч → upsert/delete по таблицам.
// Возвращает { sent, dropped, error }: sent — подтверждено сервером,
// dropped — неисправимые (не ретраим), error — транзиент (оставить и повторить).
async function sendBatch(items) {
  const sent = []
  const dropped = []
  let error = null
  // группируем по (таблица, компания, операция) — company_id важен, если
  // элемент остался в очереди от прошлой сессии другой компании
  const groups = new Map()
  for (const it of items) {
    const gk = `${it.key}|${it.companyId}|${it.op}`
    ;(groups.get(gk) || groups.set(gk, []).get(gk)).push(it)
  }
  for (const group of groups.values()) {
    const { key, companyId, op } = group[0]
    let res
    if (key === 'settings') {
      res = await supabase
        .from('settings')
        .upsert({ company_id: companyId, data: group[group.length - 1].obj })
    } else {
      const cfg = byKey[key]
      if (!cfg) {
        dropped.push(...group)
        continue
      }
      res =
        op === 'delete'
          ? await supabase.from(cfg.table).delete().in('id', group.map((it) => it.id))
          : await supabase
              .from(cfg.table)
              .upsert(group.map((it) => ({ ...toRow(it.obj, cfg), company_id: companyId })))
    }
    if (!res.error) sent.push(...group)
    else if (isPermanentError(res.error)) {
      console.warn('sync: неисправимая ошибка, пропуск', key, res.error.message)
      dropped.push(...group)
    } else error = res.error // транзиент: элементы остаются в очереди
  }
  return { sent, dropped, error }
}

// Единственный экземпляр очереди (экспорт — для тестов и служебных нужд)
export const syncOutbox = createOutbox({ send: sendBatch })
export const syncNow = () => syncOutbox.flushNow()

// вернулась сеть → досылаем сразу, не дожидаясь бэкоффа
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => syncOutbox.flushNow())
}

let attached = false
let paused = false
let prev = null
let prevSettings = null

// На время применения серверных данных (bootstrap) захват отключаем, иначе
// загруженное эхом уедет обратно в облако и раздует очередь.
export function pauseSync() {
  paused = true
}
export function resumeSync(useStore) {
  paused = false
  if (!attached) return
  const s = useStore.getState()
  prev = snap(s)
  prevSettings = s.settings
}

export function attachSync(useStore) {
  if (attached) return
  attached = true
  const st = useStore.getState()
  prev = snap(st)
  prevSettings = st.settings
  // статус очереди → стор (индикатор в шапке)
  syncOutbox.onChange(({ pending, state, error }) =>
    useStore.setState({ syncPending: pending, syncState: state, syncError: error }),
  )
  useStore.subscribe((state) => {
    if (paused) return
    const companyId = state.companyId
    if (!companyId) return // без компании не синхронизируем
    const batch = []
    for (const cfg of TABLES) {
      const next = new Map((state[cfg.key] || []).map((o) => [o.id, o]))
      const old = prev[cfg.key]
      // новые / изменённые
      for (const [id, obj] of next) {
        const before = old.get(id)
        if (!before || before !== obj) batch.push({ op: 'upsert', key: cfg.key, id, obj, companyId })
      }
      // удалённые
      for (const id of old.keys())
        if (!next.has(id)) batch.push({ op: 'delete', key: cfg.key, id, companyId })
    }
    if (state.settings !== prevSettings)
      batch.push({
        op: 'upsert',
        key: 'settings',
        id: companyId,
        obj: settingsForCloud(state.settings),
        companyId,
      })
    if (!batch.length) return
    // Снапшот двигаем только после того, как изменения надёжно захвачены
    // персистентной очередью; иначе следующий diff захватит их повторно
    // (компакция по id делает это безопасным).
    if (syncOutbox.enqueue(batch)) {
      prev = snap(state)
      prevSettings = state.settings
    }
  })
}

// ── Загрузка с учётом неотправленного ─────────────────────────────────────────
// Порядок bootstrap: сначала дослать локальную очередь (иначе чтение перетрёт
// несинхронизированные правки), затем читать сервер. Если дослать не удалось
// (офлайн) — читаем, но накладываем неотправленное поверх: локальное побеждает,
// outbox доставит его позже.
export async function cloudLoadMerged() {
  await syncOutbox.flushNow().catch(() => {})
  const data = await cloudLoadAll()
  const pending = syncOutbox.items()
  if (data && pending.length) applyPendingToData(data, pending)
  return data
}

export function applyPendingToData(data, pending) {
  for (const it of pending) {
    if (it.key === 'settings') {
      if (it.op === 'upsert') data.settings = { ...(data.settings || {}), ...it.obj }
      continue
    }
    const arr = data[it.key]
    if (!Array.isArray(arr)) continue
    const i = arr.findIndex((r) => r.id === it.id)
    if (it.op === 'delete') {
      if (i >= 0) arr.splice(i, 1)
    } else if (i >= 0) arr[i] = it.obj
    else arr.push(it.obj)
  }
  return data
}

// ── Компании (тенанты) ───────────────────────────────────────────────────────
// Текущее членство пользователя: { company_id, role, name, companies:{name} } | null
export async function getMembership() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('memberships')
    .select('company_id, role, name, companies(name, plan)')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle()
  if (error) throw error
  return data
}

// Онбординг: создать компанию + членство атомарно через серверную RPC
// (обходит гонку RLS: select компании до появления членства).
export async function createCompanyCloud(companyName, userName) {
  const { data, error } = await supabase.rpc('create_company', {
    p_name: companyName,
    p_user_name: userName || null,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, companyId: data }
}

// Принять приглашение (если пользователь приглашён в компанию) → company_id | null
export async function acceptInvitation() {
  const { data, error } = await supabase.rpc('accept_invitation')
  if (error) return null
  return data
}

// ── Команда: участники и приглашения ─────────────────────────────────────────
export async function loadMembers() {
  const { data } = await supabase
    .from('memberships')
    .select('user_id, role, name, active, created_at')
  return data || []
}
export async function loadInvites() {
  const { data } = await supabase.from('invitations').select('id, email, role, name, created_at')
  return data || []
}
export async function inviteMember(companyId, email, role, name) {
  const { error } = await supabase.from('invitations').insert({
    company_id: companyId,
    email: email.trim().toLowerCase(),
    role,
    name: name || null,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
export async function revokeInvite(id) {
  await supabase.from('invitations').delete().eq('id', id)
}
export async function updateMemberRole(userId, companyId, role) {
  await supabase.from('memberships').update({ role }).eq('user_id', userId).eq('company_id', companyId)
}
export async function removeMember(userId, companyId) {
  await supabase.from('memberships').delete().eq('user_id', userId).eq('company_id', companyId)
}

// ── Пароль ───────────────────────────────────────────────────────────────────
export async function changePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { ok: false, error: ruAuthError(error.message) }
  return { ok: true }
}
export async function requestPasswordReset(email) {
  const redirectTo = window.location.origin + window.location.pathname
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
  if (error) return { ok: false, error: ruAuthError(error.message) }
  return { ok: true }
}

// Переход по ссылке из письма сброса: recoveryTokens захвачены в supabase.js
// при загрузке модуля (до того, как HashRouter перепишет hash).
export async function checkRecovery() {
  if (!recoveryTokens?.access_token) return false
  const { error } = await supabase.auth.setSession(recoveryTokens)
  return !error
}

// ── Авторизация (Supabase Auth, email + пароль) ──────────────────────────────
export async function getCloudSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
}

// Подписка на события авторизации. Передаём event, чтобы отличить выход.
export function onAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(event, session))
  return () => data.subscription.unsubscribe()
}

export async function cloudSignIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) return { ok: false, error: ruAuthError(error.message) }
  return { ok: true }
}

export async function cloudSignUp(email, password, name) {
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
  if (error) return { ok: false, error: ruAuthError(error.message) }
  // если в Supabase включено подтверждение email — сессии сразу нет
  if (!data.session) return { ok: true, needConfirm: true }
  return { ok: true, user: data.user, name }
}

export async function cloudSignOut() {
  await supabase.auth.signOut()
}

function ruAuthError(m = '') {
  const s = m.toLowerCase()
  if (s.includes('invalid login')) return 'Неверный email или пароль'
  if (s.includes('already registered')) return 'Этот email уже зарегистрирован'
  if (s.includes('password')) return 'Пароль слишком короткий (мин. 6 символов)'
  if (s.includes('email')) return 'Некорректный email'
  return m
}
