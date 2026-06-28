// ──────────────────────────────────────────────────────────────────────────
//  Облачный слой: загрузка/заливка данных в Supabase + автосинхронизация +
//  авторизация. Активен только если задан Supabase (hasSupabase).
//  Стор остаётся локальным кэшем (быстро, оффлайн), а изменения уходят в БД.
// ──────────────────────────────────────────────────────────────────────────
import { supabase, recoveryTokens } from './supabase'

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
  await Promise.all(
    TABLES.map(async (cfg) => {
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
  )
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

// ── Автосинхронизация: diff коллекций стора → upsert/delete в БД ─────────────
const snap = (state) =>
  Object.fromEntries(
    TABLES.map((t) => [
      t.key,
      new Map((state[t.key] || []).map((o) => [o.id, o])),
    ]),
  )

let queue = [] // { op:'upsert'|'delete', cfg, row|id }
let timer = null
function flush() {
  timer = null
  const batch = queue
  queue = []
  // группируем по таблице
  for (const cfg of TABLES) {
    const ups = batch.filter((b) => b.cfg === cfg && b.op === 'upsert').map((b) => b.row)
    const dels = batch.filter((b) => b.cfg === cfg && b.op === 'delete').map((b) => b.id)
    if (ups.length) supabase.from(cfg.table).upsert(ups).then(({ error }) => error && console.warn('sync upsert', cfg.table, error.message))
    if (dels.length) supabase.from(cfg.table).delete().in('id', dels).then(({ error }) => error && console.warn('sync delete', cfg.table, error.message))
  }
}
function enqueue(item) {
  queue.push(item)
  if (!timer) timer = setTimeout(flush, 400)
}

let attached = false
export function attachSync(useStore) {
  if (attached) return
  attached = true
  let prev = snap(useStore.getState())
  useStore.subscribe((state) => {
    const companyId = state.companyId
    if (!companyId) return // без компании не синхронизируем
    for (const cfg of TABLES) {
      const next = new Map((state[cfg.key] || []).map((o) => [o.id, o]))
      const old = prev[cfg.key]
      // новые / изменённые
      for (const [id, obj] of next) {
        const before = old.get(id)
        if (!before || before !== obj)
          enqueue({ op: 'upsert', cfg, row: { ...toRow(obj, cfg), company_id: companyId } })
      }
      // удалённые
      for (const id of old.keys()) if (!next.has(id)) enqueue({ op: 'delete', cfg, id })
    }
    prev = snap(state)
  })
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
