import { useStore } from '@/shared/store/useStore'

// Открыть POS в отдельном окне. window.open с фиксированным размером —
// браузер (Chrome/Edge/Firefox) откроет popup-окно без табов, а не новую
// вкладку в основной. Если pop-up заблокирован — фолбэк на переход в /pos.
export function openPosWindow() {
  const url = window.location.origin + window.location.pathname + '#/pos'
  const w = window.open(
    url,
    'skladpro-pos',
    'width=1280,height=860,resizable=yes,scrollbars=yes,noopener=no',
  )
  if (!w) window.location.hash = '#/pos'
}

// Текущий авторизованный сотрудник и его роль (fallback — «Гость»/admin,
// чтобы гости и не-настроенные тенанты видели полный NAV).
export function useCurrentUser() {
  const employees = useStore((s) => s.employees) || []
  const authUserId = useStore((s) => s.authUserId)
  const me = employees.find((e) => e.id === authUserId)
  return me || { name: 'Гость', role: 'admin' }
}
