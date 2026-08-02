import { Suspense, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ShieldX } from 'lucide-react'
import CommandPalette from '@/shared/components/CommandPalette'
import { ConfirmProvider } from '@/shared/components/Confirm'
import SupportWidget from '@/shared/components/SupportWidget'
import PageLoader from '@/shared/components/PageLoader'
import { canAccess, roleInfo } from '@/shared/lib/constants'
import { apiFetch, hasApi } from '@/shared/api'
import { useStore } from '@/shared/store/useStore'
import { NAV_ITEMS } from './nav'
import { useCurrentUser } from './utils'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'

// Re-exports для сторонних модулей (CommandPalette, EmployeesPage,
// CashiersPage), которые исторически брали их из Layout.jsx. Оставляем
// как удобный публичный API самой папки layout/.
export { NAV, NAV_ITEMS, NAV_STOCK, NAV_COURIER, NAV_CASHIER, CREATE_DOC_ITEMS, navFor } from './nav'
export { openPosWindow } from './utils'

export default function Layout() {
  const [navOpen, setNavOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const { pathname } = useLocation()
  const me = useCurrentUser()
  const cloud = useStore((s) => s.cloud)
  const lastTracked = useRef('')

  useEffect(() => {
    if (!cloud || !hasApi || pathname === lastTracked.current) return
    lastTracked.current = pathname
    const t = setTimeout(() => {
      apiFetch('POST', '/v1/track', { page: pathname }).catch(() => {})
    }, 1000)
    return () => clearTimeout(t)
  }, [pathname, cloud])

  const item = NAV_ITEMS.find((n) =>
    n.end ? n.to === pathname : n.to !== '/' && pathname.startsWith(n.to),
  )
  const allowed = !item || canAccess(me.role, item.perm)

  return (
    <ConfirmProvider>
      <div className="min-h-screen bg-bg">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <CommandPalette open={cmdOpen} setOpen={setCmdOpen} />
        <SupportWidget />
        <div className="lg:pl-[252px] flex flex-col min-h-screen">
          <Topbar onMenu={() => setNavOpen(true)} onSearch={() => setCmdOpen(true)} />
          <main className="flex-1 p-4 lg:p-6 max-w-[1400px] w-full mx-auto">
            {allowed ? (
              <Suspense fallback={<PageLoader />}>
                <Outlet />
              </Suspense>
            ) : (
              <div className="grid place-items-center py-24 text-center">
                <div>
                  <div className="h-16 w-16 rounded-2xl bg-bad-soft text-bad grid place-items-center mx-auto mb-4">
                    <ShieldX size={30} />
                  </div>
                  <h2 className="text-lg font-semibold">Нет доступа</h2>
                  <p className="text-sm text-muted mt-1 max-w-xs">
                    Раздел недоступен для роли «{roleInfo(me.role).label}». Обратитесь к администратору.
                  </p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </ConfirmProvider>
  )
}
