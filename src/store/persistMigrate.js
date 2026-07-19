// Миграция persist-хранилища. При bump `version` в useStore.js добавляем
// сюда очередной блок «if (version < N) { ... }» — он вытянет уже
// сохранённые в браузере пользователей данные к новой схеме без потерь.
//
// Идемпотентно: каждое поле досыпается только если отсутствует. Все
// блоки выполняются последовательно от старой версии к текущей, поэтому
// пользователь на v3 после `if (version < 4)` пойдёт дальше в v5..v9.
import { makeSeed } from './seed'
import { migrateReservationV8 } from '../lib/orders'
import { uid } from '../lib/id'

export function persistMigrate(state, version) {
  if (!state) return state

  if (version < 2) {
    // досыпаем поля авторизации/операций к ранее сохранённым данным
    state.employees = makeSeed().employees
    state.authUserId = null
    state.movements = state.movements || []
    delete state.currentUserId
  }

  if (version < 3) {
    // аудит, смены, поля маркировки/веса
    state.audit = state.audit || []
    state.shifts = state.shifts?.length ? state.shifts : makeSeed().shifts
    state.activeShiftId = state.activeShiftId || null
    const seedById = Object.fromEntries(
      makeSeed().products.map((p) => [p.id, p]),
    )
    state.products = (state.products || []).map((p) => ({
      weighted: false,
      marked: false,
      codes: [],
      plu: seedById[p.id]?.plu,
      ...p,
    }))
  }

  if (version < 4) {
    // категории цен
    const seed = makeSeed()
    state.priceTypes = state.priceTypes?.length ? state.priceTypes : seed.priceTypes
    const pts = state.priceTypes
    const defId = pts.find((t) => t.default)?.id || pts[0]?.id
    const seedPr = Object.fromEntries(seed.products.map((p) => [p.sku, p.prices]))
    state.products = (state.products || []).map((p) => ({
      ...p,
      prices:
        p.prices ||
        seedPr[p.sku] ||
        Object.fromEntries(pts.map((t) => [t.id, p.price || 0])),
    }))
    state.customers = (state.customers || []).map((c) => ({
      ...c,
      priceTypeId: c.priceTypeId || defId,
    }))
  }

  if (version < 5) {
    // несколько складов
    const seed = makeSeed()
    state.warehouses = state.warehouses?.length ? state.warehouses : seed.warehouses
    state.activeWarehouseId = state.activeWarehouseId || seed.activeWarehouseId
    const wh1 = state.warehouses[0]?.id || 'wh1'
    if (!state.cells?.some((c) => c.warehouseId)) {
      state.cells = (state.cells || []).map((c) => ({
        ...c,
        code: c.code || c.id,
        warehouseId: wh1,
      }))
      const extra = seed.cells.filter((c) => c.warehouseId !== wh1)
      state.cells = [...state.cells, ...extra]
    }
    state.products = (state.products || []).map((p) => ({
      ...p,
      warehouseId: p.warehouseId || wh1,
    }))
  }

  if (version < 6) {
    // баланс/долг контрагентов
    const seedC = Object.fromEntries(
      makeSeed().customers.map((c) => [c.id, c.balance]),
    )
    state.customers = (state.customers || []).map((c) => ({
      ...c,
      balance: c.balance ?? seedC[c.id] ?? 0,
    }))
  }

  if (version < 7) {
    // реестр документов
    state.documents = state.documents || []
  }

  if (version < 8) {
    // Резерв остатков. Раньше заказ списывал остаток при создании; теперь
    // открытый заказ лишь резервирует, списание — при отгрузке. Открытым
    // заказам возвращаем остаток и коды маркировки (их удержит резерв),
    // отгруженным ставим stockConsumed=true.
    const migrated = migrateReservationV8(state)
    state.orders = migrated.orders
    state.products = migrated.products
  }

  if (version < 9) {
    // Партионный учёт FIFO: у товара появляется массив batches. Существующий
    // stock превращается в единственную партию по текущей cost с датой
    // конца эпохи — так все последующие приходы уходят в новые партии, а
    // «наследство» списывается первым (как самое старое).
    const at = new Date(0).toISOString() // Unix epoch — заведомо раньше любого нового прихода
    state.products = (state.products || []).map((p) => {
      if (Array.isArray(p.batches)) return p // уже есть (напр., импорт)
      const s = Math.max(0, Number(p.stock) || 0)
      return {
        ...p,
        batches: s > 0 ? [{ id: uid('b'), qty: s, cost: Number(p.cost) || 0, at }] : [],
      }
    })
  }

  if (version < 10) {
    // Типы товарной позиции: product/service/kit. Все существующие товары
    // становятся type='product', components — пустой массив на случай, если
    // потом станут комплектом. Услуги/комплекты добавляются пользователем
    // вручную из карточки.
    state.products = (state.products || []).map((p) => ({
      ...p,
      type: p.type || 'product',
      components: p.components || [],
    }))
  }

  return state
}

// Runtime-флаги, которые НЕ сохраняются в persist. Иначе после reload
// приложение подумает, что оно уже инициализировано, и не пойдёт в
// bootstrapCloud/initAuth заново. 'cloud' обязан выводиться только из env
// (hasApi): застрявшее в снапшоте значение иначе переживает смену конфига.
export const RUNTIME_FLAGS = [
  '_authInited',
  '_bootBusy',
  '_creating',
  'cloud',
  'cloudReady',
  'needOnboarding',
  'recoveryMode',
  'cloudError',
  'syncPending',
  'syncState',
  'syncError',
]

export function persistPartialize(state) {
  const rest = { ...state }
  for (const k of RUNTIME_FLAGS) delete rest[k]
  return rest
}

// Merge при регидрации: старые снапшоты могли успеть сохранить runtime-флаги
// (до добавления ключа в RUNTIME_FLAGS) — вычищаем их и на чтении, иначе они
// перекроют начальное состояние до первой перезаписи снапшота.
export function persistMerge(persisted, current) {
  const clean = { ...persisted }
  for (const k of RUNTIME_FLAGS) delete clean[k]
  return { ...current, ...clean }
}
