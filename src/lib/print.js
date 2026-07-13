// ──────────────────────────────────────────────────────────────────────────
//  Печатные формы для документов из заказа:
//    - Счёт на оплату (для оплаты покупателем);
//    - ТОРГ-12 — товарная накладная (первичный документ передачи);
//    - УПД (статус 1) — универсальный передаточный документ, совмещающий
//      счёт-фактуру и накладную.
//  Математика (НДС, сумма прописью) — чистые функции, покрыты тестами.
//
//  Формы намеренно КОМПАКТНЫЕ (не пиксельные копии официального макета
//  ФНС/Госкомстата), но содержат все обязательные реквизиты для приёма
//  контрагентом: стороны + ИНН/КПП/адрес/банк, № и дата, таблица товаров
//  с ценой/НДС, подписи «отпустил/получил», сумма прописью.
// ──────────────────────────────────────────────────────────────────────────

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// Разбить сумму, включающую НДС, на «без НДС» и «в т.ч. НДС».
// rate — ставка в процентах (20, 10, 0). 0 → без налога.
export function splitVat(total, rate = 20) {
  const t = Number(total) || 0
  if (!rate) return { net: round2(t), vat: 0, rate: 0 }
  const net = t / (1 + rate / 100)
  return { net: round2(net), vat: round2(t - net), rate }
}

// ── Сумма прописью (рубли и копейки) ───────────────────────────────────────
const ONES = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать']
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто']
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот']

// Форма слова по числу: [1, 2-4, 5-20]. напр. ['рубль','рубля','рублей']
export function plural(n, forms) {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b === 1) return forms[0]
  if (b >= 2 && b <= 4) return forms[1]
  return forms[2]
}

// Три разряда (0..999) прописью. female — женский род (для тысяч).
function tri(n, female) {
  const h = Math.floor(n / 100)
  const t = Math.floor((n % 100) / 10)
  const o = n % 10
  const w = []
  if (h) w.push(HUNDREDS[h])
  if (t >= 2) {
    w.push(TENS[t])
    if (o) w.push(female ? ONES_F[o] : ONES[o])
  } else if (t === 1) {
    w.push(ONES[10 + o])
  } else if (o) {
    w.push(female ? ONES_F[o] : ONES[o])
  }
  return w.join(' ')
}

export function rublesToWords(amount) {
  // Считаем в копейках, чтобы округление корректно переносилось в рубли
  // (99.999 → 100 руб. 00 коп., а не 99 руб. 100 коп.).
  const totalKop = Math.round(Math.abs(Number(amount) || 0) * 100)
  const rub = Math.floor(totalKop / 100)
  const kop = totalKop % 100
  const parts = []
  const bil = Math.floor(rub / 1e9) % 1000
  const mil = Math.floor(rub / 1e6) % 1000
  const tho = Math.floor(rub / 1e3) % 1000
  const one = rub % 1000
  if (bil) parts.push(tri(bil, false), plural(bil, ['миллиард', 'миллиарда', 'миллиардов']))
  if (mil) parts.push(tri(mil, false), plural(mil, ['миллион', 'миллиона', 'миллионов']))
  if (tho) parts.push(tri(tho, true), plural(tho, ['тысяча', 'тысячи', 'тысяч']))
  if (one) parts.push(tri(one, false))
  let s = parts.filter(Boolean).join(' ').trim()
  if (!s) s = 'ноль'
  s = s.charAt(0).toUpperCase() + s.slice(1)
  const kopStr = String(kop).padStart(2, '0')
  return `${s} ${plural(rub, ['рубль', 'рубля', 'рублей'])} ${kopStr} ${plural(kop, ['копейка', 'копейки', 'копеек'])}`
}

// ── Общие хелперы ──────────────────────────────────────────────────────────
const esc = (s = '') =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const fmt = (n) =>
  new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)

// Открыть окно печати с готовым HTML. Возвращает окно (для тестов удобно
// внедрить фейковый window.open, а в браузере — авто-печать через <script>).
function openPrint(html) {
  if (typeof window === 'undefined' || !window.open) return null
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (w) {
    w.document.write(html)
    w.document.close()
  }
  return w
}

// Полная строка реквизитов продавца из settings.requisites — используется
// в шапке «Счёта», в блоках Продавец/Грузоотправитель ТОРГ-12 и УПД.
export function sellerRequisites(r = {}, settings = {}) {
  return [
    r.inn && `ИНН ${esc(r.inn)}`,
    r.kpp && `КПП ${esc(r.kpp)}`,
    r.address && esc(r.address),
    r.bank && `Банк: ${esc(r.bank)}`,
    r.bik && `БИК ${esc(r.bik)}`,
    r.account && `Р/с ${esc(r.account)}`,
    r.corrAccount && `К/с ${esc(r.corrAccount)}`,
  ]
    .filter(Boolean)
    .join(' · ') || esc(settings.company || '')
}

