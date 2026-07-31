import { KeyRound, Trash2 } from 'lucide-react'
import { Avatar, Badge, Card, cx } from '@/shared/ui'
import { useConfirm } from '@/shared/components/Confirm'
import { useStore } from '@/shared/store/useStore'
import { ROLES, roleInfo } from '@/shared/lib/constants'

export default function EmployeesTable() {
  const employees = useStore((s) => s.employees)
  const authUserId = useStore((s) => s.authUserId)
  const updateEmployee = useStore((s) => s.updateEmployee)
  const removeEmployee = useStore((s) => s.removeEmployee)
  const confirm = useConfirm()

  const changePin = (e) => {
    // Prompt БЕЗ дефолтного значения: раньше сюда подставлялся текущий
    // PIN (в новых версиях — хэш). Пользователь стирал непонятную строку,
    // жал OK — PIN становился пустым, админ терял доступ навсегда.
    const pin = window.prompt(`Новый PIN для «${e.name}» — 4 цифры`)
    if (pin == null) return
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
                        <option key={ro.key} value={ro.key}>{ro.label}</option>
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
  )
}
