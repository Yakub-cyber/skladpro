// Шаблоны печатных форм для продажи: Счёт, ТОРГ-12, УПД, товарный чек,
// ярлык доставки. Возвращают ТОЛЬКО тело <body> — обёртку (<!doctype>,
// <head>, <style>) добавляет printFrame из lib/printCore.
//
// Работают и с order (state.orders), и с sale-документом (state.documents).
// Различие маскируется: если у doc нет items с price — берём из document.
import {
  esc,
  fmt,
  _round2 as round2,
  sellerRequisites,
  buyerRequisites,
  splitVat,
  itemFinancials,
  plural,
  rublesToWords,
} from '../print'

const dateRu = (iso) => new Date(iso || Date.now()).toLocaleDateString('ru-RU')

// Универсально достаём items с ценой. У складского sale-документа в items
// может быть price (мы сохраняем при создании через SaleTab), у старого
// формата — только qty/name. Прочерком не мешаем — просто выводим 0.
function normalizeItems(doc) {
  return (doc.items || []).map((it) => ({
    name: it.name || '',
    qty: Number(it.qty) || 0,
    unit: it.unit || 'шт',
    price: Number(it.price) || 0,
    country: it.country || '',
  }))
}

// ── Счёт на оплату ────────────────────────────────────────────────────────
export function bill(doc, ctx) {
  const r = ctx.requisites || {}
  const rate = r.vatRate ?? 20
  const items = normalizeItems(doc)
  const total = items.reduce((a, it) => a + it.qty * it.price, 0) || Number(doc.total) || 0
  const { net, vat } = splitVat(total, rate)
  const cur = esc(ctx.currency)
  const sellerReq = sellerRequisites(r, ctx.settings)
  const buyerReq = buyerRequisites(ctx.customer || {})

  const rows = items
    .map(
      (it, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.name)}</td>
      <td class="c">${esc(it.unit)}</td>
      <td class="r">${fmt(it.qty)}</td>
      <td class="r">${fmt(it.price)}</td>
      <td class="r">${fmt(it.qty * it.price)}</td>
    </tr>`,
    )
    .join('')

  const vatLine = rate
    ? `В том числе НДС ${rate}%: <b>${fmt(vat)} ${cur}</b>`
    : 'Без налога (НДС)'

  return `
    <div class="req">
      <b>${esc(ctx.company)}</b>${sellerReq ? ' · ' + sellerReq : ''}
    </div>
    <h1>Счёт на оплату № ${esc(doc.no)} от ${dateRu(doc.createdAt)}</h1>
    <div class="parties">
      <div><b>Поставщик:</b> ${esc(ctx.company)}</div>
      <div><b>Покупатель:</b> ${esc(ctx.customer?.name || '—')}${buyerReq ? ' · ' + buyerReq : ''}</div>
    </div>
    <table>
      <thead><tr><th>№</th><th>Наименование</th><th>Ед.</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="6">Итого без НДС: <b>${fmt(net)} ${cur}</b></td></tr>
        <tr><td colspan="6">${vatLine}</td></tr>
        <tr><td colspan="6" class="total">Всего к оплате: ${fmt(total)} ${cur}</td></tr>
      </tfoot>
    </table>
    <div class="words">
      Всего наименований ${items.length}, на сумму ${fmt(total)} ${cur}<br>
      <b>${rublesToWords(total)}</b>
    </div>
    <div class="sign">
      <div class="line">Руководитель${r.director ? ' · ' + esc(r.director) : ''}</div>
      <div class="line">Бухгалтер${r.accountant ? ' · ' + esc(r.accountant) : ''}</div>
    </div>`
}

// ── ТОРГ-12 ───────────────────────────────────────────────────────────────
export function torg12(doc, ctx) {
  const r = ctx.requisites || {}
  const rate = r.vatRate ?? 20
  const items = normalizeItems(doc)
  const cur = esc(ctx.currency)
  const sellerReq = sellerRequisites(r, ctx.settings)
  const buyerReq = buyerRequisites(ctx.customer || {})

  let totalNet = 0
  let totalVat = 0
  let totalGross = 0
  const rows = items
    .map((it, i) => {
      const f = itemFinancials(it, rate)
      totalNet += f.net
      totalVat += f.vat
      totalGross += f.gross
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(it.name)}</td>
        <td class="c">${esc(it.unit)}</td>
        <td class="r">${fmt(f.qty)}</td>
        <td class="r">${fmt(f.priceNet)}</td>
        <td class="r">${fmt(f.net)}</td>
        <td class="c">${rate ? rate + '%' : 'без НДС'}</td>
        <td class="r">${fmt(f.vat)}</td>
        <td class="r">${fmt(f.gross)}</td>
      </tr>`
    })
    .join('')
  totalNet = round2(totalNet)
  totalVat = round2(totalVat)
  totalGross = round2(totalGross)
  const totalQty = items.reduce((a, it) => a + it.qty, 0)

  return `
    <div class="req">
      <b>${esc(ctx.company)}</b>${sellerReq ? ' · ' + sellerReq : ''}
    </div>
    <div class="muted" style="text-align:right;margin-bottom:2mm">Унифицированная форма № ТОРГ-12</div>
    <h1>Товарная накладная № ${esc(doc.no)} от ${dateRu(doc.createdAt)}</h1>
    <div class="parties">
      <div><b>Грузоотправитель:</b> ${esc(ctx.company)}${sellerReq ? ' · ' + sellerReq : ''}</div>
      <div><b>Грузополучатель:</b> ${esc(ctx.customer?.name || '—')}${buyerReq ? ' · ' + buyerReq : ''}</div>
      <div><b>Поставщик:</b> ${esc(ctx.company)}</div>
      <div><b>Плательщик:</b> ${esc(ctx.customer?.name || '—')}</div>
      <div><b>Основание:</b> ${esc(doc.reason || 'Заказ ' + doc.no + ' от ' + dateRu(doc.createdAt))}</div>
    </div>
    <table>
      <thead><tr>
        <th>№</th><th>Наименование товара</th><th>Ед.</th>
        <th class="r">Кол-во</th><th class="r">Цена без НДС</th><th class="r">Сумма без НДС</th>
        <th class="c">Ставка НДС</th><th class="r">Сумма НДС</th><th class="r">Всего с НДС</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="text-align:right">Итого:</td>
          <td class="r"><b>${fmt(totalQty)}</b></td>
          <td></td>
          <td class="r"><b>${fmt(totalNet)}</b></td>
          <td></td>
          <td class="r"><b>${fmt(totalVat)}</b></td>
          <td class="r"><b>${fmt(totalGross)}</b></td>
        </tr>
      </tfoot>
    </table>
    <div class="words">
      Всего отпущено ${items.length} ${plural(items.length, ['наименование', 'наименования', 'наименований'])},
      на сумму ${fmt(totalGross)} ${cur}<br>
      <b>${rublesToWords(totalGross)}</b>
    </div>
    <div class="sign">
      <div class="line">Отпустил${r.director ? ' · ' + esc(r.director) : ''}</div>
      <div class="line">Принял</div>
    </div>
    <div class="sign" style="margin-top:6mm">
      <div class="line">Главный бухгалтер${r.accountant ? ' · ' + esc(r.accountant) : ''}</div>
      <div class="line">М. П.</div>
    </div>`
}

