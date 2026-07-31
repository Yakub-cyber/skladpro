import { useState } from 'react'
import { Plus, ShieldCheck } from 'lucide-react'
import { Badge, Button } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import AddEmployeeModal from './components/AddEmployeeModal'
import EmployeesTable from './components/EmployeesTable'
import RolesGrid from './components/RolesGrid'
import TeamInvites from './components/TeamInvites'
import TeamMembers from './components/TeamMembers'

export default function Employees() {
  // F3-7: селекторы вместо useStore() — иначе Employees ререндерится
  // на каждое изменение state, включая audit и sync-тик.
  const employees = useStore((s) => s.employees)
  const cloud = useStore((s) => s.cloud)
  const companyId = useStore((s) => s.companyId)
  const [adding, setAdding] = useState(false)

  return (
    <div className="animate-fadeUp space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            Сотрудники <Badge tone="brand"><ShieldCheck size={12} /> роли</Badge>
          </h2>
          <p className="text-sm text-muted">
            {employees.length} сотрудников · доступ по ролям
          </p>
        </div>
        {/* В облачном режиме локальное создание через AddEmployeeModal
            ведёт к карточке без authUid — она никогда не сможет войти,
            и после bootstrap приглашённого появится дубликат. Прячем
            кнопку и предлагаем «Пригласить». */}
        {!cloud && (
          <Button icon={Plus} onClick={() => setAdding(true)}>
            Добавить
          </Button>
        )}
      </div>

      {cloud && <TeamMembers companyId={companyId} />}
      {cloud && <TeamInvites companyId={companyId} />}

      <RolesGrid />

      <EmployeesTable />

      <AddEmployeeModal open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
