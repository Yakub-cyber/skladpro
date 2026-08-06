import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Cloud, CloudOff, CloudUpload, ShoppingCart } from 'lucide-react'
import { cx } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { canAccess } from '@/shared/lib/constants'
import { openPosWindow, useCurrentUser } from '../utils'
import { DiagPanel } from './DiagPanel'

// D2: индикатор офлайн-режима. Появляется, когда navigator.onLine=false.
// Все изменения продолжают писаться в localStorage и уходят в очередь
// outbox — уйдут при возврате online. Иконка объясняет, почему кнопки
// «работают» без сетевого ответа.
export function OfflineBadge() {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  if (online) return null
  return (
    <span
      title="Офлайн-режим — изменения сохраняются локально и уйдут в облако при подключении"
      className="h-10 px-2.5 rounded-xl bg-warn-soft text-warn text-[12px] font-semibold inline-flex items-center gap-1.5 shrink-0"
    >
      <CloudOff size={14} />
      <span className="hidden sm:inline">Офлайн</span>
    </span>
  )
}

// Индикатор облачной синхронизации: зелёное облако — всё отправлено,
// стрелка с числом — ожидают отправки, перечёркнутое — ошибка (клик = повторить).
export function SyncBadge() {
  const cloud = useStore((s) => s.cloud)
  const ready = useStore((s) => s.cloudReady)
  const pending = useStore((s) => s.syncPending || 0)
  const quarantined = useStore((s) => s.syncQuarantined || 0)
  const state = useStore((s) => s.syncState || 'ok')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])
  if (!cloud || !ready) return null
  // 'attention' — есть карантинные операции (продажи/документы с 4xx).
  // Красный треугольник, не «облако с ошибкой», чтобы владелец сразу отличил
  // «сеть моргнула, ретрай сам сделает» от «чек не принят, надо смотреть».
  // Карантинных показываем отдельным числом, а не общим pending — этот
  // счётчик и цвет должны отличаться от «сеть тормозит».
  const cfg =
    state === 'attention'
      ? {
          Icon: AlertTriangle,
          cls: 'text-bad',
          badge: quarantined,
          badgeCls: 'bg-bad',
          title: `Отклонено сервером: ${quarantined}. Требует ручного разбора — нажмите`,
        }
      : state === 'error'
        ? {
            Icon: CloudOff,
            cls: 'text-bad',
            badge: pending,
            badgeCls: 'bg-warn',
            title: `Ошибка синхронизации, изменений в очереди: ${pending}. Нажмите для подробностей`,
          }
        : pending > 0
          ? {
              Icon: CloudUpload,
              cls: 'text-warn',
              badge: pending,
              badgeCls: 'bg-warn',
              title: `Ожидает отправки: ${pending}. Нажмите для подробностей`,
            }
          : { Icon: Cloud, cls: 'text-ok', badge: 0, title: 'Синхронизировано с облаком' }
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        title={cfg.title}
        className={cx(
          'relative h-10 w-10 grid place-items-center rounded-xl hover:bg-surface-2',
          cfg.cls,
        )}
      >
        <cfg.Icon size={19} />
        {cfg.badge > 0 && (
          <span
            className={cx(
              'absolute -top-0.5 -right-0.5 text-[10px] font-semibold min-w-4 h-4 px-1 grid place-items-center rounded-full text-white',
              cfg.badgeCls,
            )}
          >
            {cfg.badge > 99 ? '99+' : cfg.badge}
          </span>
        )}
      </button>
      {open && <DiagPanel onClose={() => setOpen(false)} />}
    </div>
  )
}

// Кнопка «Касса» в шапке — всегда под рукой независимо от текущей страницы.
// На десктопе — полноценная кнопка с текстом; на мобиле — только иконка.
// Скрываем, если у текущей роли нет прав на заказы. Клик = открытие POS
// в отдельном окне — админ продолжает работу в основной вкладке, а кассир
// видит только чек.
export function CashierButton() {
  const me = useCurrentUser()
  if (!canAccess(me.role, 'orders')) return null
  return (
    <button
      onClick={openPosWindow}
      title="Открыть кассу в новом окне"
      className="h-10 px-3 rounded-xl bg-brand text-brand-ink font-medium text-sm inline-flex items-center gap-2 shrink-0 hover:opacity-90 transition shadow-sm shadow-brand/25"
    >
      <ShoppingCart size={17} />
      <span className="hidden sm:inline">Касса</span>
    </button>
  )
}
