import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { makeSeed } from './seed'
import { uid, docNo } from '../lib/id'
import { nextStatus, statusInfo, docTypeInfo } from '../lib/constants'
import { applyDocToState } from '../lib/posting'
import { applyOrderStock, migrateReservationV8, stockConsumedFromStatus } from '../lib/orders'
import { hasSupabase } from '../lib/supabase'
import {
  cloudLoadAll,
  cloudSeed,
  cloudUpsert,
  remapSeedForCompany,
  attachSync,
  getCloudSession,
  onAuthChange,
  cloudSignIn,
  cloudSignUp,
  cloudSignOut,
  getMembership,
  createCompanyCloud,
  acceptInvitation,
  checkRecovery,
  changePassword,
} from '../lib/cloud'

// Слой данных. Сейчас источник истины — localStorage (persist).
// Чтобы переключиться на реальный API/Supabase, эти actions заменяются
// на сетевые вызовы — компоненты менять не нужно.

export const useStore = create(
  persist(
    (set, get) => ({
      ...makeSeed(), // audit/shifts/activeShiftId приходят отсюда
      authUserId: null, // кто авторизован (null = показать экран входа)
      cloud: hasSupabase, // работаем с облаком Supabase
      cloudReady: false, // данные из облака загружены
      cloudError: null,
      _authInited: false,
      needOnboarding: false, // вошёл, но компании ещё нет
      recoveryMode: false, // перешёл по ссылке сброса пароля → ввод нового
      companyId: null,
      companyName: null,

      // ── Облако (Supabase, мультитенант) ──────────────────────
      // Единая точка реакции на вход/выход через onAuthStateChange
      initAuth: async () => {
        if (!hasSupabase || get()._authInited) return
        set({ _authInited: true })
        // onAuthChange — только выход (вход/токены обрабатываем явными
        // вызовами bootstrap, чтобы не было параллельных гонок)
        onAuthChange((event) => {
          if (event === 'SIGNED_OUT') {
            set({ authUserId: null, needOnboarding: false, companyId: null, companyName: null, cloudReady: false })
          }
        })
        // переход по ссылке сброса пароля → экран ввода нового (без bootstrap)
        if (await checkRecovery()) {
          set({ recoveryMode: true })
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
          let data = await cloudLoadAll()
          if (!data) {
            const seed = remapSeedForCompany(makeSeed(), companyId)
            await cloudSeed(seed, companyId)
            data = await cloudLoadAll()
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
          let employees = data.employees || []
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
          set({
            ...data,
            companyId,
            companyName: membership.companies?.name || 'Компания',
            authUserId: me.id,
            cloudReady: true,
            needOnboarding: false,
            cloudError: null,
          })
          attachSync(useStore)
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
        await cloudSignOut()
        set({ authUserId: null, cloudReady: false, needOnboarding: false, companyId: null, companyName: null })
      },
      // Завершить сброс пароля: задать новый и войти в приложение
      completePasswordReset: async (newPassword) => {
        const r = await changePassword(newPassword)
        if (r.ok) {
          set({ recoveryMode: false })
          await get().bootstrapCloud()
        }
        return r
      },

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
      // Возврат поставщику (закупленный товар уходит со склада)
      supplierReturn: (productId, qty, reason) => {
        const p = get().products.find((x) => x.id === productId)
        if (!p) return
        set((s) => ({
          products: s.products.map((x) =>
            x.id === productId ? { ...x, stock: Math.max(0, x.stock - qty) } : x,
          ),
          movements: [
            {
              id: uid('mv'),
              type: 'supplier_return',
              productId,
              name: p.name,
              qty,
              delta: -qty,
              reason: reason || 'Возврат поставщику',
              by: s.authUserId,
              at: new Date().toISOString(),
            },
            ...s.movements,
          ],
        }))
        get().logAction(`Возврат поставщику «${p.name}» −${qty} ${p.unit}`, {
          section: 'Склад',
          type: 'supplier_return',
        })
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
      addDocument: (doc, opts = {}) => {
        const post = opts.post !== false
        const id = uid('doc')
        const type = doc.type
        set((s) => {
          const seq = s.documents.filter((d) => d.type === type).length + 1
          const header = {
            id,
            no: docNo(docTypeInfo(type).prefix, seq),
            type,
            status: post ? 'posted' : 'draft',
            items: (doc.items || []).map((it) => ({ ...it })),
            toWarehouseId: doc.toWarehouseId || null,
            reason: doc.reason || '',
            note: doc.note || '',
            totalQty: (doc.items || []).reduce((a, x) => a + (Number(x.qty) || 0), 0),
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
      // Переместить товар в другую ячейку/склад
      moveProduct: (productId, warehouseId, cellCode) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === productId ? { ...p, warehouseId, cell: cellCode } : p,
          ),
        })),

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
      version: 8,
      // не сохраняем runtime-флаги облака (иначе после reload не переинициализируется)
      partialize: (state) => {
        const { _authInited, _bootBusy, _creating, cloudReady, needOnboarding, recoveryMode, cloudError, ...rest } = state
        return rest
      },
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
          // ячейкам и товарам — склад по умолчанию (основной)
          const wh1 = state.warehouses[0]?.id || 'wh1'
          if (!state.cells?.some((c) => c.warehouseId)) {
            state.cells = (state.cells || []).map((c) => ({
              ...c,
              code: c.code || c.id,
              warehouseId: wh1,
            }))
            // подмешиваем демо-ячейки второго склада
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
          const seedC = Object.fromEntries(makeSeed().customers.map((c) => [c.id, c.balance]))
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
          // отгруженным ставим stockConsumed=true. См. migrateReservationV8.
          const migrated = migrateReservationV8(state)
          state.orders = migrated.orders
          state.products = migrated.products
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
