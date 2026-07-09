import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  ClipboardList,
  Package,
  Warehouse as WarehouseIcon,
  FileText,
  ClipboardCheck,
  Users,
  Truck,
  Navigation,
  UserCog,
  History,
  BarChart3,
  Bot,
  Store,
  Settings as SettingsIcon,
  Sparkles,
  Search,
  Sun,
  Moon,
  Menu,
  Boxes,
  Command,
  ChevronDown,
  LogOut,
  ShieldX,
} from 'lucide-react'
import { cx, Badge, Avatar } from './ui'
import CommandPalette from './CommandPalette'
import { useStore } from '../store/useStore'
import { canAccess, roleInfo } from '../lib/constants'
import { reservedByProduct, availableStock } from '../lib/orders'

// текущий авторизованный сотрудник и его роль
function useCurrentUser() {
  const employees = useStore((s) => s.employees) || []
  const authUserId = useStore((s) => s.authUserId)
  const me = employees.find((e) => e.id === authUserId)
  return me || { name: 'Гость', role: 'admin' }
}

export const NAV = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard, end: true, perm: 'dashboard' },
  { to: '/orders', label: 'Заказы', icon: ClipboardList, perm: 'orders' },
  { to: '/delivery', label: 'Доставка', icon: Navigation, perm: 'delivery' },
  { to: '/products', label: 'Товары', icon: Package, perm: 'products' },
  { to: '/warehouse', label: 'Карта склада', icon: WarehouseIcon, perm: 'warehouse' },
  { to: '/operations', label: 'Документы', icon: ClipboardCheck, perm: 'operations' },
  { to: '/invoices', label: 'Накладные', icon: FileText, ai: true, perm: 'invoices' },
  { to: '/customers', label: 'Клиенты', icon: Users, perm: 'customers' },
  { to: '/suppliers', label: 'Поставщики', icon: Truck, perm: 'suppliers' },
  { to: '/analytics', label: 'Аналитика', icon: BarChart3, ai: true, perm: 'analytics' },
  { to: '/assistant', label: 'ИИ-ассистент', icon: Bot, ai: true, perm: 'assistant' },
  { to: '/storefront', label: 'Витрина', icon: Store, perm: 'storefront' },
  { to: '/journal', label: 'Смены и журнал', icon: History, perm: 'journal' },
  { to: '/employees', label: 'Сотрудники', icon: UserCog, perm: 'employees' },
  { to: '/settings', label: 'Настройки', icon: SettingsIcon, perm: 'settings' },
]

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-9 w-9 rounded-xl bg-brand grid place-items-center text-brand-ink shadow-lg shadow-brand/30">
        <Boxes size={20} strokeWidth={2.3} />
      </div>
      <div className="leading-none">
        <div className="font-semibold tracking-tight text-[15px]">
          Склад<span className="text-brand">Про</span>
        </div>
        <div className="text-[10px] text-muted mt-0.5 tracking-wide uppercase">
          AI Warehouse
        </div>
      </div>
    </div>
  )
}

function Sidebar({ open, onClose }) {
  const orders = useStore((s) => s.orders)
  const products = useStore((s) => s.products)
  const me = useCurrentUser()
  const activeOrders = orders.filter((o) =>
    ['new', 'confirmed', 'picking', 'packed'].includes(o.status),
  ).length
  const reserved = reservedByProduct(orders)
  const lowStock = products.filter((p) => availableStock(p, reserved) <= p.minStock).length

  const counts = { '/orders': activeOrders, '/products': lowStock }
  const items = NAV.filter((n) => canAccess(me.role, n.perm))

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
        <nav className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-0.5">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 h-10 px-3 rounded-xl text-sm font-medium transition-colors relative group',
                  isActive
                    ? 'bg-brand-soft text-brand'
                    : 'text-muted hover:text-ink hover:bg-surface-2',
                )
              }
            >
              <item.icon size={18} strokeWidth={2.1} />
              <span className="flex-1">{item.label}</span>
              {item.ai && (
                <Sparkles size={13} className="text-brand opacity-80" />
              )}
              {counts[item.to] > 0 && (
                <span className="text-[11px] font-semibold px-1.5 h-5 min-w-5 grid place-items-center rounded-md bg-surface-3 text-ink">
                  {counts[item.to]}
                </span>
              )}
            </NavLink>
          ))}
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

