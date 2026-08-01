import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, Sparkles } from 'lucide-react'
import { cx } from '@/shared/ui'
import { isNavActive } from '../nav'

// Одиночный пункт NAV. Отдельно вынесен, чтобы одинаково рендерить
// прямые пункты NAV (Дашборд) и пункты внутри группы. Не используем
// NavLink — нужна поддержка query-string при активности.
export function NavItem({ item, counts, onClose, nested = false }) {
  const { pathname, search } = useLocation()
  const isActive = isNavActive(item.to, pathname, search, item.end)
  return (
    <Link
      to={item.to}
      onClick={onClose}
      className={cx(
        'flex items-center gap-3 h-10 rounded-xl text-sm font-medium transition-colors relative group',
        nested ? 'px-3 ml-2' : 'px-3',
        isActive
          ? 'bg-brand text-brand-ink'
          : item.highlight
            ? 'text-ink bg-brand-soft/60 hover:bg-brand-soft border border-brand/25'
            : 'text-muted hover:text-ink hover:bg-surface-2',
      )}
    >
      <item.icon size={item.highlight ? 19 : 18} strokeWidth={item.highlight ? 2.3 : 2.1} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.ai && <Sparkles size={13} className="text-brand opacity-80" />}
      {counts[item.to] > 0 && (
        <span className="text-[11px] font-semibold px-1.5 h-5 min-w-5 grid place-items-center rounded-md bg-surface-3 text-ink">
          {counts[item.to]}
        </span>
      )}
    </Link>
  )
}

// Схлопываемая группа. Активная (внутри — текущий роут) раскрывается
// автоматически. Состояние раскрытия других групп персистится в
// localStorage — иначе клик по любой вкладке снова закрывал бы всё.
export function NavGroup({ node, counts, onClose, open, onToggle }) {
  const { pathname, search } = useLocation()
  const hasActive = node.items.some((it) => isNavActive(it.to, pathname, search, it.end))
  useEffect(() => {
    if (hasActive && !open) onToggle()
  }, [hasActive])

  const toggle = () => onToggle()

  const totalCount = node.items.reduce((n, it) => n + (counts[it.to] || 0), 0)

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className={cx(
          'w-full flex items-center gap-3 h-10 px-3 rounded-xl text-sm font-medium transition-colors',
          hasActive ? 'text-ink' : 'text-muted hover:text-ink hover:bg-surface-2',
        )}
      >
        <node.icon size={18} strokeWidth={2.1} />
        <span className="flex-1 text-left">{node.label}</span>
        {totalCount > 0 && (
          <span className="text-[11px] font-semibold px-1.5 h-5 min-w-5 grid place-items-center rounded-md bg-surface-3 text-ink">
            {totalCount}
          </span>
        )}
        <ChevronDown
          size={14}
          className={cx('transition-transform text-muted', open ? '' : '-rotate-90')}
        />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {node.items.map((it) => (
            <NavItem key={it.to} item={it} counts={counts} onClose={onClose} nested />
          ))}
        </div>
      )}
    </div>
  )
}
