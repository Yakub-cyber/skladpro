import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from '@/app/layout/Layout'
import Login, { Onboarding, ResetPassword } from '@/features/auth/LoginPage'
import PageLoader from '@/shared/components/PageLoader'
import FeatureGate from '@/shared/components/FeatureGate'
import { useStore } from '@/shared/store/useStore'

// Ленивая загрузка страниц (code-splitting): тяжёлые зависимости
// (recharts, leaflet, jsbarcode) уезжают в отдельные чанки и не грузятся,
// пока пользователь не откроет соответствующий раздел.
const Dashboard = lazy(() => import('@/features/dashboard/DashboardPage'))
const Orders = lazy(() => import('@/features/orders/OrdersPage'))
const NewOrder = lazy(() => import('@/features/orders/NewOrderPage'))
const EditOrder = lazy(() => import('@/features/orders/EditOrderPage'))
const Delivery = lazy(() => import('@/features/delivery/DeliveryPage'))
const Products = lazy(() => import('@/features/products/ProductsPage'))
const Warehouse = lazy(() => import('@/features/warehouse/WarehousePage'))
const Operations = lazy(() => import('@/features/operations/OperationsPage'))
const Invoices = lazy(() => import('@/features/invoices/InvoicesPage'))
const Customers = lazy(() => import('@/features/customers/CustomersPage'))
const Suppliers = lazy(() => import('@/features/suppliers/SuppliersPage'))
const Analytics = lazy(() => import('@/features/analytics/AnalyticsPage'))
const Assistant = lazy(() => import('@/features/assistant/AssistantPage'))
const Storefront = lazy(() => import('@/features/storefront/StorefrontPage'))
const Journal = lazy(() => import('@/features/shifts/JournalPage'))
const Money = lazy(() => import('@/features/money/MoneyPage'))
const Cashiers = lazy(() => import('@/features/shifts/CashiersPage'))
const Movements = lazy(() => import('@/features/movements/MovementsPage'))
const Subscription = lazy(() => import('@/features/subscription/SubscriptionPage'))
const PurchaseOrders = lazy(() => import('@/features/suppliers/PurchaseOrdersPage'))
const Employees = lazy(() => import('@/features/employees/EmployeesPage'))
const Settings = lazy(() => import('@/features/settings/SettingsPage'))
const Tracking = lazy(() => import('@/features/tracking/TrackingPage'))

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
      {/* Публичная витрина — доступна клиентам без входа в админку. */}
      <Route
        path="/shop"
        element={
          <Suspense fallback={<PageLoader />}>
            <FeatureGate feature="storefront">
              <Storefront isPublic />
            </FeatureGate>
          </Suspense>
        }
      />

      {/* Полноэкранный POS-режим: та же NewOrder-страница, но БЕЗ Layout. */}
      <Route
        path="/pos"
        element={
          <AuthGate>
            <Suspense fallback={<PageLoader />}>
              <NewOrder fullscreen />
            </Suspense>
          </AuthGate>
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
        <Route path="invoices" element={<FeatureGate feature="invoices"><Invoices /></FeatureGate>} />
        <Route path="customers" element={<Customers />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="analytics" element={<FeatureGate feature="analytics"><Analytics /></FeatureGate>} />
        <Route path="assistant" element={<FeatureGate feature="assistant"><Assistant /></FeatureGate>} />
        <Route path="storefront" element={<FeatureGate feature="storefront"><Storefront /></FeatureGate>} />
        <Route path="journal" element={<Journal />} />
        <Route path="money" element={<Money />} />
        <Route path="cashiers" element={<Cashiers />} />
        <Route path="movements" element={<Movements />} />
        <Route path="subscription" element={<Subscription />} />
        <Route path="purchase-orders" element={<PurchaseOrders />} />
        <Route path="employees" element={<Employees />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