// ── УПД (статус 1) ────────────────────────────────────────────────────────
export function upd(doc, ctx) {
  const r = ctx.requisites || {}
  const rate = r.vatRate ?? 20
  const items = normalizeItems(doc)
  const cur = esc(ctx.currency)
  const sellerReq = sellerRequisites(r, ctx.settings)
  const buyerReq = buyerRequisites(ctx.customer || {})

  let totalNet = 0
  let totalVat = 0
  let totalGross = 0
  const rows = items
    .map((it, i) => {
      const f = itemFinancials(it, rate)
      totalNet += f.net
      totalVat += f.vat
      totalGross += f.gross
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(it.name)}</td>
        <td class="c">${esc(it.unit)}</td>
        <td class="r">${fmt(f.qty)}</td>
        <td class="r">${fmt(f.priceNet)}</td>
        <td class="r">${fmt(f.net)}</td>
        <td class="c">${rate ? rate + '%' : 'без НДС'}</td>
        <td class="r">${fmt(f.vat)}</td>
        <td class="r">${fmt(f.gross)}</td>
        <td class="c">${esc(it.country || '—')}</td>
      </tr>`
    })
    .join('')
  totalNet = round2(totalNet)
  totalVat = round2(totalVat)
  totalGross = round2(totalGross)

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4mm">
      <div>
        <div class="muted">Приложение № 1 к постановлению Правительства РФ</div>
        <div class="muted">Форма счёта-фактуры (УПД)</div>
      </div>
      <div style="text-align:right">
        <div>Статус: <b>1</b><span class="badge">счёт-фактура и первичный документ</span></div>
      </div>
    </div>
    <h1>Универсальный передаточный документ № ${esc(doc.no)} от ${dateRu(doc.createdAt)}</h1>
    <div class="parties">
      <div><b>Продавец:</b> ${esc(ctx.company)}${sellerReq ? ' · ' + sellerReq : ''}</div>
      <div><b>Грузоотправитель:</b> ${esc(ctx.company)}</div>
      <div><b>Покупатель:</b> ${esc(ctx.customer?.name || '—')}${buyerReq ? ' · ' + buyerReq : ''}</div>
      <div><b>Грузополучатель:</b> ${esc(ctx.customer?.name || '—')}</div>
      <div><b>К платёжно-расчётному документу:</b> ${esc(doc.reason || 'Заказ ' + doc.no + ' от ' + dateRu(doc.createdAt))}</div>
    </div>
    <table>
      <thead><tr>
        <th>№</th><th>Наименование</th><th>Ед.</th>
        <th class="r">Кол-во</th><th class="r">Цена без НДС</th><th class="r">Сумма без НДС</th>
        <th class="c">НДС</th><th class="r">Сумма НДС</th><th class="r">Всего с НДС</th><th class="c">Страна</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="5" style="text-align:right">Всего к оплате:</td>
          <td class="r"><b>${fmt(totalNet)}</b></td>
          <td></td>
          <td class="r"><b>${fmt(totalVat)}</b></td>
          <td class="r total">${fmt(totalGross)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
    <div class="words">
      Сумма к оплате: ${fmt(totalGross)} ${cur}<br>
      <b>${rublesToWords(totalGross)}</b>
    </div>
    <div class="sign">
      <div class="line">Руководитель${r.director ? ' · ' + esc(r.director) : ''}</div>
      <div class="line">Главный бухгалтер${r.accountant ? ' · ' + esc(r.accountant) : ''}</div>
    </div>
    <div class="sign" style="margin-top:6mm">
      <div class="line">Товар (груз) передал${r.director ? ' · ' + esc(r.director) : ''}</div>
      <div class="line">Товар (груз) получил</div>
    </div>`
}

// ── Товарный чек ──────────────────────────────────────────────────────────
// Короткая форма для розницы: компания сверху, список товаров с ценой,
// итог. Реквизиты покупателя не обязательны.
export function cheque(doc, ctx) {
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

  return `
    <div style="text-align:center;margin-bottom:6mm">
      <h1 style="font-size:16px">Товарный чек № ${esc(doc.no)} от ${dateRu(doc.createdAt)}</h1>
      <div class="muted">${esc(ctx.company)}${r.address ? ' · ' + esc(r.address) : ''}</div>
      ${r.phone ? `<div class="muted">Тел.: ${esc(r.phone)}</div>` : ''}
    </div>
    <table>
      <thead><tr><th>№</th><th>Наименование</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="5" class="total">ИТОГО: ${fmt(total)} ${cur}</td></tr>
      </tfoot>
    </table>
    <div class="words" style="text-align:center">
      <b>${rublesToWords(total)}</b>
    </div>
    <div class="sign">
      <div class="line">Продавец${r.director ? ' · ' + esc(r.director) : ''}</div>
      <div class="line">Покупатель${ctx.customer?.name ? ' · ' + esc(ctx.customer.name) : ''}</div>
    </div>`
}

// ── Ярлык доставки ────────────────────────────────────────────────────────
// Для наклейки на посылку: получатель крупно, адрес, курьер, номер заказа.
export function waybill(doc, ctx) {
  const r = ctx.requisites || {}
  const items = normalizeItems(doc)
  const totalQty = items.reduce((a, it) => a + it.qty, 0)

  return `
    <div style="border:2px solid #111;border-radius:6px;padding:10mm;margin-bottom:4mm">
      <div class="muted" style="margin-bottom:2mm">ЗАКАЗ № ${esc(doc.no)} от ${dateRu(doc.createdAt)}</div>
      <div style="font-size:20px;font-weight:800;margin-bottom:3mm">${esc(ctx.customer?.name || '—')}</div>
      <div style="font-size:14px;margin-bottom:3mm">${esc(doc.address || ctx.customer?.address || '—')}</div>
      ${ctx.customer?.phone ? `<div style="font-size:14px">Тел.: <b>${esc(ctx.customer.phone)}</b></div>` : ''}
    </div>
    <div class="parties" style="line-height:1.7">
      <div><b>Отправитель:</b> ${esc(ctx.company)}${r.phone ? ' · тел. ' + esc(r.phone) : ''}</div>
      <div><b>Курьер / способ:</b> ${esc(doc.courier || '—')}</div>
      <div><b>Позиций:</b> ${items.length} · <b>Штук:</b> ${fmt(totalQty)}</div>
      ${doc.total ? `<div><b>К оплате при получении:</b> ${fmt(doc.total)} ${esc(ctx.currency)}</div>` : ''}
    </div>
    <div class="sign" style="margin-top:12mm">
      <div class="line">Отправил</div>
      <div class="line">Принял</div>
    </div>`
}
