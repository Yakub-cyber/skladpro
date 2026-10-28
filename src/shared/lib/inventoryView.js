// No fallback to products.stock or batches: missing warehouse coverage stays unknown.
export function inventoryView(products, projection, warehouseId, counts = {}) {
  return products.map((product) => {
    const view = projection.get(product.id), pair = view?.warehouses[warehouseId]
    const available = !!warehouseId && view?.available === true && !!pair
    const previous = available ? pair.projected : null
    const raw = counts[product.id], fact = raw == null || raw === '' ? null : Number(raw)
    return { product, previous, confirmed: pair?.confirmed ?? null, total: view?.total ?? null,
      available, reason: view?.reason || 'NO_WAREHOUSE_SNAPSHOT', fact,
      changed: fact !== null && Number.isFinite(fact) && available && fact !== previous,
      diff: fact !== null && available ? Math.round((fact - previous) * 10000) / 10000 : null }
  })
}