// Реквизиты покупателя из карточки клиента (используется в ТОРГ-12/УПД).
export function buyerRequisites(customer = {}) {
  return [
    customer.inn && `ИНН ${esc(customer.inn)}`,
    customer.kpp && `КПП ${esc(customer.kpp)}`,
    customer.address && esc(customer.address),
  ]
    .filter(Boolean)
    .join(' · ')
}

// Разложить строку заказа на числовые поля товарной накладной. Цена в
// заказе — с НДС (обычная розничная схема), поэтому net-цену и НДС
// вычисляем разбивкой (splitVat).
export function itemFinancials(it, rate) {
  const qty = Number(it.qty) || 0
  const gross = round2(qty * (Number(it.price) || 0)) // сумма с НДС
  const { net, vat } = splitVat(gross, rate)
  const priceNet = qty ? round2(net / qty) : 0
  return { qty, gross, net, vat, priceNet }
}

// Общий CSS для всех печатных форм. Единый макет уменьшает риск того, что
// одна форма выглядит хорошо, а другая ломается при печати.
const PRINT_CSS = `
*{font-family:Arial,sans-serif;box-sizing:border-box}
body{margin:0;padding:14mm;color:#111;font-size:12px}
h1{font-size:18px;margin:0 0 2mm}
.muted{color:#555;font-size:11px}
.req{border:1px solid #111;border-radius:4px;padding:8px 10px;font-size:11px;line-height:1.5;margin-bottom:5mm}
.parties{margin-bottom:4mm;line-height:1.6}
.parties b{display:inline-block;min-width:36mm}
table{width:100%;border-collapse:collapse;margin-top:2mm}
th,td{border:1px solid #999;padding:4px 6px}
th{background:#f0f0f0;font-size:10px;text-align:left;font-weight:600}
td.c{text-align:center}td.r{text-align:right}
tfoot td{border:none;text-align:right;font-size:12px;padding-top:3px}
.total{font-size:15px;font-weight:800}
.words{margin:4mm 0;padding:6px 0;border-top:1px solid #ccc;border-bottom:1px solid #ccc;font-size:12px}
.sign{margin-top:10mm;display:flex;justify-content:space-between;gap:20mm}
.sign .line{border-top:1px solid #111;padding-top:3px;flex:1;text-align:center;font-size:11px;color:#555}
.badge{display:inline-block;padding:2px 8px;background:#eef;border:1px solid #99a;border-radius:3px;font-size:10px;margin-left:6px}
@media print{body{padding:10mm}}
`

// order: { no, customerName, createdAt, items:[{name,qty,unit,price}], total }
// opts: { settings, customer }
export function printInvoiceBill(order, { settings = {}, customer = null } = {}) {
  const r = settings.requisites || {}
  const rate = r.vatRate ?? 20
  const items = order.items || []
  const total = items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.price) || 0), 0) || order.total || 0
  const { net, vat } = splitVat(total, rate)
  const date = new Date(order.createdAt || Date.now()).toLocaleDateString('ru-RU')
  const cur = esc(settings.currency || '₽')

  const rows = items
    .map(
      (it, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(it.name)}</td>
      <td class="c">${esc(it.unit || 'шт')}</td>
      <td class="r">${fmt(it.qty)}</td>
      <td class="r">${fmt(it.price)}</td>
      <td class="r">${fmt((Number(it.qty) || 0) * (Number(it.price) || 0))}</td>
    </tr>`,
    )
    .join('')

  const sellerReq = sellerRequisites(r, settings)
  const buyerReq = buyerRequisites(customer || {})
  const vatLine = rate
    ? `В том числе НДС ${rate}%: <b>${fmt(vat)} ${cur}</b>`
    : 'Без налога (НДС)'

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Счёт ${esc(order.no)}</title>
  <style>${PRINT_CSS}</style></head><body>
    <div class="req">
      <b>${esc(r.name || settings.company || 'Организация')}</b>${sellerReq ? ' · ' + sellerReq : ''}
    </div>
    <h1>Счёт на оплату № ${esc(order.no)} от ${date}</h1>
    <div class="parties">
      <div><b>Поставщик:</b> ${esc(r.name || settings.company || '—')}</div>
      <div><b>Покупатель:</b> ${esc(order.customerName || customer?.name || '—')}${buyerReq ? ' · ' + buyerReq : ''}</div>
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
    </div>
    <script>window.onload=()=>window.print()</script>
  </body></html>`

  return openPrint(html)
}

