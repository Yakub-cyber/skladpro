import { useState } from 'react'
import { Plus, Phone, KeyRound, Check, Trash2, ShieldCheck } from 'lucide-react'
import {
  Card,
  Section,
  Button,
  Badge,
  Modal,
  Field,
  Input,
  Select,
  Avatar,
  cx,
} from '../components/ui'
import { useStore } from '../store/useStore'
import { ROLES, roleInfo } from '../lib/constants'
import { NAV } from '../components/Layout'

const PERM_LABEL = NAV.reduce((m, n) => {
  m[n.perm] = n.label
  return m
}, {})

export default function Employees() {
  const { employees, authUserId, updateEmployee, removeEmployee } = useStore()
  const [adding, setAdding] = useState(false)

  const changePin = (e) => {
    const pin = window.prompt(`Новый PIN для «${e.name}» (4 цифры)`, e.pin || '')
    if (pin && /^\d{4}$/.test(pin)) updateEmployee(e.id, { pin })
    else if (pin != null) alert('PIN должен состоять из 4 цифр')
  }

  return (
    <div className="animate-fadeUp space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            Сотрудники <Badge tone="brand"><ShieldCheck size={12} /> роли</Badge>
          </h2>
          <p className="text-sm text-muted">{employees.length} сотрудников · доступ по ролям</p>
        </div>
        <Button icon={Plus} onClick={() => setAdding(true)}>
          Добавить
        </Button>
      </div>

      {/* Роли и их доступ */}
      <Section title="Роли и права доступа">
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {ROLES.map((r) => (
            <div key={r.key} className="rounded-xl border border-line p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-3 h-3 rounded-full" style={{ background: r.color }} />
                <span className="font-medium text-sm">{r.label}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {r.access === '*' ? (
                  <Badge tone="brand">Полный доступ</Badge>
                ) : (
                  r.access
                    .filter((p) => PERM_LABEL[p])
                    .map((p) => (
                      <span
                        key={p}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-surface-2 text-muted"
                      >
                        {PERM_LABEL[p]}
                      </span>
                    ))
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Список сотрудников */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-[12px] text-left border-b border-line bg-surface-2/40">
                <th className="font-medium py-3 px-4">Сотрудник</th>
                <th className="font-medium py-3 px-3">Телефон</th>
                <th className="font-medium py-3 px-3">Роль</th>
                <th className="font-medium py-3 px-3">Статус</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {employees.map((e) => {
                const r = roleInfo(e.role)
                const isMe = e.id === authUserId
                return (
                  <tr key={e.id} className="hover:bg-surface-2/40">
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={e.name} color={r.color} size={34} />
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {e.name}
                            {isMe && <Badge tone="brand">вы</Badge>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-muted">{e.phone}</td>
                    <td className="py-2.5 px-3">
                      <select
                        value={e.role}
                        onChange={(ev) => updateEmployee(e.id, { role: ev.target.value })}
                        className="h-9 px-2 rounded-lg bg-surface-2 border border-line text-[13px] outline-none focus:border-brand"
                      >
                        {ROLES.map((ro) => (
                          <option key={ro.key} value={ro.key}>
                            {ro.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-3">
                      <button
                        onClick={() => updateEmployee(e.id, { active: !e.active })}
                        className={cx(
                          'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-medium',
                          e.active ? 'bg-ok-soft text-ok' : 'bg-surface-2 text-muted',
                        )}
                      >
                        <span className={cx('w-1.5 h-1.5 rounded-full', e.active ? 'bg-ok' : 'bg-muted')} />
                        {e.active ? 'Активен' : 'Отключён'}
                      </button>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => changePin(e)}
                          title="Сменить PIN"
                          className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-brand hover:bg-surface-2"
                        >
                          <KeyRound size={16} />
                        </button>
                        {!isMe && employees.length > 1 && (
                          <button
                            onClick={() => removeEmployee(e.id)}
                            className="h-8 w-8 grid place-items-center rounded-lg text-muted hover:text-bad hover:bg-surface-2"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <AddEmployeeModal open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

function AddEmployeeModal({ open, onClose }) {
  const addEmployee = useStore((s) => s.addEmployee)
  const [f, setF] = useState({ name: '', phone: '', role: 'stock', pin: '' })
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const valid = f.name && /^\d{4}$/.test(f.pin)
  const save = () => {
    if (!valid) return
    addEmployee(f)
    setF({ name: '', phone: '', role: 'stock', pin: '' })
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новый сотрудник"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} disabled={!valid} icon={Check}>
            Добавить
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Имя">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="ФИО" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Телефон">
            <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+7" />
          </Field>
          <Field label="Роль">
            <Select value={f.role} onChange={(e) => set('role', e.target.value)}>
              {ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="PIN для входа" hint="4 цифры — сотрудник будет вводить их при входе">
          <Input
            value={f.pin}
            onChange={(e) => set('pin', e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="0000"
            inputMode="numeric"
          />
        </Field>
      </div>
    </Modal>
  )
}
