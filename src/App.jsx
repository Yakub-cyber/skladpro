import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Login, { Onboarding } from './pages/Login'
import { useStore } from './store/useStore'
import Dashboard from './pages/Dashboard'
import Orders from './pages/Orders'
import NewOrder from './pages/NewOrder'
import Delivery from './pages/Delivery'
import Products from './pages/Products'
import Warehouse from './pages/Warehouse'
import Operations from './pages/Operations'
import Invoices from './pages/Invoices'
import Customers from './pages/Customers'
import Suppliers from './pages/Suppliers'
import Analytics from './pages/Analytics'
import Storefront from './pages/Storefront'
import Journal from './pages/Journal'
import Employees from './pages/Employees'
import Settings from './pages/Settings'
import Tracking from './pages/Tracking'

function AuthGate({ children }) {
  const authUserId = useStore((s) => s.authUserId)
  const cloud = useStore((s) => s.cloud)
  const needOnboarding = useStore((s) => s.needOnboarding)
  const initAuth = useStore((s) => s.initAuth)

  useEffect(() => {
    if (cloud) initAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (cloud && needOnboarding) return <Onboarding />
  return authUserId ? children : <Login />
}

export default function App() {
  return (
    <Routes>
      {/* Публичная страница трекинга — без авторизации (для клиента) */}
      <Route path="/track/:id" element={<Tracking />} />

      <Route
        element={
          <AuthGate>
            <Layout />
          </AuthGate>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/new" element={<NewOrder />} />
        <Route path="delivery" element={<Delivery />} />
        <Route path="products" element={<Products />} />
        <Route path="warehouse" element={<Warehouse />} />
        <Route path="operations" element={<Operations />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="customers" element={<Customers />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="storefront" element={<Storefront />} />
        <Route path="journal" element={<Journal />} />
        <Route path="employees" element={<Employees />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
