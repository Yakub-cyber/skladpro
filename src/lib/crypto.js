// ──────────────────────────────────────────────────────────────────────────
//  Хэширование PIN сотрудника (локально, без выгрузки в облако).
//
//  Зачем:
//    - PIN — короткий (4 цифры), лёгкий для брутфорса. Открытым текстом в БД
//      его хранить нельзя: любой сотрудник компании прочитает PIN админа
//      через Supabase API (см. RLS для employees).
//    - Синхронизировать даже хэшированный PIN нет смысла: 10 000 вариантов
//      подбираются за миллисекунды. Поэтому PIN не уходит в облако вообще
//      (см. LOCAL_ONLY_EMPLOYEE_FIELDS в cloud.js).
//    - Локальный хэш нужен, чтобы PIN не был виден «глазами» в localStorage
//      и в devtools стора; это единственная реальная защита от беглого
//      подсматривания. Полноценная защита от компрометации устройства —
//      уже вне этой утилиты.
//
//  Схема: SHA-256(pin + SALT), hex 64 символа. Соль — константа приложения.
//  Легаси-совместимость: verifyPin принимает и открытый PIN (для seed/демо и
//  для карточек до миграции), и возвращает флаг legacy, чтобы вызывающая
//  сторона могла лениво обновить запись на хэш.
// ──────────────────────────────────────────────────────────────────────────

const SALT = 'sklad-pin-v1'

// SubtleCrypto доступен в браузере (secure context / localhost) и в Node 20+
// (тесты Vitest в environment: 'node').
function subtle() {
  const c = globalThis.crypto
  if (!c?.subtle) throw new Error('SubtleCrypto недоступен: обновите браузер')
  return c.subtle
}

function toHex(buf) {
  const b = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0')
  return s
}

const enc = new TextEncoder()

export async function hashPin(pin) {
  const raw = String(pin ?? '')
  if (!raw) return ''
  const buf = await subtle().digest('SHA-256', enc.encode(raw + SALT))
  return toHex(buf)
}

// Хэшированный PIN — ровно 64 hex-символа. Всё остальное трактуем как legacy
// (открытый PIN, оставшийся с прошлых версий или в seed-данных демо).
export function isHashedPin(stored) {
  return typeof stored === 'string' && /^[0-9a-f]{64}$/.test(stored)
}

// Сравнить введённый PIN с сохранённым.
// Возврат: { ok: boolean, legacy?: boolean }
//   ok=true, legacy=true → совпало с открытым legacy-значением, вызывающая
//   сторона должна перезаписать хранимый PIN на hashPin(pin) (ленивая миграция).
export async function verifyPin(pin, stored) {
  const raw = String(pin ?? '')
  const s = String(stored ?? '')
  if (!s) return { ok: false }
  if (isHashedPin(s)) {
    const h = await hashPin(raw)
    return { ok: h === s }
  }
  // legacy: PIN лежит открытым текстом (seed или старая версия persist)
  return { ok: raw === s, legacy: true }
}
