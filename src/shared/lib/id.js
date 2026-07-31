// Генерация id и номеров документов.

let counter = Math.floor(Math.random() * 1000)

export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`

// Номер документа вида ПР-2026-0007
export const docNo = (prefix, seq) =>
  `${prefix}-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`

// Следующий уникальный номер для коллекции документов. Раньше писалось
// `collection.length + N`, но это ломалось в 3 случаях:
//   - две вкладки одновременно addOrder → одинаковый seq → одинаковый no;
//   - cancelOrder не удаляет запись, но следующий addOrder использует
//     length → тот же seq;
//   - импорт документов извне (Supabase pull) добавляет записи, но
//     length следующего addOrder не учитывает их «настоящих» seq.
//
// Решение: считать `max(seq в текущем году, prefix совпадает) + 1`, а
// не `length`. Работает для всех коллекций с полем `no` формата
// `ПРЕФИКС-ГОД-XXXX`.
export function nextNo(collection = [], prefix) {
  const y = new Date().getFullYear()
  const re = new RegExp('^' + prefix + '-' + y + '-(\\d+)$')
  let max = 0
  for (const item of collection) {
    const m = item?.no && String(item.no).match(re)
    if (m) {
      const n = Number(m[1])
      if (n > max) max = n
    }
  }
  return docNo(prefix, max + 1)
}

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

export const sum = (arr, key) =>
  arr.reduce((acc, x) => acc + (key ? Number(x[key]) || 0 : Number(x) || 0), 0)
