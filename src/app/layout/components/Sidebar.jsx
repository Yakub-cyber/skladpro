import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { cx } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { canAccess } from '@/shared/lib/constants'
import { reservedByProduct, availableStock } from '@/shared/lib/orders'
import { navFor } from '../nav'
import { useCurrentUser } from '../utils'
import Logo from './Logo'
import CreateDocMenu from './CreateDocMenu'
import ShiftContextTile from './ShiftContextTile'
import { NavGroup, NavItem } from './NavItem'

export default function Sidebar({ open, onClose }) {
  const [openGroup, setOpenGroup] = useState(null)
  const orders = useStore((s) => s.orders)
  const products = useStore((s) => s.products)
  const documents = useStore((s) => s.documents) || []
  const authAt = useStore((s) => s.authAt)
  const me = useCurrentUser()
  const activeOrders = orders.filter((o) =>
    ['new', 'confirmed', 'picking', 'packed'].includes(o.status),
  ).length
  const reserved = reservedByProduct(orders)
  const lowStock = products.filter((p) => availableStock(p, reserved) <= p.minStock).length

  const counts = { '/orders': activeOrders, '/products': lowStock }

  // По роли берём свой NAV-набор. Дополнительно фильтруем через canAccess:
  // если админ поменял права роли — пункты, ставшие недоступными, скроются.
  const roleNav = navFor(me.role)
  const visibleNodes = roleNav
    .map((node) => {
      if (node.items) {
        const kept = node.items.filter((it) => canAccess(me.role, it.perm))
        return kept.length ? { ...node, items: kept } : null
      }
      return canAccess(me.role, node.perm) ? node : null
    })
    .filter(Boolean)

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cx(
          'fixed z-40 inset-y-0 left-0 w-[252px] bg-surface border-r border-line flex flex-col transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="h-16 flex items-center px-5 border-b border-line">
          <Logo />
        </div>
        <div className="pt-3">
          <CreateDocMenu role={me.role} onNavigate={onClose} />
        </div>
        <ShiftContextTile me={me} orders={orders} documents={documents} authAt={authAt} />
        <nav className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-0.5">
          {visibleNodes.map((node) => {
            const gk = node.key || node.label
            return node.items ? (
              <NavGroup
                key={gk}
                node={node}
                counts={counts}
                onClose={onClose}
                open={openGroup === gk}
                onToggle={() => setOpenGroup((v) => v === gk ? null : gk)}
              />
            ) : (
              <NavItem key={node.to} item={node} counts={counts} onClose={onClose} />
            )
          })}
        </nav>
        <div className="p-3 border-t border-line">
          <NavLink
            to="/assistant"
            onClick={onClose}
            className="block rounded-xl bg-gradient-to-br from-brand/15 to-brand/5 border border-brand/20 p-3 hover:border-brand/40 transition-colors"
          >
            <div className="flex items-center gap-2 text-brand font-medium text-[13px]">
              <Sparkles size={15} /> ИИ-помощник
            </div>
            <p className="text-[12px] text-muted mt-1 leading-relaxed">
              Спросите про остатки, долги и закупки — ответит по вашим данным.
            </p>
          </NavLink>
        </div>
      </aside>
    </>
  )
}
