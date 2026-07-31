import { useStore } from '@/shared/store/useStore'
import DashboardManager from './components/DashboardManager'
import DashboardStock from './DashboardStockPage'
import DashboardCourier from './DashboardCourierPage'

// Дашборд-router: по роли текущего сотрудника рендерит нужный вариант.
//  - stock (кладовщик) → DashboardStock: приёмка, сборка, ниже минимума.
//  - courier (курьер)  → DashboardCourier: прогресс маршрута, следующая точка.
//  - остальные         → DashboardManager: финансы, KPI, аналитика.
export default function Dashboard() {
  const employees = useStore((s) => s.employees) || []
  const authUserId = useStore((s) => s.authUserId)
  const me = employees.find((e) => e.id === authUserId)
  if (me?.role === 'stock') return <DashboardStock />
  if (me?.role === 'courier') return <DashboardCourier />
  return <DashboardManager />
}
