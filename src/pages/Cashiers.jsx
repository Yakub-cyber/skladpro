// Управление кассами (CloudShop-стиль). Раньше клик по «Касса» в NAV
// сразу открывал POS — юзеру это мешало, когда он хотел просто настроить
// сами кассы. Здесь список accounts с назначением кассиров, создание и
// редактирование. POS открывается через большую кнопку «Касса» в шапке
// или через «Продажа» в CTA-меню.
import { useMemo, useState } from 'react'
import {
  Wallet,
  Landmark,
  Plus,
  Pencil,
  Trash2,
  Check,
  ShoppingCart,
  Users,
  X,
} from 'lucide-react'
import { Card, Button, Badge, Field, Input, Select, Modal, Empty, Avatar, cx } from '../components/ui'
import { useConfirm } from '../components/Confirm'
import { useStore } from '../store/useStore'
import { money } from '../lib/format'
import { accountBalances } from '../lib/money'
import { roleInfo } from '../lib/constants'
import { openPosWindow } from '../components/Layout'

export default function Cashiers() {
  const accounts = useStore((s) => s.accounts) || []
  const moneyTx = useStore((s) => s.moneyTx) || []
  const employees = useStore((s) => s.employees) || []
  const addAccount = useStore((s) => s.addAccount)
  const updateAccount = useStore((s) => s.updateAccount)
  const removeAccount = useStore((s) => s.removeAccount)
  const confirm = useConfirm()

  const [editId, setEditId] = useState(null)
  const [creating, setCreating] = useState(false)

  const balances = useMemo(
    () => accountBalances(accounts, moneyTx),
    [accounts, moneyTx],
  )
  const total = accounts.reduce((a, x) => a + (balances[x.id] || 0), 0)

  const canBeCashier = (e) =>
    e.active !== false && ['admin', 'manager', 'stock'].includes(e.role)

  const editing = accounts.find((a) => a.id === editId)

  const askRemove = async (a) => {
    const ok = await confirm({
      title: `Удалить «${a.name}»?`,
      body: 'Если по счёту были денежные транзакции — удаление не сработает. Иначе счёт исчезнет из списка.',
      tone: 'danger',
      okLabel: 'Удалить',
      cancelLabel: 'Оставить',
    })
    if (ok) removeAccount(a.id)
  }

  return (
    <div className="animate-fadeUp space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Кассы и счета</h2>
          <p className="text-sm text-muted">
            Настройка касс, расчётных счетов и закрепление кассиров.
            Открыть POS — кнопкой «Касса» в шапке.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted">Всего денег:</span>
          <span className={cx('text-lg font-bold tabular-nums', total < 0 && 'text-bad')}>
            {money(total)}
          </span>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {accounts.map((a) => {
          const balance = balances[a.id] || 0
          const Icon = a.kind === 'bank' ? Landmark : Wallet
          const cashiers = (a.cashierIds || [])
            .map((id) => employees.find((e) => e.id === id))
            .filter(Boolean)
          return (
            <Card key={a.id} className="p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
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
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditId(a.id)}
                    className="h-8 w-8 rounded-lg grid place-items-center hover:bg-surface-2 text-muted hover:text-ink"
                    title="Изменить"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => askRemove(a)}
                    className="h-8 w-8 rounded-lg grid place-items-center hover:bg-bad-soft text-muted hover:text-bad"
                    title="Удалить"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div>
                <div className="text-[11px] text-muted uppercase tracking-wide mb-0.5">
                  Баланс
                </div>
                <div
                  className={cx(
                    'text-xl font-bold tabular-nums',
                    balance < 0 && 'text-bad',
                  )}
                >
                  {money(balance)}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-muted uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                  <Users size={11} /> Кассиры
                </div>
                {cashiers.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {cashiers.map((e) => (
                      <span
                        key={e.id}
                        className="inline-flex items-center gap-1.5 pr-2 pl-0.5 h-7 rounded-full bg-surface-2 text-[12px]"
                        title={e.name}
                      >
                        <Avatar name={e.name} color={roleInfo(e.role).color} size={24} />
                        <span className="truncate max-w-[100px]">{e.name.split(' ')[0]}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[12px] text-muted italic">
                    Никто не назначен — кассу может открыть любой сотрудник.
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-line flex gap-2">
                <Button
                  size="sm"
                  variant="soft"
                  icon={ShoppingCart}
                  className="flex-1"
                  onClick={openPosWindow}
                  title="Открыть POS в новом окне"
                >
                  Открыть POS
                </Button>
              </div>
            </Card>
          )
        })}

        <button
          onClick={() => setCreating(true)}
          className="card p-4 flex flex-col items-center justify-center gap-2 border-dashed text-muted hover:text-ink hover:border-brand/40 min-h-[220px]"
        >
          <Plus size={26} />
          <span className="text-sm font-medium">Добавить кассу</span>
        </button>
      </div>

      {accounts.length === 0 && (
        <Empty
          icon={Wallet}
          title="Пока нет касс"
          text="Добавьте кассу или расчётный счёт, чтобы записывать движение денег."
        />
      )}

      {creating && (
        <AccountEditor
          employees={employees.filter(canBeCashier)}
          onClose={() => setCreating(false)}
          onSave={(patch) => addAccount(patch)}
        />
      )}
      {editing && (
        <AccountEditor
          initial={editing}
          employees={employees.filter(canBeCashier)}
          onClose={() => setEditId(null)}
          onSave={(patch) => updateAccount(editing.id, patch)}
        />
      )}
    </div>
  )
}

function AccountEditor({ initial, employees, onClose, onSave }) {
  const [name, setName] = useState(initial?.name || '')
  const [kind, setKind] = useState(initial?.kind || 'cash')
  const [cashierIds, setCashierIds] = useState(initial?.cashierIds || [])

  const toggle = (id) =>
    setCashierIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const canSave = name.trim().length > 0

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {kind === 'bank' ? <Landmark size={18} className="text-brand" /> : <Wallet size={18} className="text-brand" />}
          {initial ? 'Редактирование кассы' : 'Новая касса'}
        </span>
      }
    >
      <div className="space-y-3">
        <Field label="Название">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Касса №1"
            autoFocus
          />
        </Field>
        <Field label="Тип">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="cash">Касса (наличные)</option>
            <option value="bank">Расчётный счёт</option>
          </Select>
        </Field>
        <Field
          label="Кассиры"
          hint="Сотрудники, которые могут открывать эту кассу. Если никого не выбрать — доступ у всех."
        >
          {employees.length === 0 ? (
            <div className="text-[13px] text-muted italic">
              Нет активных сотрудников с ролью «Администратор», «Менеджер» или
              «Кладовщик». Добавьте их в разделе «Сотрудники».
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
              {employees.map((e) => {
                const on = cashierIds.includes(e.id)
                return (
                  <label
                    key={e.id}
                    className={cx(
                      'flex items-center gap-2.5 h-10 px-2.5 rounded-xl cursor-pointer border transition',
                      on ? 'bg-brand-soft border-brand/40' : 'border-line hover:border-brand/25',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(e.id)}
                      className="h-4 w-4 accent-brand"
                    />
                    <Avatar name={e.name} color={roleInfo(e.role).color} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate">{e.name}</div>
                      <div className="text-[11px] text-muted">{roleInfo(e.role).label}</div>
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </Field>

        <div className="flex gap-2 pt-1">
          <Button
            icon={Check}
            className="flex-1"
            disabled={!canSave}
            onClick={() => {
              onSave({ name: name.trim(), kind, cashierIds })
              onClose()
            }}
          >
            {initial ? 'Сохранить' : 'Создать'}
          </Button>
          <Button variant="soft" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </div>
    </Modal>
  )
}
