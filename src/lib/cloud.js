// ──────────────────────────────────────────────────────────────────────────
//  Облачный слой: загрузка/заливка данных в Supabase + автосинхронизация +
//  авторизация. Активен только если задан Supabase (hasSupabase).
//  Стор остаётся локальным кэшем (быстро, оффлайн), а изменения уходят в БД.
// ──────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase'

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
  { key: 'movements', table: 'movements' },
  { key: 'shifts', table: 'shifts' },
  { key: 'audit', table: 'audit' },
]
const byKey = Object.fromEntries(TABLES.map((t) => [t.key, t]))

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
      if (error) throw error
      result[cfg.key] = (data || []).map((r) => fromRow(r, cfg))
      total += result[cfg.key].length
    }),
  )
  return total > 0 ? result : null
}

// Залить начальное состояние (seed) в БД, пометив записи компанией
export async function cloudSeed(state, companyId) {
  for (const cfg of TABLES) {
    const rows = (state[cfg.key] || []).map((o) => ({ ...toRow(o, cfg), company_id: companyId }))
    if (!rows.length) continue
    const { error } = await supabase.from(cfg.table).upsert(rows)
    if (error) throw error
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

// Онбординг: создать компанию + сделать текущего пользователя её админом
export async function createCompanyCloud(companyName, userName) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Нет сессии' }
  const { data: company, error: e1 } = await supabase
    .from('companies')
    .insert({ name: companyName })
    .select()
    .single()
  if (e1) return { ok: false, error: e1.message }
  const { error: e2 } = await supabase.from('memberships').insert({
    user_id: user.id,
    company_id: company.id,
    role: 'admin',
    name: userName || user.email?.split('@')[0] || 'Администратор',
  })
  if (e2) return { ok: false, error: e2.message }
  return { ok: true, company }
}

// ── Авторизация (Supabase Auth, email + пароль) ──────────────────────────────
export async function getCloudSession() {
  const { data } = await supabase.auth.getSession()
  return data.session
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
