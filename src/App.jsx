import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Login, { Onboarding, ResetPassword } from './pages/Login'
import PageLoader from './components/PageLoader'
import { useStore } from './store/useStore'

// Ленивая загрузка страниц (code-splitting): тяжёлые зависимости
// (recharts, leaflet, jsbarcode) уезжают в отдельные чанки и не грузятся,
// пока пользователь не откроет соответствующий раздел.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Orders = lazy(() => import('./pages/Orders'))
const NewOrder = lazy(() => import('./pages/NewOrder'))
const EditOrder = lazy(() => import('./pages/EditOrder'))
const Delivery = lazy(() => import('./pages/Delivery'))
const Products = lazy(() => import('./pages/Products'))
const Warehouse = lazy(() => import('./pages/Warehouse'))
const Operations = lazy(() => import('./pages/Operations'))
const Invoices = lazy(() => import('./pages/Invoices'))
const Customers = lazy(() => import('./pages/Customers'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Assistant = lazy(() => import('./pages/Assistant'))
const Storefront = lazy(() => import('./pages/Storefront'))
const Journal = lazy(() => import('./pages/Journal'))
const Employees = lazy(() => import('./pages/Employees'))
const Settings = lazy(() => import('./pages/Settings'))
const Tracking = lazy(() => import('./pages/Tracking'))

function AuthGate({ children }) {
  const authUserId = useStore((s) => s.authUserId)
  const cloud = useStore((s) => s.cloud)
  const needOnboarding = useStore((s) => s.needOnboarding)
  const recoveryMode = useStore((s) => s.recoveryMode)
  const initAuth = useStore((s) => s.initAuth)

  useEffect(() => {
    if (cloud) initAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (cloud && recoveryMode) return <ResetPassword />
  if (cloud && needOnboarding) return <Onboarding />
  return authUserId ? children : <Login />
}

export default function App() {
  // Подписка на settings.currency: при её смене корневой компонент
  // ререндерится, а значит вся ветка страниц — и money() внутри format.js
  // прочитает свежее значение из useStore.
  useStore((s) => s.settings?.currency)
  return (
    <Routes>
      {/* Публичная страница трекинга — без авторизации (для клиента) */}
      <Route
        path="/track/:id"
        element={
          <Suspense fallback={<PageLoader />}>
            <Tracking />
          </Suspense>
        }
      />
      {/* Публичная витрина — доступна клиентам без входа в админку.
          Тот же компонент, что в /storefront, но без брендового
          «баннера админки» — определяется по props isPublic. */}
      <Route
        path="/shop"
        element={
          <Suspense fallback={<PageLoader />}>
            <Storefront isPublic />
          </Suspense>
        }
      />

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
        <Route path="orders/:id/edit" element={<EditOrder />} />
        <Route path="delivery" element={<Delivery />} />
        <Route path="products" element={<Products />} />
        <Route path="warehouse" element={<Warehouse />} />
        <Route path="operations" element={<Operations />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="customers" element={<Customers />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="assistant" element={<Assistant />} />
        {/* /storefront — предпросмотр витрины из админки; /shop — то же
            без Layout для клиента (см. публичный маршрут выше). */}
        <Route path="storefront" element={<Storefront />} />
        <Route path="journal" element={<Journal />} />
        <Route path="employees" element={<Employees />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
