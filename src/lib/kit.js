// «Лёгкая техкарта» на базе комплекта. Комплект (type='kit') не хранит
// собственный остаток — при продаже он раскрывается в компоненты
// (см. posting.js expandItem), а «сколько наборов доступно» вычисляется
// на лету как минимум по компонентам.
//
//   доступно = min по всем c: floor(component.stock / component.qty)
//
// Целочисленный округление вниз: полу-собранный набор продавать нельзя.

/**
 * Вернуть, сколько наборов можно собрать из текущих остатков.
 * Если у комплекта нет components — возвращает 0 (пустой комплект
 * продавать бессмысленно).
 *
 * @param {object} kit — товар с type='kit' и components: [{productId, qty}]
 * @param {Array<object>} products — все товары (для поиска компонентов)
 * @returns {number}
 */
export function computeKitStock(kit, products) {
  if (!kit || kit.type !== 'kit') return 0
  const components = kit.components || []
  if (!components.length) return 0
  let min = Infinity
  for (const c of components) {
    const p = products.find((x) => x.id === c.productId)
    if (!p) return 0
    const per = Number(c.qty) || 0
    if (per <= 0) return 0
    const available = Math.floor((Number(p.stock) || 0) / per)
    if (available < min) min = available
    if (min === 0) return 0
  }
  return min === Infinity ? 0 : min
}

/**
 * Универсальный «сколько сейчас доступно»: для kit — computeKitStock,
 * иначе — p.stock. Использовать в UI везде, где раньше писали `p.stock`
 * напрямую для строк каталога.
 */
export function effectiveStock(p, products) {
  if (p?.type === 'kit') return computeKitStock(p, products)
  return Number(p?.stock) || 0
}