function Topbar({ onMenu, onSearch }) {
  const { pathname } = useLocation()
  const title =
    NAV.find((n) => (n.end ? n.to === pathname : pathname.startsWith(n.to) && n.to !== '/'))
      ?.label || 'Дашборд'
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  )
  const toggleTheme = () => {
    const isDark = document.documentElement.classList.toggle('dark')
    localStorage.setItem('sklad.theme', isDark ? 'dark' : 'light')
    setDark(isDark)
  }

  return (
    <header className="h-16 shrink-0 border-b border-line bg-bg/80 backdrop-blur sticky top-0 z-20 flex items-center gap-3 px-4 lg:px-6">
      <button
        onClick={onMenu}
        className="lg:hidden h-9 w-9 grid place-items-center rounded-lg hover:bg-surface-2"
      >
        <Menu size={20} />
      </button>
      <h1 className="font-semibold text-[17px] tracking-tight hidden sm:block">
        {title}
      </h1>

      <button
        onClick={onSearch}
        className="ml-auto group flex items-center gap-2 h-10 px-3 rounded-xl bg-surface-2 border border-line text-muted hover:border-brand/40 transition w-full max-w-xs"
      >
        <Search size={16} />
        <span className="text-sm">Поиск по складу…</span>
        <kbd className="ml-auto hidden md:flex items-center gap-0.5 text-[11px] px-1.5 h-5 rounded bg-surface-3 border border-line">
          <Command size={11} /> K
        </kbd>
      </button>

      <button
        onClick={toggleTheme}
        className="h-10 w-10 grid place-items-center rounded-xl hover:bg-surface-2 text-muted hover:text-ink shrink-0"
        title="Сменить тему"
      >
        {dark ? <Sun size={19} /> : <Moon size={19} />}
      </button>
      <ProfileMenu />
    </header>
  )
}

function ProfileMenu() {
  const [open, setOpen] = useState(false)
  const me = useCurrentUser()
  const cloud = useStore((s) => s.cloud)
  const logout = useStore((s) => s.logout)
  const cloudLogout = useStore((s) => s.cloudLogout)
  const doLogout = () => (cloud ? cloudLogout() : logout())
  const role = roleInfo(me.role)

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-10 pl-1 pr-2 rounded-xl hover:bg-surface-2"
      >
        <Avatar name={me.name} color={role.color} size={32} />
        <div className="hidden md:block text-left leading-tight">
          <div className="text-[13px] font-medium">{me.name.split(' ')[0]}</div>
          <div className="text-[11px] text-muted">{role.label}</div>
        </div>
        <ChevronDown size={15} className="text-muted hidden md:block" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-60 card p-1.5 z-40 animate-fadeUp">
            <div className="flex items-center gap-2.5 px-2.5 py-2 mb-1 border-b border-line">
              <Avatar name={me.name} color={role.color} size={36} />
              <div className="min-w-0">
                <div className="text-[13px] font-medium truncate">{me.name}</div>
                <div className="text-[11px] text-muted">{role.label}</div>
              </div>
            </div>
            <button
              onClick={() => {
                setOpen(false)
                doLogout()
              }}
              className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg hover:bg-bad-soft text-bad text-sm font-medium"
            >
              <LogOut size={16} /> Выйти из системы
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function Layout() {
  const [navOpen, setNavOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const { pathname } = useLocation()
  const me = useCurrentUser()

  const item = NAV.find((n) =>
    n.end ? n.to === pathname : n.to !== '/' && pathname.startsWith(n.to),
  )
  const allowed = !item || canAccess(me.role, item.perm)

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <CommandPalette open={cmdOpen} setOpen={setCmdOpen} />
      <div className="lg:pl-[252px] flex flex-col min-h-screen">
        <Topbar onMenu={() => setNavOpen(true)} onSearch={() => setCmdOpen(true)} />
        <main className="flex-1 p-4 lg:p-6 max-w-[1400px] w-full mx-auto">
          {allowed ? (
            <Outlet />
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
  )
}
