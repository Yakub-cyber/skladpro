import { useMemo, useState } from 'react'
import {
  Sparkles,
  Wand2,
  Printer,
  Save,
  Trash2,
  Plus,
  FileText,
  Check,
  CircleAlert,
  ArrowDownToLine,
  ArrowUpFromLine,
} from 'lucide-react'
import {
  Card,
  Button,
  Badge,
  Field,
  Select,
  Input,
  Empty,
  cx,
} from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num, dateFull } from '../lib/format'
import { parseInvoiceText, aiParseInvoice } from '../lib/ai'
import { priceFor } from '../lib/constants'

const EXAMPLES = [
  'Гвозди 100шт, Молоток слесалный 5шт, Саморез по дереву 3.5x40 20 уп',
  'Кабель ВВГ 3x2.5 200м\nАвтомат C16 15шт\nРозетка 30\nГофра 20мм 150 м',
  'Труба ППР 25мм 80м, кран шаровый 1/2 12 шт, фитинг муфта 25 — 40',
]

export default function Invoices() {
  const { products, customers, suppliers, invoices, settings, priceTypes, addInvoice, receiveStock } =
    useStore()
  const defType = priceTypes.find((t) => t.default)?.id || priceTypes[0]?.id
  const [kind, setKind] = useState('out') // out — расход (клиенту), in — приход (от поставщика)
  const [text, setText] = useState('')
  const [items, setItems] = useState(null)
  const [party, setParty] = useState('')
  const [priceTypeId, setPriceTypeId] = useState(defType)
  const [applyStock, setApplyStock] = useState(true)
  const [busy, setBusy] = useState(false)
  const [aiMode, setAiMode] = useState('')

  const parties = kind === 'out' ? customers : suppliers
  const usingAI = !!settings.aiKey

  // подставить цены по выбранной категории (для расхода) / закупке (для прихода)
  const applyType = (list, ptId) =>
    list.map((it) => {
      if (!it.productId) return it
      const p = products.find((x) => x.id === it.productId)
      if (!p) return it
      return { ...it, price: kind === 'in' ? p.cost : priceFor(p, ptId) }
    })

  const changeType = (ptId) => {
    setPriceTypeId(ptId)
    if (items) setItems(applyType(items, ptId))
  }

  const recognize = async () => {
    if (!text.trim()) return
    setBusy(true)
    setAiMode('')
    try {
      let result
      if (usingAI) {
        result = await aiParseInvoice(text, products, {
          apiKey: settings.aiKey,
          model: settings.aiModel,
        })
        setAiMode('DeepSeek')
      } else {
        await new Promise((r) => setTimeout(r, 450))
        result = parseInvoiceText(text, products)
        setAiMode('локально')
      }
      setItems(applyType(result, priceTypeId))
    } catch (e) {
      // ошибка облака → локальный фолбэк
      setItems(applyType(parseInvoiceText(text, products), priceTypeId))
      setAiMode('локально (ошибка облака)')
    }
    setBusy(false)
  }

  const total = useMemo(
    () => (items || []).reduce((a, it) => a + (it.qty || 0) * (it.price || 0), 0),
    [items],
  )
  const matchedCount = (items || []).filter((i) => i.matched).length

  const patch = (i, k, v) =>
    setItems((arr) => arr.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)))
  const removeRow = (i) => setItems((arr) => arr.filter((_, idx) => idx !== i))
  const addRow = () =>
    setItems((arr) => [
      ...(arr || []),
      { name: '', qty: 1, unit: 'шт', price: 0, matched: false },
    ])

  const save = () => {
    const partyObj = parties.find((p) => p.id === party)
    const inv = {
      kind,
      party: partyObj?.name || (kind === 'out' ? 'Розничный покупатель' : 'Поставщик'),
      partyId: party || null,
      items: items.map((it) => ({
        productId: it.productId || null,
        name: it.name,
        qty: it.qty,
        unit: it.unit,
        price: it.price || 0,
      })),
      total,
      priceTypeId: kind === 'out' ? priceTypeId : null,
      source: text,
    }
    addInvoice(inv)
    if (kind === 'in' && applyStock) {
      receiveStock(
        items
          .filter((it) => it.productId)
          .map((it) => ({ productId: it.productId, qty: it.qty })),
      )
    }
    setItems(null)
    setText('')
    setParty('')
  }

  return (
    <div className="animate-fadeUp space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            Накладные
            <Badge tone="brand">
              <Sparkles size={12} /> ИИ
            </Badge>
          </h2>
          <p className="text-sm text-muted">
            Напишите состав текстом — ИИ соберёт готовую накладную для печати.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* ИИ-конструктор */}
        <Card className="p-5">
          <div className="flex gap-2 mb-4">
            <TypeTab active={kind === 'out'} onClick={() => setKind('out')} icon={ArrowUpFromLine}>
              Расход (клиенту)
            </TypeTab>
            <TypeTab active={kind === 'in'} onClick={() => setKind('in')} icon={ArrowDownToLine}>
              Приход (от поставщика)
            </TypeTab>
          </div>

          <Field label="Текст накладной">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="Например: Гвозди 100шт, Молоток 5шт, Саморез 3.5x40 20 уп…"
              className="w-full px-3 py-2.5 rounded-xl bg-surface-2 border border-line text-sm outline-none focus:border-brand resize-y leading-relaxed"
            />
          </Field>

          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="text-[12px] text-muted self-center">Примеры:</span>
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => setText(ex)}
                className="text-[12px] px-2 py-1 rounded-md bg-surface-2 text-muted hover:text-brand truncate max-w-[180px]"
              >
                {ex.split('\n')[0].slice(0, 28)}…
              </button>
            ))}
          </div>

          <Button
            icon={busy ? undefined : Wand2}
            className="w-full mt-4"
            onClick={recognize}
            disabled={!text.trim() || busy}
          >
            {busy
              ? 'ИИ распознаёт…'
              : usingAI
                ? 'Распознать через DeepSeek'
                : 'Распознать в накладную'}
          </Button>
          <div className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
            <span className={cx('w-2 h-2 rounded-full', usingAI ? 'bg-ok' : 'bg-warn')} />
            {usingAI
              ? 'Облачный ИИ DeepSeek подключён'
              : 'Локальный разбор (ключ DeepSeek — в Настройках)'}
          </div>

          {items && (
            <div className="mt-3 p-3 rounded-xl bg-brand-soft/50 border border-brand/20 text-[13px] flex items-center gap-2">
              <Sparkles size={15} className="text-brand shrink-0" />
              <span>
                Распознано <b>{items.length}</b>, сопоставлено <b>{matchedCount}</b>
                {aiMode && <> · режим: <b>{aiMode}</b></>}. Проверьте цены и количество.
              </span>
            </div>
          )}
        </Card>

        {/* Превью накладной */}
        <Card className="p-5">
          {!items ? (
            <Empty
              icon={FileText}
              title="Накладная появится здесь"
              text="Введите текст слева и нажмите «Распознать» — позиции, цены и суммы соберутся автоматически."
            />
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Черновик накладной</h3>
                <Button size="sm" variant="soft" icon={Plus} onClick={addRow}>
                  Строка
                </Button>
              </div>

              <div className="space-y-2 max-h-[42vh] overflow-y-auto no-scrollbar pr-0.5">
                {items.map((it, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-xl bg-surface-2 border border-line"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={it.name}
                        onChange={(e) => patch(i, 'name', e.target.value)}
                        className="flex-1 min-w-0 bg-transparent text-sm font-medium outline-none"
                      />
                      {it.matched ? (
                        <Badge tone="ok">
                          <Check size={11} /> каталог
                        </Badge>
                      ) : (
                        <Badge tone="warn">
                          <CircleAlert size={11} /> новая
                        </Badge>
                      )}
                      <button
                        onClick={() => removeRow(i)}
                        className="text-muted hover:text-bad shrink-0"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <NumBox
                        value={it.qty}
                        onChange={(v) => patch(i, 'qty', v)}
                        suffix={it.unit}
                      />
                      <span className="text-muted text-xs">×</span>
                      <NumBox
                        value={it.price || 0}
                        onChange={(v) => patch(i, 'price', v)}
                        suffix="₽"
                        wide
                      />
                      <span className="ml-auto text-sm font-semibold tabular-nums">
                        {money((it.qty || 0) * (it.price || 0))}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-line space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted text-sm">Итого</span>
                  <span className="text-xl font-semibold tabular-nums">
                    {money(total)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={kind === 'out' ? 'Покупатель' : 'Поставщик'}>
                    <Select
                      value={party}
                      onChange={(e) => {
                        setParty(e.target.value)
                        if (kind === 'out') {
                          const c = customers.find((x) => x.id === e.target.value)
                          if (c?.priceTypeId) changeType(c.priceTypeId)
                        }
                      }}
                    >
                      <option value="">— выберите —</option>
                      {parties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {kind === 'out' && (
                    <Field label="Категория цен">
                      <Select value={priceTypeId} onChange={(e) => changeType(e.target.value)}>
                        {priceTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
                {kind === 'in' && (
                  <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyStock}
                      onChange={(e) => setApplyStock(e.target.checked)}
                      className="accent-[var(--brand)] w-4 h-4"
                    />
                    Оприходовать позиции на склад при сохранении
                  </label>
                )}
                <div className="flex gap-2">
                  <Button icon={Save} onClick={save} className="flex-1">
                    Сохранить
                  </Button>
                  <Button
                    variant="soft"
                    icon={Printer}
                    onClick={() =>
                      printInvoice({
                        kind,
                        party:
                          parties.find((p) => p.id === party)?.name ||
                          (kind === 'out' ? 'Покупатель' : 'Поставщик'),
                        items,
                        total,
                        no: 'ЧЕРНОВИК',
                        createdAt: new Date().toISOString(),
                      })
                    }
                  >
                    Печать
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Сохранённые накладные */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3">Сохранённые накладные</h3>
        {invoices.length === 0 ? (
          <Empty icon={FileText} title="Пока пусто" text="Созданные накладные появятся здесь." />
        ) : (
          <div className="divide-y divide-line">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 py-3">
                <div
                  className={cx(
                    'h-9 w-9 rounded-lg grid place-items-center shrink-0',
                    inv.kind === 'in' ? 'bg-ok-soft text-ok' : 'bg-info-soft text-info',
                  )}
                >
                  {inv.kind === 'in' ? <ArrowDownToLine size={17} /> : <ArrowUpFromLine size={17} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm tabular-nums">
                    {inv.no} · {inv.party}
                  </div>
                  <div className="text-[12px] text-muted">
                    {dateFull(inv.createdAt)} · {inv.items.length} поз.
                  </div>
                </div>
                <span className="text-sm font-semibold tabular-nums hidden sm:block">
                  {money(inv.total)}
                </span>
                <Button size="sm" variant="ghost" icon={Printer} onClick={() => printInvoice(inv)}>
                  Печать
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function TypeTab({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-[13px] font-medium transition border',
        active
          ? 'bg-brand-soft border-brand/30 text-brand'
          : 'bg-surface-2 border-line text-muted hover:text-ink',
      )}
    >
      <Icon size={16} /> {children}
    </button>
  )
}

function NumBox({ value, onChange, suffix, wide }) {
  return (
    <div
      className={cx(
        'flex items-center gap-1 h-9 px-2 rounded-lg bg-surface border border-line',
        wide ? 'w-28' : 'w-24',
      )}
    >
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="w-full bg-transparent text-sm text-right outline-none tabular-nums"
      />
      <span className="text-[12px] text-muted shrink-0">{suffix}</span>
    </div>
  )
}

// ── Печать накладной (ТОРГ-12-подобная форма) ──────────────────────────────
function printInvoice(inv) {
  const company = useStore.getState().settings.company || 'СкладПро'
  const rows = inv.items
    .map(
      (it, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td>${escapeHtml(it.name)}</td>
      <td class="c">${it.unit || 'шт'}</td>
      <td class="r">${num(it.qty)}</td>
      <td class="r">${num(it.price || 0)}</td>
      <td class="r">${num((it.qty || 0) * (it.price || 0))}</td>
    </tr>`,
    )
    .join('')
  const dir = inv.kind === 'in' ? 'Приходная накладная' : 'Расходная накладная'
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
  <title>Накладная ${inv.no}</title>
  <style>
    *{font-family:Arial,sans-serif;box-sizing:border-box}
    body{margin:0;padding:32px;color:#111;font-size:13px}
    h1{font-size:18px;margin:0 0 2px}
    .muted{color:#666}
    .head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;border-bottom:2px solid #111;padding-bottom:12px}
    .meta div{margin:3px 0}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    th,td{border:1px solid #999;padding:7px 9px;text-align:left}
    th{background:#f0f0f0;font-size:12px}
    td.c,th.c{text-align:center}
    td.r,th.r{text-align:right}
    tfoot td{font-weight:bold;border:none;padding-top:10px}
    .sign{margin-top:46px;display:flex;justify-content:space-between}
    .sign div{width:45%;border-top:1px solid #111;padding-top:6px;font-size:12px;color:#444}
    @media print{body{padding:0}}
  </style></head><body>
    <div class="head">
      <div>
        <h1>${dir}</h1>
        <div class="muted">№ ${inv.no} от ${dateFull(inv.createdAt)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:bold;font-size:15px">${escapeHtml(company)}</div>
        <div class="muted">Оптовый склад</div>
      </div>
    </div>
    <div class="meta">
      <div><b>${inv.kind === 'in' ? 'Поставщик' : 'Покупатель'}:</b> ${escapeHtml(inv.party)}</div>
    </div>
    <table>
      <thead><tr>
        <th class="c">№</th><th>Наименование</th><th class="c">Ед.</th>
        <th class="r">Кол-во</th><th class="r">Цена, ₽</th><th class="r">Сумма, ₽</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="5" class="r">ИТОГО:</td><td class="r">${num(inv.total)} ₽</td>
      </tr></tfoot>
    </table>
    <div class="sign">
      <div>Отпустил / Сдал</div>
      <div>Получил / Принял</div>
    </div>
    <script>window.onload=()=>{window.print()}</script>
  </body></html>`
  const w = window.open('', '_blank', 'width=820,height=900')
  if (w) {
    w.document.write(html)
    w.document.close()
  }
}

function escapeHtml(s = '') {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}
