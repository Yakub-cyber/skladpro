// НДС в товарах. Раньше vatRate жил только в реквизитах компании
// (settings.company.vatRate) и рисовался в печатных формах. Теперь у
// каждого товара может быть своя ставка (product.vatRate: 0 | 10 | 20 |
// null). Итоговый НДС по чеку/накладной считается позициями, а не
// пропорцией от суммы.

// Стандартные ставки для РФ.
export const VAT_RATES = [
  { key: 'none', value: null, label: 'Без НДС' },
  { key: '0', value: 0, label: '0%' },
  { key: '10', value: 10, label: '10% (продукты, детские)' },
  { key: '20', value: 20, label: '20% (общая)' },
]

// Эффективная ставка для позиции чека:
//   1) product.vatRate явно задан → берём его;
//   2) иначе settings.company.vatRate (fallback компании);
//   3) иначе 20 (стандарт РФ), чтобы старые печатные формы не сломались.
export function effectiveVat(product, settings = {}) {
  const p = product?.vatRate
  if (p !== undefined && p !== null) return Number(p)
  const c = settings?.company?.vatRate
  if (c !== undefined && c !== null) return Number(c)
  return 20
}

// Разложить сумму с НДС на «база» + «НДС».
//   gross — цена с НДС;
//   rate  — ставка (например, 20).
// Возвращает { net, vat, gross }.
export function extractVat(gross, rate) {
  const g = Number(gross) || 0
  const r = Number(rate) || 0
  if (r <= 0) return { net: g, vat: 0, gross: g }
  const net = Math.round((g / (1 + r / 100)) * 100) / 100
  const vat = Math.round((g - net) * 100) / 100
  return { net, vat, gross: g }
}

// Свёртка НДС по массиву items и заданным настройкам. Возвращает
// разбивку по ставкам + агрегаты. items — { productId, qty, price }.
// products — массив каталога, чтобы найти product.vatRate.
export function computeVatSummary(items = [], products = [], settings = {}) {
  const byRate = {}
  let totalNet = 0
  let totalVat = 0
  let totalGross = 0
  for (const it of items) {
    const gross = (Number(it.qty) || 0) * (Number(it.price) || 0)
    const prod = products.find((p) => p.id === it.productId)
    const rate = effectiveVat(prod, settings)
    const { net, vat } = extractVat(gross, rate)
    if (!byRate[rate]) byRate[rate] = { rate, net: 0, vat: 0, gross: 0 }
    byRate[rate].net += net
    byRate[rate].vat += vat
    byRate[rate].gross += gross
    totalNet += net
    totalVat += vat
    totalGross += gross
  }
  const round2 = (n) => Math.round(n * 100) / 100
  return {
    net: round2(totalNet),
    vat: round2(totalVat),
    gross: round2(totalGross),
    byRate: Object.values(byRate).map((r) => ({
      rate: r.rate,
      net: round2(r.net),
      vat: round2(r.vat),
      gross: round2(r.gross),
    })),
  }
}
