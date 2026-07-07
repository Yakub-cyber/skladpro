// ──────────────────────────────────────────────────────────────────────────
//  Печатные формы. Пока — «Счёт на оплату» из заказа.
//  Математика (НДС, сумма прописью) вынесена в чистые функции — тестируется.
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

// ── Печать «Счёта на оплату» ───────────────────────────────────────────────
const esc = (s = '') =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const fmt = (n) =>
  new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)

// order: { no, customerName, createdAt, items:[{name,qty,unit,price}], total }
// opts: { settings, customer }
export function printInvoiceBill(order, { settings = {}, customer = null } = {}) {
  const r = settings.requisites || {}
  const rate = r.vatRate ?? 20
  const items = order.items || []
  const total = items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.price) || 0), 0) || order.total || 0
  const { net, vat } = splitVat(total, rate)
  const date = new Date(order.createdAt || Date.now()).toLocaleDateString('ru-RU')

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

  const sellerReq = [
    r.inn && `ИНН ${esc(r.inn)}`,
    r.kpp && `КПП ${esc(r.kpp)}`,
    r.address && esc(r.address),
    r.bank && `Банк: ${esc(r.bank)}`,
    r.bik && `БИК ${esc(r.bik)}`,
    r.account && `Р/с ${esc(r.account)}`,
    r.corrAccount && `К/с ${esc(r.corrAccount)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  const buyerReq = [customer?.inn && `ИНН ${esc(customer.inn)}`, customer?.address && esc(customer.address)]
    .filter(Boolean)
    .join(' · ')

  const vatLine = rate
    ? `<div>В том числе НДС ${rate}%: <b>${fmt(vat)} ${esc(settings.currency || '₽')}</b></div>`
    : `<div>Без налога (НДС)</div>`

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Счёт ${esc(order.no)}</title>
  <style>
    *{font-family:Arial,sans-serif;box-sizing:border-box}
    body{margin:0;padding:14mm;color:#111;font-size:13px}
    h1{font-size:19px;margin:0 0 2mm}
    .muted{color:#555}
    .req{border:1px solid #111;border-radius:4px;padding:8px 10px;font-size:12px;line-height:1.5;margin-bottom:5mm}
    .parties{margin-bottom:5mm;line-height:1.6}
    table{width:100%;border-collapse:collapse;margin-top:2mm}
    th,td{border:1px solid #999;padding:5px 7px}
    th{background:#f0f0f0;font-size:11px;text-align:left}
    td.c{text-align:center}td.r{text-align:right}
    tfoot td{border:none;text-align:right;font-size:13px;padding-top:3px}
    .total{font-size:16px;font-weight:800}
    .words{margin:4mm 0;padding:6px 0;border-top:1px solid #ccc;border-bottom:1px solid #ccc}
    .sign{margin-top:10mm;display:flex;justify-content:space-between;gap:20mm}
    .sign .line{border-top:1px solid #111;padding-top:3px;flex:1;text-align:center;font-size:11px;color:#555}
    @media print{body{padding:10mm}}
  </style></head><body>
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
        <tr><td colspan="6">Итого без НДС: <b>${fmt(net)} ${esc(settings.currency || '₽')}</b></td></tr>
        <tr><td colspan="6">${vatLine.replace(/<\/?div>/g, '')}</td></tr>
        <tr><td colspan="6" class="total">Всего к оплате: ${fmt(total)} ${esc(settings.currency || '₽')}</td></tr>
      </tfoot>
    </table>
    <div class="words">
      Всего наименований ${items.length}, на сумму ${fmt(total)} ${esc(settings.currency || '₽')}<br>
      <b>${rublesToWords(total)}</b>
    </div>
    <div class="sign">
      <div class="line">Руководитель${r.director ? ' · ' + esc(r.director) : ''}</div>
      <div class="line">Бухгалтер${r.accountant ? ' · ' + esc(r.accountant) : ''}</div>
    </div>
    <script>window.onload=()=>window.print()</script>
  </body></html>`

  const w = window.open('', '_blank', 'width=900,height=1000')
  if (w) {
    w.document.write(html)
    w.document.close()
  }
}
