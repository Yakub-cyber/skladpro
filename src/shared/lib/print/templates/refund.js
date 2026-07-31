// F1-3: Печать возврата покупателю. Раньше refund-order (kind='refund')
// печатался шаблоном sale.cheque как обычный чек с плюсовыми суммами.
// Юзер путал возврат с продажей.
//
// Здесь минимальный шаблон: тот же табличный вид, но:
//   - заголовок «Возврат по чеку»,
//   - ссылка на оригинал (doc.origOrderId → искать в orders по id и
//     подставить его no),
//   - слово «Возвращено» в подписи вместо «Продавец / Покупатель».
import { esc, fmt, rublesToWords } from '../print'

const dateRu = (iso) => new Date(iso || Date.now()).toLocaleDateString('ru-RU')

function normalizeItems(doc) {
  return (doc.items || []).map((it) => ({
    name: it.name || '',
    qty: Number(it.qty) || 0,
    unit: it.unit || 'шт',
    price: Number(it.price) || 0,
  }))
}

export function refundCheque(doc, ctx) {
  const r = ctx.requisites || {}
  const items = normalizeItems(doc)
  const total = items.reduce((a, it) => a + it.qty * it.price, 0) || Number(doc.total) || 0
  const cur = esc(ctx.currency)

  const rows = items
    .map(
      (it, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.name)}</td>
      <td class="r">${fmt(it.qty)} ${esc(it.unit)}</td>
      <td class="r">${fmt(it.price)}</td>
      <td class="r">${fmt(it.qty * it.price)}</td>
    </tr>`,
    )
    .join('')

  const origLine = doc.origOrderId
    ? `<div class="muted">По чеку ${esc(doc.origOrderId).slice(-6)}</div>`
    : ''
  const reasonLine = doc.reason
    ? `<div class="muted">Причина: ${esc(doc.reason)}</div>`
    : ''

  return `
    <div style="text-align:center;margin-bottom:6mm">
      <h1 style="font-size:16px">Возврат по чеку № ${esc(doc.no)} от ${dateRu(doc.createdAt)}</h1>
      ${origLine}
      ${reasonLine}
      <div class="muted">${esc(ctx.company)}${r.address ? ' · ' + esc(r.address) : ''}</div>
      ${r.phone ? `<div class="muted">Тел.: ${esc(r.phone)}</div>` : ''}
    </div>
    <table>
      <thead><tr><th>№</th><th>Наименование</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="5" class="total">К ВОЗВРАТУ: ${fmt(total)} ${cur}</td></tr>
      </tfoot>
    </table>
    <div class="words" style="text-align:center">
      <b>${rublesToWords(total)}</b>
    </div>
    <div class="sign">
      <div class="line">Кассир${r.director ? ' · ' + esc(r.director) : ''}</div>
      <div class="line">Покупатель${ctx.customer?.name ? ' · ' + esc(ctx.customer.name) : ''}</div>
    </div>`
}
