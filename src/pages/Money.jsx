// Финансовый модуль «Деньги». По схеме CloudShop: карточки счетов сверху,
// три кнопки «Приход / Расход / Перевод», ниже — лента транзакций с
// фильтром по счёту. Балансы вычисляются на лету из moneyTx (см. lib/money.js).
import { useMemo, useState } from 'react'
import {
  Wallet,
  Landmark,
  Plus,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  X,
  Trash2,
  Check,
  Building2,
} from 'lucide-react'
import { Card, Button, Badge, Field, Input, Select, Modal, Empty, cx } from '../components/ui'
import { useConfirm } from '../components/Confirm'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'
import { accountBalances, MONEY_PURPOSES, purposeLabel } from '../lib/money'

export default function Money() {
  const accounts = useStore((s) => s.accounts) || []
  const moneyTx = useStore((s) => s.moneyTx) || []
  const customers = useStore((s) => s.customers) || []
  const suppliers = useStore((s) => s.suppliers) || []
  const addMoneyTx = useStore((s) => s.addMoneyTx)
  const cancelMoneyTx = useStore((s) => s.cancelMoneyTx)
  const addAccount = useStore((s) => s.addAccount)

  const [modal, setModal] = useState(null) // null | 'in' | 'out' | 'transfer' | 'account'
  const [filterAcc, setFilterAcc] = useState('all')

  const balances = useMemo(
    () => accountBalances(accounts, moneyTx),
    [accounts, moneyTx],
  )
  const total = accounts.reduce((a, x) => a + (balances[x.id] || 0), 0)

  const visibleTx = moneyTx.filter(
    (t) => filterAcc === 'all' || t.accountId === filterAcc || t.toAccountId === filterAcc,
  )

  return (
    <div className="animate-fadeUp space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Деньги</h2>
          <p className="text-sm text-muted">
            Кассы, счета, движение средств. Приход / расход / перевод между счетами.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Button icon={ArrowDownToLine} onClick={() => setModal('in')}>
            Приход
          </Button>
          <Button icon={ArrowUpFromLine} variant="soft" onClick={() => setModal('out')}>
            Расход
          </Button>
          <Button icon={ArrowLeftRight} variant="soft" onClick={() => setModal('transfer')}>
            Перевод
          </Button>
        </div>
      </div>

      {/* Карточки счетов */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {accounts.map((a) => {
          const balance = balances[a.id] || 0
          const Icon = a.kind === 'bank' ? Landmark : Wallet
          return (
            <button
              key={a.id}
              onClick={() =>
                setFilterAcc(filterAcc === a.id ? 'all' : a.id)
              }
              className={cx(
                'card p-4 flex items-start gap-3 text-left transition hover:border-brand/40',
                filterAcc === a.id && 'border-brand ring-1 ring-brand/40',
              )}
            >
              <div
                className={cx(
                  'h-10 w-10 rounded-xl grid place-items-center shrink-0',
                  a.kind === 'bank'
                    ? 'bg-info-soft text-info'
                    : 'bg-warn-soft text-warn',
                )}
              >
                <Icon size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-muted">
                  {a.kind === 'bank' ? 'Расчётный счёт' : 'Касса'}
                </div>
                <div className="font-semibold text-[15px] truncate">{a.name}</div>
                <div
                  className={cx(
                    'mt-1.5 text-lg font-bold tabular-nums',
                    balance < 0 && 'text-bad',
                  )}
                >
                  {money(balance)}
                </div>
              </div>
            </button>
          )
        })}
        <button
          onClick={() => setModal('account')}
          className="card p-4 flex flex-col items-center justify-center gap-2 border-dashed text-muted hover:text-ink hover:border-brand/40"
        >
          <Plus size={22} />
          <span className="text-sm font-medium">Добавить счёт</span>
        </button>
      </div>

      {/* Итого + фильтр */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted">Итого по счетам:</span>
        <span
          className={cx(
            'text-lg font-bold tabular-nums',
            total < 0 && 'text-bad',
          )}
        >
          {money(total)}
        </span>
        {filterAcc !== 'all' && (
          <button
            onClick={() => setFilterAcc('all')}
            className="ml-auto text-[12px] flex items-center gap-1 text-muted hover:text-ink"
          >
            <X size={13} /> сбросить фильтр
          </button>
        )}
      </div>

      {/* Лента транзакций */}
      <Card className="overflow-hidden">
        {visibleTx.length === 0 ? (
          <Empty
            icon={Wallet}
            title="Пока нет движений"
            text="Нажмите «Приход», «Расход» или «Перевод», чтобы записать движение денег."
          />
        ) : (
          <div className="divide-y divide-line">
            {visibleTx.map((t) => (
              <TxRow
                key={t.id}
                tx={t}
                accounts={accounts}
                customers={customers}
                suppliers={suppliers}
                onCancel={() => cancelMoneyTx(t.id)}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Модалки */}
      {modal === 'in' && (
        <MoneyTxModal
          type="in"
          accounts={accounts}
          customers={customers}
          suppliers={suppliers}
          onClose={() => setModal(null)}
          onSubmit={(tx) => addMoneyTx({ ...tx, type: 'in' })}
        />
      )}
      {modal === 'out' && (
        <MoneyTxModal
          type="out"
          accounts={accounts}
          customers={customers}
          suppliers={suppliers}
          onClose={() => setModal(null)}
          onSubmit={(tx) => addMoneyTx({ ...tx, type: 'out' })}
        />
      )}
      {modal === 'transfer' && (
        <MoneyTxModal
          type="transfer"
          accounts={accounts}
          customers={customers}
          suppliers={suppliers}
          onClose={() => setModal(null)}
          onSubmit={(tx) => addMoneyTx({ ...tx, type: 'transfer' })}
        />
      )}
      {modal === 'account' && (
        <AccountModal
          onClose={() => setModal(null)}
          onSubmit={(a) => addAccount(a)}
        />
      )}
    </div>
  )
}

function TxRow({ tx, accounts, customers, suppliers, onCancel }) {
  const confirm = useConfirm()
  const askCancel = async () => {
    const ok = await confirm({
      title: `Отменить транзакцию ${tx.no}?`,
      body: 'Баланс счёта пересчитается автоматически. Историю запись сохранит со статусом «отменено».',
      tone: 'warning',
      okLabel: 'Отменить транзакцию',
      cancelLabel: 'Оставить',
    })
    if (ok) onCancel()
  }
  const acc = accounts.find((a) => a.id === tx.accountId)
  const toAcc = accounts.find((a) => a.id === tx.toAccountId)
  const cust = customers.find((c) => c.id === tx.customerId)
  const sup = suppliers.find((s) => s.id === tx.supplierId)
  const cancelled = tx.status === 'cancelled'
  const sign = tx.type === 'in' ? '+' : tx.type === 'out' ? '−' : ''
  const Icon =
    tx.type === 'in'
      ? ArrowDownToLine
      : tx.type === 'out'
        ? ArrowUpFromLine
        : ArrowLeftRight
  const tone =
    tx.type === 'in' ? 'text-ok' : tx.type === 'out' ? 'text-bad' : 'text-info'

  return (
    <div
      className={cx(
        'flex items-center gap-3 p-3.5',
        cancelled && 'opacity-50 line-through',
      )}
    >
      <div
        className={cx(
          'h-9 w-9 rounded-lg grid place-items-center shrink-0',
          tx.type === 'in'
            ? 'bg-ok-soft'
            : tx.type === 'out'
              ? 'bg-bad-soft'
              : 'bg-info-soft',
          tone,
        )}
      >
        <Icon size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium flex items-center gap-1.5 flex-wrap">
          <span>{purposeLabel(tx.type, tx.purpose)}</span>
          <Badge tone="brand" className="text-[10px]">{tx.no}</Badge>
          {cancelled && <Badge tone="bad" className="text-[10px]">отменено</Badge>}
        </div>
        <div className="text-[11.5px] text-muted mt-0.5 truncate">
          {tx.type === 'transfer'
            ? `${acc?.name || '—'} → ${toAcc?.name || '—'}`
            : acc?.name || '—'}
          {cust && ` · клиент: ${cust.name}`}
          {sup && ` · поставщик: ${sup.name}`}
          {tx.note && ` · ${tx.note}`}
        </div>
      </div>
      <div
        className={cx(
          'text-[15px] font-semibold tabular-nums shrink-0',
          tone,
        )}
      >
        {sign}
        {money(tx.amount)}
      </div>
      {!cancelled && (
        <button
          onClick={askCancel}
          className="text-muted hover:text-bad p-1.5"
          title="Отменить"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

// Универсальная модалка приход/расход/перевод. Тип фиксирован пропом.
function MoneyTxModal({ type, accounts, customers, suppliers, onClose, onSubmit }) {
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
  const Icon =
    type === 'in' ? ArrowDownToLine : type === 'out' ? ArrowUpFromLine : ArrowLeftRight

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
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        {type === 'transfer' && (
          <Field label="На счёт">
            <Select
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
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
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {showCustomer && (
          <Field label="Клиент (уменьшить долг)">
            <Select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
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
            <Select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">— не выбран —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Комментарий">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Опционально"
          />
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

function AccountModal({ onClose, onSubmit }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState('cash')

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Building2 size={18} className="text-brand" /> Новый счёт
        </span>
      }
    >
      <div className="space-y-3">
        <Field label="Название">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, «Касса магазина №2»"
            autoFocus
          />
        </Field>
        <Field label="Тип">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="cash">Касса (наличные)</option>
            <option value="bank">Расчётный счёт</option>
          </Select>
        </Field>
        <div className="flex gap-2 pt-1">
          <Button
            icon={Check}
            className="flex-1"
            disabled={!name.trim()}
            onClick={() => {
              onSubmit({ name: name.trim(), kind })
              onClose()
            }}
          >
            Создать
          </Button>
          <Button variant="soft" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </div>
    </Modal>
  )
}
