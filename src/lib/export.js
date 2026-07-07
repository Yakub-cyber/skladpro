// ──────────────────────────────────────────────────────────────────────────
//  Экспорт данных в CSV (открывается в Excel/Google Sheets). Без зависимостей.
//  - разделитель ';' — так Excel в русской локали раскладывает по столбцам;
//  - UTF-8 BOM при скачивании — чтобы кириллица не превращалась в «кракозябры».
// ──────────────────────────────────────────────────────────────────────────

// Экранирование значения по правилам CSV (RFC 4180).
function esc(value, delimiter) {
  if (value == null) return ''
  const s = String(value)
  if (s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

// rows: массив объектов; columns: [{ key, label?, map?(value,row) }]
// Возвращает строку CSV (без BOM).
export function toCsv(rows, columns, { delimiter = ';' } = {}) {
  const header = columns.map((c) => esc(c.label ?? c.key, delimiter)).join(delimiter)
  const lines = (rows || []).map((row) =>
    columns
      .map((c) => esc(c.map ? c.map(row[c.key], row) : row[c.key], delimiter))
      .join(delimiter),
  )
  return [header, ...lines].join('\r\n')
}

// Сформировать CSV и скачать файлом (в браузере).
export function downloadCsv(filename, rows, columns, opts) {
  const csv = toCsv(rows, columns, opts)
  const BOM = '﻿' // Excel распознаёт UTF-8 по метке порядка байт
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  a.click()
  URL.revokeObjectURL(url)
}
