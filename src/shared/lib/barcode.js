// Весовые штрихкоды (EAN-13 с префиксом «2»): 2 PPPPP WWWWWW C
//   2       — признак весового товара
//   PPPPP   — PLU (код товара), 5 цифр
//   WWWWWW  — вес в граммах, 6 цифр
//   C       — контрольная цифра

export function checkDigitEAN13(digits12) {
  const d = String(digits12).slice(0, 12).split('').map(Number)
  const sum = d.reduce((a, n, i) => a + n * (i % 2 === 0 ? 1 : 3), 0)
  return (10 - (sum % 10)) % 10
}

// Сгенерировать валидный штучный штрихкод EAN-13 (префикс 46 — Россия)
export function generateEan13(prefix = '46') {
  let body = String(prefix)
  while (body.length < 12) body += Math.floor(Math.random() * 10)
  body = body.slice(0, 12)
  return body + checkDigitEAN13(body)
}

// Сгенерировать весовой штрихкод по PLU и весу (кг)
export function makeWeightBarcode(plu, weightKg) {
  const p = String(plu).padStart(5, '0').slice(-5)
  const g = String(Math.round((Number(weightKg) || 0) * 1000)).padStart(6, '0').slice(-6)
  const body = '2' + p + g
  return body + checkDigitEAN13(body)
}

// Распознать весовой штрихкод → { plu, weightKg } | null
export function parseWeightBarcode(code) {
  const s = String(code).trim()
  if (!/^2\d{12}$/.test(s)) return null
  const plu = parseInt(s.slice(1, 6), 10)
  const grams = parseInt(s.slice(6, 12), 10)
  return { plu, weightKg: Math.round((grams / 1000) * 1000) / 1000 }
}

// Поиск товара по любому коду: обычный штрихкод/артикул или весовой ШК
export function resolveScan(code, products) {
  const w = parseWeightBarcode(code)
  if (w) {
    const p = products.find((x) => x.weighted && Number(x.plu) === w.plu)
    if (p) return { product: p, weightKg: w.weightKg, weighed: true }
  }
  const c = String(code).trim().toLowerCase()
  const p = products.find(
    (x) => String(x.barcode) === code || x.sku.toLowerCase() === c,
  )
  return p ? { product: p, weighed: false } : null
}
