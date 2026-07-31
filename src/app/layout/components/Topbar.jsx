import { useState } from 'react'
import { Command, Menu, Moon, Search, Sun } from 'lucide-react'
import Breadcrumbs from './Breadcrumbs'
import { CashierButton, OfflineBadge, SyncBadge } from './StatusBadges'
import ProfileMenu from './ProfileMenu'

export default function Topbar({ onMenu, onSearch }) {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  )
  const toggleTheme = () => {
    const isDark = document.documentElement.classList.toggle('dark')
    localStorage.setItem('sklad.theme', isDark ? 'dark' : 'light')
    setDark(isDark)
  }

  return (
    <header className="h-16 shrink-0 border-b border-line bg-bg/80 backdrop-blur sticky top-0 z-20 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 lg:px-6">
      <button
        onClick={onMenu}
        className="lg:hidden h-9 w-9 grid place-items-center rounded-lg hover:bg-surface-2 shrink-0"
      >
        <Menu size={20} />
      </button>
      <div className="min-w-0 flex-shrink">
        <Breadcrumbs />
      </div>

      <button
        onClick={onSearch}
        className="ml-auto group flex items-center gap-2 h-10 px-3 rounded-xl bg-surface-2 border border-line text-muted hover:border-brand/40 transition w-full max-w-xs min-w-0"
      >
        <Search size={16} className="shrink-0" />
        <span className="text-sm truncate">Поиск по складу…</span>
        <kbd className="ml-auto hidden md:flex items-center gap-0.5 text-[11px] px-1.5 h-5 rounded bg-surface-3 border border-line">
          <Command size={11} /> K
        </kbd>
      </button>

      <CashierButton />
      <OfflineBadge />
      <SyncBadge />
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
