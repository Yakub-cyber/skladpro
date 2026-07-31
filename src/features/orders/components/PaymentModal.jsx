import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Modal, Input, cx } from '@/shared/ui'
import { money } from '@/shared/lib/format'

// Экран выбора способа оплаты. Крупные кнопки «Наличные / Карта / В долг /
// Смешанная». Для наличных — поле «Получено» + расчёт сдачи. Для смешанной
// — 2 поля. Enter подтверждает, Esc закрывает. Стандартный POS-flow: сумма
// на экране крупно, минимум решений от кассира. Опирается на компоненты
// Modal/Button/Input из components/ui.
export default function PaymentModal({ open, onClose, total, onConfirm }) {
  const [method, setMethod] = useState('cash') // cash | card | credit | mixed
  const [cashPaid, setCashPaid] = useState('')
  const [cardPaid, setCardPaid] = useState('')

  useEffect(() => {
    if (open) {
      // Сброс к дефолтам при каждом открытии.
      setMethod('cash')
      setCashPaid(String(total || ''))
      setCardPaid('')
    }
  }, [open, total])

  const cashN = Number(cashPaid) || 0
  const cardN = Number(cardPaid) || 0
  const change = method === 'cash' ? Math.max(0, cashN - total) : 0
  const mixedTotal = cashN + cardN
  const mixedShort = Math.max(0, total - mixedTotal)

  // Валидация «можно ли пробить».
  const canConfirm =
    method === 'card' ||
    method === 'credit' ||
    (method === 'cash' && cashN >= total) ||
    (method === 'mixed' && mixedTotal >= total && cashN > 0 && cardN > 0)

  // F1-12: idempotence-guard. Двойной клик или Enter-hammer раньше
  // приводил к двум вызовам onConfirm → два заказа → два moneyTx →
  // касса удвоена. Ref (не state), чтобы гарантированно не пропустить
  // второй synchronous-клик.
  const submittedRef = useRef(false)
  useEffect(() => {
    if (open) submittedRef.current = false
  }, [open])
  const confirm = () => {
    if (!canConfirm || submittedRef.current) return
    submittedRef.current = true
    onConfirm({
      method,
      cashPaid: method === 'cash' ? cashN : method === 'mixed' ? cashN : 0,
      cardPaid: method === 'card' ? total : method === 'mixed' ? cardN : 0,
      change,
    })
  }

  // Enter — подтвердить, Esc — закрыть. Только пока модалка открыта.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Enter' && canConfirm) {
        e.preventDefault()
        confirm()
      }
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canConfirm, method, cashN, cardN])

  const methods = [
    { key: 'cash', label: 'Наличные', icon: '₽', color: 'ok' },
    { key: 'card', label: 'Карта', icon: '💳', color: 'info' },
    { key: 'credit', label: 'В долг', icon: '⏱', color: 'warn' },
    { key: 'mixed', label: 'Смешанная', icon: '±', color: 'brand' },
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={
        <span className="flex items-center gap-2">
          Оплата
          <span className="text-2xl font-bold tabular-nums text-brand">{money(total)}</span>
        </span>
      }
    >
      <div className="space-y-4">
        {/* Крупные плитки способов оплаты — тач-фрэндли. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {methods.map((m) => (
            <button
              key={m.key}
              onClick={() => setMethod(m.key)}
              className={cx(
                'h-24 rounded-2xl flex flex-col items-center justify-center gap-1 text-[15px] font-semibold border-2 transition',
                method === m.key
                  ? 'bg-brand-soft border-brand text-brand'
                  : 'bg-surface-2 border-line text-muted hover:text-ink',
              )}
            >
              <div className="text-3xl leading-none">{m.icon}</div>
              <div>{m.label}</div>
            </button>
          ))}
        </div>

        {/* Наличные — ввод «получено» и крупная плашка «сдача». */}
        {method === 'cash' && (
          <div className="rounded-2xl bg-surface-2 p-4 space-y-3">
            <div>
              <div className="text-[12px] text-muted mb-1.5">Получено, ₽</div>
              <Input
                type="number"
                value={cashPaid}
                onChange={(e) => setCashPaid(e.target.value)}
                className="text-2xl font-bold text-right tabular-nums h-14"
                autoFocus
              />
            </div>
            {/* Быстрые суммы: точная / +100 / +500 / +1000 */}
            <div className="grid grid-cols-4 gap-2">
              {[total, total + 100, total + 500, total + 1000].map((v) => (
                <button
                  key={v}
                  onClick={() => setCashPaid(String(v))}
                  className="h-9 rounded-lg bg-surface hover:bg-surface-3 border border-line text-[13px] font-medium tabular-nums"
                >
                  {money(v)}
                </button>
              ))}
            </div>
            <div
              className={cx(
                'flex items-center justify-between p-3 rounded-xl font-semibold',
                cashN < total
                  ? 'bg-bad-soft text-bad'
                  : change > 0
                    ? 'bg-ok-soft text-ok'
                    : 'bg-surface-3 text-muted',
              )}
            >
              <span>{cashN < total ? 'Не хватает' : 'Сдача'}</span>
              <span className="text-xl tabular-nums">
                {money(cashN < total ? total - cashN : change)}
              </span>
            </div>
          </div>
        )}

        {/* Карта — просто подтверждение суммы, ввода не требуется. */}
        {method === 'card' && (
          <div className="rounded-2xl bg-info-soft text-info p-4 flex items-center justify-between">
            <span className="font-medium">К оплате картой</span>
            <span className="text-2xl font-bold tabular-nums">{money(total)}</span>
          </div>
        )}

        {/* В долг — предупреждение и подтверждение суммы. */}
        {method === 'credit' && (
          <div className="rounded-2xl bg-warn-soft text-warn p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">В долг клиенту</span>
              <span className="text-2xl font-bold tabular-nums">{money(total)}</span>
            </div>
            <div className="text-[12px] opacity-80">
              Сумма прибавится к балансу выбранного клиента. Розничным покупателям
              «в долг» оформить нельзя — выберите клиента в чеке.
            </div>
          </div>
        )}

        {/* Смешанная — 2 поля с автопересчётом «недостающего». */}
        {method === 'mixed' && (
          <div className="rounded-2xl bg-surface-2 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[12px] text-muted mb-1.5">Наличными, ₽</div>
                <Input
                  type="number"
                  value={cashPaid}
                  onChange={(e) => setCashPaid(e.target.value)}
                  className="text-lg font-semibold text-right tabular-nums"
                  autoFocus
                />
              </div>
              <div>
                <div className="text-[12px] text-muted mb-1.5">Картой, ₽</div>
                <Input
                  type="number"
                  value={cardPaid}
                  onChange={(e) => setCardPaid(e.target.value)}
                  className="text-lg font-semibold text-right tabular-nums"
                />
              </div>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-surface">
              <span className="text-[13px] text-muted">Итого внесено</span>
              <span className="font-semibold tabular-nums">{money(mixedTotal)}</span>
            </div>
            {mixedShort > 0 && (
              <div className="text-[12px] text-bad text-right">
                Не хватает {money(mixedShort)}
              </div>
            )}
          </div>
        )}

        {/* Финальная CTA. Enter тоже сработает. */}
        <button
          onClick={confirm}
          disabled={!canConfirm}
          className={cx(
            'w-full h-16 rounded-2xl flex items-center justify-center gap-2 text-white text-xl font-bold transition shadow-lg',
            canConfirm
              ? 'bg-[var(--ok,#16a34a)] hover:brightness-110 shadow-emerald-500/25'
              : 'bg-surface-3 text-muted cursor-not-allowed shadow-none',
          )}
        >
          <Check size={22} />
          Пробить чек
          <kbd className="text-[11px] font-semibold bg-black/20 rounded px-1.5 py-0.5">
            Enter
          </kbd>
        </button>
      </div>
    </Modal>
  )
}
