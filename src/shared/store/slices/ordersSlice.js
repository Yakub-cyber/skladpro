import { deliveryFingerprint } from '../../lib/deliveryV2'
import { enqueueDelivery, enqueueCancellation } from '../../lib/cloud'
import { shipmentConditions } from '../../lib/shipmentV2'
import { enqueueShipment, prepareProtectedShipment } from '../../lib/cloud'
import { uid, nextNo } from '../../lib/id'
import { nextStatus, statusInfo } from '../../lib/constants'
import { applyOrderStock } from '../../lib/orders'
import { normalizeItems } from '../../lib/units'
import { enqueueSale, enqueueOrderStatus, enqueueReturn, enqueueCommercialOrder } from '../../lib/cloud'
import { prepareOfflineRefund } from '../../lib/offlineRefunds'
import { companyCache } from '../../lib/scopedCache'
import { getAuthContext, isAuthContextCurrent } from '@/shared/api'
import { planRefund, priorRefunds } from '../../lib/refunds'
import { completeBusinessAction } from '../../lib/businessIntent'
import { saleWarehouseError } from '../../lib/saleV2'
import { canonicalPayload } from '../../lib/outbox'
import { isCommercialOrder, prepareCommercial } from '../../lib/commercialOrders'

// ── Общие проверки заявки и продажи ─────────────────────────
// Живут на уровне модуля, а не в двух экшенах: правка шлюза
// делается один раз (тот же принцип, что и с отправкой на сервер).

// B5: оплата покрывает сумму. Единственный шлюз раньше был в
// PaymentModal.canConfirm — из кода легко обойти (тесты, cloud
// sync, batch-импорт), и заказ уходил с недостачей выручки.
function paymentShortfall(order) {
  const p = order.payment || {}
  const total = Number(order.total) || 0
  if (p.method && p.method !== 'credit') {
    const paid = (Number(p.cashPaid) || 0) + (Number(p.cardPaid) || 0)
    if (paid + 0.01 < total) return `Оплачено ${paid}₽ из ${total}₽ — недостаточно`
  }
  return null
}

// C1: кредитный лимит клиента. При продаже «в долг» смотрим, не выйдет
// ли текущий долг + новая продажа за customer.creditLimit. 0 — лимита нет.
function creditLimitError(s, order) {
  if (!(order.onCredit && order.customerId)) return null
  const cust = s.customers.find((c) => c.id === order.customerId)
  const limit = Number(cust?.creditLimit) || 0
  if (limit > 0) {
    const newDebt = (Number(cust?.balance) || 0) + (Number(order.total) || 0)
    if (newDebt > limit) {
      return `Кредитный лимит превышен: долг стал бы ${newDebt}₽ при лимите ${limit}₽`
    }
  }
  return null
}

// moneyTx для non-credit платежей: cash → счёт кассы (или счёт смены),
// card → банковский счёт. Для «в долг» деньги не пришли — tx не создаём
// (customer.balance начисляется в момент создания заказа/продажи).
function recordPaymentTx(get, orderId, orderNo, payment) {
  const p = payment || {}
  if (!p.method || p.method === 'credit') return
  const st = get()
  const shift = st.activeShiftId ? st.shifts.find((sh) => sh.id === st.activeShiftId) : null
  const cashAccountId = shift?.cashAccountId || st.accounts.find((a) => a.kind === 'cash')?.id
  const bankAccountId = st.accounts.find((a) => a.kind === 'bank')?.id
  const cashPaid = Number(p.cashPaid) || 0
  const cardPaid = Number(p.cardPaid) || 0
  if (cashPaid > 0 && cashAccountId) {
    get().addMoneyTx({
      type: 'in',
      accountId: cashAccountId,
      amount: cashPaid,
      purpose: 'sale-cash',
      orderId,
      note: `Продажа ${orderNo}`,
    })
  }
  if (cardPaid > 0 && bankAccountId) {
    get().addMoneyTx({
      type: 'in',
      accountId: bankAccountId,
      amount: cardPaid,
      purpose: 'sale-card',
      orderId,
      note: `Продажа ${orderNo}`,
    })
  }
}

