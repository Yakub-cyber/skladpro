// ──────────────────────────────────────────────────────────────────────────
//  Себестоимость: средневзвешенная скользящая (moving weighted average).
//  При каждом приходе новая себестоимость = (старый_остаток*старая_цена +
//  приход_кол*цена_прихода) / (старый_остаток + приход_кол).
//  Метод обратим при откате проводки, если сохранить прежнюю себестоимость.
// ──────────────────────────────────────────────────────────────────────────

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// Новая себестоимость после поступления партии.
// costIn == null/пусто → себестоимость не меняем (цена прихода не указана).
export function weightedCost(oldStock, oldCost, qtyIn, costIn) {
  const oc = Number(oldCost) || 0
  if (costIn == null || costIn === '' || Number.isNaN(Number(costIn))) return oc
  const os = Math.max(0, Number(oldStock) || 0)
  const qi = Number(qtyIn) || 0
  const ci = Number(costIn)
  if (qi <= 0) return oc
  if (os <= 0) return round2(ci) // склад был пуст — берём цену прихода
  return round2((os * oc + qi * ci) / (os + qi))
}
