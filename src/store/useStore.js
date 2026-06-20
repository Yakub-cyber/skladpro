import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { makeSeed } from './seed'
import { uid, docNo } from '../lib/id'
import { nextStatus, statusInfo } from '../lib/constants'

// Слой данных. Сейчас источник истины — localStorage (persist).
// Чтобы переключиться на реальный API/Supabase, эти actions заменяются
// на сетевые вызовы — компоненты менять не нужно.

export const useStore = create(
  persist(
    (set, get) => ({
      ...makeSeed(), // audit/shifts/activeShiftId приходят отсюда
      authUserId: null, // кто авторизован (null = показать экран входа)

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

      // ── Кассовые смены ───────────────────────────────────────
      openShift: (openingCash = 0) => {
        if (get().activeShiftId) return
        const id = uid('sh')
        set((s) => ({
          shifts: [
            {
              id,
              userId: s.authUserId,
              openedAt: new Date().toISOString(),
              closedAt: null,
              openingCash: Number(openingCash) || 0,
            },
            ...s.shifts,
          ],
          activeShiftId: id,
        }))
        get().logAction('Открыта смена', { section: 'Касса', type: 'shift' })
      },
      closeShift: (closingCash = 0) => {
        const s = get()
        const sh = s.shifts.find((x) => x.id === s.activeShiftId)
        if (!sh) return
        const orders = s.orders.filter(
          (o) => o.shiftId === sh.id && o.status !== 'cancelled',
        )
        const revenue = orders.reduce((a, o) => a + o.total, 0)
        const moves = s.movements.filter(
          (m) => new Date(m.at) >= new Date(sh.openedAt),
        ).length
        set((st) => ({
          shifts: st.shifts.map((x) =>
            x.id === sh.id
              ? {
                  ...x,
                  closedAt: new Date().toISOString(),
                  closingCash: Number(closingCash) || 0,
                  revenue,
                  ordersCount: orders.length,
                  movesCount: moves,
                }
              : x,
          ),
          activeShiftId: null,
        }))
        get().logAction('Закрыта смена', { section: 'Касса', type: 'shift' })
      },

      // ── Товары ───────────────────────────────────────────────
      addProduct: (p) => {
        set((s) => ({
          products: [
            {
              id: uid('p'),
              stock: 0,
              minStock: 0,
              tags: [],
              weighted: false,
              marked: false,
              codes: [],
              ...p,
            },
            ...s.products,
          ],
        }))
        get().logAction(`Добавлен товар «${p.name || 'без названия'}»`, {
          section: 'Товары',
          type: 'create',
        })
      },
      updateProduct: (id, patch) => {
        set((s) => ({
          products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }))
        const p = get().products.find((x) => x.id === id)
        if (p) get().logAction(`Изменён товар «${p.name}»`, { section: 'Товары', type: 'update' })
      },
      removeProduct: (id) => {
        const p = get().products.find((x) => x.id === id)
        set((s) => ({ products: s.products.filter((x) => x.id !== id) }))
        if (p) get().logAction(`Удалён товар «${p.name}»`, { section: 'Товары', type: 'delete' })
      },
      adjustStock: (id, delta) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === id ? { ...p, stock: Math.max(0, p.stock + delta) } : p,
          ),
        })),
      // Приёмка: применить позиции накладной к остаткам
      receiveStock: (items) =>
        set((s) => ({
          products: s.products.map((p) => {
            const it = items.find((x) => x.productId === p.id)
            return it ? { ...p, stock: p.stock + it.qty } : p
          }),
        })),

      // ── Складские операции (с журналом движений) ─────────────
      // Приёмка со сканера/вручную
      receiveOp: (items, note) => {
        set((s) => {
          const moves = items.map((it) => ({
            id: uid('mv'),
            type: 'in',
            productId: it.productId,
            name: it.name,
            qty: it.qty,
            delta: it.qty,
            reason: note || 'Приёмка',
            by: s.authUserId,
            at: new Date().toISOString(),
          }))
          return {
            products: s.products.map((p) => {
              const it = items.find((x) => x.productId === p.id)
              return it ? { ...p, stock: p.stock + it.qty } : p
            }),
            movements: [...moves, ...s.movements],
          }
        })
        const total = items.reduce((a, x) => a + x.qty, 0)
        get().logAction(`Приёмка: ${items.length} поз., ${total} ед.`, {
          section: 'Склад',
          type: 'in',
        })
      },
      // Списание (брак/недостача/порча)
      writeOff: (productId, qty, reason) => {
        const p = get().products.find((x) => x.id === productId)
        if (!p) return
        set((s) => ({
          products: s.products.map((x) =>
            x.id === productId ? { ...x, stock: Math.max(0, x.stock - qty) } : x,
          ),
          movements: [
            {
              id: uid('mv'),
              type: 'writeoff',
              productId,
              name: p.name,
              qty,
              delta: -qty,
              reason: reason || 'Списание',
              by: s.authUserId,
              at: new Date().toISOString(),
            },
            ...s.movements,
          ],
        }))
        get().logAction(`Списание «${p.name}» −${qty} ${p.unit} (${reason || 'Списание'})`, {
          section: 'Склад',
          type: 'writeoff',
        })
      },
      // Возврат на склад (от клиента)
      returnStock: (productId, qty, reason) => {
        const p = get().products.find((x) => x.id === productId)
        if (!p) return
        set((s) => ({
          products: s.products.map((x) =>
            x.id === productId ? { ...x, stock: x.stock + qty } : x,
          ),
          movements: [
            {
              id: uid('mv'),
              type: 'return',
              productId,
              name: p.name,
              qty,
              delta: qty,
              reason: reason || 'Возврат от клиента',
              by: s.authUserId,
              at: new Date().toISOString(),
            },
            ...s.movements,
          ],
        }))
        get().logAction(`Возврат «${p.name}» +${qty} ${p.unit}`, {
          section: 'Склад',
          type: 'return',
        })
      },
      // Инвентаризация: counts = { productId: фактический остаток }
      applyInventory: (counts) => {
        let changed = 0
        set((s) => {
          const moves = []
          const products = s.products.map((p) => {
            if (!(p.id in counts)) return p
            const fact = Number(counts[p.id])
            const delta = fact - p.stock
            if (delta !== 0) {
              changed++
              moves.push({
                id: uid('mv'),
                type: 'inventory',
                productId: p.id,
                name: p.name,
                qty: Math.abs(delta),
                delta,
                reason: delta > 0 ? 'Излишек' : 'Недостача',
                by: s.authUserId,
                at: new Date().toISOString(),
              })
            }
            return { ...p, stock: fact }
          })
          return { products, movements: [...moves, ...s.movements] }
        })
        get().logAction(`Инвентаризация: скорректировано ${changed} поз.`, {
          section: 'Склад',
          type: 'inventory',
        })
      },

      // ── Заказы ───────────────────────────────────────────────
      addOrder: (order) => {
        const id = uid('o')
        set((s) => {
          const seq = s.orders.length + 101
          const o = {
            id,
            no: docNo('ЗК', seq),
            status: 'new',
            createdAt: new Date().toISOString(),
            track: [{ status: 'new', at: new Date().toISOString() }],
            priority: false,
            shiftId: s.activeShiftId || null,
            ...order,
          }
          // резерв остатков + выбытие кодов маркировки «Честный знак»
          const products = s.products.map((p) => {
            const it = (order.items || []).find((x) => x.productId === p.id)
            if (!it) return p
            const np = { ...p, stock: Math.max(0, p.stock - it.qty) }
            if (p.marked && p.codes?.length) {
              np.codes = p.codes.slice(Math.ceil(it.qty)) // первые коды выбывают
            }
            return np
          })
          return { orders: [o, ...s.orders], products }
        })
        const o = get().orders.find((x) => x.id === id)
        get().logAction(`Создан заказ ${o?.no} на ${order.total || 0} ₽`, {
          section: 'Заказы',
          type: 'create',
        })
      },
      setOrderStatus: (id, status, note) => {
        set((s) => ({
          orders: s.orders.map((o) => {
            if (o.id !== id) return o
            const track = [
              ...(o.track || []),
              { status, at: new Date().toISOString(), ...(note ? { note } : {}) },
            ]
            return { ...o, status, track }
          }),
        }))
        const o = get().orders.find((x) => x.id === id)
        get().logAction(`Заказ ${o?.no} → ${statusInfo(status).label}`, {
          section: 'Заказы',
          type: 'update',
        })
      },
      advanceOrder: (id) => {
        const o = get().orders.find((x) => x.id === id)
        const nx = o && nextStatus(o.status)
        if (nx) get().setOrderStatus(id, nx)
      },
      cancelOrder: (id) => {
        const o = get().orders.find((x) => x.id === id)
        set((s) => ({
          orders: s.orders.map((x) =>
            x.id === id
              ? {
                  ...x,
                  status: 'cancelled',
                  track: [
                    ...(x.track || []),
                    { status: 'cancelled', at: new Date().toISOString() },
                  ],
                }
              : x,
          ),
        }))
        get().logAction(`Отменён заказ ${o?.no}`, { section: 'Заказы', type: 'delete' })
      },

      // ── Накладные ────────────────────────────────────────────
      addInvoice: (inv) => {
        set((s) => {
          const seq = s.invoices.length + 1
          return {
            invoices: [
              {
                id: uid('inv'),
                no: docNo(inv.kind === 'in' ? 'ПР' : 'РН', seq),
                createdAt: new Date().toISOString(),
                ...inv,
              },
              ...s.invoices,
            ],
          }
        })
        const created = get().invoices[0]
        get().logAction(
          `Накладная ${created?.no} · ${inv.kind === 'in' ? 'приход' : 'расход'} · ${inv.party}`,
          { section: 'Накладные', type: 'create' },
        )
      },
      removeInvoice: (id) =>
        set((s) => ({ invoices: s.invoices.filter((i) => i.id !== id) })),

      // ── Маркировка «Честный знак» ────────────────────────────
      // Приёмка кодов маркировки (DataMatrix) в пул товара
      addMarkCodes: (productId, codes) => {
        const clean = (Array.isArray(codes) ? codes : [codes])
          .map((c) => String(c).trim())
          .filter(Boolean)
        if (!clean.length) return
        set((s) => ({
          products: s.products.map((p) =>
            p.id === productId
              ? { ...p, codes: [...new Set([...(p.codes || []), ...clean])] }
              : p,
          ),
        }))
        const p = get().products.find((x) => x.id === productId)
        get().logAction(`Маркировка: принято ${clean.length} КМ для «${p?.name}»`, {
          section: 'Маркировка',
          type: 'in',
        })
      },

      // ── Клиенты ──────────────────────────────────────────────
      addCustomer: (c) =>
        set((s) => ({
          customers: [
            {
              id: uid('c'),
              type: 'ООО',
              totalSpent: 0,
              bonus: 0,
              since: new Date().toISOString(),
              ...c,
            },
            ...s.customers,
          ],
        })),
      updateCustomer: (id, patch) =>
        set((s) => ({
          customers: s.customers.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),

      // ── Поставщики ───────────────────────────────────────────
      addSupplier: (sup) =>
        set((s) => ({ suppliers: [{ id: uid('s'), ...sup }, ...s.suppliers] })),

      // ── Сотрудники / роли ────────────────────────────────────
      addEmployee: (e) =>
        set((s) => ({
          employees: [...s.employees, { id: uid('e'), active: true, role: 'stock', ...e }],
        })),
      updateEmployee: (id, patch) =>
        set((s) => ({
          employees: s.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        })),
      removeEmployee: (id) =>
        set((s) => ({
          employees: s.employees.filter((e) => e.id !== id),
          authUserId: s.authUserId === id ? null : s.authUserId,
        })),
      // Авторизация по PIN (клиентская; под реальный бэкенд — заменить на API)
      login: (id, pin) => {
        const e = get().employees.find((x) => x.id === id)
        if (!e) return { ok: false, error: 'Сотрудник не найден' }
        if (!e.active) return { ok: false, error: 'Учётная запись отключена' }
        if (String(e.pin) !== String(pin)) return { ok: false, error: 'Неверный PIN' }
        set({ authUserId: e.id })
        get().logAction('Вход в систему', { section: 'Авторизация', type: 'login' })
        return { ok: true }
      },
      logout: () => {
        get().logAction('Выход из системы', { section: 'Авторизация', type: 'logout' })
        set({ authUserId: null })
      },

      // ── Настройки / прочее ───────────────────────────────────
      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetDemo: () => set((s) => ({ ...makeSeed(), authUserId: s.authUserId })),
    }),
    {
      name: 'sklad.db',
      version: 3,
      migrate: (state, version) => {
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
        return state
      },
    },
  ),
)

// Удобные хуки-селекторы
export const useProducts = () => useStore((s) => s.products)
export const useOrders = () => useStore((s) => s.orders)
export const useCustomers = () => useStore((s) => s.customers)
export const useSettings = () => useStore((s) => s.settings)
