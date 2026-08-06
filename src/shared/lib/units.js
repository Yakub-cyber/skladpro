export function unitFactor(product, unit) {
  if (!unit || !product?.units?.length) return 1
  const entry = product.units.find((u) => u.unit === unit)
  return entry?.factor || 1
}

export function normalizeItemQty(item, product) {
  if (item.unitFactor != null) return item
  const f = unitFactor(product, item.unit)
  if (f === 1) return item
  return {
    ...item,
    qty: (Number(item.qty) || 0) * f,
    inputQty: item.qty,
    inputUnit: item.unit,
    unitFactor: f,
  }
}

export function normalizeItems(items, products) {
  return (items || []).map((it) => {
    const p = products.find((x) => x.id === it.productId)
    return normalizeItemQty(it, p)
  })
}
