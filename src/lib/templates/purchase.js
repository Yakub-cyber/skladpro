// Шаблоны для покупки и оприходования. Возвращают тело <body>.
// - receiveAct — универсальный приёмный акт от поставщика (или без —
//   для stockin/оприходования). Формат ближе к ТОРГ-1/М-4.
// - m4 — упрощённый приходный ордер (форма М-4): без НДС/поставщика,
//   для внутреннего оприходования (излишков и т.п.).
import {
  esc,
  fmt,
  _round2 as round2,
  sellerRequisites,
  buyerRequisites,
  splitVat,
  rublesToWords,
  plural,
} from '../print'

const dateRu = (iso) => new Date(iso || Date.now()).toLocaleDateString('ru-RU')

function normalizeItems(doc) {
  return (doc.items || []).map((it) => ({
    name: it.name || '',
    qty: Number(it.qty) || 0,
    unit: it.unit || 'шт',
    cost: Number(it.cost) || 0,
  }))
}

// Приёмный акт: содержит поставщика (если задан) и позиции с себестоимостью.
export function receiveAct(doc, ctx) {
  const r = ctx.requisites || {}
  const rate = r.vatRate ?? 20
  const items = normalizeItems(doc)
  const total = items.reduce((a, it) => a + it.qty * it.cost, 0)
  const { net, vat } = splitVat(total, rate)
  const cur = esc(ctx.currency)
  const sellerReq = sellerRequisites(r, ctx.settings)
  const supplier = ctx.supplier || null
  const supplierReq = buyerRequisites(supplier || {}) // формат тот же (ИНН/КПП/адрес)

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

  const title =
    doc.type === 'stockin'
      ? `Акт оприходования № ${esc(doc.no)} от ${dateRu(doc.createdAt)}`
      : `Приёмный акт № ${esc(doc.no)} от ${dateRu(doc.createdAt)}`

  return `
    <div class="req">
      <b>${esc(ctx.company)}</b>${sellerReq ? ' · ' + sellerReq : ''}
    </div>
    <h1>${title}</h1>
    <div class="parties">
      <div><b>Получатель:</b> ${esc(ctx.company)}</div>
      ${supplier
        ? `<div><b>Поставщик:</b> ${esc(supplier.name || '—')}${supplierReq ? ' · ' + supplierReq : ''}</div>`
        : ''}
      ${doc.reason ? `<div><b>Основание:</b> ${esc(doc.reason)}</div>` : ''}
      ${doc.note ? `<div><b>Примечание:</b> ${esc(doc.note)}</div>` : ''}
    </div>
    <table>
      <thead><tr>
        <th>№</th><th>Наименование</th><th>Ед.</th>
        <th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="6">Всего позиций: <b>${items.length}</b></td></tr>
        ${rate ? `<tr><td colspan="6">Без НДС: <b>${fmt(net)} ${cur}</b> · НДС ${rate}%: <b>${fmt(vat)} ${cur}</b></td></tr>` : ''}
        <tr><td colspan="6" class="total">Итого к оприходованию: ${fmt(total)} ${cur}</td></tr>
      </tfoot>
    </table>
    <div class="words">
      <b>${rublesToWords(total)}</b>
    </div>
    <div class="sign">
      <div class="line">Сдал (поставщик)</div>
      <div class="line">Принял${r.director ? ' · ' + esc(r.director) : ''}</div>
    </div>
    <div class="sign" style="margin-top:6mm">
      <div class="line">М. П. поставщика</div>
      <div class="line">М. П. получателя</div>
    </div>`
}

// М-4 (упрощённо): для оприходования излишков без поставщика.
export function m4(doc, ctx) {
  const r = ctx.requisites || {}
  const items = normalizeItems(doc)
  const total = items.reduce((a, it) => a + it.qty * it.cost, 0)
  const cur = esc(ctx.currency)

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
    <div class="muted" style="text-align:right;margin-bottom:2mm">Унифицированная форма № М-4</div>
    <h1>Приходный ордер № ${esc(doc.no)} от ${dateRu(doc.createdAt)}</h1>
    <div class="parties">
      <div><b>Организация:</b> ${esc(ctx.company)}</div>
      <div><b>Склад:</b> —</div>
      ${doc.reason ? `<div><b>Основание:</b> ${esc(doc.reason)}</div>` : ''}
    </div>
    <table>
      <thead><tr>
        <th>№</th><th>Наименование</th><th>Ед.</th>
        <th class="r">Принято</th><th class="r">Цена</th><th class="r">Сумма</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="6" class="total">Итого: ${fmt(total)} ${cur}</td></tr>
      </tfoot>
    </table>
    <div class="words">
      Всего принято ${items.length} ${plural(items.length, ['наименование', 'наименования', 'наименований'])} на сумму:<br>
      <b>${rublesToWords(total)}</b>
    </div>
    <div class="sign">
      <div class="line">Сдал</div>
      <div class="line">Принял${r.director ? ' · ' + esc(r.director) : ''}</div>
    </div>`
}
