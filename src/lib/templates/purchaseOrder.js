// Шаблон заявки поставщику (Purchase Order) — печатная форма ЗКП.
// Отправляется поставщику: наш адрес/телефон, что и сколько заказываем,
// ожидаемая дата поставки, подпись менеджера.
import { esc, fmt, sellerRequisites, buyerRequisites, rublesToWords, plural } from '../print'

const dateRu = (iso) => new Date(iso || Date.now()).toLocaleDateString('ru-RU')

function normalizeItems(po) {
  return (po.items || []).map((it) => ({
    name: it.name || '',
    qty: Number(it.qty) || 0,
    unit: it.unit || 'шт',
    cost: Number(it.cost) || 0,
  }))
}

export function poRequest(po, ctx) {
  const r = ctx.requisites || {}
  const items = normalizeItems(po)
  const total = items.reduce((a, it) => a + it.qty * it.cost, 0) || Number(po.total) || 0
  const cur = esc(ctx.currency)
  const buyerReq = sellerRequisites(r, ctx.settings) // наши данные — как «покупателя»
  const supplier = ctx.supplier || { name: po.supplierName }
  const supplierReq = buyerRequisites(supplier || {})

  const rows = items
    .map(
      (it, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.name)}</td>
      <td class="c">${esc(it.unit)}</td>
      <td class="r">${fmt(it.qty)}</td>
      <td class="r">${fmt(it.cost)}</td>
      <td class="r">${fmt(it.qty * it.cost)}</td>
    </tr>`,
    )
    .join('')

  return `
    <div class="req">
      <b>${esc(ctx.company)}</b>${buyerReq ? ' · ' + buyerReq : ''}
    </div>
    <h1>Заказ поставщику № ${esc(po.no)} от ${dateRu(po.createdAt)}</h1>
    <div class="parties">
      <div><b>Поставщик:</b> ${esc(supplier?.name || '—')}${supplierReq ? ' · ' + supplierReq : ''}</div>
      <div><b>Покупатель:</b> ${esc(ctx.company)}</div>
      ${po.expectedAt
        ? `<div><b>Ожидаемая дата поставки:</b> ${dateRu(po.expectedAt)}</div>`
        : ''}
      ${po.note ? `<div><b>Комментарий:</b> ${esc(po.note)}</div>` : ''}
    </div>
    <table>
      <thead><tr>
        <th>№</th><th>Наименование</th><th>Ед.</th>
        <th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="6">Всего позиций: <b>${items.length}</b>, единиц: <b>${fmt(items.reduce((a, it) => a + it.qty, 0))}</b></td></tr>
        <tr><td colspan="6" class="total">Ожидаемая сумма: ${fmt(total)} ${cur}</td></tr>
      </tfoot>
    </table>
    <div class="words">
      ${plural(items.length, ['Ожидаемая сумма', 'Ожидаемая сумма', 'Ожидаемая сумма'])}: <b>${rublesToWords(total)}</b>
    </div>
    <div class="sign">
      <div class="line">Заказ составил</div>
      <div class="line">М. П. покупателя</div>
    </div>`
}
