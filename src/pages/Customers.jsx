import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Plus,
  Search,
  Phone,
  MapPin,
  Gift,
  Crown,
  Building2,
  Wallet,
  X,
  Download,
} from 'lucide-react'
import {
  Card,
  Button,
  Badge,
  Modal,
  Field,
  Input,
  Select,
  Avatar,
  Empty,
  Progress,
  cx,
} from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num, dateFull, dateShort, relTime } from '../lib/format'
import { TIERS, tierFor, statusInfo } from '../lib/constants'
import { downloadCsv } from '../lib/export'

export default function Customers() {
  const { customers, orders } = useStore()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)

  const openId = params.get('id')
  const open = customers.find((c) => c.id === openId)

  const list = useMemo(() => {
    const s = q.toLowerCase()
    return [...customers]
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .filter(
        (c) =>
          !s ||
          c.name.toLowerCase().includes(s) ||
          c.city.toLowerCase().includes(s) ||
          c.contact.toLowerCase().includes(s),
      )
  }, [customers, q])

  return (
    <div className="animate-fadeUp">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Клиенты</h2>
          <p className="text-sm text-muted">
            {customers.length} контрагентов · оборот{' '}
            {money(customers.reduce((a, c) => a + c.totalSpent, 0))}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="soft"
            icon={Download}
            disabled={!list.length}
            onClick={() =>
              downloadCsv(`Взаиморасчёты-${new Date().toISOString().slice(0, 10)}`, list, [
                { key: 'name', label: 'Наименование' },
                { key: 'type', label: 'Тип' },
                { key: 'city', label: 'Город' },
                { key: 'contact', label: 'Контакт' },
                { key: 'phone', label: 'Телефон' },
                { key: 'totalSpent', label: 'Оборот', map: (v) => Math.round(v || 0) },
                { key: 'balance', label: 'Долг', map: (v) => Math.round(v || 0) },
                { key: 'bonus', label: 'Бонусы', map: (v) => Math.round(v || 0) },
                { key: 'totalSpent', label: 'Уровень', map: (v) => tierFor(v || 0).label },
              ])
            }
          >
            <span className="hidden sm:inline">Экспорт</span>
          </Button>
          <Button icon={Plus} onClick={() => setAdding(true)}>
            Добавить
          </Button>
        </div>
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск клиента…"
          className="pl-9"
        />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((c) => {
          const tier = tierFor(c.totalSpent)
          return (
            <button
              key={c.id}
              onClick={() => setParams({ id: c.id })}
              className="card p-4 text-left hover:border-brand/40 transition truncate"
              style={{ maxWidth: '100%' }}
            >
              <div className="flex items-center gap-3">
                <Avatar name={c.name} color={tier.color} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{c.name}</div>
                  <div className="text-[12px] text-muted flex items-center gap-1">
                    <MapPin size={11} /> {c.city} · {c.type}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-line">
                <div>
                  <div className="text-[11px] text-muted">Оборот</div>
                  <div className="font-semibold text-sm tabular-nums">
                    {money(c.totalSpent)}
                  </div>
                </div>
                <div className="text-right">
                  <Badge tone={tier.key === 'base' ? 'muted' : 'brand'}>
                    <Crown size={11} /> {tier.label}
                  </Badge>
                  {c.balance > 0 && (
                    <div className="text-[11px] text-bad mt-1 font-medium">
                      долг {money(c.balance)}
                    </div>
                  )}
                </div>
              </div>
            </button>
          )
        })}
        {list.length === 0 && (
          <div className="col-span-full">
            <Empty icon={Search} title="Клиенты не найдены" />
          </div>
        )}
      </div>

      {open && (
        <CustomerModal
          customer={open}
          orders={orders.filter((o) => o.customerId === open.id)}
          onClose={() => setParams({})}
        />
      )}
      <AddCustomerModal open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