// ── ТОРГ-12 — товарная накладная ───────────────────────────────────────────
// Первичный документ передачи товара покупателю. Обязательные реквизиты:
// стороны с ИНН/КПП/адресами, № и дата, основание (заказ), таблица товаров
// с ценой/НДС, «отпустил / получил», сумма прописью.
// order: тот же формат, что и для «Счёта».
export function printInvoiceTORG12(order, { settings = {}, customer = null } = {}) {
  const r = settings.requisites || {}
  const rate = r.vatRate ?? 20
  const items = order.items || []
  const date = new Date(order.createdAt || Date.now()).toLocaleDateString('ru-RU')
  const cur = esc(settings.currency || '₽')

  // Суммы: считаем по каждой строке через splitVat, чтобы итог net+vat === gross
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
        <td class="c">${esc(it.unit || 'шт')}</td>
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
  const totalQty = items.reduce((a, it) => a + (Number(it.qty) || 0), 0)

  const sellerReq = sellerRequisites(r, settings)
  const buyerReq = buyerRequisites(customer || {})

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>ТОРГ-12 ${esc(order.no)}</title>
  <style>${PRINT_CSS}</style></head><body>
    <div class="req">
      <b>${esc(r.name || settings.company || 'Организация')}</b>${sellerReq ? ' · ' + sellerReq : ''}
    </div>
    <div class="muted" style="text-align:right;margin-bottom:2mm">Унифицированная форма № ТОРГ-12</div>
    <h1>Товарная накладная № ${esc(order.no)} от ${date}</h1>
    <div class="parties">
      <div><b>Грузоотправитель:</b> ${esc(r.name || settings.company || '—')}${sellerReq ? ' · ' + sellerReq : ''}</div>
      <div><b>Грузополучатель:</b> ${esc(order.customerName || customer?.name || '—')}${buyerReq ? ' · ' + buyerReq : ''}</div>
      <div><b>Поставщик:</b> ${esc(r.name || settings.company || '—')}</div>
      <div><b>Плательщик:</b> ${esc(order.customerName || customer?.name || '—')}</div>
      <div><b>Основание:</b> Заказ ${esc(order.no)} от ${date}</div>
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
    </div>
    <script>window.onload=()=>window.print()</script>
  </body></html>`

  return openPrint(html)
}

// ── УПД — Универсальный передаточный документ (статус 1) ───────────────────
// Совмещает счёт-фактуру и первичный документ передачи. Статус 1 —
// используется и как счёт-фактура, и как накладная. Кроме реквизитов
// ТОРГ-12 добавляет колонку «Страна происхождения» и явную отметку статуса.
export function printInvoiceUPD(order, { settings = {}, customer = null } = {}) {
  const r = settings.requisites || {}
  const rate = r.vatRate ?? 20
  const items = order.items || []
  const date = new Date(order.createdAt || Date.now()).toLocaleDateString('ru-RU')
  const cur = esc(settings.currency || '₽')

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
        <td class="c">${esc(it.unit || 'шт')}</td>
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

  const sellerReq = sellerRequisites(r, settings)
  const buyerReq = buyerRequisites(customer || {})

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>УПД ${esc(order.no)}</title>
  <style>${PRINT_CSS}</style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4mm">
      <div>
        <div class="muted">Приложение № 1 к постановлению Правительства РФ</div>
        <div class="muted">Форма счёта-фактуры (УПД)</div>
      </div>
      <div style="text-align:right">
        <div>Статус: <b>1</b><span class="badge">счёт-фактура и первичный документ</span></div>
      </div>
    </div>
    <h1>Универсальный передаточный документ № ${esc(order.no)} от ${date}</h1>
    <div class="parties">
      <div><b>Продавец:</b> ${esc(r.name || settings.company || '—')}${sellerReq ? ' · ' + sellerReq : ''}</div>
      <div><b>Грузоотправитель:</b> ${esc(r.name || settings.company || '—')}</div>
      <div><b>Покупатель:</b> ${esc(order.customerName || customer?.name || '—')}${buyerReq ? ' · ' + buyerReq : ''}</div>
      <div><b>Грузополучатель:</b> ${esc(order.customerName || customer?.name || '—')}</div>
      <div><b>К платёжно-расчётному документу:</b> Заказ ${esc(order.no)} от ${date}</div>
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
    </div>
    <script>window.onload=()=>window.print()</script>
  </body></html>`

  return openPrint(html)
}
