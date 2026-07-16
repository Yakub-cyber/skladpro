// Парсер прайса из Excel (вставка как TSV / загрузка .xlsx) или CSV.
// Понимает заголовки по синонимам; без заголовка — позиционный разбор.
// Также экспортирует хелперы для визарда импорта: readFile → таблица
// (headers + rows), applyMapping → нормализованные строки.

export const IMPORT_FIELDS = [
  { key: 'sku', label: 'Артикул (SKU)', required: true },
  { key: 'name', label: 'Название', required: true },
  { key: 'category', label: 'Категория' },
  { key: 'unit', label: 'Ед. изм.' },
  { key: 'price', label: 'Цена', numeric: true },
  { key: 'cost', label: 'Себестоимость', numeric: true },
  { key: 'stock', label: 'Остаток', numeric: true },
  { key: 'minStock', label: 'Мин. остаток', numeric: true },
  { key: 'cell', label: 'Ячейка' },
  { key: 'barcode', label: 'Штрихкод' },
]

const FIELD_SYNONYMS = {
  sku: ['артикул', 'sku', 'код', 'код товара'],
  name: ['название', 'наименование', 'name', 'товар'],
  category: ['категория', 'группа', 'category', 'group'],
  unit: ['ед', 'единица', 'ед.изм', 'unit', 'ед изм'],
  price: ['цена', 'опт', 'цена опт', 'price', 'цена продажи'],
  cost: ['закуп', 'закупка', 'себест', 'себестоимость', 'cost'],
  stock: ['остаток', 'кол-во', 'количество', 'склад', 'stock', 'qty', 'остатки'],
  minStock: ['мин', 'минимум', 'min', 'мин остаток'],
  cell: ['ячейка', 'место', 'cell', 'ряд', 'локация'],
  barcode: ['штрих', 'штрихкод', 'ean', 'barcode'],
}

const POSITIONAL = ['sku', 'name', 'category', 'unit', 'price', 'cost', 'stock', 'minStock', 'cell']

const normNum = (v) => {
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, ''))
  return isNaN(n) ? 0 : n
}

function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || ''
  if (line.includes('\t')) return '\t'
  if (line.includes(';')) return ';'
  return ','
}

function splitRow(line, d) {
  return line.split(d).map((c) => c.trim().replace(/^"|"$/g, ''))
}

function matchField(header) {
  const h = header.toLowerCase().trim()
  for (const [field, syns] of Object.entries(FIELD_SYNONYMS)) {
    if (syns.some((s) => h === s || h.includes(s))) return field
  }
  return null
}

export function parsePriceTable(text, products = []) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return { rows: [], hasHeader: false, columns: [] }

  const d = detectDelimiter(text)
  const first = splitRow(lines[0], d)

  // заголовок, если хотя бы 2 колонки распознаны и в строке мало чисел
  const matched = first.map(matchField)
  const hasHeader = matched.filter(Boolean).length >= 2

  const mapping = hasHeader
    ? matched
    : POSITIONAL.slice(0, first.length)

  const bySku = {}
  for (const p of products) bySku[String(p.sku).toLowerCase()] = p

  const dataLines = hasHeader ? lines.slice(1) : lines
  const rows = dataLines
    .map((line) => {
      const cells = splitRow(line, d)
      const obj = {}
      mapping.forEach((field, i) => {
        if (!field) return
        const v = cells[i]
        if (v == null) return
        if (['price', 'cost', 'stock', 'minStock'].includes(field)) obj[field] = normNum(v)
        else obj[field] = v
      })
      if (!obj.sku && !obj.name) return null

      const existing = obj.sku ? bySku[String(obj.sku).toLowerCase()] : null
      return {
        ...obj,
        _existing: existing || null,
        _action: existing ? 'update' : 'new',
      }
    })
    .filter(Boolean)

  return { rows, hasHeader, columns: hasHeader ? first : POSITIONAL.slice(0, first.length) }
}

export const SAMPLE_TEMPLATE =
  'артикул\tназвание\tкатегория\tед\tцена\tзакупка\tостаток\tминимум\tячейка\n' +
  'КР-0070\tГвозди 3×70\tКрепёж\tкг\t98\t64\t150\t40\tA1\n' +
  'НОВ-001\tСетка сварная 50×50\tКрепёж\tрул\t1200\t850\t30\t10\tB5'

// ── Универсальный ридер для визарда импорта ──────────────────────────────
// Читает File (.xlsx / .xls / .csv / .tsv / .txt) в единую структуру:
//   { headers: string[], rows: string[][] }
// XLSX парсим через SheetJS ленивым импортом (пакет xlsx весит ~1 МБ,
// уедет в отдельный чанк — не тянется на дашборд).
export async function readImportFile(file) {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm')) {
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false, defval: '' })
    if (!aoa.length) return { headers: [], rows: [] }
    return { headers: aoa[0].map((v) => String(v ?? '').trim()), rows: aoa.slice(1).map((r) => r.map((v) => String(v ?? ''))) }
  }
  // CSV/TSV/TXT
  const text = await file.text()
  return parseTextToTable(text)
}

export function parseTextToTable(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return { headers: [], rows: [] }
  const d = detectDelimiter(text)
  return { headers: splitRow(lines[0], d), rows: lines.slice(1).map((l) => splitRow(l, d)) }
}

// Автомапинг: по заголовкам столбцов возвращает { fieldKey → columnIndex }.
// Пустое значение — «не мэпить». Если совпадений <2, отдаём позиционный
// маппинг (первые N полей ↔ первые N колонок).
export function autoMap(headers) {
  const mapping = {}
  headers.forEach((h, i) => {
    const field = matchField(h)
    if (field && mapping[field] == null) mapping[field] = i
  })
  if (Object.keys(mapping).length < 2) {
    // мало совпадений — позиционный вариант
    POSITIONAL.slice(0, headers.length).forEach((field, i) => {
      if (mapping[field] == null) mapping[field] = i
    })
  }
  return mapping
}

// Применить маппинг: rows таблицы → массив объектов { sku, name, price… }
// с проставленным _action ('update'|'new') по совпадению sku.
export function applyMapping(table, mapping, products = []) {
  const numericFields = new Set(IMPORT_FIELDS.filter((f) => f.numeric).map((f) => f.key))
  const bySku = {}
  for (const p of products) bySku[String(p.sku).toLowerCase()] = p

  return table.rows
    .map((cells, rowIdx) => {
      const obj = {}
      for (const [field, colIdx] of Object.entries(mapping)) {
        if (colIdx == null || colIdx === '' || colIdx === -1) continue
        const raw = cells[colIdx]
        if (raw == null || raw === '') continue
        obj[field] = numericFields.has(field) ? normNum(raw) : String(raw).trim()
      }
      if (!obj.sku && !obj.name) return null
      const existing = obj.sku ? bySku[String(obj.sku).toLowerCase()] : null
      return {
        ...obj,
        _existing: existing || null,
        _action: existing ? 'update' : 'new',
        _rowIdx: rowIdx + 2, // +2: строка Excel (1-я — заголовок, 2-я — данные)
      }
    })
    .filter(Boolean)
}
