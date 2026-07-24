import { useEffect, useState } from 'react'
import { Plus, Phone, KeyRound, Check, Trash2, ShieldCheck, Mail, Send, Clock, UserPlus } from 'lucide-react'
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
  Empty,
  cx,
} from '../components/ui'
import { useConfirm } from '../components/Confirm'
import { useStore } from '../store/useStore'
import { ROLES, roleInfo } from '../lib/constants'
import { NAV } from '../components/Layout'
import { loadInvites, inviteMember, revokeInvite, loadMembers, updateMemberRole, removeMember } from '../lib/cloud'
import { dateFull } from '../lib/format'

const PERM_LABEL = NAV.reduce((m, n) => {
  m[n.perm] = n.label
  return m
}, {})

export default function Employees() {
  const { employees, authUserId, updateEmployee, removeEmployee, cloud, companyId } = useStore()
  const [adding, setAdding] = useState(false)
  const confirm = useConfirm()

  const changePin = (e) => {
    // Prompt БЕЗ дефолтного значения: раньше сюда подставлялся текущий
    // PIN (в новых версиях — 64-символьный хэш). Пользователь стирал
    // непонятную строку, нажимал OK — PIN становился пустым, и админ
    // терял доступ навсегда (verifyPin('', '') === false для любого
    // ввода). Пустой ввод здесь тоже игнорируем — не пишем в стор.
    const pin = window.prompt(`Новый PIN для «${e.name}» — 4 цифры`)
    if (pin == null) return // отмена — не трогаем
    const trimmed = pin.trim()
    if (!trimmed) {
      alert('PIN не задан. Ничего не меняем — старый PIN остался в силе.')
      return
    }
    if (!/^\d{4}$/.test(trimmed)) {
      alert('PIN должен состоять ровно из 4 цифр.')
      return
    }
    updateEmployee(e.id, { pin: trimmed })
  }
  const askRemove = async (e) => {
    const ok = await confirm({
      title: `Удалить сотрудника «${e.name}»?`,
      body: 'Учётная запись пропадёт из списка. Записи, где сотрудник указан автором, сохранятся с прежним именем.',
      tone: 'danger',
      okLabel: 'Удалить',
    })
    if (ok) removeEmployee(e.id)
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
        {/* В облачном режиме локальное создание сотрудника через
            AddEmployeeModal ведёт к карточке без authUid — она никогда
            не сможет войти и после bootstrap приглашённого пользователя
            появится дубликат. Прячем кнопку и предлагаем «Пригласить». */}
        {!cloud && (
          <Button icon={Plus} onClick={() => setAdding(true)}>
            Добавить
          </Button>
        )}
      </div>

      {cloud && <TeamMembers companyId={companyId} />}
      {cloud && <TeamInvites companyId={companyId} />}

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
                            onClick={() => askRemove(e)}
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

// ── Участники компании (облако) ─────────────────────────────────────────────
// Список тех, кто уже зарегистрирован и является членом компании: смена роли,
// удаление. Ограничения бэкенда: «нельзя удалить себя», «нельзя удалить
// последнего админа», роль меняет только admin.
function TeamMembers({ companyId }) {
  const currentEmail = useStore((s) => s.authEmail)
  const [members, setMembers] = useState([])
  const [busy, setBusy] = useState(null) // { userId, action }
  const [msg, setMsg] = useState(null)
  const confirm = useConfirm()

  const refresh = () => loadMembers().then(setMembers).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  const changeRole = async (m, newRole) => {
    if (newRole === m.role) return
    setBusy({ userId: m.user_id, action: 'role' })
    setMsg(null)
    const r = await updateMemberRole(m.user_id, companyId, newRole)
    setBusy(null)
    if (!r?.ok) return setMsg({ ok: false, m: r?.error || 'Не удалось сменить роль' })
    refresh()
  }

  const remove = async (m) => {
    const ok = await confirm({
      title: `Удалить «${m.name || m.email}» из компании?`,
      body: 'Пользователь потеряет доступ к данным компании. Если это последний админ, сервер откажет.',
      tone: 'danger',
      okLabel: 'Удалить участника',
    })
    if (!ok) return
    setBusy({ userId: m.user_id, action: 'remove' })
    setMsg(null)
    const r = await removeMember(m.user_id, companyId)
    setBusy(null)
    if (!r?.ok) return setMsg({ ok: false, m: r?.error || 'Не удалось удалить участника' })
    refresh()
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-brand" /> Участники компании
        </span>
      }
      subtitle="Кто уже присоединился к компании. Роль и удаление доступны только админу."
    >
      {members.length === 0 ? (
        <Empty icon={ShieldCheck} title="Пока никого" text="Как только приглашённый зарегистрируется — он появится здесь." />
      ) : (
        <div className="space-y-2">
          {members.map((m) => {
            const r = roleInfo(m.role)
            const isMe = m.email && currentEmail && m.email.toLowerCase() === String(currentEmail).toLowerCase()
            const isBusy = busy?.userId === m.user_id
            return (
              <div key={m.user_id || m.email} className="flex items-center gap-3 p-3 rounded-xl bg-surface-2">
                <div className="h-9 w-9 rounded-lg bg-brand-soft text-brand grid place-items-center shrink-0">
                  <Avatar name={m.name || m.email} size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">
                    {m.name || m.email}
                    {isMe && <span className="text-[11px] text-muted ml-1.5">(вы)</span>}
                  </div>
                  <div className="text-[12px] text-muted truncate">{m.email}</div>
                </div>
                {isMe ? (
                  <Badge tone="brand">{r.label}</Badge>
                ) : (
                  <Select
                    value={m.role}
                    onChange={(e) => changeRole(m, e.target.value)}
                    disabled={isBusy}
                    className="w-[130px]"
                  >
                    {ROLES.map((rr) => (
                      <option key={rr.key} value={rr.key}>{rr.label}</option>
                    ))}
                  </Select>
                )}
                {!isMe && (
                  <button
                    onClick={() => remove(m)}
                    disabled={isBusy}
                    className={cx('p-1', isBusy ? 'text-muted' : 'text-muted hover:text-bad')}
                    title="Удалить из компании"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {msg && (
        <Badge tone={msg.ok ? 'ok' : 'bad'} className="mt-3">
          {msg.m}
        </Badge>
      )}
    </Section>
  )
}

// ── Приглашения в команду (облако) ───────────────────────────────────────────
function TeamInvites({ companyId }) {
  const [invites, setInvites] = useState([])
  const [open, setOpen] = useState(false)
  const refresh = () => loadInvites().then(setInvites).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <UserPlus size={16} className="text-brand" /> Приглашения в команду
        </span>
      }
      subtitle="Пригласите сотрудника по email — он зарегистрируется и автоматически войдёт в вашу компанию"
      action={
        <Button size="sm" icon={Send} onClick={() => setOpen(true)}>
          Пригласить
        </Button>
      }
    >
      {invites.length === 0 ? (
        <Empty icon={Mail} title="Нет активных приглашений" text="Нажмите «Пригласить», чтобы добавить сотрудника." />
      ) : (
        <div className="space-y-2">
          {invites.map((inv) => {
            const r = roleInfo(inv.role)
            return (
              <div key={inv.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-2">
                <div className="h-9 w-9 rounded-lg bg-brand-soft text-brand grid place-items-center shrink-0">
                  <Mail size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{inv.email}</div>
                  <div className="text-[12px] text-muted flex items-center gap-1.5">
                    <Clock size={11} /> Ожидает регистрации · {dateFull(inv.created_at)}
                  </div>
                </div>
                <Badge tone="brand">{r.label}</Badge>
                <button
                  onClick={() => revokeInvite(inv.id).then(refresh)}
                  className="text-muted hover:text-bad p-1"
                  title="Отозвать приглашение"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <InviteModal open={open} onClose={() => { setOpen(false); refresh() }} companyId={companyId} />
    </Section>
  )
}

function InviteModal({ open, onClose, companyId }) {
  const [f, setF] = useState({ email: '', name: '', role: 'stock' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))

  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(f.email)) return setErr('Укажите корректный email')
    setBusy(true)
    setErr('')
    const r = await inviteMember(companyId, f.email, f.role, f.name)
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setF({ email: '', name: '', role: 'stock' })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Пригласить сотрудника"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} disabled={busy} icon={Send}>
            {busy ? 'Отправляем…' : 'Пригласить'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-muted">
          Сотрудник зарегистрируется на этом же сайте с указанным email — и сразу окажется в вашей компании с выбранной ролью.
        </p>
        <Field label="Email сотрудника">
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="ivan@mail.ru" className="pl-9" />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Имя (необязательно)">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Иван" />
          </Field>
          <Field label="Роль">
            <Select value={f.role} onChange={(e) => set('role', e.target.value)}>
              {ROLES.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        {err && <div className="text-[13px] text-bad">{err}</div>}
      </div>
    </Modal>
  )
}
