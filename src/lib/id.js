// Генерация id и номеров документов.

let counter = Math.floor(Math.random() * 1000)

export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`

// Номер документа вида ПР-2026-0007
export const docNo = (prefix, seq) =>
  `${prefix}-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

export const sum = (arr, key) =>
  arr.reduce((acc, x) => acc + (key ? Number(x[key]) || 0 : Number(x) || 0), 0)
