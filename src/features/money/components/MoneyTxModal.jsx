import { useState } from 'react'
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Check } from 'lucide-react'
import { Button, Field, Input, Modal, Select } from '@/shared/ui'
import { num } from '@/shared/lib/format'
import { MONEY_PURPOSES } from '@/shared/lib/money'

// Универсальная модалка приход/расход/перевод. Тип фиксирован пропом.
export default function MoneyTxModal({ type, accounts, customers, suppliers, onClose, onSubmit }) {
  const purposes = MONEY_PURPOSES[type] || []
  const [accountId, setAccountId] = useState(accounts[0]?.id || '')
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id || accounts[0]?.id || '')
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState(purposes[0]?.key || '')
  const [customerId, setCustomerId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  const title =
    type === 'in' ? 'Приход денег' : type === 'out' ? 'Расход денег' : 'Перевод между счетами'
  const Icon = type === 'in' ? ArrowDownToLine : type === 'out' ? ArrowUpFromLine : ArrowLeftRight

  const showCustomer = type === 'in' && purpose === 'debt-in'
  const showSupplier = type === 'out' && purpose === 'debt-out'

  const submit = () => {
    setErr('')
    const r = onSubmit({
      accountId,
      toAccountId: type === 'transfer' ? toAccountId : null,
      amount: Number(amount),
      purpose,
      customerId: showCustomer ? customerId : null,
      supplierId: showSupplier ? supplierId : null,
      note,
    })
    if (r && typeof r === 'object' && r.ok === false) {
      setErr(r.error)
      return
    }
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Icon size={18} className="text-brand" /> {title}
        </span>
      }
    >
      <div className="space-y-3">
        <Field label={type === 'transfer' ? 'Со счёта' : 'Счёт'}>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>
        {type === 'transfer' && (
          <Field label="На счёт">
            <Select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Сумма, ₽">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
            className="text-lg font-semibold text-right tabular-nums"
          />
        </Field>
        {type !== 'transfer' && (
          <Field label="Назначение">
            <Select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {purposes.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </Select>
          </Field>
        )}
        {showCustomer && (
          <Field label="Клиент (уменьшить долг)">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— не выбран —</option>
              {customers
                .filter((c) => (c.balance || 0) > 0)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · долг {num(c.balance || 0)} ₽
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {showSupplier && (
          <Field label="Поставщик">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— не выбран —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Комментарий">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Опционально" />
        </Field>
        {err && <div className="text-[13px] text-bad">{err}</div>}
        <div className="flex gap-2 pt-1">
          <Button icon={Check} className="flex-1" onClick={submit}>
            Провести
          </Button>
          <Button variant="soft" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </div>
    </Modal>
  )
}
