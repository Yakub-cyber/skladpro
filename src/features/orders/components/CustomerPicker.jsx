import { useMemo, useRef, useState } from 'react'
import { Check, X, UserPlus, User } from 'lucide-react'
import { Button, Input, cx } from '@/shared/ui'
import { money } from '@/shared/lib/format'

// Компактный «Клиент»: селект + кнопка «+», раскрывающая мини-форму
// прямо здесь, без ухода в раздел «Клиенты». Заполнил имя+телефон →
// клиент добавлен и уже выбран.
// Search-комбобокс клиента — вместо <Select> с 500+ опций (неюзабельно
// на клавиатуре и мыши). Ввод → фильтр по имени/телефону/ИНН. Стрелки
// вверх/вниз — навигация, Enter — выбор, Esc — сброс. Кнопка «+» рядом
// раскрывает мини-форму «новый клиент» (осталась как была).
export default function CustomerPicker({ customers, customerId, onPick, onAdd }) {
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState({ name: '', phone: '', city: '' })
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)

  // Свежесть отображаемого label когда customerId меняется извне.
  const selected = customers.find((c) => c.id === customerId)
  const showLabel = selected?.name || 'Розничный'

  const norm = (s) => (s || '').toLowerCase()
  const matches = useMemo(() => {
    const s = norm(q).trim()
    if (!s) return customers.slice(0, 8) // без запроса — топ последних
    return customers
      .filter((c) => {
        return (
          norm(c.name).includes(s) ||
          norm(c.phone).includes(s) ||
          norm(c.inn).includes(s) ||
          norm(c.contact).includes(s)
        )
      })
      .slice(0, 12)
  }, [customers, q])

  const pick = (id) => {
    onPick(id)
    setQ('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKey = (e) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(matches.length, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // 0 = «Розничный» (первый пункт), дальше matches[i-1]
      if (active === 0) pick('')
      else if (matches[active - 1]) pick(matches[active - 1].id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setQ('')
      inputRef.current?.blur()
    }
  }

  const save = () => {
    const name = f.name.trim()
    if (!name) return
    const id = onAdd({ name, phone: f.phone.trim(), city: f.city.trim() })
    if (id) onPick(id)
    setF({ name: '', phone: '', city: '' })
    setAdding(false)
  }
  return (
    <div>
      <div className="flex gap-1.5">
        <div className="relative flex-1 min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={open ? q : showLabel}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
              setOpen(true)
            }}
            onFocus={() => {
              setOpen(true)
              setQ('')
              setActive(0)
            }}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKey}
            placeholder="Поиск: имя / телефон / ИНН…"
            className={cx(
              'w-full h-10 px-3 rounded-xl bg-surface-2 border border-line outline-none focus:border-brand text-sm truncate',
              !open && !selected && 'text-muted',
            )}
          />
          {open && (
            <div className="absolute z-30 left-0 right-0 top-full mt-1 rounded-xl bg-surface border border-line shadow-xl max-h-[280px] overflow-y-auto py-1">
              {/* Первый пункт — «Розничный» (сброс выбора) */}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick('')}
                className={cx(
                  'w-full flex items-center gap-2 px-3 h-10 text-left text-[13px] transition',
                  active === 0 ? 'bg-brand-soft text-brand' : 'hover:bg-surface-2',
                )}
              >
                <User size={14} className="text-muted" />
                Розничный покупатель
              </button>
              {matches.length === 0 && q && (
                <div className="px-3 py-2 text-[12px] text-muted italic">
                  Не найдено. Нажмите «+», чтобы добавить нового.
                </div>
              )}
              {matches.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c.id)}
                  className={cx(
                    'w-full flex items-center gap-2 px-3 h-11 text-left text-[13px] transition',
                    active === i + 1 ? 'bg-brand-soft text-brand' : 'hover:bg-surface-2',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-[11px] text-muted truncate">
                      {[c.type, c.city, c.phone].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {c.balance > 0 && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-warn-soft text-warn tabular-nums whitespace-nowrap">
                      долг {money(c.balance)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          title="Новый клиент"
          className={cx(
            'h-10 w-10 rounded-xl grid place-items-center border transition shrink-0',
            adding ? 'bg-brand text-brand-ink border-brand' : 'bg-surface-2 border-line hover:text-brand',
          )}
        >
          {adding ? <X size={16} /> : <UserPlus size={16} />}
        </button>
      </div>
      {adding && (
        <div className="mt-2 p-3 rounded-xl bg-surface-2 border border-line space-y-2 animate-fadeUp">
          <Input
            placeholder="Имя / название компании *"
            value={f.name}
            onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))}
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Телефон"
              value={f.phone}
              onChange={(e) => setF((s) => ({ ...s, phone: e.target.value }))}
            />
            <Input
              placeholder="Город"
              value={f.city}
              onChange={(e) => setF((s) => ({ ...s, city: e.target.value }))}
            />
          </div>
          <Button icon={Check} className="w-full" onClick={save} disabled={!f.name.trim()} size="sm">
            Добавить и выбрать
          </Button>
        </div>
      )}
    </div>
  )
}
