import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal, Star, X } from 'lucide-react'
import { cx } from '@/shared/ui'

// Панель фильтров: раскрывающийся блок с полями цены/остатка/статуса.
// Не модалка, а inline-панель под поисковой строкой — так пользователь
// сразу видит эффект фильтров на таблице.
export function FiltersPanel({ filters, setFilters, onReset, activeCount, onClose }) {
  const set = (k, v) => setFilters((s) => ({ ...s, [k]: v }))
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 mb-4 animate-fadeUp">
      <div className="flex items-center gap-2 mb-3">
        <SlidersHorizontal size={16} className="text-brand" />
        <h4 className="font-semibold text-sm">Фильтры</h4>
        <span className="text-[12px] text-muted">
          {activeCount ? `активных: ${activeCount}` : 'без фильтров'}
        </span>
        <div className="ml-auto flex gap-1">
          {activeCount > 0 && (
            <button
              onClick={onReset}
              className="text-[12px] px-2 h-8 rounded-lg text-muted hover:text-ink hover:bg-surface-2"
            >
              Сброс
            </button>
          )}
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg text-muted hover:text-ink hover:bg-surface-2 grid place-items-center"
            title="Скрыть"
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <OperatorField
          label="Цена, ₽"
          op={filters.priceOp}
          val={filters.priceVal}
          onOp={(v) => set('priceOp', v)}
          onVal={(v) => set('priceVal', v)}
        />
        <OperatorField
          label="Остаток"
          op={filters.stockOp}
          val={filters.stockVal}
          onOp={(v) => set('stockOp', v)}
          onVal={(v) => set('stockVal', v)}
        />
        <SelectField
          label="Статус остатка"
          value={filters.stockStatus}
          onChange={(v) => set('stockStatus', v)}
          options={[
            { value: 'any', label: 'Любой' },
            { value: 'low', label: 'Ниже минимума' },
            { value: 'out', label: 'Закончился' },
            { value: 'in', label: 'В наличии' },
          ]}
        />
        <div className="grid grid-cols-2 gap-2">
          <SelectField
            label="Весовой"
            value={filters.weighted}
            onChange={(v) => set('weighted', v)}
            options={[
              { value: 'any', label: 'Любой' },
              { value: 'yes', label: 'Да' },
              { value: 'no', label: 'Нет' },
            ]}
          />
          <SelectField
            label="Маркировка"
            value={filters.marked}
            onChange={(v) => set('marked', v)}
            options={[
              { value: 'any', label: 'Любой' },
              { value: 'yes', label: 'Да' },
              { value: 'no', label: 'Нет' },
            ]}
          />
        </div>
      </div>
    </div>
  )
}

// Оператор + значение (как в CloudShop): [Select >/<=/=] [Input число].
// Пустое значение выключает фильтр.
function OperatorField({ label, op, val, onOp, onVal }) {
  return (
    <div>
      <div className="text-[12px] text-muted mb-1.5">{label}</div>
      <div className="flex items-center gap-1.5">
        <select
          value={op}
          onChange={(e) => onOp(e.target.value)}
          className="h-9 px-2 rounded-lg bg-surface-2 border border-line text-sm outline-none focus:border-brand shrink-0"
        >
          <option value=">">больше</option>
          <option value="<">меньше</option>
          <option value="=">равно</option>
        </select>
        <input
          type="number"
          value={val}
          onChange={(e) => onVal(e.target.value)}
          placeholder="значение"
          className="w-full h-9 px-2 rounded-lg bg-surface-2 border border-line text-sm outline-none focus:border-brand"
        />
      </div>
    </div>
  )
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <div className="text-[12px] text-muted mb-1.5">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-2 rounded-lg bg-surface-2 border border-line text-sm outline-none focus:border-brand"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// Меню пресетов: выпадашка с сохранёнными наборами фильтров + кнопки
// «Сохранить как…» и «Удалить». Хранится в localStorage
// LS_PRESETS = 'sklad.products.filterPresets'.
export function PresetsMenu({ presets, currentFilters, activeCount, onApply, onSave, onRemove }) {
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const menuRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false); setNaming(false); setName('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const save = () => {
    const n = name.trim()
    if (!n) return
    onSave(n)
    setNaming(false)
    setName('')
    setOpen(false)
  }
  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-10 px-3 rounded-xl inline-flex items-center gap-2 text-sm font-medium border border-line bg-surface-2 text-muted hover:text-ink transition"
        title="Пресеты фильтров"
      >
        <Star size={16} />
        <span className="hidden sm:inline">Пресеты</span>
        {presets.length > 0 && (
          <span className="text-[11px] font-semibold text-muted">
            {presets.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-72 card p-2 z-30 animate-fadeUp">
          {presets.length === 0 && !naming && (
            <div className="text-[12px] text-muted p-2">
              Пресетов пока нет. Настройте фильтр и «Сохранить как…».
            </div>
          )}
          {presets.map((p) => (
            <div
              key={p.name}
              className="flex items-center gap-1 p-1 rounded-lg hover:bg-surface-2"
            >
              <button
                onClick={() => { onApply(p.filters); setOpen(false) }}
                className="flex-1 text-left text-[13px] px-2 py-1.5 rounded-md hover:text-brand truncate"
              >
                {p.name}
              </button>
              <button
                onClick={() => onRemove(p.name)}
                className="h-7 w-7 rounded-md text-muted hover:text-bad grid place-items-center"
                title="Удалить пресет"
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <div className="border-t border-line mt-1 pt-1">
            {naming ? (
              <div className="flex items-center gap-1 p-1">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && save()}
                  placeholder="Название пресета"
                  autoFocus
                  className="flex-1 h-8 px-2 rounded-md bg-surface-2 border border-line text-sm outline-none focus:border-brand"
                />
                <button
                  onClick={save}
                  disabled={!name.trim()}
                  className="h-8 px-2 rounded-md bg-brand text-brand-ink text-[12px] font-medium disabled:opacity-50"
                >
                  OK
                </button>
              </div>
            ) : (
              <button
                onClick={() => setNaming(true)}
                disabled={activeCount === 0}
                className="w-full text-left text-[13px] px-2 py-1.5 rounded-md hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={activeCount === 0 ? 'Задайте фильтры сначала' : ''}
              >
                + Сохранить текущий как пресет
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Крупный чип с числом — для фильтра по типу позиции (Товар/Услуга/Комплект).
// Отличается от обычного Chip брендовой обводкой и цифрой справа.
export function TypeChip({ active, onClick, children, count }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-1.5 px-3 h-9 rounded-xl text-[13px] font-medium whitespace-nowrap transition border',
        active
          ? 'bg-brand text-brand-ink border-brand'
          : 'bg-surface border-line text-muted hover:text-ink',
      )}
    >
      <span>{children}</span>
      <span
        className={cx(
          'text-[11px] px-1.5 h-5 min-w-5 grid place-items-center rounded-md tabular-nums',
          active ? 'bg-white/25' : 'bg-surface-2 text-ink',
        )}
      >
        {count}
      </span>
    </button>
  )
}

export function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'px-3 h-9 rounded-lg text-[13px] font-medium whitespace-nowrap transition',
        active ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}
