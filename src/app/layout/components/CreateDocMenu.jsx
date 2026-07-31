import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { cx } from '@/shared/ui'
import { canAccess } from '@/shared/lib/constants'
import { CREATE_DOC_ITEMS } from '../nav'

// «Создать документ» — брендовая CTA как в CloudShop. Клик раскрывает
// панель со списком типов документов (2 секции); клик по пункту ведёт
// на экран с ?new=… и панель закрывается. Клик мимо или Esc — тоже
// закрывает. Кнопка визуально доминирует над NAV, чтобы оператор нашёл
// её без раздумий.
export default function CreateDocMenu({ role, onNavigate }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    const onEsc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const sections = useMemo(
    () =>
      CREATE_DOC_ITEMS.map((s) => ({
        ...s,
        items: s.items.filter((it) => canAccess(role, it.perm)),
      })).filter((s) => s.items.length),
    [role],
  )

  return (
    <div ref={boxRef} className="mx-3 mb-3 relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'w-full h-11 rounded-xl bg-brand text-brand-ink text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-md shadow-brand/25 hover:brightness-110 transition',
          open && 'ring-2 ring-brand/40',
        )}
      >
        <Plus size={17} strokeWidth={2.5} /> Создать документ
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-xl bg-surface border border-line shadow-xl overflow-hidden animate-fadeUp">
          {sections.map((s, si) => (
            <div key={s.section} className={si > 0 ? 'border-t border-line' : ''}>
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {s.section}
              </div>
              {s.items.map((it) => (
                <Link
                  key={it.to}
                  to={it.to}
                  onClick={() => {
                    setOpen(false)
                    onNavigate?.()
                  }}
                  className="flex items-center gap-2.5 px-3 h-9 text-[13px] text-ink hover:bg-brand-soft hover:text-brand transition"
                >
                  <it.icon size={15} className="text-muted" />
                  <span className="truncate">{it.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
