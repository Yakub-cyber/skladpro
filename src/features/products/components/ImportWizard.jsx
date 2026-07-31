import { useMemo, useState } from 'react'
import {
  Check,
  FileUp,
  TriangleAlert,
  Download,
} from 'lucide-react'
import {
  Modal,
  Button,
  Badge,
  Textarea,
  cx,
} from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { money, num } from '@/shared/lib/format'
import { CELLS } from '@/shared/store/seed'
import {
  SAMPLE_TEMPLATE,
  readImportFile,
  parseTextToTable,
  autoMap,
  applyMapping,
  IMPORT_FIELDS,
} from '@/shared/lib/importPrice'

// ── Импорт прайса из Excel/CSV ─────────────────────────────────────────────
// Импорт-мастер в стиле CloudShop: 3 шага (файл → мапинг колонок → превью).
// Понимает .xlsx / .xls / .csv / .tsv + вставку таблицы из буфера. На каждом
// шаге видна прогресс-плашка сверху. По совпадению SKU строка помечается
// как «обновить», новая — как «добавить». Ошибки валидации (нет SKU / нет
// названия) считаются и подсвечиваются красным.
export function ImportModal({ onClose }) {
  const { products, updateProduct, addProduct } = useStore()
  const [step, setStep] = useState(1) // 1 = файл, 2 = мапинг, 3 = превью
  const [table, setTable] = useState(null) // { headers, rows }
  const [mapping, setMapping] = useState({}) // { fieldKey: colIdx }
  const [pastedText, setPastedText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(0)

  const acceptFile = async (file) => {
    setErr('')
    setBusy(true)
    try {
      const tbl = await readImportFile(file)
      if (!tbl.headers.length) throw new Error('Файл пуст или не удалось прочитать таблицу')
      setTable(tbl)
      setMapping(autoMap(tbl.headers))
      setStep(2)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const acceptText = () => {
    setErr('')
    const t = pastedText.trim()
    if (!t) return setErr('Вставьте данные из Excel')
    const tbl = parseTextToTable(t)
    if (!tbl.headers.length) return setErr('Не удалось разобрать таблицу — проверьте формат')
    setTable(tbl)
    setMapping(autoMap(tbl.headers))
    setStep(2)
  }

  const rowsPreview = useMemo(() => {
    if (!table) return []
    return applyMapping(table, mapping, products)
  }, [table, mapping, products])

  const invalidRows = rowsPreview.filter((r) => !r.sku || !r.name)
  const updCount = rowsPreview.filter((r) => r._action === 'update').length
  const newCount = rowsPreview.filter((r) => r._action === 'new').length

  const apply = () => {
    let n = 0
    for (const r of rowsPreview) {
      if (!r.sku || !r.name) continue
      if (r._action === 'update' && r._existing) {
        const patch = {}
        ;['name', 'category', 'unit', 'price', 'cost', 'minStock', 'cell', 'barcode'].forEach((k) => {
          if (r[k] != null && r[k] !== '') patch[k] = r[k]
        })
        if (r.stock != null && r.stock !== '') patch.stock = r.stock
        updateProduct(r._existing.id, patch)
      } else {
        addProduct({
          sku: r.sku,
          name: r.name,
          category: r.category || 'Расходники',
          unit: r.unit || 'шт',
          price: r.price || 0,
          cost: r.cost || 0,
          minStock: r.minStock || 0,
          cell: r.cell || CELLS[0].id,
          stock: r.stock || 0,
          barcode: r.barcode || '',
        })
      }
      n++
    }
    setDone(n)
    setTimeout(onClose, 1500)
  }

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + SAMPLE_TEMPLATE.replace(/\t/g, ';')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'shablon-praysa.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Импорт товаров"
      wide
      footer={
        <>
          <Button variant="ghost" icon={Download} onClick={downloadTemplate} className="mr-auto">
            Шаблон
          </Button>
          {step > 1 && !done && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Назад
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          {step === 2 && (
            <Button onClick={() => setStep(3)} disabled={!rowsPreview.length}>
              Далее
            </Button>
          )}
          {step === 3 && (
            <Button
              onClick={apply}
              disabled={!rowsPreview.length || done > 0 || invalidRows.length === rowsPreview.length}
              icon={Check}
            >
              {done ? `Готово: ${done}` : `Импортировать (${rowsPreview.length - invalidRows.length})`}
            </Button>
          )}
        </>
      }
    >
      <ImportSteps step={step} />
      {err && <div className="mb-3 text-[13px] text-bad">{err}</div>}

      {step === 1 && (
        <ImportStepFile
          onFile={acceptFile}
          pastedText={pastedText}
          setPastedText={setPastedText}
          onPasteContinue={acceptText}
          busy={busy}
        />
      )}
      {step === 2 && table && (
        <ImportStepMapping
          table={table}
          mapping={mapping}
          setMapping={setMapping}
        />
      )}
      {step === 3 && table && (
        <ImportStepPreview
          rows={rowsPreview}
          updCount={updCount}
          newCount={newCount}
          invalidRows={invalidRows}
        />
      )}
    </Modal>
  )
}

function ImportSteps({ step }) {
  const items = [
    { n: 1, label: 'Файл' },
    { n: 2, label: 'Колонки' },
    { n: 3, label: 'Превью' },
  ]
  return (
    <div className="flex items-center gap-2 mb-4">
      {items.map((it, i) => (
        <div key={it.n} className="flex items-center gap-2 flex-1">
          <div
            className={cx(
              'h-7 w-7 rounded-full grid place-items-center text-[12px] font-semibold shrink-0',
              step > it.n
                ? 'bg-ok text-white'
                : step === it.n
                  ? 'bg-brand text-brand-ink'
                  : 'bg-surface-2 text-muted',
            )}
          >
            {step > it.n ? <Check size={13} /> : it.n}
          </div>
          <div className={cx('text-[13px] font-medium', step >= it.n ? 'text-ink' : 'text-muted')}>
            {it.label}
          </div>
          {i < items.length - 1 && <div className="flex-1 h-0.5 bg-surface-2 rounded" />}
        </div>
      ))}
    </div>
  )
}

function ImportStepFile({ onFile, pastedText, setPastedText, onPasteContinue, busy }) {
  const [drag, setDrag] = useState(false)
  const onDrop = (e) => {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onFile(f)
  }
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 rounded-xl bg-info-soft text-info text-[13px]">
        <TriangleAlert size={16} className="shrink-0 mt-0.5" />
        <span>
          Поддерживаются Excel (.xlsx, .xls) и CSV/TSV. На следующем шаге вы укажете, какая
          колонка соответствует какому полю товара — автомап сработает по русским
          заголовкам, и вы сможете его подправить.
        </span>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx(
          'rounded-2xl border-2 border-dashed p-8 text-center transition',
          drag ? 'border-brand bg-brand-soft' : 'border-line bg-surface-2',
        )}
      >
        <FileUp size={40} className="mx-auto mb-3 text-muted" />
        <div className="font-semibold mb-1">Перетащите файл сюда</div>
        <div className="text-[12px] text-muted mb-4">
          Excel (.xlsx, .xls) или CSV / TSV
        </div>
        <label className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-brand text-brand-ink text-sm font-medium cursor-pointer hover:opacity-90">
          <FileUp size={16} /> {busy ? 'Читаем…' : 'Выбрать файл'}
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            className="hidden"
          />
        </label>
      </div>

      <div className="relative flex items-center gap-3 text-[12px] text-muted my-3">
        <div className="flex-1 h-px bg-line" />
        или вставьте из буфера
        <div className="flex-1 h-px bg-line" />
      </div>

      <Textarea
        value={pastedText}
        onChange={(e) => setPastedText(e.target.value)}
        rows={5}
        placeholder="Скопируйте строки из Excel (Ctrl+C) и вставьте сюда"
        className="font-mono text-[12px]"
      />
      <div className="flex justify-end">
        <Button icon={Check} disabled={!pastedText.trim()} onClick={onPasteContinue}>
          Продолжить
        </Button>
      </div>
    </div>
  )
}

function ImportStepMapping({ table, mapping, setMapping }) {
  const setField = (field, colIdx) => {
    setMapping((m) => {
      const n = { ...m }
      if (colIdx === '' || colIdx == null) delete n[field]
      else n[field] = Number(colIdx)
      return n
    })
  }
  return (
    <div className="space-y-4">
      <div className="text-[13px] text-muted">
        Автомап уже сработал по заголовкам. Проверьте: каждой сущности слева должна соответствовать
        нужная колонка справа. Обязательные — «Артикул» и «Название».
      </div>

      <div className="border border-line rounded-xl overflow-hidden">
        {IMPORT_FIELDS.map((f) => (
          <div
            key={f.key}
            className="flex items-center gap-3 px-3 py-2 border-b border-line last:border-b-0"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium flex items-center gap-1.5">
                {f.label}
                {f.required && <span className="text-bad">*</span>}
              </div>
              <div className="text-[11px] text-muted">
                {f.key}
                {f.numeric && ' · число'}
              </div>
            </div>
            <select
              value={mapping[f.key] ?? ''}
              onChange={(e) => setField(f.key, e.target.value)}
              className={cx(
                'h-9 px-2 rounded-lg bg-surface-2 border text-[13px] outline-none focus:border-brand min-w-[180px]',
                f.required && mapping[f.key] == null ? 'border-bad' : 'border-line',
              )}
            >
              <option value="">— не импортировать —</option>
              {table.headers.map((h, i) => (
                <option key={i} value={i}>
                  {String.fromCharCode(65 + i)}. {h || `(колонка ${i + 1})`}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <details className="rounded-xl bg-surface-2 border border-line p-3 text-[13px]">
        <summary className="cursor-pointer font-medium text-muted">
          Превью первых 5 строк вашего файла
        </summary>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-muted">
                {table.headers.map((h, i) => (
                  <th key={i} className="py-1.5 px-2 font-medium text-left border-b border-line">
                    {String.fromCharCode(65 + i)}. {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.slice(0, 5).map((row, i) => (
                <tr key={i} className="border-b border-line last:border-b-0">
                  {row.map((v, j) => (
                    <td key={j} className="py-1 px-2 truncate max-w-[160px]">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function ImportStepPreview({ rows, updCount, newCount, invalidRows }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
        <Badge tone="brand">Всего: {rows.length}</Badge>
        <Badge tone="ok">Обновится: {updCount}</Badge>
        <Badge tone="info">Новых: {newCount}</Badge>
        {invalidRows.length > 0 && (
          <Badge tone="bad">С ошибками (пропустится): {invalidRows.length}</Badge>
        )}
      </div>
      <div className="border border-line rounded-xl overflow-hidden max-h-[46vh] overflow-y-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-2 sticky top-0">
            <tr className="text-muted text-left">
              <th className="py-2 px-3 font-medium">#</th>
              <th className="py-2 px-3 font-medium">Артикул</th>
              <th className="py-2 px-3 font-medium">Название</th>
              <th className="py-2 px-3 font-medium">Категория</th>
              <th className="py-2 px-3 font-medium text-right">Цена</th>
              <th className="py-2 px-3 font-medium text-right">Себест.</th>
              <th className="py-2 px-3 font-medium text-right">Остаток</th>
              <th className="py-2 px-3 font-medium">Действие</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.slice(0, 200).map((r, i) => {
              const bad = !r.sku || !r.name
              return (
                <tr key={i} className={bad ? 'bg-bad-soft/30' : ''}>
                  <td className="py-1.5 px-3 tabular-nums text-muted">{r._rowIdx}</td>
                  <td className="py-1.5 px-3 tabular-nums">{r.sku || <span className="text-bad">—</span>}</td>
                  <td className="py-1.5 px-3 truncate max-w-[200px]">
                    {r.name || <span className="text-bad">нет названия</span>}
                  </td>
                  <td className="py-1.5 px-3 text-muted">{r.category || '—'}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">
                    {r.price ? money(r.price) : '—'}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-muted">
                    {r.cost ? money(r.cost) : '—'}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums">
                    {r.stock != null ? num(r.stock) : '—'}
                  </td>
                  <td className="py-1.5 px-3">
                    {bad ? (
                      <Badge tone="bad">пропустится</Badge>
                    ) : (
                      <Badge tone={r._action === 'update' ? 'ok' : 'info'}>
                        {r._action === 'update' ? 'обновить' : 'новый'}
                      </Badge>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length > 200 && (
          <div className="text-[12px] text-muted text-center py-2 border-t border-line">
            показаны первые 200 строк, будут импортированы все
          </div>
        )}
      </div>
    </div>
  )
}
