import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BarChart3,
  Bot,
  ClipboardCheck,
  ClipboardList,
  ClipboardMinus,
  FileText,
  History,
  LayoutDashboard,
  Navigation,
  Package,
  RotateCcw,
  Settings as SettingsIcon,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  UserCog,
  Users,
  Wallet,
  Warehouse as WarehouseIcon,
} from 'lucide-react'

// Формат навигации: массив «узлов». Узел — либо прямой пункт (`to`),
// либо группа (`items: [...]`). Группы схлопываемые; активная группа
// (в её `items` есть текущий роут) раскрывается автоматически.
// Порядок NAV по образцу CloudShop: Дашборд → Товары → Кассы и смены →
// Продажи → Движение товара → Движение денег → Склад → Контрагенты →
// Отчёты → Витрина → Компания.
export const NAV = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard, end: true, perm: 'dashboard' },
  { to: '/products', label: 'Товары', icon: Package, perm: 'products' },
  {
    label: 'Кассы и смены',
    icon: ShoppingCart,
    key: 'pos',
    items: [
      { to: '/cashiers', label: 'Кассы', icon: Wallet, perm: 'money' },
      { to: '/journal', label: 'Смены и журнал', icon: History, perm: 'journal' },
    ],
  },
  {
    label: 'Продажи',
    icon: ClipboardList,
    key: 'sales',
    items: [
      { to: '/orders', label: 'Заказы', icon: ClipboardList, perm: 'orders' },
      { to: '/orders?filter=new', label: 'Заявки клиентов', icon: ClipboardList, perm: 'orders' },
      { to: '/delivery', label: 'Доставка', icon: Navigation, perm: 'delivery' },
    ],
  },
  { to: '/movements', label: 'Движение товара', icon: BarChart3, perm: 'analytics' },
  {
    label: 'Движение денег',
    icon: Wallet,
    key: 'finance',
    items: [
      { to: '/money', label: 'Деньги', icon: Wallet, perm: 'money' },
    ],
  },
  {
    label: 'Склад',
    icon: WarehouseIcon,
    key: 'stock',
    items: [
      { to: '/warehouse', label: 'Карта склада', icon: WarehouseIcon, perm: 'warehouse' },
      { to: '/invoices', label: 'Накладные', icon: FileText, ai: true, perm: 'invoices' },
    ],
  },
  {
    label: 'Контрагенты',
    icon: Users,
    key: 'partners',
    items: [
      { to: '/customers', label: 'Клиенты', icon: Users, perm: 'customers' },
      { to: '/suppliers', label: 'Поставщики', icon: Truck, perm: 'suppliers' },
    ],
  },
  {
    label: 'Отчёты',
    icon: BarChart3,
    key: 'analytics',
    items: [
      { to: '/analytics', label: 'Отчёты', icon: BarChart3, ai: true, perm: 'analytics' },
      { to: '/assistant', label: 'ИИ-ассистент', icon: Bot, ai: true, perm: 'assistant' },
    ],
  },
  { to: '/storefront', label: 'Интернет-витрина', icon: Store, perm: 'storefront' },
  {
    label: 'Компания',
    icon: SettingsIcon,
    key: 'admin',
    items: [
      { to: '/employees', label: 'Сотрудники', icon: UserCog, perm: 'employees' },
      { to: '/subscription', label: 'Подписка', icon: Sparkles, perm: 'settings' },
      { to: '/settings', label: 'Настройки', icon: SettingsIcon, perm: 'settings' },
    ],
  },
]

// Расплющенный список всех пунктов — для Topbar title и других мест,
// где группировка не нужна.
export const NAV_ITEMS = NAV.flatMap((n) => (n.items ? n.items : [n]))

// «Создать документ» — CTA-меню как в CloudShop. Клик по пункту ведёт
// на соответствующий экран с триггером в URL (?new=…), а сама страница
// подхватывает его и открывает нужную форму/вкладку.
export const CREATE_DOC_ITEMS = [
  {
    section: 'Документы',
    items: [
      { label: 'Продажа', icon: ShoppingCart, to: '/operations?new=sale', perm: 'operations' },
      { label: 'Закупка', icon: ArrowDownToLine, to: '/operations?new=receive', perm: 'operations' },
      { label: 'Возврат продажи', icon: RotateCcw, to: '/operations?new=sreturn', perm: 'operations' },
      { label: 'Возврат закупки', icon: RotateCcw, to: '/operations?new=preturn', perm: 'operations' },
      { label: 'Инвентаризация', icon: ClipboardCheck, to: '/operations?new=inventory', perm: 'operations' },
      { label: 'Оприходование', icon: Package, to: '/operations?new=stockin', perm: 'operations' },
      { label: 'Списание', icon: ClipboardMinus, to: '/operations?new=writeoff', perm: 'operations' },
      { label: 'Перемещение', icon: ArrowLeftRight, to: '/operations?new=transfer', perm: 'operations' },
    ],
  },
  {
    section: 'Деньги',
    items: [
      { label: 'Приход', icon: ArrowDownToLine, to: '/money?new=in', perm: 'money' },
      { label: 'Расход', icon: ArrowUpFromLine, to: '/money?new=out', perm: 'money' },
      { label: 'Перевод', icon: ArrowLeftRight, to: '/money?new=transfer', perm: 'money' },
    ],
  },
]

// Кладовщик: приоритет операциям, товарам и складу.
export const NAV_STOCK = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard, end: true, perm: 'dashboard' },
  { to: '/operations', label: 'Документы', icon: ClipboardCheck, perm: 'operations', highlight: true },
  { to: '/products', label: 'Товары', icon: Package, perm: 'products' },
  { to: '/warehouse', label: 'Карта склада', icon: WarehouseIcon, perm: 'warehouse' },
  { to: '/orders', label: 'На сборку', icon: ClipboardList, perm: 'orders' },
  { to: '/invoices', label: 'Накладные', icon: FileText, perm: 'invoices' },
  { to: '/assistant', label: 'ИИ-ассистент', icon: Bot, ai: true, perm: 'assistant' },
]

// Курьер: всего 3 пункта.
export const NAV_COURIER = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard, end: true, perm: 'dashboard' },
  { to: '/delivery', label: 'Мой маршрут', icon: Navigation, perm: 'delivery', highlight: true },
  { to: '/orders', label: 'Мои заказы', icon: ClipboardList, perm: 'orders' },
]

// Кассир: 4 пункта под POS-сценарий.
export const NAV_CASHIER = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard, end: true, perm: 'dashboard' },
  { to: '/orders/new', label: 'Касса', icon: ShoppingCart, perm: 'orders', highlight: true },
  { to: '/journal', label: 'Смены', icon: History, perm: 'journal' },
  { to: '/money', label: 'Деньги', icon: Wallet, perm: 'money' },
]

export function navFor(role) {
  if (role === 'courier') return NAV_COURIER
  if (role === 'stock') return NAV_STOCK
  if (role === 'cashier') return NAV_CASHIER
  return NAV
}

// Учитываем query-string при определении активного пункта: пункты
// /orders и /orders?filter=new не должны подсвечиваться одновременно.
export function isNavActive(itemTo, pathname, search, end) {
  const [path, qs] = itemTo.split('?')
  const pathMatch = end
    ? pathname === path
    : path === '/'
      ? pathname === '/'
      : pathname === path || pathname.startsWith(path + '/')
  if (!pathMatch) return false
  const target = new URLSearchParams(qs || '')
  const targetFilter = target.get('filter')
  const curFilter = new URLSearchParams(search).get('filter')
  if (targetFilter) return curFilter === targetFilter
  return !curFilter
}
