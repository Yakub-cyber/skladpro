import { uid, nextNo } from '../../lib/id'

export const createMoneySlice = (set, get) => ({
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
                balance: (c.balance || 0) - amount,
              }
            : c,
        )
      }
      if (tx.supplierId && type === 'out') {
        next.suppliers = s.suppliers.map((sp) =>
          sp.id === tx.supplierId
            ? {
                ...sp,
                balance: (sp.balance || 0) - amount,
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
})
