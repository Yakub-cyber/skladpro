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
