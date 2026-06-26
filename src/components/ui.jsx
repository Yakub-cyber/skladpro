import { useEffect } from 'react'
import { X } from 'lucide-react'
import { statusInfo } from '../lib/constants'
import { initials } from '../lib/format'

export const cx = (...a) => a.filter(Boolean).join(' ')

const TONE = {
  brand: 'bg-brand-soft text-brand',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
  muted: 'bg-surface-2 text-muted',
}

// ── Button ──────────────────────────────────────────────────────────────
export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  className,
  children,
  ...props
}) {
  const variants = {
    primary:
      'bg-brand text-brand-ink hover:brightness-110 shadow-sm shadow-brand/30',
    soft: 'bg-surface-2 text-ink hover:bg-surface-3',
    outline: 'border border-line text-ink hover:bg-surface-2',
    ghost: 'text-muted hover:text-ink hover:bg-surface-2',
    danger: 'bg-bad-soft text-bad hover:brightness-110',
  }
  const sizes = {
    sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
    md: 'h-10 px-4 text-sm gap-2 rounded-xl',
    lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
    icon: 'h-10 w-10 rounded-xl justify-center',
  }
  return (
    <button
      className={cx(
        'inline-flex items-center font-medium transition-all active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {Icon && <Icon size={size === 'sm' ? 15 : 17} strokeWidth={2.2} />}
      {children}
    </button>
  )
}

// ── Card ────────────────────────────────────────────────────────────────
export function Card({ className, children, ...rest }) {
  return (
    <div className={cx('card', className)} {...rest}>
      {children}
    </div>
  )
}

export function Section({ title, subtitle, action, children, className }) {
  return (
    <Card className={cx('p-5', className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            {title && <h3 className="font-semibold text-[15px]">{title}</h3>}
            {subtitle && <p className="text-[13px] text-muted mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </Card>
  )
}

// ── Badge ───────────────────────────────────────────────────────────────
export function Badge({ tone = 'muted', className, children }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] font-medium',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function StatusBadge({ status }) {
  const s = statusInfo(status)
  return (
    <Badge tone={s.color}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {s.label}
    </Badge>
  )
}

// ── Stat (KPI) ──────────────────────────────────────────────────────────
export function Stat({ label, value, sub, icon: Icon, tone = 'brand', trend }) {
  return (
    <Card className="p-4 flex items-center gap-4">
      <div
        className={cx(
          'h-11 w-11 rounded-xl grid place-items-center shrink-0',
          TONE[tone],
        )}
      >
        {Icon && <Icon size={20} strokeWidth={2.2} />}
      </div>
      <div className="min-w-0">
        <div className="text-[13px] text-muted truncate">{label}</div>
        <div className="text-[19px] font-semibold leading-tight tracking-tight">
          {value}
        </div>
        {(sub || trend != null) && (
          <div className="text-[12px] text-muted mt-0.5 flex items-center gap-1">
            {trend != null && (
              <span className={trend >= 0 ? 'text-ok' : 'text-bad'}>
                {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}%
              </span>
            )}
            {sub}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Поля ввода ──────────────────────────────────────────────────────────
export function Field({ label, hint, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && (
        <span className="block text-[13px] font-medium text-muted mb-1.5">
          {label}
        </span>
      )}
      {children}
      {hint && <span className="block text-[12px] text-muted mt-1">{hint}</span>}
    </label>
  )
}

const fieldCls =
  'w-full h-10 px-3 rounded-xl bg-surface-2 border border-line text-sm text-ink placeholder:text-muted/70 outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 transition'

export const Input = ({ className, ...p }) => (
  <input className={cx(fieldCls, className)} {...p} />
)
export const Select = ({ className, children, ...p }) => (
  <select className={cx(fieldCls, 'pr-8', className)} {...p}>
    {children}
  </select>
)
export const Textarea = ({ className, ...p }) => (
  <textarea
    className={cx(fieldCls, 'h-auto py-2.5 leading-relaxed resize-y', className)}
    {...p}
  />
)

// ── Modal ───────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/55 backdrop-blur-sm animate-fadeUp"
      onMouseDown={onClose}
    >
      <div
        className={cx(
          'card w-full flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)]',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-14 border-b border-line shrink-0">
          <h3 className="font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-ink hover:bg-surface-2"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 min-h-0">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-line bg-surface-2/40 flex justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Прочее ──────────────────────────────────────────────────────────────
export function Avatar({ name, color, size = 38 }) {
  return (
    <div
      className="rounded-xl grid place-items-center font-semibold text-white shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: color || 'var(--brand)',
      }}
    >
      {initials(name)}
    </div>
  )
}

export function Empty({ icon: Icon, title, text, action }) {
  return (
    <div className="text-center py-14 px-4">
      {Icon && (
        <div className="mx-auto mb-3 h-14 w-14 rounded-2xl bg-surface-2 grid place-items-center text-muted">
          <Icon size={26} />
        </div>
      )}
      <p className="font-medium">{title}</p>
      {text && <p className="text-[13px] text-muted mt-1 max-w-sm mx-auto">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Progress({ value, tone = 'brand' }) {
  const bar = {
    brand: 'bg-brand',
    ok: 'bg-ok',
    warn: 'bg-warn',
    bad: 'bg-bad',
  }
  return (
    <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
      <div
        className={cx('h-full rounded-full transition-all', bar[tone])}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}