function CustomerModal({ customer, orders, onClose }) {
  const addPayment = useStore((s) => s.addPayment)
  const c = useStore((s) => s.customers.find((x) => x.id === customer.id)) || customer
  const [pay, setPay] = useState('')
  const tier = tierFor(c.totalSpent)
  const idx = TIERS.findIndex((t) => t.key === tier.key)
  const next = TIERS[idx + 1]
  const progress = next
    ? ((c.totalSpent - tier.min) / (next.min - tier.min)) * 100
    : 100

  return (
    <Modal open onClose={onClose} title="Карточка клиента" wide>
      <div className="flex items-center gap-4 mb-5">
        <Avatar name={c.name} color={tier.color} size={56} />
        <div>
          <h3 className="text-lg font-semibold">{c.name}</h3>
          <p className="text-sm text-muted">
            {c.type} · с {dateFull(c.since)}
          </p>
        </div>
        <Badge tone="brand" className="ml-auto">
          <Crown size={12} /> {tier.label} · скидка {tier.discount}%
        </Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Mini label="Оборот" value={money(c.totalSpent)} />
        <Mini label="Заказов" value={num(orders.length)} />
        <Mini label="Бонусы" value={`${num(c.bonus)} б.`} icon={Gift} />
        <Mini label="Город" value={c.city} icon={MapPin} />
      </div>

      {/* Баланс / задолженность */}
      <div
        className={cx(
          'mb-5 p-4 rounded-xl border',
          c.balance > 0 ? 'bg-bad-soft border-bad/20' : 'bg-ok-soft border-ok/20',
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] text-muted flex items-center gap-1.5">
              <Wallet size={13} /> {c.balance > 0 ? 'Задолженность' : 'Расчётов нет'}
            </div>
            <div className={cx('text-xl font-semibold tabular-nums', c.balance > 0 ? 'text-bad' : 'text-ok')}>
              {money(c.balance || 0)}
            </div>
          </div>
          {c.balance > 0 && (
            <div className="flex items-end gap-2">
              <input
                type="number"
                value={pay}
                onChange={(e) => setPay(e.target.value)}
                placeholder="Сумма"
                className="w-28 h-10 px-3 rounded-xl bg-surface border border-line text-sm outline-none focus:border-brand"
              />
              <Button
                icon={Wallet}
                onClick={() => {
                  addPayment(c.id, pay)
                  setPay('')
                }}
                disabled={!pay}
              >
                Внести оплату
              </Button>
            </div>
          )}
        </div>
      </div>

      {next && (
        <div className="mb-5 p-3 rounded-xl bg-surface-2">
          <div className="flex justify-between text-[13px] mb-1.5">
            <span className="text-muted">До уровня «{next.label}»</span>
            <span className="font-medium">{money(next.min - c.totalSpent)}</span>
          </div>
          <Progress value={progress} tone="brand" />
        </div>
      )}

      <div className="flex items-center gap-4 mb-3 text-sm">
        <a href={`tel:${c.phone}`} className="flex items-center gap-2 text-brand">
          <Phone size={15} /> {c.phone}
        </a>
        <span className="text-muted">{c.contact}</span>
      </div>

      <h4 className="font-semibold text-sm mb-2 mt-5">История заказов</h4>
      {orders.length ? (
        <div className="divide-y divide-line max-h-60 overflow-y-auto">
          {orders.map((o) => (
            <div key={o.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="font-medium tabular-nums w-28">{o.no}</span>
              <span className="text-muted text-[12px] flex-1">
                {dateShort(o.createdAt)} · {o.items.length} поз.
              </span>
              <span className="tabular-nums font-medium">{money(o.total)}</span>
              <Badge tone={statusInfo(o.status).color}>{statusInfo(o.status).label}</Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Заказов пока нет</p>
      )}
    </Modal>
  )
}

function Mini({ label, value, icon: Icon }) {
  return (
    <div className="p-3 rounded-xl bg-surface-2">
      <div className="text-[11px] text-muted flex items-center gap-1">
        {Icon && <Icon size={11} />} {label}
      </div>
      <div className="font-semibold text-sm mt-0.5 truncate">{value}</div>
    </div>
  )
}

function AddCustomerModal({ open, onClose }) {
  const addCustomer = useStore((s) => s.addCustomer)
  const [f, setF] = useState({ name: '', type: 'ООО', city: '', contact: '', phone: '' })
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const save = () => {
    if (!f.name) return
    addCustomer(f)
    setF({ name: '', type: 'ООО', city: '', contact: '', phone: '' })
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новый клиент"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} disabled={!f.name}>
            Добавить
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Название / ФИО">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="ООО «...»" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Тип">
            <Select value={f.type} onChange={(e) => set('type', e.target.value)}>
              <option>ООО</option>
              <option>ИП</option>
              <option>Бригада</option>
              <option>Розница</option>
            </Select>
          </Field>
          <Field label="Город">
            <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Контактное лицо">
            <Input value={f.contact} onChange={(e) => set('contact', e.target.value)} />
          </Field>
          <Field label="Телефон">
            <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+7" />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
