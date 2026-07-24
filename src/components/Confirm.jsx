import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
// eslint-disable-next-line no-unused-vars
// (useRef оставляем для ref кнопки OK; input фокусируется через autoFocus)
import { AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import { Button, Field, Input, Modal, cx } from './ui'

// Универсальный Confirm-диалог для деструктивных/подтверждаемых действий.
// Заменяет `window.confirm()` и прямые вызовы delete/cancel без подтверждения.
//
// Использование:
//   const confirm = useConfirm()
//   const ok = await confirm({
//     title: 'Удалить товар?',
//     body:  'Действие необратимо. История продаж сохранится.',
//     tone:  'danger',        // 'danger' | 'warning' | 'default'
//     okLabel: 'Удалить',
//     requireInput: 'УДАЛИТЬ' // опция — только для очень опасных операций
//   })
//   if (ok) removeProduct(id)

const ConfirmContext = createContext(null)

const TONE_CFG = {
  danger:  { Icon: ShieldAlert,   iconCls: 'bg-bad-soft text-bad',  cta: 'primary', ctaExtra: 'bg-bad text-white shadow-sm shadow-bad/30 hover:brightness-110' },
  warning: { Icon: AlertTriangle, iconCls: 'bg-warn-soft text-warn', cta: 'primary', ctaExtra: 'bg-warn text-white shadow-sm shadow-warn/30 hover:brightness-110' },
  default: { Icon: Info,          iconCls: 'bg-brand-soft text-brand', cta: 'primary', ctaExtra: '' },
}

// Одиночная модалка. Управляется провайдером через open + текущие опции.
function ConfirmDialog({ open, opts, onCancel, onConfirm }) {
  const cfg = TONE_CFG[opts?.tone] || TONE_CFG.default
  const { Icon } = cfg
  const [typed, setTyped] = useState('')
  const okBtnRef = useRef(null)

  // Сброс введённого при каждом новом открытии.
  useEffect(() => { if (open) setTyped('') }, [open, opts])
  // Автофокус на кнопку OK (input с requireInput сам возьмёт фокус через autoFocus).
  useEffect(() => {
    if (!open || opts?.requireInput) return
    const t = setTimeout(() => okBtnRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [open, opts])
  // Enter = OK (когда позволено).
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key !== 'Enter') return
      if (e.target?.tagName === 'TEXTAREA') return
      if (canOk) { e.preventDefault(); onConfirm() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, typed, opts])

  if (!opts) return null

  const need = opts.requireInput
  const canOk = need ? typed.trim() === need : true

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={opts.title || 'Подтверждение'}
      footer={(
        <>
          <Button variant="ghost" onClick={onCancel}>{opts.cancelLabel || 'Отмена'}</Button>
          <button
            ref={okBtnRef}
            type="button"
            onClick={onConfirm}
            disabled={!canOk}
            className={cx(
              'h-10 px-5 rounded-xl text-sm font-medium transition-all active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-2',
              cfg.ctaExtra,
            )}
          >
            {opts.okLabel || 'Подтвердить'}
          </button>
        </>
      )}
    >
      <div className="flex gap-3.5">
        <div className={cx('h-11 w-11 rounded-xl grid place-items-center shrink-0', cfg.iconCls)}>
          <Icon size={22} strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          {opts.body && (
            <p className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap">
              {opts.body}
            </p>
          )}
          {opts.details && (
            <div className="mt-3 p-3 rounded-xl bg-surface-2 border border-line text-[13px] text-muted">
              {opts.details}
            </div>
          )}
          {need && (
            <div className="mt-4">
              <Field
                label={<>Для подтверждения впишите <b className="text-ink">{need}</b></>}
              >
                <Input
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// Провайдер держит одно состояние (последний confirm), очередь не нужна —
// пользователь физически не открывает две модалки одновременно.
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null) // { opts, resolve } | null

  const confirm = useCallback((opts) => {
    // Обратная совместимость: строку тоже примем как body.
    const normalized = typeof opts === 'string' ? { body: opts } : (opts || {})
    return new Promise((resolve) => setState({ opts: normalized, resolve }))
  }, [])

  const close = (result) => {
    state?.resolve(result)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={!!state}
        opts={state?.opts}
        onCancel={() => close(false)}
        onConfirm={() => close(true)}
      />
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    // Фолбэк: если по какой-то причине провайдер не поднят, лучше
    // деградировать до нативного confirm, чем крашиться.
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[useConfirm] ConfirmProvider не найден, использую window.confirm')
    }
    return (opts) => Promise.resolve(
      window.confirm(typeof opts === 'string' ? opts : (opts?.body || opts?.title || 'Подтвердить?')),
    )
  }
  return ctx
}
