import JsBarcode from 'jsbarcode'
import { money } from './format'

// SVG-штрихкод Code128 (сканируется реальным сканером/телефоном)
export function barcodeSVG(code) {
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    JsBarcode(svg, String(code || '0000'), {
      format: 'CODE128',
      width: 1.5,
      height: 34,
      displayValue: false,
      margin: 0,
    })
    return svg.outerHTML
  } catch {
    return ''
  }
}

// Печать листа этикеток. entries: [{ p, qty }]
export function printLabels(entries, currency = '₽') {
  const cells = entries.flatMap(({ p, qty }) =>
    Array.from({ length: Math.max(1, qty) }, () => p),
  )
  if (!cells.length) return
  const labels = cells
    .map(
      (p) => `<div class="lbl">
      <div class="nm">${esc(p.name)}</div>
      <div class="sku">Арт. ${esc(p.sku)}${p.cell ? ' · ячейка ' + esc(p.cell) : ''}</div>
      <div class="bc">${barcodeSVG(p.barcode || p.sku)}</div>
      <div class="bn">${esc(p.barcode || p.sku)}</div>
      <div class="pr">${esc(money(p.price, currency))}<span> / ${esc(p.unit)}</span></div>
    </div>`,
    )
    .join('')

  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Этикетки</title>
  <style>
    *{font-family:Arial,sans-serif;box-sizing:border-box}
    body{margin:0;padding:8mm}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm}
    .lbl{border:1px dashed #bbb;border-radius:4px;padding:6px 8px;height:34mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;overflow:hidden}
    .nm{font-size:11px;font-weight:700;line-height:1.15;max-height:2.6em;overflow:hidden}
    .sku{font-size:9px;color:#555}
    .bc{width:100%;display:flex;justify-content:center}
    .bc svg{max-width:100%}
    .bn{font-size:9px;letter-spacing:1px;color:#333;margin-top:-2px}
    .pr{font-size:15px;font-weight:800}
    .pr span{font-size:9px;font-weight:400;color:#555}
    @media print{body{padding:6mm}.lbl{border-color:#ddd}}
  </style></head><body><div class="grid">${labels}</div>
  <script>window.onload=()=>window.print()</script></body></html>`
  const w = window.open('', '_blank', 'width=900,height=900')
  if (w) {
    w.document.write(html)
    w.document.close()
  }
}

// Печать ценников (для полки/витрины — крупная цена, без штрихкода)
export function printPriceTags(entries, currency = '₽') {
  const cells = entries.flatMap(({ p, qty }) =>
    Array.from({ length: Math.max(1, qty) }, () => p),
  )
  if (!cells.length) return
  const today = new Date().toLocaleDateString('ru-RU')
  const tags = cells
    .map((p) => {
      const priceStr = new Intl.NumberFormat('ru-RU').format(p.price)
      const per = p.weighted ? 'за кг' : `за ${p.unit}`
      return `<div class="tag">
        <div class="cat">${esc(p.category || '')}</div>
        <div class="nm">${esc(p.name)}</div>
        <div class="price"><span class="rub">${priceStr}</span><span class="cur">${currency}</span></div>
        <div class="bottom"><span>${per}</span><span>${esc(p.sku)} · ${today}</span></div>
      </div>`
    })
    .join('')
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Ценники</title>
  <style>
    *{font-family:Arial,sans-serif;box-sizing:border-box}
    body{margin:0;padding:8mm}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5mm}
    .tag{border:1.5px solid #111;border-radius:6px;padding:10px 12px;height:46mm;display:flex;flex-direction:column}
    .cat{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#777}
    .nm{font-size:14px;font-weight:700;line-height:1.2;margin-top:2px;max-height:3.6em;overflow:hidden}
    .price{margin-top:auto;display:flex;align-items:baseline;gap:4px}
    .rub{font-size:42px;font-weight:800;line-height:1}
    .cur{font-size:18px;font-weight:700}
    .bottom{display:flex;justify-content:space-between;font-size:10px;color:#555;margin-top:4px;border-top:1px solid #ddd;padding-top:4px}
    @media print{body{padding:6mm}}
  </style></head><body><div class="grid">${tags}</div>
  <script>window.onload=()=>window.print()</script></body></html>`
  const w = window.open('', '_blank', 'width=900,height=900')
  if (w) {
    w.document.write(html)
    w.document.close()
  }
}

const esc = (s = '') =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
