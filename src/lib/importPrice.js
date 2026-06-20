// Парсер прайса из Excel (вставка как TSV) или CSV.
// Понимает заголовки по синонимам; без заголовка — позиционный разбор.

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
