// Финансовый модуль: вычисление баланса счёта по денежным транзакциям
// и удобные селекторы. Баланс не хранится в store — считается на лету
// из moneyTx, чтобы не рассогласовался при отмене/удалении транзакций.

/**
 * Баланс одного счёта: сумма приходов минус расходы плюс входящие
 * переводы минус исходящие. Отменённые транзакции (status='cancelled')
 * не учитываются.
 */
export function accountBalance(accountId, moneyTx = []) {
  let sum = 0
  for (const t of moneyTx) {
    if (t.status === 'cancelled') continue
    if (t.type === 'in' && t.accountId === accountId) sum += t.amount
    else if (t.type === 'out' && t.accountId === accountId) sum -= t.amount
    else if (t.type === 'transfer') {
      if (t.accountId === accountId) sum -= t.amount
      if (t.toAccountId === accountId) sum += t.amount
    }
  }
  return Math.round(sum * 100) / 100
}

/** Балансы по всем счетам одним проходом (O(N) вместо O(N × K)). */
export function accountBalances(accounts = [], moneyTx = []) {
  const map = Object.fromEntries(accounts.map((a) => [a.id, 0]))
  for (const t of moneyTx) {
    if (t.status === 'cancelled') continue
    if (t.type === 'in' && map[t.accountId] != null) map[t.accountId] += t.amount
    else if (t.type === 'out' && map[t.accountId] != null) map[t.accountId] -= t.amount
    else if (t.type === 'transfer') {
      if (map[t.accountId] != null) map[t.accountId] -= t.amount
      if (map[t.toAccountId] != null) map[t.toAccountId] += t.amount
    }
  }
  for (const k of Object.keys(map)) map[k] = Math.round(map[k] * 100) / 100
  return map
}

// Каталог целей платежа/прихода. Метки — для UI и лога.
export const MONEY_PURPOSES = {
  in: [
    { key: 'sale-cash', label: 'Приход за продажу' },
    { key: 'debt-in', label: 'Погашение долга клиентом' },
    { key: 'initial', label: 'Начальный остаток' },
    { key: 'investment', label: 'Внесение владельца' },
    { key: 'other', label: 'Прочий приход' },
  ],
  out: [
    { key: 'debt-out', label: 'Оплата поставщику' },
    { key: 'salary', label: 'Зарплата' },
    { key: 'rent', label: 'Аренда' },
    { key: 'utilities', label: 'Коммуналка' },
    { key: 'tax', label: 'Налоги' },
    { key: 'other', label: 'Прочий расход' },
  ],
  transfer: [{ key: 'transfer', label: 'Перевод между счетами' }],
}

export const purposeLabel = (type, key) =>
  (MONEY_PURPOSES[type] || []).find((p) => p.key === key)?.label || key

// Границы популярных периодов (для селектора «Сегодня / Неделя / Месяц»).
// Возвращает { from, to } в ISO-строках. `now` можно подменить в тестах.
export function rangeFor(period, now = new Date()) {
  const to = new Date(now)
  to.setHours(23, 59, 59, 999)
  const from = new Date(now)
  if (period === 'today') {
    from.setHours(0, 0, 0, 0)
  } else if (period === 'week') {
    from.setDate(from.getDate() - 6)
    from.setHours(0, 0, 0, 0)
  } else if (period === 'month') {
    from.setDate(from.getDate() - 29)
    from.setHours(0, 0, 0, 0)
  } else {
    // 'all' и всё неизвестное — открытый интервал (сверху ограничим 'to').
    return { from: null, to: to.toISOString() }
  }
  return { from: from.toISOString(), to: to.toISOString() }
}

/**
 * Сводка по moneyTx за период (и опционально по одному счёту).
 * Transfer'ы вычитаются и добавляются только если фильтруем по счёту,
 * иначе они внутренние и в приход/расход не идут (не искажают выручку).
 * Отменённые (status='cancelled') игнорируются.
 *
 * Возвращает:
 *   inTotal   — сумма приходов
 *   outTotal  — сумма расходов
 *   net       — inTotal − outTotal
 *   count     — сколько записей вошло (кроме отменённых)
 *   inByPurpose  — { key: sum } по назначениям прихода
 *   outByPurpose — { key: sum } по назначениям расхода
 */
export function summarize(moneyTx = [], { from, to, accountId } = {}) {
  let inTotal = 0
  let outTotal = 0
  let count = 0
  const inByPurpose = {}
  const outByPurpose = {}
  for (const t of moneyTx) {
    if (t.status === 'cancelled') continue
    if (from && t.at < from) continue
    if (to && t.at > to) continue
    const relatesToAccount =
      !accountId ||
      t.accountId === accountId ||
      (t.type === 'transfer' && t.toAccountId === accountId)
    if (!relatesToAccount) continue

    if (t.type === 'in') {
      inTotal += t.amount
      inByPurpose[t.purpose] = (inByPurpose[t.purpose] || 0) + t.amount
      count++
    } else if (t.type === 'out') {
      outTotal += t.amount
      outByPurpose[t.purpose] = (outByPurpose[t.purpose] || 0) + t.amount
      count++
    } else if (t.type === 'transfer' && accountId) {
      // При фильтре по счёту перевод считается как приход/расход этого
      // конкретного счёта. Без фильтра — переводы внутренние.
      if (t.accountId === accountId) {
        outTotal += t.amount
        outByPurpose.transfer = (outByPurpose.transfer || 0) + t.amount
        count++
      } else if (t.toAccountId === accountId) {
        inTotal += t.amount
        inByPurpose.transfer = (inByPurpose.transfer || 0) + t.amount
        count++
      }
    }
  }
  const round2 = (n) => Math.round(n * 100) / 100
  return {
    inTotal: round2(inTotal),
    outTotal: round2(outTotal),
    net: round2(inTotal - outTotal),
    count,
    inByPurpose,
    outByPurpose,
  }
}
