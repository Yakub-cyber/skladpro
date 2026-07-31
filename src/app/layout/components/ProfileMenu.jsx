import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut } from 'lucide-react'
import { Avatar } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { roleInfo } from '@/shared/lib/constants'
import { useCurrentUser } from '../utils'

export default function ProfileMenu() {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const me = useCurrentUser()
  const cloud = useStore((s) => s.cloud)
  const logout = useStore((s) => s.logout)
  const cloudLogout = useStore((s) => s.cloudLogout)
  const doLogout = () => (cloud ? cloudLogout() : logout())
  const role = roleInfo(me.role)

  // Click-outside через слушатель, а не через fixed-backdrop:
  // `<div fixed inset-0 z-30>` перекрывал бы всю шапку — клик по любой
  // другой кнопке (Касса, тема, sync) съедался бы бэкдропом, требуя
  // двух кликов. Esc тоже закрывает.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    const onEsc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div className="relative shrink-0" ref={menuRef}>
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
      )}
    </div>
  )
}
