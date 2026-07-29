import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { makeSeed } from './seed'
import { uid, nextNo } from '../lib/id'
import { nextStatus, statusInfo, docTypeInfo, DEFAULT_WORK_ZONES } from '../lib/constants'
import { applyDocToState } from '../lib/posting'
import { applyOrderStock } from '../lib/orders'
import { persistMigrate, persistPartialize, persistMerge } from './persistMigrate'
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
      // `accountId` — касса, которую открывает кассир. Если у этой кассы
      // непустой `cashierIds` (см. Cashiers.jsx) и текущий сотрудник не
      // в списке — возвращаем `{ok:false}`. Иначе `cashAccountId` летит
      // в shift, а затем — в `addOrder → moneyTx.accountId` (T1-A).
      // Обратная совместимость: старый вызов `openShift(1000)` без
      // accountId по-прежнему работает.
      openShift: (openingCash = 0, accountId = null) => {
        if (get().activeShiftId) return { ok: false, error: 'Смена уже открыта' }
        const s = get()
        if (accountId) {
          const acc = (s.accounts || []).find((a) => a.id === accountId)
          if (acc && Array.isArray(acc.cashierIds) && acc.cashierIds.length > 0) {
            if (!acc.cashierIds.includes(s.authUserId)) {
              return { ok: false, error: 'Кассир не назначен на эту кассу' }
            }
          }
        }
        const id = uid('sh')
        set((st) => ({
          shifts: [
            {
              id,
              userId: st.authUserId,
              openedAt: new Date().toISOString(),
              closedAt: null,
              openingCash: Number(openingCash) || 0,
              cashAccountId: accountId || null,
            },
            ...st.shifts,
          ],
          activeShiftId: id,
        }))
        get().logAction('Открыта смена', { section: 'Касса', type: 'shift' })
        return { ok: true, id }
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

      // ── Товары / услуги / комплекты ─────────────────────────────
      // type: 'product' | 'service' | 'kit' (default 'product'). Услуга и
      // комплект пропускают ленту складских полей (stock/batches/cell);
      // seed по умолчанию оставляем безопасный — движок posting.js это
      // корректно обрабатывает.
      addProduct: (p) => {
        const pts = get().priceTypes || []
        const prices =
          p.prices || Object.fromEntries(pts.map((t) => [t.id, p.price || 0]))
        set((s) => ({
          products: [
            {
              id: uid('p'),
              type: 'product',
              stock: 0,
              minStock: 0,
              tags: [],
              weighted: false,
              marked: false,
              codes: [],
              components: [],
              prices,
              ...p,
            },
            ...s.products,
          ],
        }))
        const label =
          p.type === 'service' ? 'услуга' : p.type === 'kit' ? 'комплект' : 'товар'
        get().logAction(`Добавлен ${label} «${p.name || 'без названия'}»`, {
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
      // Удаление товара защищено от «висячих» ссылок. Если товар
      // упоминается в открытых заказах — резерв «замораживается на
      // фантоме» (reservedByProduct продолжает копить qty на удалённом
      // id). То же для документов/заявок поставщикам с этим товаром.
      // Возвращает { ok:false, error } — UI показывает подсказку что
      // перед удалением надо закрыть/отменить связанные документы.
      removeProduct: (id) => {
        const s = get()
        const inOpenOrders = (s.orders || []).some(
          (o) =>
            !['cancelled', 'delivered'].includes(o.status) &&
            (o.items || []).some((it) => it.productId === id),
        )
        if (inOpenOrders) {
          return {
            ok: false,
            error: 'Товар используется в открытых заказах — закройте или отмените их сначала',
          }
        }
        const inDraftDocs = (s.documents || []).some(
          (d) => d.status !== 'cancelled' && (d.items || []).some((it) => it.productId === id),
        )
        if (inDraftDocs) {
          return {
            ok: false,
            error: 'Товар есть в документах — удалить нельзя (нарушит остатки и историю)',
          }
        }
        const inPo = (s.purchaseOrders || []).some(
          (po) => po.status !== 'closed' && (po.items || []).some((it) => it.productId === id),
        )
        if (inPo) {
          return {
            ok: false,
            error: 'Товар есть в открытых заказах поставщикам — закройте их сначала',
          }
        }
        const p = s.products.find((x) => x.id === id)
        set((st) => ({ products: st.products.filter((x) => x.id !== id) }))
        if (p) get().logAction(`Удалён товар «${p.name}»`, { section: 'Товары', type: 'delete' })
        return { ok: true }
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
      // Legacy actions receiveOp/writeOff/returnStock/supplierReturn
      // удалены — UI везде проводит движения через addDocument({type})
      // → applyDocToState (lib/posting.js), включая FIFO по партиям.
      // Инвентаризация — единственная operational-функция, оставшаяся
      // самостоятельной (движок для неё в posting.js есть, но раритетный
      // фолбэк без партий тоже сохранён).

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
      // Перемещение между складами/ячейками (общий остаток не меняется)
      // B7: частичное перемещение. Раньше `transferStock` двигал ВЕСЬ
      // остаток (просто переписывал warehouseId), а параметр `qty`
      // ложился только в reason движения. Теперь:
      //   - `qty >= p.stock` (или не указан) — переезжает весь товар
      //     (backward compat, изменения нет);
      //   - `qty < p.stock` — на исходном складе создаём отдельную
      //     карточку-«близнеца» c оставшимся остатком, а сам товар
      //     переезжает с частичным `qty` на новый склад.
      // Идентичные копии на разных складах различаются `warehouseId`
      // и `cell`; поле `sku` и `id` разные. Это осознанный
      // компромисс: полноценный multi-store требует переработки
      // модели (product.stocks[whId]), но для типового склада с
      // 1-2 точками работает.
      transferStock: (productId, toWarehouseId, toCell, qty) => {
        const p = get().products.find((x) => x.id === productId)
        if (!p) return { ok: false, error: 'Товар не найден' }
        const whName = (id) => get().warehouses?.find((w) => w.id === id)?.name || '—'
        const from = `${whName(p.warehouseId)}${p.cell ? ' · ' + p.cell : ''}`
        const to = `${whName(toWarehouseId)}${toCell ? ' · ' + toCell : ''}`
        const n = Number(qty) || 0
        const stock = Number(p.stock) || 0
        const partial = n > 0 && n < stock
        set((s) => {
          const movement = {
            id: uid('mv'),
            type: 'transfer',
            productId,
            name: p.name,
            qty: partial ? n : stock,
            delta: 0,
            reason: `Перемещение: ${from} → ${to}${partial ? ` (частично ${n}/${stock})` : ''}`,
            by: s.authUserId,
            at: new Date().toISOString(),
          }
          if (!partial) {
            // Целиком: старый путь.
            return {
              products: s.products.map((x) =>
                x.id === productId
                  ? { ...x, warehouseId: toWarehouseId || x.warehouseId, cell: toCell || x.cell }
                  : x,
              ),
              movements: [movement, ...s.movements],
            }
          }
          // Частично: исходную карточку уменьшаем, создаём копию на
          // новом складе с перенесённой частью. batches, если есть,
          // «переезжают» пропорционально n/stock (округление вниз).
          const ratio = n / stock
          const copyBatches = (p.batches || []).map((b) => ({
            id: uid('b'),
            qty: Math.floor((Number(b.qty) || 0) * ratio),
            cost: b.cost,
            at: b.at,
          }))
          const remainBatches = (p.batches || []).map((b, i) => ({
            ...b,
            qty: (Number(b.qty) || 0) - (copyBatches[i]?.qty || 0),
          }))
          const copy = {
            ...p,
            id: uid('p'),
            stock: n,
            warehouseId: toWarehouseId || p.warehouseId,
            cell: toCell || p.cell,
            batches: copyBatches,
          }
          return {
            products: [
              copy,
              ...s.products.map((x) =>
                x.id === productId ? { ...x, stock: stock - n, batches: remainBatches } : x,
              ),
            ],
            movements: [movement, ...s.movements],
          }
        })
        get().logAction(
          `Перемещение «${p.name}»: ${from} → ${to}${partial ? ` (${n}/${stock})` : ''}`,
          { section: 'Склад', type: 'transfer' },
        )
        return { ok: true }
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
          const prefix = docTypeInfo(type).prefix
          const header = {
            id,
            no: nextNo(s.documents.filter((d) => d.type === type), prefix),
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
      // `kind` разделяет два принципиально разных сценария:
      //   'retail' — розничный чек из кассы. Товар отдан покупателю
      //              прямо сейчас: заказ создаётся и СРАЗУ закрывается
      //              (delivered + физическое списание). Воронка
      //              «подтверждён → сборка → в пути» для него не нужна.
      //   'order'  — заказ с доставкой/самовывозом (по умолчанию).
      //              Идёт по обычной воронке статусов.
      addOrder: (order) => {
        // B5: валидация суммы оплаты. Единственный шлюз раньше был в
        // PaymentModal.canConfirm — из кода легко обойти (тесты, cloud
        // sync, batch-импорт), и заказ уходил с недостачей выручки.
        const p = order.payment || {}
        const total = Number(order.total) || 0
        if (p.method && p.method !== 'credit') {
          const paid = (Number(p.cashPaid) || 0) + (Number(p.cardPaid) || 0)
          if (paid + 0.01 < total) {
            return { ok: false, error: `Оплачено ${paid}₽ из ${total}₽ — недостаточно` }
          }
        }
        // C1: кредитный лимит клиента. При продаже «в долг» смотрим,
        // не выйдет ли текущий долг + новая продажа за customer.creditLimit.
        // 0 или отсутствует — лимита нет.
        if (order.onCredit && order.customerId) {
          const cust = get().customers.find((c) => c.id === order.customerId)
          const limit = Number(cust?.creditLimit) || 0
          if (limit > 0) {
            const newDebt = (Number(cust?.balance) || 0) + total
            if (newDebt > limit) {
              return {
                ok: false,
                error: `Кредитный лимит превышен: долг стал бы ${newDebt}₽ при лимите ${limit}₽`,
              }
            }
          }
        }
        const id = uid('o')
        const kind = order.kind || 'order'
        set((s) => {
          const prefix = kind === 'retail' ? 'ЧК' : 'ЗК'
          const o = {
            id,
            no: nextNo(s.orders, prefix),
            status: 'new',
            createdAt: new Date().toISOString(),
            track: [{ status: 'new', at: new Date().toISOString() }],
            priority: false,
            shiftId: s.activeShiftId || null,
            stockConsumed: false, // физически спишется при отгрузке
            ...order,
            kind,
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
        // Розничный чек закрываем сразу: товар физически ушёл с покупателем,
        // держать его в «резерве» и гонять по воронке бессмысленно.
        // setOrderStatus сам применит applyOrderStock (FIFO + маркировка).
        if (kind === 'retail') get().setOrderStatus(id, 'delivered')
        const o = get().orders.find((x) => x.id === id)
        // Автоматическое создание moneyTx для non-credit платежей.
        // Раньше `/money` не видел выручку от кассы (POS писал только
        // `order.payment`), теперь при cash/card/mixed балансы касс
        // растут сразу же. Для «в долг» — деньги не пришли, tx не
        // создаём (customer.balance уже прирос выше). `p` уже
        // объявлен в валидации выше (B5).
        if (p.method && p.method !== 'credit') {
          const st = get()
          const shift = st.activeShiftId
            ? st.shifts.find((sh) => sh.id === st.activeShiftId)
            : null
          const cashAccountId =
            shift?.cashAccountId ||
            st.accounts.find((a) => a.kind === 'cash')?.id
          const bankAccountId = st.accounts.find((a) => a.kind === 'bank')?.id
          const cashPaid = Number(p.cashPaid) || 0
          const cardPaid = Number(p.cardPaid) || 0
          if (cashPaid > 0 && cashAccountId) {
            get().addMoneyTx({
              type: 'in',
              accountId: cashAccountId,
              amount: cashPaid,
              purpose: 'sale-cash',
              orderId: id,
              note: `Продажа ${o?.no}`,
            })
          }
          if (cardPaid > 0 && bankAccountId) {
            get().addMoneyTx({
              type: 'in',
              accountId: bankAccountId,
              amount: cardPaid,
              purpose: 'sale-card',
              orderId: id,
              note: `Продажа ${o?.no}`,
            })
          }
        }
        get().logAction(`Создан заказ ${o?.no} на ${order.total || 0} ₽ (резерв)`, {
          section: 'Заказы',
          type: 'create',
        })
        return { ok: true, id }
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
          // B6: если patch менял items или discount — пересчитываем
          // subtotal/total из позиций. Раньше total клался как есть,
          // а debtDelta пытался использовать «замороженное» число →
          // customer.balance расходился с фактом.
          const itemsChanged = 'items' in patch
          const discChanged = 'discount' in patch
          if (itemsChanged || discChanged) {
            const items = next.items || []
            const subtotal = items.reduce(
              (acc, it) => acc + (Number(it.qty) || 0) * (Number(it.price) || 0),
              0,
            )
            const disc = Number(next.discount) || 0
            const total = Math.round(subtotal * (1 - disc / 100))
            next.subtotal = subtotal
            next.total = total
          }
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
                    // B4: сбрасываем stockConsumed после возврата остатков —
                    // иначе повторный setOrderStatus('shipped') не спишет
                    // ничего (guard `!o.stockConsumed`), товар «уйдёт
                    // бесплатно». cancelOrder идемпотентен и всегда
                    // финализирует в согласованное состояние.
                    stockConsumed: false,
                    track: [
                      ...(x.track || []),
                      { status: 'cancelled', at: new Date().toISOString(), ...(note ? { note } : {}) },
                    ],
                  }
                : x,
            ),
          }
        })
        // Отменяем парные moneyTx (созданные автоматически при addOrder).
        // Через public API — cancelMoneyTx корректно откатит балансы
        // счетов (они на лету считаются из moneyTx с status!='cancelled').
        const linkedTx = (get().moneyTx || []).filter(
          (t) => t.orderId === id && t.status !== 'cancelled',
        )
        linkedTx.forEach((t) => get().cancelMoneyTx(t.id))
        get().logAction(
          `Отменён заказ ${o.no} · ${o.stockConsumed ? 'остатки возвращены' : 'резерв снят'}`,
          { section: 'Заказы', type: 'delete' },
        )
      },
      // C2: Возврат по чеку. Клиент вернул товар — оформляем «возврат-
      // документ» со ссылкой на оригинал и параллельно откатываем
      // деньги и остаток. items — массив { productId, qty } из
      // оригинального чека (можно вернуть меньшее количество, чем
      // покупали, но не больше).
      //
      // Побочки:
      //   1) Новый order kind='refund' с origOrderId + reason + items;
      //   2) Возврат остатка на склад (обратный FIFO по partition из
      //      original.items[].consumed);
      //   3) Возврат денег через addMoneyTx type='out' с purpose=
      //      'sale-refund' на тот же счёт, где было получено (или на
      //      cash-account смены). Для credit — уменьшаем customer.balance.
      refundOrder: (origOrderId, opts = {}) => {
        const s = get()
        const orig = s.orders.find((o) => o.id === origOrderId)
        if (!orig) return { ok: false, error: 'Оригинальный заказ не найден' }
        if (!orig.stockConsumed) {
          return { ok: false, error: 'Заказ ещё не отгружен — используйте «Отмена»' }
        }
        // items не задан — возврат полного чека (по всем позициям).
        const items = (opts.items && opts.items.length)
          ? opts.items
          : orig.items.map((it) => ({ productId: it.productId, qty: it.qty }))
        // Проверка: qty не больше, чем в оригинале.
        for (const ri of items) {
          const oi = orig.items.find((x) => x.productId === ri.productId)
          if (!oi) return { ok: false, error: `Товар ${ri.productId} не из этого чека` }
          if (Number(ri.qty) > Number(oi.qty)) {
            return {
              ok: false,
              error: `Возвращают ${ri.qty} из ${oi.qty} по «${oi.name}» — больше нельзя`,
            }
          }
        }
        // Считаем сумму возврата пропорционально orig.price.
        const enriched = items.map((ri) => {
          const oi = orig.items.find((x) => x.productId === ri.productId)
          return {
            ...oi,
            qty: Number(ri.qty),
            consumed: (oi.consumed || []).slice(0, 8), // partition-hint для FIFO reverse
          }
        })
        const refundTotal = enriched.reduce(
          (acc, it) => acc + Number(it.qty) * Number(it.price || 0),
          0,
        )
        // Создаём refund-order через addOrder (kind='refund' — специальный).
        const id = uid('o')
        set((st) => {
          const o = {
            id,
            no: nextNo(st.orders, 'ВЧК'),
            kind: 'refund',
            origOrderId,
            reason: opts.reason || 'Возврат покупателя',
            status: 'delivered',
            createdAt: new Date().toISOString(),
            track: [{ status: 'delivered', at: new Date().toISOString() }],
            shiftId: st.activeShiftId || null,
            stockConsumed: true,
            customerId: orig.customerId,
            customerName: orig.customerName,
            items: enriched,
            total: refundTotal,
            payment: { method: orig.payment?.method || 'cash', cashPaid: 0, cardPaid: 0 },
          }
          // Возврат остатка на склад — прибавляем qty к продукту.
          const products = st.products.map((p) => {
            const ri = enriched.find((x) => x.productId === p.id)
            return ri ? { ...p, stock: (Number(p.stock) || 0) + Number(ri.qty) } : p
          })
          return {
            orders: [o, ...st.orders],
            products,
          }
        })
        // Возврат денег.
        const method = orig.payment?.method
        const shift = s.activeShiftId
          ? s.shifts.find((sh) => sh.id === s.activeShiftId)
          : null
        if (method === 'credit') {
          // Долг клиента уменьшается: возврат гасит.
          set((st) => ({
            customers: st.customers.map((c) =>
              c.id === orig.customerId
                ? { ...c, balance: Math.max(0, (c.balance || 0) - refundTotal) }
                : c,
            ),
          }))
        } else if (method === 'cash' || method === 'mixed') {
          const cashAcc =
            shift?.cashAccountId || s.accounts.find((a) => a.kind === 'cash')?.id
          if (cashAcc && refundTotal > 0) {
            const cashPart = method === 'mixed'
              ? Math.min(refundTotal, Number(orig.payment?.cashPaid) || 0)
              : refundTotal
            if (cashPart > 0) {
              get().addMoneyTx({
                type: 'out',
                accountId: cashAcc,
                amount: cashPart,
                purpose: 'sale-refund',
                orderId: id,
                note: `Возврат по ${orig.no}`,
              })
            }
            if (method === 'mixed') {
              const cardPart = refundTotal - cashPart
              const bankAcc = s.accounts.find((a) => a.kind === 'bank')?.id
              if (cardPart > 0 && bankAcc) {
                get().addMoneyTx({
                  type: 'out',
                  accountId: bankAcc,
                  amount: cardPart,
                  purpose: 'sale-refund',
                  orderId: id,
                  note: `Возврат по ${orig.no}`,
                })
              }
            }
          }
        } else if (method === 'card') {
          const bankAcc = s.accounts.find((a) => a.kind === 'bank')?.id
          if (bankAcc && refundTotal > 0) {
            get().addMoneyTx({
              type: 'out',
              accountId: bankAcc,
              amount: refundTotal,
              purpose: 'sale-refund',
              orderId: id,
              note: `Возврат по ${orig.no}`,
            })
          }
        }
        get().logAction(`Возврат по ${orig.no} на ${refundTotal} ₽`, {
          section: 'Заказы',
          type: 'return',
        })
        return { ok: true, id, total: refundTotal }
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
          const prefix = inv.kind === 'in' ? 'ПР' : 'РН'
          return {
            invoices: [
              {
                id: uid('inv'),
                no: nextNo(s.invoices.filter((x) => x.kind === inv.kind), prefix),
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
      // Клиент считается «в использовании», если у него есть открытые
      // заказы, долг > 0, или он привязан к какой-то moneyTx. Иначе
      // безопасно удаляется. В UI кнопка «Удалить» доступна только для
      // «чистых» карточек — но защита должна быть и в сторе.
      removeCustomer: (id) => {
        const s = get()
        const c = s.customers.find((x) => x.id === id)
        if (!c) return { ok: false, error: 'Клиент не найден' }
        if ((c.balance || 0) > 0) {
          return { ok: false, error: `У клиента есть долг ${c.balance} ₽ — сначала закройте` }
        }
        const hasOpenOrders = (s.orders || []).some(
          (o) => o.customerId === id && !['cancelled', 'delivered'].includes(o.status),
        )
        if (hasOpenOrders) {
          return { ok: false, error: 'У клиента есть открытые заказы' }
        }
        set((st) => ({ customers: st.customers.filter((c) => c.id !== id) }))
        get().logAction(`Удалён клиент «${c.name}»`, { section: 'Контрагенты', type: 'delete' })
        return { ok: true }
      },
      // Приём оплаты от клиента — тонкая обёртка над addMoneyTx с
      // purpose='debt-in'. Раньше это была параллельная механика:
      // addPayment двигал customer.balance, но НЕ писал moneyTx —
      // поэтому касса не росла, а Money.jsx не видел прихода.
      // Теперь оба пути (карточка клиента и /money → «Приход») дают
      // один и тот же побочный эффект: +сумма к балансу счёта,
      // −сумма из долга клиента, запись в ленте /money и /movements.
      //
      // accountId — куда положить: если не передан, берём кассу
      // активной смены (или первую доступную кассу).
      addPayment: (customerId, amount, opts = {}) => {
        const a = Number(amount) || 0
        if (a <= 0) return { ok: false, error: 'Укажите сумму больше нуля' }
        const s = get()
        const shift = s.activeShiftId
          ? s.shifts.find((sh) => sh.id === s.activeShiftId)
          : null
        const accountId =
          opts.accountId ||
          shift?.cashAccountId ||
          s.accounts.find((a) => a.kind === 'cash')?.id
        if (!accountId) return { ok: false, error: 'Не найдена касса — добавьте её в разделе «Кассы»' }
        return get().addMoneyTx({
          type: 'in',
          accountId,
          amount: a,
          purpose: 'debt-in',
          customerId,
          note: opts.note || '',
        })
      },

      // ── Поставщики ───────────────────────────────────────────
      addSupplier: (sup) =>
        set((s) => ({ suppliers: [{ id: uid('s'), ...sup }, ...s.suppliers] })),
      updateSupplier: (id, patch) =>
        set((s) => ({
          suppliers: s.suppliers.map((sp) => (sp.id === id ? { ...sp, ...patch } : sp)),
        })),
      removeSupplier: (id) => {
        const s = get()
        const sup = s.suppliers.find((x) => x.id === id)
        if (!sup) return { ok: false, error: 'Поставщик не найден' }
        if ((sup.balance || 0) > 0) {
          return { ok: false, error: `Мы должны поставщику ${sup.balance} ₽ — сначала закройте` }
        }
        const hasOpenPo = (s.purchaseOrders || []).some(
          (po) => po.supplierId === id && !['closed', 'cancelled'].includes(po.status),
        )
        if (hasOpenPo) {
          return { ok: false, error: 'Есть открытые заказы поставщикам' }
        }
        set((st) => ({ suppliers: st.suppliers.filter((sp) => sp.id !== id) }))
        get().logAction(`Удалён поставщик «${sup.name}»`, { section: 'Контрагенты', type: 'delete' })
        return { ok: true }
      },

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

      // ── Деньги: кассы/счета и денежные транзакции ─────────────
      // Модель:
      //   accounts: [{ id, name, kind: 'cash'|'bank', currency }]
      //   moneyTx:  [{ id, no, type, accountId, toAccountId?, amount,
      //                purpose, customerId?, supplierId?, note, at, by,
      //                status: 'posted'|'cancelled' }]
      // Баланс счёта считается на лету из moneyTx (не хранится в state).
      addAccount: (a) => {
        const id = uid('acc')
        set((s) => ({
          accounts: [
            ...(s.accounts || []),
            {
              id,
              kind: 'cash',
              currency: s.settings?.currency || '₽',
              cashierIds: [],
              ...a,
              createdAt: new Date().toISOString(),
            },
          ],
        }))
        get().logAction(`Добавлен счёт «${a.name || id}»`, {
          section: 'Деньги',
          type: 'create',
        })
        return id
      },
      updateAccount: (id, patch) =>
        set((s) => ({
          accounts: (s.accounts || []).map((a) =>
            a.id === id ? { ...a, ...patch } : a,
          ),
        })),
      removeAccount: (id) =>
        set((s) => {
          // Нельзя удалить счёт, по которому есть транзакции.
          const hasTx = (s.moneyTx || []).some(
            (t) => t.accountId === id || t.toAccountId === id,
          )
          if (hasTx) return {}
          return { accounts: (s.accounts || []).filter((a) => a.id !== id) }
        }),
      // Провести денежный документ. Возвращает id или { ok:false, error }.
      // Валидация:
      //   - amount > 0
      //   - для in/out — accountId обязателен
      //   - для transfer — обе стороны обязательны и не равны
      // Побочные эффекты:
      //   - customerId + purpose='debt-in' → уменьшить его balance на amount
      //   - supplierId + purpose='debt-out' → уменьшить долг перед ним
      //     (у поставщика balance — сколько мы ему должны)
      addMoneyTx: (tx) => {
        const type = tx.type
        const amount = Math.round(Number(tx.amount) * 100) / 100
        if (!(amount > 0)) return { ok: false, error: 'Сумма должна быть > 0' }
        if (type === 'in' || type === 'out') {
          if (!tx.accountId) return { ok: false, error: 'Не выбран счёт' }
        } else if (type === 'transfer') {
          if (!tx.accountId || !tx.toAccountId)
            return { ok: false, error: 'Выберите оба счёта' }
          if (tx.accountId === tx.toAccountId)
            return { ok: false, error: 'Счёт-источник и получатель совпадают' }
        } else {
          return { ok: false, error: `Неизвестный тип: ${type}` }
        }
        const id = uid('mtx')
        set((s) => {
          const prefix =
            type === 'in' ? 'ПКО' : type === 'out' ? 'РКО' : 'ПРВ'
          const header = {
            id,
            no: nextNo(
              (s.moneyTx || []).filter((t) => t.type === type),
              prefix,
            ),
            type,
            accountId: tx.accountId,
            toAccountId: tx.toAccountId || null,
            amount,
            purpose: tx.purpose || 'other',
            customerId: tx.customerId || null,
            supplierId: tx.supplierId || null,
            // orderId — связь с заказом-источником, если tx создана
            // автоматически при `addOrder`. Позволяет `cancelOrder`
            // найти и отменить парную транзакцию.
            orderId: tx.orderId || null,
            note: tx.note || '',
            at: new Date().toISOString(),
            by: s.authUserId,
            status: 'posted',
          }
          const next = { moneyTx: [header, ...(s.moneyTx || [])] }
          // Долг контрагента, если явно связан.
          if (tx.customerId && type === 'in') {
            next.customers = s.customers.map((c) =>
              c.id === tx.customerId
                ? {
                    ...c,
                    balance: Math.max(0, (c.balance || 0) - amount),
                  }
                : c,
            )
          }
          if (tx.supplierId && type === 'out') {
            next.suppliers = s.suppliers.map((sp) =>
              sp.id === tx.supplierId
                ? {
                    ...sp,
                    balance: Math.max(0, (sp.balance || 0) - amount),
                  }
                : sp,
            )
          }
          return next
        })
        const purposeLabel = {
          'debt-in': 'Погашение долга клиентом',
          'sale-cash': 'Приход за продажу',
          'debt-out': 'Оплата поставщику',
          salary: 'Зарплата',
          rent: 'Аренда',
          transfer: 'Перевод между счетами',
        }
        const kindLabel =
          type === 'in' ? 'Приход' : type === 'out' ? 'Расход' : 'Перевод'
        const amountStr =
          new Intl.NumberFormat('ru-RU').format(amount) + ' ₽'
        get().logAction(
          `${kindLabel} ${amountStr} · ${purposeLabel[tx.purpose] || tx.purpose || 'прочее'}`,
          { section: 'Деньги', type: 'create' },
        )
        return id
      },
      // Отменить транзакцию — оставляем запись, но не учитывается в
      // балансе (status='cancelled') и откатывает влияние на контрагентов.
      cancelMoneyTx: (id) => {
        const tx = get().moneyTx?.find((t) => t.id === id)
        if (!tx || tx.status !== 'posted') return
        set((s) => {
          const next = {
            moneyTx: s.moneyTx.map((t) =>
              t.id === id ? { ...t, status: 'cancelled' } : t,
            ),
          }
          if (tx.customerId && tx.type === 'in') {
            next.customers = s.customers.map((c) =>
              c.id === tx.customerId
                ? { ...c, balance: (c.balance || 0) + tx.amount }
                : c,
            )
          }
          if (tx.supplierId && tx.type === 'out') {
            next.suppliers = s.suppliers.map((sp) =>
              sp.id === tx.supplierId
                ? { ...sp, balance: (sp.balance || 0) + tx.amount }
                : sp,
            )
          }
          return next
        })
        get().logAction(`Отменена транзакция ${tx.no}`, {
          section: 'Деньги',
          type: 'delete',
        })
      },

      // ── Заказы поставщикам (PO) ───────────────────────────────
      // Pre-документ до приёмки товара. Флоу: draft → sent → received
      // → closed. При «Получено» вызывается addDocument(type='purchase')
      // с items из PO — движок posting.js оприходует остатки по FIFO.
      addPurchaseOrder: (po) => {
        const id = uid('po')
        const items = (po.items || []).map((it) => ({ ...it }))
        set((s) => {
          const sup = s.suppliers.find((x) => x.id === po.supplierId)
          const header = {
            id,
            no: nextNo(s.purchaseOrders || [], 'ЗКП'),
            supplierId: po.supplierId,
            supplierName: sup?.name || po.supplierName || '',
            items,
            total: items.reduce((a, x) => a + (Number(x.qty) || 0) * (Number(x.cost) || 0), 0),
            expectedAt: po.expectedAt || null,
            note: po.note || '',
            status: po.status || 'draft',
            createdAt: new Date().toISOString(),
            sentAt: null,
            receivedAt: null,
            receiveDocId: null,
            by: s.authUserId,
          }
          return { purchaseOrders: [header, ...(s.purchaseOrders || [])] }
        })
        get().logAction(
          `Заказ поставщику создан · ${po.supplierName || 'без поставщика'}`,
          { section: 'Заказы поставщикам', type: 'create' },
        )
        return id
      },
      updatePurchaseOrder: (id, patch) =>
        set((s) => ({
          purchaseOrders: (s.purchaseOrders || []).map((p) => {
            if (p.id !== id) return p
            const items = patch.items || p.items
            const total = items.reduce(
              (a, x) => a + (Number(x.qty) || 0) * (Number(x.cost) || 0),
              0,
            )
            return { ...p, ...patch, items, total }
          }),
        })),
      // Отметить как отправленный (draft → sent).
      sendPurchaseOrder: (id) => {
        const p = get().purchaseOrders?.find((x) => x.id === id)
        if (!p || p.status !== 'draft') return
        set((s) => ({
          purchaseOrders: s.purchaseOrders.map((x) =>
            x.id === id
              ? { ...x, status: 'sent', sentAt: new Date().toISOString() }
              : x,
          ),
        }))
        get().logAction(`ЗКП ${p.no} отправлен поставщику`, {
          section: 'Заказы поставщикам',
          type: 'update',
        })
      },
      // Принять товар по PO: создаёт документ покупки (addDocument
      // type='purchase') с items из PO, помечает PO как received и
      // связывает с созданным документом. Если позиции отредактировались
      // при приёмке — передайте новые в overrideItems.
      receivePurchaseOrder: (id, overrideItems) => {
        const p = get().purchaseOrders?.find((x) => x.id === id)
        if (!p || (p.status !== 'draft' && p.status !== 'sent')) return null
        const items = (overrideItems || p.items).map((it) => ({
          productId: it.productId,
          name: it.name,
          unit: it.unit,
          qty: Number(it.qty) || 0,
          cost: Number(it.cost) || 0,
        }))
        const docId = get().addDocument(
          {
            type: 'purchase',
            reason: `Приёмка по ${p.no}`,
            note: `Заказ поставщику ${p.no} · ${p.supplierName || ''}`,
            items,
            supplierId: p.supplierId,
          },
          { post: true },
        )
        if (typeof docId !== 'string') return docId // ok:false / error
        set((s) => ({
          purchaseOrders: s.purchaseOrders.map((x) =>
            x.id === id
              ? {
                  ...x,
                  status: 'received',
                  receivedAt: new Date().toISOString(),
                  receiveDocId: docId,
                  items,
                }
              : x,
          ),
        }))
        get().logAction(`ЗКП ${p.no} принят по документу покупки`, {
          section: 'Заказы поставщикам',
          type: 'update',
        })
        return docId
      },
      cancelPurchaseOrder: (id) => {
        const p = get().purchaseOrders?.find((x) => x.id === id)
        if (!p || p.status === 'received') return
        set((s) => ({
          purchaseOrders: s.purchaseOrders.map((x) =>
            x.id === id ? { ...x, status: 'cancelled' } : x,
          ),
        }))
        get().logAction(`ЗКП ${p.no} отменён`, {
          section: 'Заказы поставщикам',
          type: 'delete',
        })
      },
      removePurchaseOrder: (id) => {
        const p = get().purchaseOrders?.find((x) => x.id === id)
        if (!p || p.status === 'received') return
        set((s) => ({
          purchaseOrders: (s.purchaseOrders || []).filter((x) => x.id !== id),
        }))
      },

      // ── Настройки / прочее ───────────────────────────────────
      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetDemo: () => set((s) => ({ ...makeSeed(), authUserId: s.authUserId })),
    }),
    {
      name: 'sklad.db',
      version: 17,
      partialize: persistPartialize,
      merge: persistMerge,
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