export const createOrdersSlice = (set, get) => ({
  cancelProtectedOrder: async (id) => {
    const context = getAuthContext()
    try {
      if (!get().cloud || companyCache.pendingOrderCommands(context, id).length) return { ok: false, error: 'Сначала разрешите предыдущие команды заказа; отмена не принята' }
      const source = companyCache.deliverySource(context, id)
      const order = get().orders.find(o => o.id === id)
      if (order?.deliveryPending || order?.returns?.length || order?.cancellationPending) return { ok: false, error: 'Есть доставка, возврат или отмена; требуется сверка' }
      const shipmentFingerprint = await deliveryFingerprint({ companyId: context.companyId, orderId: id, ...source.payload })
      if (!isAuthContextCurrent(context)) return { ok: false, error: 'Контекст сессии изменился' }
      if (companyCache.pendingOrderCommands(context, id).length) return { ok: false, error: 'Другая вкладка сохранила команду заказа' }
      const envelope = { orderId: id, request: { contractVersion: 2, status: 'cancelled', shipmentId: source.shipmentId, shipmentFingerprint },
        projection: { warehouseId: source.payload.warehouseId, items: structuredClone(source.payload.orderSnapshot.items) } }
      return completeBusinessAction(get(), 'cancellation_v2', { id, ...envelope.request }, () => ({ id, envelope }),
        prepared => enqueueCancellation(prepared.envelope), () => { set({ orders: companyCache.overlayLocal(getAuthContext(), get()).orders }); return { ok: true, id, pending: true } }, `cancellation:${id}`)
    } catch(e) { return { ok: false, error: e.message } }
  },
  deliverOrder: async (id) => {
    const context = getAuthContext()
    try {
      if (!get().cloud) return { ok: false, error: 'Delivered v2 доступен только защищённому облачному заказу' }
      if (companyCache.pendingOrderCommands(context, id).length) return { ok: false, error: 'Сначала подтвердите предыдущие команды заказа; доставка не принята' }
      const source = companyCache.deliverySource(context, id)
      const shipmentFingerprint = await deliveryFingerprint({ companyId: context.companyId, orderId: id, ...source.payload })
      if (!isAuthContextCurrent(context)) return { ok: false, error: 'Контекст сессии изменился; доставка не принята' }
      if (companyCache.pendingOrderCommands(context, id).length) return { ok: false, error: 'Другая вкладка сохранила команду заказа; обновите состояние' }
      const envelope = { orderId: id, request: { contractVersion: 2, status: 'delivered', shipmentId: source.shipmentId, shipmentFingerprint } }
      return completeBusinessAction(get(), 'delivery_v2', { id, ...envelope.request }, () => ({ id, envelope }),
        prepared => enqueueDelivery(prepared.envelope), () => { set({ orders: companyCache.overlayLocal(getAuthContext(), get()).orders }); return { ok: true, id, pending: true } }, `delivery:${id}`)
    } catch(e) { return { ok: false, error: e.message } }
  },
  prepareShipment: async (id) => {
    try {
      if (!get().cloud || companyCache.pendingOrderCommands(getAuthContext(), id).length) return { ok: false, error: 'Сначала подтвердите предыдущие команды заказа' }
      const a = companyCache.commercialOrder(getAuthContext(), id)
      if (!a || !['new', 'confirmed'].includes(a.status)) return { ok: false, error: 'Подготовка недоступна; обновите заказ' }
      const problem = shipmentConditions(a.snapshot); if (problem) return { ok: false, error: problem }
      await prepareProtectedShipment(id)
      set({ orders: companyCache.overlayLocal(getAuthContext(), get()).orders })
      return { ok: true }
    } catch(e) { return { ok: false, error: e.message } }
  },
  shipOrder: (id, warehouseId) => {
    try {
      if (!get().cloud || companyCache.pendingOrderCommands(getAuthContext(), id).length) return { ok: false, error: 'Сначала подтвердите предыдущие команды заказа' }
      const authority = companyCache.commercialOrder(getAuthContext(), id)
      if (!authority || !['picking', 'packed'].includes(authority.status) || authority.stockConsumed || authority.shipmentDocId) return { ok: false, error: 'Нужен подтверждённый подготовленный коммерческий заказ' }
      const issue = shipmentConditions(authority.snapshot) || saleWarehouseError(get().warehouses, warehouseId)
      if (issue) return { ok: false, error: issue }
      if (authority.snapshot.items.some(l => get().products.find(p => p.id === l.productId)?.marked)) return { ok: false, error: 'Маркированные товары не поддерживаются' }
      return completeBusinessAction(get(), 'shipment_v2', { id, warehouseId, snapshot: authority.snapshot }, () => ({ id,
        body: { contractVersion: 2, status: 'shipped', shipmentId: crypto.randomUUID(), warehouseId, orderSnapshot: structuredClone(authority.snapshot) } }),
        prepared => enqueueShipment(id, prepared.body), () => { set(companyCache.overlayLocal(getAuthContext(), get())); return { ok: true, id, pending: true } }, `shipment:${id}`)
    } catch(e) { return { ok: false, error: e.message } }
  },
  // ── Движок продажи ────────────────────────────────────────
  // createSaleDocument — единственное место, где продажа становится
  // учётным фактом. Заявка (addOrder) — «клиент попросил»; продажа —
  // «товар ушёл, деньги пришли». В рознице оба события совпадают по
  // времени, поэтому касса зовёт только этот движок.
  //
  // Движок делает ВСЁ: заказ-обёртку (для истории и чека), локальное
  // списание (FIFO + маркировка), moneyTx, и документ для сервера в
  // персистентной очереди. Экраны только передают данные.
  // Проводку (post_doc) делает СЕРВЕР — поэтому «create», а не «post».
  //
  // Возвращает { ok, id, docId }. docId = `sale-${id}` — тот же id
  // сервер использует для docs (см. sales.ts), маркер shipmentDocId
  // на заказе однозначно связывает его с документом.
  createSaleDocument: (input) => {
    if (get().cloud) {
      const error = saleWarehouseError(get().warehouses, input.warehouseId)
      if (error) return { ok: false, error }
      if (input.sourceDocumentId && `draft-sale-${input.sourceDocumentId}`.length > 64) return { ok: false, error: 'Идентификатор старого черновика слишком длинный; требуется разбор' }
    }
    const shortfall = paymentShortfall(input)
    if (shortfall) return { ok: false, error: shortfall }
    const overLimit = creditLimitError(get(), input)
    if (overLimit) return { ok: false, error: overLimit }
    return completeBusinessAction(get(), 'sale', input, () => {
      const s = get(), id = s.cloud && input.sourceDocumentId ? `draft-sale-${input.sourceDocumentId}` : uid('o'), docId = `sale-${id}`
      const items = normalizeItems(input.items || [], s.products)
      const at = new Date().toISOString()
      const header = { status: 'new', createdAt: at, track: [{ status: 'new', at }],
        priority: false, shiftId: s.activeShiftId || null, stockConsumed: false,
        ...input, items, id, no: nextNo(s.orders, 'ЧК'), kind: 'retail', shipmentDocId: docId }
      const saleItems = items.map((it) => ({ productId: it.productId, name: it.name,
        qty: Number(it.inputQty ?? it.qty) || 0, price: Number(it.price) || 0,
        ...(it.unitId ? { unitId: it.unitId } : {}), ...(it.unitFactor != null ? { unitFactor: it.unitFactor } : {}),
        ...(it.markCodes ? { markCodes: [...it.markCodes] } : {}) }))
      const subtotal = saleItems.reduce((n, it) => n + it.qty * it.price, 0)
      const order = { id, no: header.no,
        customerId: header.customerId || undefined, customerName: header.customerName || undefined,
        items: saleItems, discount: Math.max(0, Math.round((subtotal - (header.total || 0)) * 100) / 100),
        onCredit: !!header.onCredit, priceTypeId: header.priceTypeId || undefined,
        shiftId: header.shiftId || undefined, track: [...header.track, { status: 'delivered', at }] }
      return { id, docId, header, command: s.cloud ? { contractVersion: 2, order: { ...order, warehouseId: input.warehouseId } } : order }
    }, (prepared) => enqueueSale(prepared.command, prepared.header.sourceDocumentId), (prepared, accepted) => {
      const { id, docId, header } = prepared
      if (get().orders.some((o) => o.id === id)) return { ok: true, id, docId }
      if (accepted.acknowledged) return { ok: false, error: 'Команда уже подтверждена сервером. Обновите данные перед локальным завершением.' }
      const fields = ['orders', 'products', 'customers', 'moneyTx', 'shifts', 'audit', 'documents']
      const before = Object.fromEntries(fields.map((k) => [k, get()[k]]))
      try {
        set((s) => ({ orders: [{ ...header, ...(s.cloud ? { stockConsumed: true } : {}) }, ...s.orders], customers: header.onCredit && header.customerId
          ? s.customers.map((c) => c.id === header.customerId ? { ...c, balance: (c.balance || 0) + (header.total || 0) } : c)
          : s.customers }))
        get().setOrderStatus(id, 'delivered')
        if (get().cloud) set(companyCache.overlayLocal(getAuthContext(), get()))
        recordPaymentTx(get, id, header.no, header.payment)
        if (header.sourceDocumentId) set({ documents: get().documents.filter((d) => d.id !== header.sourceDocumentId) })
        get().logAction(`Продажа ${header.no} на ${header.total || 0} ₽`, { section: 'Заказы', type: 'create' })
        return { ok: true, id, docId }
      } catch (e) { try { set(before) } catch { /* state is restored before persist */ } throw e }
    })
  },

  // ── Заказы (заявки) ──────────────────────────────────────
  // Заказ — это НЕ продажа. Это заявка: клиент попросил, вы приняли,
  // собираете, везёте. Живёт по воронке статусов, остаток не двигает —
  // максимум резервирует (через открытый статус). Учётный факт
  // (списание, долг, деньги) появится при отгрузке.
  //
  // kind='retail' здесь — обратная совместимость: розница целиком
  // делегируется движку createSaleDocument, т.к. в рознице заявка и
  // отгрузка — одно событие.
  addOrder: (order) => {
    if ((order.kind || 'order') === 'retail') return get().createSaleDocument(order)
    if (get().cloud) {
      let checked
      try { checked = prepareCommercial({ ...order, shiftId: order.shiftId ?? get().activeShiftId ?? null }, get().products, null, () => uid('line')) }
      catch (e) { return { ok: false, error: e.message } }
      const apply = () => {
        const view = companyCache.overlayLocal(getAuthContext(), get())
        set({ orders: view.orders })
        return { ok: true, id: preparedId, pending: true }
      }
      let preparedId
      return completeBusinessAction(get(), 'commercial_create', order, () => {
        const orderId = uid('o'), commandId = uid('cmd')
        return { id: orderId, payload: { contractVersion: 2, commandId, orderId,
          commercial: { ...checked, no: checked.no || nextNo(get().orders, 'ЗК') } } }
      }, (prepared) => { preparedId = prepared.id; return enqueueCommercialOrder('commercial_create', prepared.payload) }, apply)
    }
    const shortfall = paymentShortfall(order)
    if (shortfall) return { ok: false, error: shortfall }
    const overLimit = creditLimitError(get(), order)
    if (overLimit) return { ok: false, error: overLimit }
    if (order.items) {
      order = { ...order, items: normalizeItems(order.items, get().products) }
    }
    const id = uid('o')
    set((s) => {
      const o = {
        id,
        no: nextNo(s.orders, 'ЗК'),
        status: 'new',
        createdAt: new Date().toISOString(),
        track: [{ status: 'new', at: new Date().toISOString() }],
        priority: false,
        shiftId: s.activeShiftId || null,
        stockConsumed: false, // физически спишется при отгрузке
        ...order,
        kind: 'order',
        shipmentDocId: null, // заявка не отгружена — документа нет
      }
      // Долг «в долг» начисляем сразу (предоплата долга при приёме заявки).
      let customers = s.customers
      if (o.onCredit && o.customerId) {
        customers = s.customers.map((c) =>
          c.id === o.customerId ? { ...c, balance: (c.balance || 0) + (o.total || 0) } : c,
        )
      }
      return { orders: [o, ...s.orders], customers }
    })
    const o = get().orders.find((x) => x.id === id)
    // Предоплата при приёме заявки (клиент заплатил вперёд) — в кассу сразу.
    recordPaymentTx(get, id, o?.no, order.payment)
    get().logAction(`Создан заказ ${o?.no} на ${order.total || 0} ₽ (резерв)`, {
      section: 'Заказы',
      type: 'create',
    })
    return { ok: true, id }
  },
  setOrderStatus: (id, status, note) => {
    if (get().cloud && isCommercialOrder(get().orders.find((o) => o.id === id))) return { ok: false, error: 'Для защищённого заказа используйте отдельное действие shipment/delivered v2' }
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
    if (nx) return get().setOrderStatus(id, nx)
  },
  // Редактирование заказа до отгрузки. Разрешено только пока
  // stockConsumed=false и статус не cancelled — иначе правка сломает
  // проведённое списание/долг. Резерв на складе вычисляется на лету
  // (reservedByProduct → открытые заказы), поэтому меняется автоматом
  // при новых items. Долг «в долг» корректируем на дельту total.
  updateOrder: (id, patch, options) => {
    const o = get().orders.find((x) => x.id === id)
    if (!o) return { ok: false, error: 'Заказ не найден' }
    if (get().cloud) {
      if (!isCommercialOrder(o)) return { ok: false, error: 'Редактирование исторического облачного заказа этим контрактом недоступно' }
      if (companyCache.pendingOrderCommands?.(getAuthContext(), id).length || o.shipmentPending || o.shipmentQueued) return { ok: false, error: 'Команды заказа или отгрузка ещё не разрешены' }
      if (o.commercialPending) return { ok: false, error: 'Есть незавершённая команда заказа. Дождитесь подтверждения или разберите конфликт' }
      if (o.stockConsumed || o.shipmentDocId || o.status === 'cancelled') return { ok: false, error: 'Коммерческий состав уже отгруженного или отменённого заказа защищён' }
      let commercial
      try {
        const authority = companyCache.commercialOrder(getAuthContext(), id)
        if (!authority || !options?.expectedRowVersion || authority.rowVersion !== options.expectedRowVersion || !options.baseSnapshot || canonicalPayload(authority.snapshot) !== canonicalPayload(options.baseSnapshot))
          return { ok: false, error: 'Серверная версия изменилась или не подтверждена. Откройте заказ заново; сервер не будет перезаписан' }
        if (options.baseSnapshot.discount.kind !== 'percent' || new Set(options.baseSnapshot.items.map((l) => l.productId)).size !== options.baseSnapshot.items.length)
          return { ok: false, error: 'Эта форма пока не поддерживает редактирование абсолютной скидки или повторных строк товара' }
        commercial = prepareCommercial(patch, get().products, options.baseSnapshot, () => uid('line'))
      } catch (e) { return { ok: false, error: e.message } }
      return completeBusinessAction(get(), 'commercial_edit', { id, patch, options }, () => {
        const commandId = uid('cmd')
        return { id, payload: { contractVersion: 2, commandId, orderId: id, expectedRowVersion: options.expectedRowVersion, commercial } }
      }, (prepared) => enqueueCommercialOrder('commercial_edit', prepared.payload), () => {
        set({ orders: companyCache.overlayLocal(getAuthContext(), get()).orders })
        return { ok: true, id, pending: true }
      }, `commercial_edit:${id}`)
    }
    if (o.stockConsumed || o.status === 'cancelled') {
      return { ok: false, error: 'Заказ уже отгружен или отменён — редактирование недоступно' }
    }
    if (patch.items) {
      patch = { ...patch, items: normalizeItems(patch.items, get().products) }
    }
    const next = { ...o, ...patch }
    const itemsChanged = 'items' in patch
    const discChanged = 'discount' in patch
    if (itemsChanged || discChanged) {
      const items = next.items || []
      const subtotal = items.reduce(
        (acc, it) => acc + (Number(it.qty) || 0) * (Number(it.price) || 0),
        0,
      )
      const disc = Number(next.discount) || 0
      const total = Math.round(subtotal * (1 - disc / 100) * 100) / 100
      next.subtotal = subtotal
      next.total = total
    }
    const oldDebt = o.onCredit ? o.total || 0 : 0
    const newDebt = next.onCredit ? next.total || 0 : 0
    const customer = get().customers.find((c) => c.id === next.customerId)
    const existingDebt = Number(customer?.balance) || 0
    const nextDebt = existingDebt - (o.customerId === next.customerId ? oldDebt : 0) + newDebt
    if (
      newDebt > 0 &&
      Number(customer?.creditLimit) > 0 &&
      nextDebt > Number(customer.creditLimit)
    ) {
      return {
        ok: false,
        error: `Кредитный лимит превышен: долг стал бы ${nextDebt}₽ при лимите ${customer.creditLimit}₽`,
      }
    }
    set((s) => {
      let customers = s.customers
      if (oldDebt || newDebt) {
        customers = s.customers.map((c) =>
          c.id === o.customerId || c.id === next.customerId
            ? {
                ...c,
                balance:
                  (c.balance || 0) -
                  (c.id === o.customerId ? oldDebt : 0) +
                  (c.id === next.customerId ? newDebt : 0),
              }
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
    if (get().cloud && isCommercialOrder(o)) return get().cancelProtectedOrder(id)
    if (!o || o.status === 'cancelled') return // идемпотентность: не откатываем дважды
    if (get().cloud) {
      let projected
      try { projected = companyCache.overlayLocal(getAuthContext(), get()) }
      catch { return { ok: false, error: 'Не удалось проверить сохранённые возвраты. Аннулирование остановлено.' } }
      if (o.refundContractVersion === 2 || (o.returns || []).some((event) => event.contractVersion === 2) ||
        projected.orders.some((row) => row.origOrderId === id && row.refundContractVersion === 2)) {
        return { ok: false, error: 'Аннулирование чека с сохранённым возвратом недоступно: требуется сверка. Возврат сохранён.' }
      }
    }
    // Legacy-чек: создан старой сборкой — ни shipmentDocId, ни kind='retail'.
    // Его отмена ушла бы только в localStorage: sync/push срезает status,
    // сервер остаётся при своём. Пользователь увидел бы «Отменён», а учёт —
    // нет. Молчаливая потеря действия хуже отказа. Заявки (ЗК) не трогаем:
    // их воронка живёт локально до отдельного этапа.
    const isLegacyReceipt =
      !o.shipmentDocId && o.kind !== 'retail' && String(o.no || '').startsWith('ЧК')
    if (isLegacyReceipt) {
      return {
        ok: false,
        error: `Чек ${o.no} создан старой версией приложения — отмена из кабинета для него не сработает на сервере. Скорректируйте остаток инвентаризацией.`,
      }
    }
    const apply = (_prepared, accepted = {}) => {
      if (get().orders.find((x) => x.id === id)?.status === 'cancelled') return { ok: true, id }
      if (accepted.acknowledged) return { ok: false, error: 'Отмена уже подтверждена сервером. Обновите данные перед локальным завершением.' }
      const fields = ['orders', 'products', 'customers', 'moneyTx', 'shifts', 'audit']
      const before = Object.fromEntries(fields.map((k) => [k, get()[k]]))
      try {
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
              c.id === o.customerId ? { ...c, balance: (c.balance || 0) - (o.total || 0) } : c,
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
        // F2-9: если отменили заказ уже закрытой смены — пересчитать
        // её snapshot revenue.
        if (o.shiftId) get().recalcClosedShift(o.shiftId)
        // Отмена — через outbox: если сеть моргнула, заказ на сервере останется
        // отгруженным, остатки не вернутся. Персистентная очередь ретраит.
        // Кому нужна серверная отмена: заказам с документом отгрузки
        // (shipmentDocId) — сервер сделает unpost_doc. kind='retail' без
        // маркера — legacy-чеки, созданные до маркера: они тоже на сервере.

        get().logAction(
          `Отменён заказ ${o.no} · ${o.stockConsumed ? 'остатки возвращены' : 'резерв снят'}`,
          { section: 'Заказы', type: 'delete' },
        )

        return { ok: true, id }
      } catch (e) { try { set(before) } catch { /* state restored before persist */ } throw e }
    }
    if (!(o.shipmentDocId || o.kind === 'retail')) return apply()
    return completeBusinessAction(get(), 'order_status', { id, note },
      () => ({ id: `${id}:cancelled`, orderId: id }),
      (prepared) => enqueueOrderStatus(prepared.orderId, 'cancelled'), apply, `order_status:${id}:cancelled`)
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
    if (orig.kind === 'refund')
      return { ok: false, error: 'Нельзя оформить возврат по документу возврата' }
    if (s.cloud) {
      return completeBusinessAction(s, 'return_v2', { origOrderId, opts },
        () => prepareOfflineRefund(orig, get().orders, opts),
        (prepared) => enqueueReturn(prepared.command),
        (prepared) => {
          set(companyCache.overlayLocal(getAuthContext(), get()))
          return { ok: true, id: prepared.id, returnId: prepared.id, pending: true }
        }, `return:${origOrderId}`)
    }
    // items не задан — возврат полного чека (по всем позициям).
    const planned = planRefund(orig, s.orders, opts.items)
    if (!planned.ok) return planned
    // Партии и коды возвращаются только для выбранного количества,
    // с пропуском уже возвращённой части исходной продажи.
    const enriched = planned.items
    const refundTotal = planned.total
    const alreadyRefunded = priorRefunds(orig, s.orders).reduce(
      (n, r) => n + Number(r.total || 0),
      0,
    )
    // Создаём refund-order.
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
      // F2-1: возврат на склад через applyOrderStock(+1). Функция
      // умеет reverseConsume(batches, consumed) — партии восстанавливаются
      // в исходные, cost пересчитывается по FIFO, инвариант
      // sum(batches.qty)===stock сохраняется. Плюс восстанавливает
      // коды маркировки, если товар marked.
      const applied = applyOrderStock(st, o, +1)
      return {
        orders: [applied.order, ...st.orders],
        products: applied.products,
      }
    })
    // Возврат денег.
    const method = orig.payment?.method
    const shift = s.activeShiftId ? s.shifts.find((sh) => sh.id === s.activeShiftId) : null
    if (orig.onCredit || method === 'credit') {
      // Долг клиента уменьшается: возврат гасит.
      set((st) => ({
        customers: st.customers.map((c) =>
          c.id === orig.customerId ? { ...c, balance: (c.balance || 0) - refundTotal } : c,
        ),
      }))
    } else if (method === 'cash' || method === 'mixed') {
      const cashAcc = shift?.cashAccountId || s.accounts.find((a) => a.kind === 'cash')?.id
      if (cashAcc && refundTotal > 0) {
        // Сначала возвращаем наличную часть, затем карточную. Предыдущие
        // частичные возвраты уже использовали часть этого лимита.
        const cashPart =
          method === 'mixed'
            ? Math.min(
                refundTotal,
                Math.max(0, (Number(orig.payment?.cashPaid) || 0) - alreadyRefunded),
              )
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
    // F2-9: если refund относится к оригиналу закрытой смены —
    // пересчитать snapshot. refund-заказ уменьшит revenue.
    if (orig.shiftId) get().recalcClosedShift(orig.shiftId)
    get().logAction(`Возврат по ${orig.no} на ${refundTotal} ₽`, {
      section: 'Заказы',
      type: 'return',
    })
    return { ok: true, id, total: refundTotal }
  },
  // Назначить заказ конкретному курьеру (сотруднику) — он видит только свои
  assignCourier: (id, employeeId) => {
    if (get().cloud && isCommercialOrder(get().orders.find((o) => o.id === id))) return { ok: false, error: 'Назначение доставки защищённого заказа ещё не подключено' }
    const o = get().orders.find((x) => x.id === id)
    const emp = get().employees.find((e) => e.id === employeeId)
    // F2-7: раньше валидация роли была только в UI (Orders.jsx
    // фильтровал по role='courier'). Через API/tests можно было
    // назначить кассира на доставку → NAV/фильтр «Мои заказы»
    // работал бы неверно. Теперь проверка в actionу.
    if (employeeId && emp && emp.role !== 'courier') {
      return { ok: false, error: 'На доставку можно назначить только сотрудника с ролью «Курьер»' }
    }
    set((s) => ({
      orders: s.orders.map((x) => (x.id === id ? { ...x, assignedTo: employeeId || null } : x)),
    }))
    get().logAction(
      employeeId ? `Курьер «${emp?.name}» назначен на ${o?.no}` : `Снято назначение с ${o?.no}`,
      { section: 'Доставка' },
    )
    return { ok: true }
  },

  // ── Накладные ────────────────────────────────────────────
  addInvoice: (inv) => {
    set((s) => {
      const prefix = inv.kind === 'in' ? 'ПР' : 'РН'
      return {
        invoices: [
          {
            id: uid('inv'),
            no: nextNo(
              s.invoices.filter((x) => x.kind === inv.kind),
              prefix,
            ),
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
  removeInvoice: (id) => set((s) => ({ invoices: s.invoices.filter((i) => i.id !== id) })),

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
    get().logAction(`Заказ поставщику создан · ${po.supplierName || 'без поставщика'}`, {
      section: 'Заказы поставщикам',
      type: 'create',
    })
    return id
  },
  updatePurchaseOrder: (id, patch) =>
    set((s) => ({
      purchaseOrders: (s.purchaseOrders || []).map((p) => {
        if (p.id !== id) return p
        const items = patch.items || p.items
        const total = items.reduce((a, x) => a + (Number(x.qty) || 0) * (Number(x.cost) || 0), 0)
        return { ...p, ...patch, items, total }
      }),
    })),
  // Отметить как отправленный (draft → sent).
  sendPurchaseOrder: (id) => {
    const p = get().purchaseOrders?.find((x) => x.id === id)
    if (!p || p.status !== 'draft') return
    set((s) => ({
      purchaseOrders: s.purchaseOrders.map((x) =>
        x.id === id ? { ...x, status: 'sent', sentAt: new Date().toISOString() } : x,
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
        sourcePurchaseOrderId: id,
      },
      { post: true },
    )
    // PO linkage is completed inside addDocument, together with local posting.
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
})
