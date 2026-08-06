import { useState } from 'react'
import { Copy, Check, X } from 'lucide-react'
import { useStore } from '@/shared/store/useStore'
import { getLastError, buildDiagText } from '@/shared/lib/diagRing'
import { syncNow } from '@/shared/lib/cloud'

export function DiagPanel({ onClose }) {
  const pending = useStore((s) => s.syncPending || 0)
  const state = useStore((s) => s.syncState || 'ok')
  const syncError = useStore((s) => s.syncError)
  const companyId = useStore((s) => s.companyId)
  const [copied, setCopied] = useState(false)

  const lastErr = getLastError()

  const handleCopy = () => {
    const text = buildDiagText({
      version: import.meta.env?.VITE_APP_VERSION || 'dev',
      companyId,
      queuePending: pending,
      queueState: state,
    })
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="absolute right-0 top-full mt-2 w-80 bg-surface rounded-xl border border-edge shadow-lg z-50 p-4 text-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold text-ink">Синхронизация</span>
        <button onClick={onClose} className="text-muted hover:text-ink"><X size={16} /></button>
      </div>

      <div className="space-y-2 text-muted">
        <div className="flex justify-between">
          <span>Очередь</span>
          <span className={pending > 0 ? 'text-warn font-medium' : 'text-ok'}>{pending} ожидает</span>
        </div>
        <div className="flex justify-between">
          <span>Состояние</span>
          <span className={state === 'error' ? 'text-bad font-medium' : state === 'ok' ? 'text-ok' : 'text-warn'}>
            {state === 'ok' ? 'Синхронизировано' : state === 'error' ? 'Ошибка' : state}
          </span>
        </div>
      </div>

      {(lastErr || syncError) && (
        <div className="mt-3 p-2.5 rounded-lg bg-bad/10 text-bad text-xs space-y-1">
          <div className="font-medium">Последняя ошибка</div>
          {lastErr?.code && <div>Код: <code className="font-mono">{lastErr.code}</code></div>}
          <div>{lastErr?.error || syncError}</div>
          {lastErr?.traceId && <div className="text-muted font-mono truncate">trace: {lastErr.traceId}</div>}
          {lastErr?.ts && <div className="text-muted">{new Date(lastErr.ts).toLocaleString()}</div>}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => { syncNow(); onClose() }}
          className="flex-1 h-8 rounded-lg bg-brand text-brand-ink text-xs font-medium hover:opacity-90"
        >
          Повторить
        </button>
        <button
          onClick={handleCopy}
          className="flex-1 h-8 rounded-lg border border-edge text-ink text-xs font-medium hover:bg-surface-2 inline-flex items-center justify-center gap-1.5"
        >
          {copied ? <><Check size={13} /> Скопировано</> : <><Copy size={13} /> Диагностика</>}
        </button>
      </div>
    </div>
  )
}
