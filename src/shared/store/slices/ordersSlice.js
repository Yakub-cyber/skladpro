import { uid, nextNo } from '../../lib/id'
import { nextStatus, statusInfo } from '../../lib/constants'
import { applyOrderStock } from '../../lib/orders'
import { normalizeItems } from '../../lib/units'
import { enqueueSale, enqueueOrderStatus } from '../../lib/cloud'

export const createOrdersSlice = (set, get) => ({
  // ── Движок продажи ────────────────────────────────────────
  // createSaleDocument — единственное место, где продажа становится
  // документом отгрузки для сервера. Собирает payload для /v1/sales
  // и кладёт в персистентную очередь (outbox). Проводку (post_doc)
  // делает СЕРВЕР — клиент только собирает и ставит в очередь,
  // поэтому «create», а не «post».
  //
  // Экраны (касса, форма документа) не строят payload сами — они
  // зовут этот движок. Пока его зовёт addOrder (kind='retail');
  // следующие шаги переводят кассу и SaleTab на прямой вызов.
  //
  // Возвращает { ok, docId }. docId = `sale-${order.id}` — этот же id
  // сервер использует для docs (см. sales.ts), поэтому маркер
  // shipmentDocId на заказе однозначно связывает заявку с документом.
  createSaleDocument: (order) => {
    const saleItems = (order.items || []).map((it) => ({
      productId: it.productId,
      name: it.name,
      qty: Number(it.qty) || 0,
      price: Number(it.price) || 0,
    }))
    const saleSubtotal = saleItems.reduce((a, it) => a + it.qty * it.price, 0)
    const docId = `sale-${order.id}`
    enqueueSale({
      id: order.id,
      no: order.no,
      customerId: order.customerId || undefined,
      customerName: order.customerName || undefined,
      items: saleItems,
      discount: Math.max(0, Math.round((saleSubtotal - (order.total || 0)) * 100) / 100),
      onCredit: !!order.onCredit,
      priceTypeId: order.priceTypeId || undefined,
      shiftId: order.shiftId || undefined,
      track: order.track || undefined,
    })
    return { ok: true, docId }
  },

  // ── Заказы ───────────────────────────────────────────────
  // `kind` разделяет два принципиально разных сценария:
  //   'retail' — розничный чек из кассы. Товар отдан покупателю
  //              прямо сейчас: заказ создаётся и СРАЗУ закрывается
  //              (delivered + физическое списание). Воронка
  //              «подтверждён → сборка → в пути» для него не нужна.
  //   'order'  — заказ с доставкой/самовывозом (по умолчанию).
  //              Идёт по обычной воронке статусов. Заявка, не продажа:
  //              остаток не двигает, максимум резервирует.
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
    if (order.items) {
      order = { ...order, items: normalizeItems(order.items, get().products) }
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
        // Маркер «заказ ушёл серверным путём» — id связанного документа
        // отгрузки. Ставится В ТОМ ЖЕ set(), что создаёт заказ: attachSync
        // срабатывает на каждый set, и заказ без маркера в первом же окне
        // улетел бы в sync/push (гонка с /v1/sales).
        // stockConsumed — про другое: «товар списан ЛОКАЛЬНО». Не смешивать.
        shipmentDocId: kind === 'retail' ? `sale-${id}` : null,
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
    // Розничный чек — это продажа, а не заявка: товар физически ушёл.
    // Документ отгрузки строит движок createSaleDocument и кладёт в
    // персистентную очередь (переживает закрытие вкладки, в отличие от
    // fire-and-forget промиса). Заказ доставки (kind='order') — заявка,
    // документ появится при отгрузке, отдельный этап.
    if (o && kind === 'retail') get().createSaleDocument(o)
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
    if (patch.items) {
      patch = { ...patch, items: normalizeItems(patch.items, get().products) }
    }
    set((s) => {
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
            ? { ...c, balance: (c.balance || 0) + debtDelta }
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
    if (o.shipmentDocId || o.kind === 'retail') enqueueOrderStatus(id, 'cancelled')
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
    // F2-1: enriched-items несут `consumed` для FIFO reverse. Для
    // частичного возврата пропорционально усекаем `consumed[i].qty`,
    // чтобы вернуть только вернувшуюся долю в те же партии, а
    // остальное осталось consumed (в продаже). Раньше stock тупо
    // += qty без batches — партии протухали, следующая продажа
    // считала COGS по «дырявым» партиям.
    const enriched = items.map((ri) => {
      const oi = orig.items.find((x) => x.productId === ri.productId)
      const refQty = Number(ri.qty)
      const origQty = Number(oi.qty) || 0
      const ratio = origQty > 0 ? refQty / origQty : 0
      const consumed = (oi.consumed || []).map((c) => ({
        ...c,
        qty: (Number(c.qty) || 0) * ratio,
      }))
      return {
        ...oi,
        qty: refQty,
        consumed,
      }
    })
    const refundTotal = enriched.reduce(
      (acc, it) => acc + Number(it.qty) * Number(it.price || 0),
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
    const shift = s.activeShiftId
      ? s.shifts.find((sh) => sh.id === s.activeShiftId)
      : null
    if (method === 'credit') {
      // Долг клиента уменьшается: возврат гасит.
      set((st) => ({
        customers: st.customers.map((c) =>
          c.id === orig.customerId
            ? { ...c, balance: (c.balance || 0) - refundTotal }
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
      orders: s.orders.map((x) =>
        x.id === id ? { ...x, assignedTo: employeeId || null } : x,
      ),
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
})
