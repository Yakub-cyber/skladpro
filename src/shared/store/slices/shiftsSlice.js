import { uid } from '../../lib/id'

export const createShiftsSlice = (set, get) => ({
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

  // F2-9: пересчитать snapshot закрытой смены. Вызывается из
  // cancelOrder и refundOrder — если заказ принадлежит уже
  // закрытой смене, её `revenue`/`ordersCount` без пересчёта
  // расходятся с фактом (закрытие делает snapshot, а последующие
  // отмены/возвраты его не двигают). Открытая смена snapshot не
  // имеет — там revenue считается на лету.
  recalcClosedShift: (shiftId) => {
    if (!shiftId) return
    const st = get()
    const sh = (st.shifts || []).find((x) => x.id === shiftId)
    if (!sh || !sh.closedAt) return
    const os = (st.orders || []).filter(
      (o) => o.shiftId === shiftId && o.status !== 'cancelled',
    )
    // refund-заказы уменьшают выручку смены.
    const revenue = os.reduce(
      (a, o) => a + (o.kind === 'refund' ? -1 : 1) * (Number(o.total) || 0),
      0,
    )
    set((state) => ({
      shifts: state.shifts.map((x) =>
        x.id === shiftId ? { ...x, revenue, ordersCount: os.length } : x,
      ),
    }))
  },
})
