import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'

// Меню «Настройки таблицы» — 12 чекбоксов колонок; сохранение по
// клику мгновенно в localStorage. Дефолты — DEFAULT_COLS.
export function ColSettingsMenu({ cols, onChange }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const toggle = (k) => onChange({ ...cols, [k]: !cols[k] })
  const items = [
    ['image', 'Фотография'],
    ['sku', 'Артикул / код'],
    ['category', 'Категория'],
    ['unit', 'Единица измерения'],
    ['cell', 'Ячейка'],
    ['stock', 'Остаток'],
    ['minStock', 'Мин. остаток'],
    ['reserved', 'Резерв'],
    ['available', 'Доступно'],
    ['cost', 'Себестоимость'],
    ['price', 'Цена продажи'],
    ['margin', 'Маржа (₽)'],
  ]
  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-10 w-10 rounded-xl grid place-items-center border border-line bg-surface-2 text-muted hover:text-ink transition"
        title="Настройки таблицы"
      >
        <SlidersHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 card p-2 z-30 animate-fadeUp">
          <div className="text-[11px] font-semibold text-muted px-2 py-1.5 uppercase">
            Настройки таблицы
          </div>
          {items.map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-2 cursor-pointer text-[13px]"
            >
              <input
                type="checkbox"
                checked={!!cols[key]}
                onChange={() => toggle(key)}
                className="accent-brand w-4 h-4"
              />
              {label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
