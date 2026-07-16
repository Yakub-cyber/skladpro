import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { makeSeed } from './seed'
import { uid, docNo } from '../lib/id'
import { nextStatus, statusInfo, docTypeInfo, DEFAULT_WORK_ZONES } from '../lib/constants'
import { applyDocToState } from '../lib/posting'
import { applyOrderStock } from '../lib/orders'
import { persistMigrate, persistPartialize } from './persistMigrate'
import { createHrSlice } from './slices/hrSlice'
import { createCloudSlice, cloudInitialState, bindStore } from './slices/cloudSlice'

// Слой данных. Сейчас источник истины — localStorage (persist).
// Чтобы переключиться на реальный API/Supabase, эти actions заменяются
// на сетевые вызовы — компоненты менять не нужно.

export const useStore = create(
  persist(
    (set, get) => ({
      ...makeSeed(), // audit/shifts/activeShiftId приходят отсюда
      ...cloudInitialState, // authUserId, cloud, companyId, runtime-флаги…

      // ── Облако (Supabase, мультитенант) — см. slices/cloudSlice.js ──
      ...createCloudSlice(set, get),

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
        const pts = get().priceTypes || []
        const prices =
          p.prices || Object.fromEntries(pts.map((t) => [t.id, p.price || 0]))
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
              prices,
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
      // Списание (брак/недостача/порча). Возвращает { ok, error? } — UI
      // должен показать причину отказа. Без проверки списание молча уходило
      // в ноль (Math.max), скрывая от пользователя расхождение с фактом.
      writeOff: (productId, qty, reason) => {
        const p = get().products.find((x) => x.id === productId)
        if (!p) return { ok: false, error: 'Товар не найден' }
        const n = Number(qty) || 0
        if (n <= 0) return { ok: false, error: 'Укажите количество' }
        if (n > p.stock)
          return {
            ok: false,
            error: `Списание превышает остаток: ${p.stock} ${p.unit || 'шт'}`,
          }
        set((s) => ({
          products: s.products.map((x) =>
            x.id === productId ? { ...x, stock: x.stock - n } : x,
          ),
          movements: [
            {
              id: uid('mv'),
              type: 'writeoff',
              productId,
              name: p.name,
              qty: n,
              delta: -n,
              reason: reason || 'Списание',
              by: s.authUserId,
              at: new Date().toISOString(),
            },
            ...s.movements,
          ],
        }))
        get().logAction(`Списание «${p.name}» −${n} ${p.unit} (${reason || 'Списание'})`, {
          section: 'Склад',
          type: 'writeoff',
        })
        return { ok: true }
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
      // Возврат поставщику (закупленный товар уходит со склада).
      // Как и writeOff — возвращает { ok, error? } и блокирует превышение.
      supplierReturn: (productId, qty, reason) => {
        const p = get().products.find((x) => x.id === productId)
        if (!p) return { ok: false, error: 'Товар не найден' }
        const n = Number(qty) || 0
        if (n <= 0) return { ok: false, error: 'Укажите количество' }
        if (n > p.stock)
          return {
            ok: false,
            error: `Возврат превышает остаток: ${p.stock} ${p.unit || 'шт'}`,
          }
        set((s) => ({
          products: s.products.map((x) =>
            x.id === productId ? { ...x, stock: x.stock - n } : x,
          ),
          movements: [
            {
              id: uid('mv'),
              type: 'supplier_return',
              productId,
              name: p.name,
              qty: n,
              delta: -n,
              reason: reason || 'Возврат поставщику',
              by: s.authUserId,
              at: new Date().toISOString(),
            },
            ...s.movements,
          ],
        }))
        get().logAction(`Возврат поставщику «${p.name}» −${n} ${p.unit}`, {
          section: 'Склад',
          type: 'supplier_return',
        })
        return { ok: true }
      },
      // Перемещение между складами/ячейками (общий остаток не меняется)
      transferStock: (productId, toWarehouseId, toCell, qty) => {
        const p = get().products.find((x) => x.id === productId)
        if (!p) return
        const whName = (id) => get().warehouses?.find((w) => w.id === id)?.name || '—'
        const from = `${whName(p.warehouseId)}${p.cell ? ' · ' + p.cell : ''}`
        const to = `${whName(toWarehouseId)}${toCell ? ' · ' + toCell : ''}`
        set((s) => ({
          products: s.products.map((x) =>
            x.id === productId
              ? { ...x, warehouseId: toWarehouseId || x.warehouseId, cell: toCell || x.cell }
              : x,
          ),
          movements: [
            {
              id: uid('mv'),
              type: 'transfer',
              productId,
              name: p.name,
              qty: qty || p.stock,
              delta: 0,
              reason: `Перемещение: ${from} → ${to}`,
              by: s.authUserId,
              at: new Date().toISOString(),
            },
            ...s.movements,
          ],
        }))
        get().logAction(`Перемещение «${p.name}»: ${from} → ${to}`, {
          section: 'Склад',
          type: 'transfer',
        })
      },

      // ── Документы (реестр складских документов) ───────────────
      // doc: { type, items:[{productId,name,unit,qty,(prevStock|fromWh)}], toWarehouseId?, reason?, note? }
      // opts.post=false → черновик (без влияния на остатки)
      // Возвращает id (успех) или { ok: false, error } — превышение остатка
      // на списании/продаже/возврате поставщику блокируется, чтобы не
      // прятать расхождение с фактом через Math.max(0, ...).
      addDocument: (doc, opts = {}) => {
        const post = opts.post !== false
        const type = doc.type
        const items = doc.items || []
        // Предпроверка остатков — только для типов, которые списывают со
        // склада, и только при проведении. Draft можно сохранить в минус.
        if (post && (type === 'sale' || type === 'writeoff' || type === 'supplier_return')) {
          const products = get().products
          for (const it of items) {
            const p = products.find((x) => x.id === it.productId)
            const need = Number(it.qty) || 0
            const have = p ? p.stock : 0
            if (need > have) {
              const label = docTypeInfo(type).label
              return {
                ok: false,
                error: `${label}: «${it.name}» — не хватает остатка (${have} из ${need} ${p?.unit || 'шт'})`,
              }
            }
          }
        }
        const id = uid('doc')
        set((s) => {
          const seq = s.documents.filter((d) => d.type === type).length + 1
          const header = {
            id,
            no: docNo(docTypeInfo(type).prefix, seq),
            type,
            status: post ? 'posted' : 'draft',
            items: items.map((it) => ({ ...it })),
            toWarehouseId: doc.toWarehouseId || null,
            reason: doc.reason || '',
            note: doc.note || '',
            totalQty: items.reduce((a, x) => a + (Number(x.qty) || 0), 0),
            by: s.authUserId,
            createdAt: new Date().toISOString(),
            postedAt: post ? new Date().toISOString() : null,
            cancelledAt: null,
          }
          const base = { documents: [header, ...s.documents] }
          return post ? { ...base, ...applyDocToState(s, header, 1, s.authUserId) } : base
        })
        const d = get().documents.find((x) => x.id === id)
        get().logAction(
          `Документ ${d?.no} · ${docTypeInfo(type).label} ${post ? 'проведён' : '— черновик'}`,
          { section: 'Документы', type: post ? 'create' : 'draft' },
        )
        return id
      },
      // Провести черновик
      postDocument: (id) => {
        const d = get().documents.find((x) => x.id === id)
        if (!d || d.status !== 'draft') return
        set((s) => ({
          ...applyDocToState(s, d, 1, s.authUserId),
          documents: s.documents.map((x) =>
            x.id === id ? { ...x, status: 'posted', postedAt: new Date().toISOString() } : x,
          ),
        }))
        get().logAction(`Документ ${d.no} проведён`, { section: 'Документы', type: 'update' })
      },
      // Отменить проводку (откатить влияние на остатки)
      cancelDocument: (id) => {
        const d = get().documents.find((x) => x.id === id)
        if (!d || d.status !== 'posted') return
        set((s) => ({
          ...applyDocToState(s, d, -1, s.authUserId),
          documents: s.documents.map((x) =>
            x.id === id ? { ...x, status: 'cancelled', cancelledAt: new Date().toISOString() } : x,
          ),
        }))
        get().logAction(`Отменён документ ${d.no}`, { section: 'Документы', type: 'delete' })
      },
      // Удалить документ (только черновик или отменённый — проведённый сначала отменить)
      removeDocument: (id) => {
        const d = get().documents.find((x) => x.id === id)
        if (!d || d.status === 'posted') return
        set((s) => ({ documents: s.documents.filter((x) => x.id !== id) }))
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
            stockConsumed: false, // физически спишется при отгрузке
            ...order,
          }
          // Заказ резервирует остаток (через открытый статус), физически со
          // склада не списывает — это произойдёт при отгрузке. Долг «в долг»
          // начисляем сразу.
          let customers = s.customers
          if (o.onCredit && o.customerId) {
            customers = s.customers.map((c) =>
              c.id === o.customerId ? { ...c, balance: (c.balance || 0) + (o.total || 0) } : c,
            )
          }
          return { orders: [o, ...s.orders], customers }
        })
        const o = get().orders.find((x) => x.id === id)
        get().logAction(`Создан заказ ${o?.no} на ${order.total || 0} ₽ (резерв)`, {
          section: 'Заказы',
          type: 'create',
        })
      },
      setOrderStatus: (id, status, note) => {
        set((s) => {
          const o = s.orders.find((x) => x.id === id)
          if (!o) return {}
          const track = [
            ...(o.track || []),
            { status, at: new Date().toISOString(), ...(note ? { note } : {}) },
          ]
          // Отгрузка (shipped/delivered) → физическое списание со склада и
          // выбытие кодов маркировки. Один раз (флаг stockConsumed).
          const shipNow = (status === 'shipped' || status === 'delivered') && !o.stockConsumed
          if (shipNow) {
            const { products, order: consumed } = applyOrderStock(s, o, -1)
            return {
              products,
              orders: s.orders.map((x) =>
                x.id === id ? { ...consumed, status, stockConsumed: true, track } : x,
              ),
            }
          }
          return {
            orders: s.orders.map((x) => (x.id === id ? { ...x, status, track } : x)),
          }
        })
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
      // Редактирование заказа до отгрузки. Разрешено только пока
      // stockConsumed=false и статус не cancelled — иначе правка сломает
      // проведённое списание/долг. Резерв на складе вычисляется на лету
      // (reservedByProduct → открытые заказы), поэтому меняется автоматом
      // при новых items. Долг «в долг» корректируем на дельту total.
      updateOrder: (id, patch) => {
        const o = get().orders.find((x) => x.id === id)
        if (!o) return { ok: false, error: 'Заказ не найден' }
        if (o.stockConsumed || o.status === 'cancelled') {
          return { ok: false, error: 'Заказ уже отгружен или отменён — редактирование недоступно' }
        }
        set((s) => {
          const next = { ...o, ...patch }
          const oldDebt = o.onCredit ? o.total || 0 : 0
          const newDebt = next.onCredit ? next.total || 0 : 0
          const debtDelta = newDebt - oldDebt
          let customers = s.customers
          if (debtDelta !== 0 && next.customerId) {
            customers = s.customers.map((c) =>
              c.id === next.customerId
                ? { ...c, balance: Math.max(0, (c.balance || 0) + debtDelta) }
                : c,
            )
          }
          return {
            orders: s.orders.map((x) => (x.id === id ? next : x)),
            customers,
          }
        })
        get().logAction(`Заказ ${o.no} изменён`, { section: 'Заказы', type: 'update' })
        return { ok: true }
      },
      cancelOrder: (id, note) => {
        const o = get().orders.find((x) => x.id === id)
        if (!o || o.status === 'cancelled') return // идемпотентность: не откатываем дважды
        set((s) => {
          // Если заказ уже отгружен — возвращаем остаток и коды на склад.
          // Если ещё не отгружен — просто снимаем резерв (через статус).
          let products = s.products
          if (o.stockConsumed) {
            products = applyOrderStock(s, o, 1).products
          }
          // Реверс долга «в долг».
          let customers = s.customers
          if (o.onCredit && o.customerId) {
            customers = s.customers.map((c) =>
              c.id === o.customerId ? { ...c, balance: Math.max(0, (c.balance || 0) - (o.total || 0)) } : c,
            )
          }
          return {
            products,
            customers,
            orders: s.orders.map((x) =>
              x.id === id
                ? {
                    ...x,
                    status: 'cancelled',
                    track: [
                      ...(x.track || []),
                      { status: 'cancelled', at: new Date().toISOString(), ...(note ? { note } : {}) },
                    ],
                  }
                : x,
            ),
          }
        })
        get().logAction(
          `Отменён заказ ${o.no} · ${o.stockConsumed ? 'остатки возвращены' : 'резерв снят'}`,
          { section: 'Заказы', type: 'delete' },
        )
      },
      // Назначить заказ конкретному курьеру (сотруднику) — он видит только свои
      assignCourier: (id, employeeId) => {
        const o = get().orders.find((x) => x.id === id)
        const emp = get().employees.find((e) => e.id === employeeId)
        set((s) => ({
          orders: s.orders.map((x) =>
            x.id === id ? { ...x, assignedTo: employeeId || null } : x,
          ),
        }))
        get().logAction(
          employeeId ? `Курьер «${emp?.name}» назначен на ${o?.no}` : `Снято назначение с ${o?.no}`,
          { section: 'Доставка' },
        )
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
      addCustomer: (c) => {
        const def = get().priceTypes?.find((t) => t.default)?.id || 'pt_retail'
        set((s) => ({
          customers: [
            {
              id: uid('c'),
              type: 'ООО',
              totalSpent: 0,
              bonus: 0,
              since: new Date().toISOString(),
              priceTypeId: def,
              ...c,
            },
            ...s.customers,
          ],
        }))
      },
      updateCustomer: (id, patch) =>
        set((s) => ({
          customers: s.customers.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      // Приём оплаты — гасит задолженность контрагента
      addPayment: (customerId, amount) => {
        const a = Number(amount) || 0
        if (a <= 0) return
        set((s) => ({
          customers: s.customers.map((c) =>
            c.id === customerId ? { ...c, balance: Math.max(0, (c.balance || 0) - a) } : c,
          ),
        }))
        const c = get().customers.find((x) => x.id === customerId)
        get().logAction(`Оплата от «${c?.name}»: ${a} ₽`, { section: 'Финансы', type: 'in' })
      },

      // ── Поставщики ───────────────────────────────────────────
      addSupplier: (sup) =>
        set((s) => ({ suppliers: [{ id: uid('s'), ...sup }, ...s.suppliers] })),

      // ── Категории цен ────────────────────────────────────────
      addPriceType: (pt) => {
        const id = uid('pt')
        set((s) => ({
          priceTypes: [...s.priceTypes, { id, color: '#94a3b8', ...pt }],
          // у всех товаров новая категория = базовая цена
          products: s.products.map((p) => ({
            ...p,
            prices: { ...p.prices, [id]: p.prices?.[id] ?? p.price ?? 0 },
          })),
        }))
        get().logAction(`Добавлена категория цен «${pt.name}»`, { section: 'Цены', type: 'create' })
      },
      updatePriceType: (id, patch) =>
        set((s) => ({
          priceTypes: s.priceTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),
      removePriceType: (id) =>
        set((s) => {
          if (s.priceTypes.find((t) => t.id === id)?.default) return {}
          return { priceTypes: s.priceTypes.filter((t) => t.id !== id) }
        }),
      setDefaultPriceType: (id) =>
        set((s) => ({
          priceTypes: s.priceTypes.map((t) => ({ ...t, default: t.id === id })),
        })),
      // Установить цену товара по категории
      setProductPrice: (productId, priceTypeId, value) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === productId
              ? { ...p, prices: { ...p.prices, [priceTypeId]: Number(value) || 0 } }
              : p,
          ),
        })),

      // ── Склады и ячейки (редактор размещения) ────────────────
      setActiveWarehouse: (id) => set({ activeWarehouseId: id }),
      addWarehouse: (w) => {
        const id = uid('wh')
        set((s) => ({ warehouses: [...s.warehouses, { id, ...w }], activeWarehouseId: id }))
        get().logAction(`Добавлен склад «${w.name}»`, { section: 'Склады', type: 'create' })
      },
      removeWarehouse: (id) =>
        set((s) => {
          if (s.warehouses.length <= 1) return {}
          const hasGoods = s.products.some((p) => p.warehouseId === id)
          if (hasGoods) return {} // нельзя удалить склад с товарами
          return {
            warehouses: s.warehouses.filter((w) => w.id !== id),
            cells: s.cells.filter((c) => c.warehouseId !== id),
            activeWarehouseId:
              s.activeWarehouseId === id
                ? s.warehouses.find((w) => w.id !== id)?.id
                : s.activeWarehouseId,
          }
        }),
      addCell: (cell) =>
        set((s) => ({
          cells: [
            ...s.cells,
            {
              id: uid('cell'),
              warehouseId: s.activeWarehouseId,
              zone: cell.code?.[0]?.toUpperCase() || 'A',
              ...cell,
            },
          ],
        })),
      updateCell: (id, patch) =>
        set((s) => ({
          cells: s.cells.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      removeCell: (id) =>
        set((s) => ({ cells: s.cells.filter((c) => c.id !== id) })),
      // Переместить рабочую зону (Приёмка/Выдача/Сборка) на карте склада.
      // Хранится в warehouse.workZones (миграция v10). Если у склада ещё нет
      // своих зон, копируем DEFAULT_WORK_ZONES и правим нужную.
      setWorkZone: (warehouseId, zoneId, patch) =>
        set((s) => ({
          warehouses: s.warehouses.map((w) => {
            if (w.id !== warehouseId) return w
            const current = Array.isArray(w.workZones) && w.workZones.length
              ? w.workZones
              : DEFAULT_WORK_ZONES.map((z) => ({ ...z }))
            return {
              ...w,
              workZones: current.map((z) => (z.id === zoneId ? { ...z, ...patch } : z)),
            }
          }),
        })),
      // Переместить товар в другую ячейку/склад
      moveProduct: (productId, warehouseId, cellCode) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === productId ? { ...p, warehouseId, cell: cellCode } : p,
          ),
        })),

      // ── Сотрудники / роли + PIN — см. slices/hrSlice.js ─────
      ...createHrSlice(set, get),

      // ── Настройки / прочее ───────────────────────────────────
      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetDemo: () => set((s) => ({ ...makeSeed(), authUserId: s.authUserId })),
    }),
    {
      name: 'sklad.db',
      version: 9,
      partialize: persistPartialize,
      migrate: persistMigrate,
    },
  ),
)

// Связываем облачный slice с готовым useStore — attachSync/resumeSync
// принимают ссылку на этот объект. До bindStore() cloud-actions не могут
// узнать про useStore (при их описании его ещё не существовало).
bindStore(useStore)

// Удобные хуки-селекторы
export const useProducts = () => useStore((s) => s.products)
export const useOrders = () => useStore((s) => s.orders)
export const useCustomers = () => useStore((s) => s.customers)
export const useSettings = () => useStore((s) => s.settings)
