import { Link, useLocation, useMatch } from 'react-router-dom'
import { cx } from '@/shared/ui'
import { NAV_ITEMS } from '../nav'

// Хлебные крошки: раздел + при необходимости уточнение (номер заказа, «Правка»).
// Первый крош — Дашборд (если мы не на нём), потом текущий раздел, потом
// уточнение. Клик по крошу — переход в соответствующее место.
export function useBreadcrumbs() {
  const { pathname } = useLocation()
  const editMatch = useMatch('/orders/:id/edit')

  if (pathname === '/') return [{ label: 'Дашборд' }]

  const item = NAV_ITEMS.find((n) =>
    n.end ? n.to === pathname : n.to !== '/' && pathname.startsWith(n.to),
  )
  const crumbs = [{ label: 'Дашборд', to: '/' }]
  if (item) crumbs.push({ label: item.label, to: item.to })
  else crumbs.push({ label: '—' })

  if (editMatch) {
    const tail = editMatch.params.id?.slice(-4) || ''
    crumbs.push({ label: `№${tail} · правка` })
  } else if (pathname === '/orders/new') {
    crumbs.push({ label: 'Новый · касса' })
  }
  return crumbs
}

export default function Breadcrumbs() {
  const crumbs = useBreadcrumbs()
  return (
    <nav aria-label="breadcrumbs" className="flex items-center gap-1.5 text-[13px] min-w-0">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1
        const cls = isLast
          ? 'font-semibold text-ink'
          : 'text-muted hover:text-ink transition-colors'
        return (
          <span key={i} className="flex items-center gap-1.5 min-w-0">
            {c.to && !isLast ? (
              <Link to={c.to} className={cx('truncate', cls)}>
                {c.label}
              </Link>
            ) : (
              <span className={cx('truncate', cls)}>{c.label}</span>
            )}
            {!isLast && <span className="text-muted/60 shrink-0">/</span>}
          </span>
        )
      })}
    </nav>
  )
}
