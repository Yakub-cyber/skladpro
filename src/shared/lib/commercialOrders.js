import { canonicalPayload } from './outbox'

export const COMMERCIAL_KEYS = ['commercial_create', 'commercial_edit']
export const isCommercialOrder = (o) => !!o?.commercialSnapshot || o?.commercialContractVersion === 2
const clone = (v) => JSON.parse(JSON.stringify(v))
const error = (message) => { throw new Error(message) }
const decimal = (v, scale = 4) => {
  const text = String(v)
  if (!new RegExp(`^(0|[1-9]\\d{0,11})(\\.\\d{1,${scale}})?$`).test(text)) error('Некорректное количество или сумма; уменьшите точность')
  const [a, b = ''] = text.split('.')
  return BigInt(a) * 10n ** BigInt(scale) + BigInt(b.padEnd(scale, '0'))
}
const fixed = (n, scale = 2) => `${n / 10n ** BigInt(scale)}.${String(n % 10n ** BigInt(scale)).padStart(scale, '0')}`
const round = (n, d) => (n + d / 2n) / d
export function validCommercial(c) {
  try {
    return !!c && Array.isArray(c.items) && c.items.length > 0 && c.items.length <= 500 &&
      new Set(c.items.map((l) => l.lineId)).size === c.items.length &&
      c.items.every((l) => typeof l.lineId === 'string' && typeof l.productId === 'string' && typeof l.unitId === 'string' &&
        ['qtyInput', 'qtyBase', 'unitFactor', 'price'].every((k) => typeof l[k] === 'string') && decimal(l.qtyBase) > 0n && decimal(l.price, 2) >= 0n && decimal(l.unitFactor) > 0n &&
        decimal(l.qtyInput) * decimal(l.unitFactor) === decimal(l.qtyBase) * 10000n) &&
      typeof c.total === 'string' && decimal(c.total, 2) >= 0n && typeof c.subtotal === 'string' && decimal(c.subtotal, 2) >= 0n &&
      ['percent', 'absolute'].includes(c.discount?.kind) && decimal(c.discount.value, 2) >= 0n &&
      ['kopeck', 'ruble'].includes(c.rounding) && typeof c.onCredit === 'boolean' && c.vatSummary === null && c.creditTerms === null &&
      ['unpaid', 'cash', 'credit'].includes(c.payment?.method) && ['cashPaid', 'cardPaid', 'change'].every((k) => decimal(c.payment[k], 2) === 0n)
  } catch { return false }
}
export function prepareCommercial(input, products, base, newId) {
  if (input.vatSummary != null || input.creditTerms != null) error('НДС-разбивка и дополнительные кредитные условия пока не поддерживаются')
  const payment = input.payment || (base ? base.payment : { method: 'unpaid', cashPaid: '0', cardPaid: '0', change: '0' })
  if (!['unpaid', 'cash', 'credit'].includes(payment.method) || ['cashPaid', 'cardPaid', 'change'].some((k) => decimal(payment[k] ?? 0, 2) !== 0n))
    error('Коммерческий заказ не принимает оплату. Карта, смешанная оплата и предоплата пока недоступны')
  const items = (input.items || []).map((item) => {
    const old = base?.items.find((l) => l.lineId === item.lineId)
    const p = products.find((p) => p.id === item.productId)
    if (!p || p.marked || item.markCodes?.length) error('Товар недоступен или требует неподдерживаемой маркировки')
    const unit = old || p.serverUnits?.find((u) => u.isBase && String(u.factor) === '1' && u.name === p.unit)
    if (!unit) error(`Нет подтверждённой базовой единицы товара «${p.name}». Обновите данные онлайн`)
    if (old && old.productId !== item.productId) error('Нельзя менять товар существующей строки; создайте новую строку')
    if (!old && item.unitId && item.unitId !== unit.id) error('Выбранная единица не подтверждена как базовая')
    if (!old && item.unitFactor != null && Number(item.unitFactor) !== 1) error('Новая упаковочная единица требует отдельного выбора; складская единица не угадывается')
    const qty = decimal(item.qty), factor = decimal(old?.unitFactor || '1')
    if (qty <= 0n || qty * 10000n % factor !== 0n) error('Количество нельзя точно выразить в выбранной единице')
    return { lineId: old?.lineId || item.lineId || newId(), productId: item.productId,
      name: item.name || p.name, unitId: old?.unitId || unit.id, unitFactor: old?.unitFactor || '1',
      qtyInput: fixed(qty * 10000n / factor, 4), qtyBase: fixed(qty, 4), price: fixed(decimal(item.price, 2)),
      ...(item.basePrice != null ? { basePrice: fixed(decimal(item.basePrice, 2)) } : {}) }
  })
  if (!items.length) error('Добавьте товары')
  const raw = items.reduce((sum, l) => sum + decimal(l.qtyBase) * decimal(l.price, 2), 0n)
  const discount = input.discountSpec || (base?.discount.kind === 'absolute' && !('discount' in input) ? base.discount : { kind: 'percent', value: fixed(decimal(input.discount ?? base?.discount.value ?? 0, 2)) })
  const d = decimal(discount.value, 2), rounding = input.rounding || base?.rounding || 'ruble'
  if (discount.kind === 'percent' && d > 10000n || discount.kind === 'absolute' && d * 10000n > raw) error('Скидка превышает сумму заказа')
  const payable = discount.kind === 'absolute' ? (raw - d * 10000n) * 10000n : raw * (10000n - d)
  const total = round(payable, 100000000n * (rounding === 'ruble' ? 100n : 1n)) * (rounding === 'ruble' ? 100n : 1n)
  const onCredit = !!input.onCredit
  const c = { items, customerId: input.customerId ?? base?.customerId ?? null, customerName: input.customerName ?? base?.customerName ?? null,
    no: input.no ?? base?.no ?? null, priceTypeId: input.priceTypeId ?? base?.priceTypeId ?? null, shiftId: input.shiftId ?? base?.shiftId ?? null,
    subtotal: fixed(round(raw, 10000n)), discount, total: fixed(total), rounding, onCredit, creditTerms: null,
    payment: { method: onCredit ? 'credit' : payment.method === 'credit' ? 'unpaid' : payment.method, cashPaid: '0', cardPaid: '0', change: '0' },
    vatSummary: null, address: input.address ?? base?.address ?? null, geo: input.geo ?? base?.geo ?? null,
    courier: input.courier ?? base?.courier ?? null, assignedTo: input.assignedTo ?? base?.assignedTo ?? null, priority: input.priority ?? base?.priority ?? false }
  if (onCredit && (!c.customerId || c.customerId === 'retail')) error('Для кредитного условия выберите клиента')
  if (!validCommercial(c)) error('Коммерческий состав не поддерживается')
  return c
}
export function commercialHeader(id, c, extra = {}) {
  return { id, kind: 'order', status: 'new', stockConsumed: false, ...c, ...extra,
    subtotal: Number(c.subtotal), total: Number(c.total), discount: c.discount.kind === 'percent' ? Number(c.discount.value) : 0,
    commercialSnapshot: clone(c), commercialContractVersion: 2,
    items: c.items.map((l) => ({ ...l, qty: Number(l.qtyBase), price: Number(l.price), basePrice: Number(l.basePrice ?? l.price), unitFactor: Number(l.unitFactor), unit: l.unitId })) }
}
export async function verifyCommercialResponse(key, payload, body, companyId) {
  const operation = key === 'commercial_create' ? 'create' : 'replace'
  const encoded = canonicalPayload({ companyId, operation, ...payload })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded))
  const fingerprint = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
  return body?.ok === true && body.contractVersion === 2 && body.commandId === payload.commandId &&
    body.order?.id === payload.orderId && /^[1-9]\d{0,18}$/.test(body.order.rowVersion) &&
    canonicalPayload(body.order.commercial) === canonicalPayload(payload.commercial) && body.fingerprint === fingerprint
}
export function projectCommercialOrders(rows, commands, authorities) {
  const result = new Map(rows.filter((o) => !isCommercialOrder(o)).map((o) => [o.id, o]))
  for (const a of authorities.values()) result.set(a.orderId, commercialHeader(a.orderId, a.snapshot, {
    rowVersion: a.rowVersion, commercialRowVersion: a.rowVersion, status: a.status,
    stockConsumed: a.stockConsumed, shipmentDocId: a.shipmentDocId, createdAt: a.createdAt }))
  const grouped = new Map()
  for (const op of commands) if (!op._acknowledged) {
    const id = op.obj.orderId
    if (!grouped.has(id)) grouped.set(id, [])
    grouped.get(id).push(op)
  }
  for (const [id, ops] of grouped) {
    const a = authorities.get(id), op = ops[0], payload = op.obj
    const conflict = ops.length > 1 || op._quarantined || op.key === 'commercial_edit' && a?.rowVersion !== payload.expectedRowVersion
    const row = result.get(id) || commercialHeader(id, payload.commercial)
    const preview = !conflict && (op.key === 'commercial_create' && !a || op.key === 'commercial_edit' && a?.rowVersion === payload.expectedRowVersion)
    result.set(id, { ...row,
      ...(preview ? { ...commercialHeader(id, payload.commercial), status: row.status, commercialRowVersion: a?.rowVersion } : {}),
      commercialPending: { commandId: payload.commandId, conflict: !!conflict,
        error: op._quarantineReason?.message || op._quarantineReason?.error || (ops.length > 1 ? 'Несколько изменений одной версии; требуется сверка' : null), code: op._quarantineReason?.code } })
  }
  return [...result.values()]
}
