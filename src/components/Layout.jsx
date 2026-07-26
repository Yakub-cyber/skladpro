import { useState, useEffect, useRef, useMemo, Suspense } from 'react'
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  ClipboardList,
  Package,
  Warehouse as WarehouseIcon,
  FileText,
  ClipboardCheck,
  Users,
  Truck,
  Navigation,
  UserCog,
  History,
  BarChart3,
  Bot,
  Store,
  Settings as SettingsIcon,
  Sparkles,
  Search,
  Sun,
  Moon,
  Menu,
  Boxes,
  Command,
  ChevronDown,
  LogOut,
  ShieldX,
  Cloud,
  CloudOff,
  CloudUpload,
  ShoppingCart,
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  RotateCcw,
  Plus,
  ClipboardMinus,
  FilePlus,
} from 'lucide-react'
import { cx, Avatar } from './ui'
import CommandPalette from './CommandPalette'
import { ConfirmProvider } from './Confirm'
import SupportWidget from './SupportWidget'
import { useStore } from '../store/useStore'
import { canAccess, roleInfo } from '../lib/constants'
import { reservedByProduct, availableStock } from '../lib/orders'
import { plural } from '../lib/format'
import { syncNow } from '../lib/cloud'
import PageLoader from './PageLoader'

// текущий авторизованный сотрудник и его роль
function useCurrentUser() {
  const employees = useStore((s) => s.employees) || []
  const authUserId = useStore((s) => s.authUserId)
  const me = employees.find((e) => e.id === authUserId)
  return me || { name: 'Гость', role: 'admin' }
}

// «Документы» вынесены на 2-е место и помечены `highlight: true` —
// это самый частый экран для оператора склада (закупка, продажа,
// перемещение, инвентаризация — все под рукой), важнее «Заказов» и
// «Товаров». Highlight-пункт рендерится с брендовой обводкой, чтобы
// глаз находил его моментально.
//
// Формат навигации: массив «узлов». Узел — либо прямой пункт (`to`),
// либо группа (`items: [...]`). Группы схлопываемые; активная группа
// (в её `items` есть текущий роут) раскрывается автоматически.
// В NAV_ITEMS хранится «расплющенный» список всех пунктов — для расчёта
// заголовка страницы и других вычислений, где группировка не важна.
// Порядок NAV по образцу CloudShop: сначала Дашборд, затем ЧАСТЫЕ
// одиночные пункты — Документы (сюда идёт основная работа) и Товары.
// Потом сгруппированные разделы. Убран пункт «Заказы поставщикам» из
// «Партнёров» — по решению пользователя (не увидел смысла); сама
// страница /purchase-orders остаётся, вход через будущую карточку
// поставщика.
// Порядок NAV по образцу CloudShop: Дашборд → Товары → Документы →
// Кассы и смены → Продажи → Движение товара → Движение денег → Склад →
// Контрагенты → Отчёты → Витрина → Компания. Группы сохранены (юзер
// явно попросил), поменялся порядок и лейблы.
export const NAV = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard, end: true, perm: 'dashboard' },
  { to: '/products', label: 'Товары', icon: Package, perm: 'products' },
  // Пункт «Документы» из главного NAV убран — эту роль полностью взяла
  // CTA-кнопка «Создать документ» вверху сайдбара. Реестр документов
  // остался как отдельная страница /operations, доступ через CTA-меню
  // (для кладовщика она остаётся в NAV_STOCK).
  {
    label: 'Кассы и смены',
    icon: ShoppingCart,
    key: 'pos',
    items: [
      // «Кассы» = управление кассами и назначение кассиров (CloudShop-стиль).
      // POS открывается через кнопку «Касса» в шапке — она видна везде.
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
      // «Заявки клиентов» = преднастроенный фильтр на Orders (status='new').
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

// «Создать документ» — CTA-меню как в CloudShop (фиолетовая кнопка вверху
// сайдбара). Клик по пункту ведёт на соответствующий экран с триггером
// в URL (?new=…), а сама страница подхватывает его и открывает нужную
// форму/вкладку. Разделено на 2 секции — Документы (склад) и Деньги.
export const CREATE_DOC_ITEMS = [
  {
    section: 'Документы',
    items: [
      { label: 'Продажа', icon: ShoppingCart, to: '/orders/new', perm: 'orders' },
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

// Кладовщик: приоритет операциям, товарам и складу. Продажи/финансы/аналитика
// скрыты. «Заказы на сборку» — то, что реально важно для смены.
export const NAV_STOCK = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard, end: true, perm: 'dashboard' },
  { to: '/operations', label: 'Документы', icon: ClipboardCheck, perm: 'operations', highlight: true },
  { to: '/products', label: 'Товары', icon: Package, perm: 'products' },
  { to: '/warehouse', label: 'Карта склада', icon: WarehouseIcon, perm: 'warehouse' },
  { to: '/orders', label: 'На сборку', icon: ClipboardList, perm: 'orders' },
  { to: '/invoices', label: 'Накладные', icon: FileText, perm: 'invoices' },
  { to: '/assistant', label: 'ИИ-ассистент', icon: Bot, ai: true, perm: 'assistant' },
]

// Курьер: всего 3 пункта, плоский NAV. Дашборд + маршрут + история заказов.
export const NAV_COURIER = [
  { to: '/', label: 'Дашборд', icon: LayoutDashboard, end: true, perm: 'dashboard' },
  { to: '/delivery', label: 'Мой маршрут', icon: Navigation, perm: 'delivery', highlight: true },
  { to: '/orders', label: 'Мои заказы', icon: ClipboardList, perm: 'orders' },
]

// Выбор набора по роли. admin/manager видят полное дерево NAV;
// stock/courier — свои плоские наборы, оптимизированные под задачу.
export function navFor(role) {
  if (role === 'courier') return NAV_COURIER
  if (role === 'stock') return NAV_STOCK
  return NAV
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-9 w-9 rounded-xl bg-brand grid place-items-center text-brand-ink shadow-lg shadow-brand/30">
        <Boxes size={20} strokeWidth={2.3} />
      </div>
      <div className="leading-none">
        <div className="font-semibold tracking-tight text-[15px]">
          Склад<span className="text-brand">Про</span>
        </div>
        <div className="text-[10px] text-muted mt-0.5 tracking-wide uppercase">
          AI Warehouse
        </div>
      </div>
    </div>
  )
}

// Учитываем query-string при определении активного пункта. Раньше два
// пункта, ведущие на один и тот же pathname (/orders и /orders?filter=new),
// подсвечивались одновременно — NavLink игнорирует ?query. Теперь пункт
// «Заявки клиентов» активен, только когда ?filter=new совпадает; а «Заказы»
// без фильтра — только когда фильтра нет.
function isNavActive(itemTo, pathname, search, end) {
  const [path, qs] = itemTo.split('?')
  const pathMatch = end ? pathname === path : path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(path + '/')
  if (!pathMatch) return false
  const target = new URLSearchParams(qs || '')
  const targetFilter = target.get('filter')
  const curFilter = new URLSearchParams(search).get('filter')
  if (targetFilter) return curFilter === targetFilter
  return !curFilter
}

// Одиночный пункт NAV. Отдельно вынесен, чтобы одинаково рендерить
// прямые пункты NAV (Дашборд) и пункты внутри группы. Не используем
// NavLink — нужна поддержка query-string при активности.
function NavItem({ item, counts, onClose, nested = false }) {
  const { pathname, search } = useLocation()
  const isActive = isNavActive(item.to, pathname, search, item.end)
  return (
    <Link
      to={item.to}
      onClick={onClose}
      className={cx(
        'flex items-center gap-3 h-10 rounded-xl text-sm font-medium transition-colors relative group',
        nested ? 'px-3 ml-2' : 'px-3',
        isActive
          ? 'bg-brand text-brand-ink'
          : item.highlight
            ? 'text-ink bg-brand-soft/60 hover:bg-brand-soft border border-brand/25'
            : 'text-muted hover:text-ink hover:bg-surface-2',
      )}
    >
      <item.icon size={item.highlight ? 19 : 18} strokeWidth={item.highlight ? 2.3 : 2.1} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.ai && <Sparkles size={13} className="text-brand opacity-80" />}
      {counts[item.to] > 0 && (
        <span className="text-[11px] font-semibold px-1.5 h-5 min-w-5 grid place-items-center rounded-md bg-surface-3 text-ink">
          {counts[item.to]}
        </span>
      )}
    </Link>
  )
}

// Схлопываемая группа. Активная (внутри — текущий роут) раскрывается
// автоматически. Состояние раскрытия других групп персистится в
// localStorage — иначе клик по любой вкладке снова закрывал бы всё.
function NavGroup({ node, counts, onClose }) {
  const { pathname, search } = useLocation()
  const key = 'sklad.nav.' + (node.key || node.label)
  const hasActive = node.items.some((it) => isNavActive(it.to, pathname, search, it.end))
  const [open, setOpen] = useState(() => {
    if (hasActive) return true
    try {
      const v = localStorage.getItem(key)
      return v == null ? true : v === '1'
    } catch {
      return true
    }
  })
  // Автораскрытие при переходе на любой роут внутри группы.
  useEffect(() => {
    if (hasActive) setOpen(true)
  }, [hasActive])

  const toggle = () => {
    setOpen((v) => {
      const next = !v
      try {
        localStorage.setItem(key, next ? '1' : '0')
      } catch {}
      return next
    })
  }

  const totalCount = node.items.reduce((n, it) => n + (counts[it.to] || 0), 0)

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className={cx(
          'w-full flex items-center gap-3 h-10 px-3 rounded-xl text-sm font-medium transition-colors',
          hasActive ? 'text-ink' : 'text-muted hover:text-ink hover:bg-surface-2',
        )}
      >
        <node.icon size={18} strokeWidth={2.1} />
        <span className="flex-1 text-left">{node.label}</span>
        {totalCount > 0 && (
          <span className="text-[11px] font-semibold px-1.5 h-5 min-w-5 grid place-items-center rounded-md bg-surface-3 text-ink">
            {totalCount}
          </span>
        )}
        <ChevronDown
          size={14}
          className={cx('transition-transform text-muted', open ? '' : '-rotate-90')}
        />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {node.items.map((it) => (
            <NavItem key={it.to} item={it} counts={counts} onClose={onClose} nested />
          ))}
        </div>
      )}
    </div>
  )
}

// Контекст-плитка над nav: для stock — «Смена открыта · Xч Yм · принято N»,
// для courier — «Маршрут · X из Y точек». Даёт роли ощущение «это моя
// смена, а не общий сайт». Для manager/admin плитку не показываем —
// им контекст даёт саму дашборд.
function ShiftContextTile({ me, orders, documents, authAt }) {
  if (me?.role !== 'stock' && me?.role !== 'courier') return null

  if (me.role === 'stock') {
    if (!authAt) return null
    const ms = Date.now() - authAt
    const h = Math.floor(ms / 3_600_000)
    const min = Math.floor((ms % 3_600_000) / 60_000)
    const dur = h ? `${h}ч ${min}м` : `${min}м`
    const accepted = documents.filter(
      (d) => d.by === me.id && d.type === 'purchase' && d.status === 'posted' && d.createdAt >= authAt,
    ).length
    return (
      <div className="mx-3 mb-2 rounded-xl bg-ok-soft border border-ok/25 px-3 py-2.5">
        <div className="text-[10px] font-semibold text-ok uppercase tracking-wide">
          Смена · {dur}
        </div>
        <div className="text-[12.5px] text-ink mt-0.5">
          Принято сегодня: <b>{accepted}</b>
        </div>
      </div>
    )
  }

  // courier
  const myRoute = orders.filter(
    (o) => o.courierId === me.id && ['packed', 'shipped', 'picking'].includes(o.status),
  )
  const done = orders.filter(
    (o) => o.courierId === me.id && o.status === 'delivered',
  ).length
  const total = myRoute.length + done
  if (!total) return null
  return (
    <div className="mx-3 mb-2 rounded-xl bg-warn-soft border border-warn/25 px-3 py-2.5">
      <div className="text-[10px] font-semibold text-warn uppercase tracking-wide">
        Маршрут · {done}/{total}
      </div>
      <div className="text-[12.5px] text-ink mt-0.5">
        Осталось {myRoute.length} {plural(myRoute.length, ['точка', 'точки', 'точек'])}
      </div>
    </div>
  )
}

// «Создать документ» — большая брендовая CTA как в CloudShop. Клик
// раскрывает панель со списком типов документов (2 секции), клик по
// пункту ведёт на нужный экран с ?new=… и панель закрывается. Клик мимо
// или Esc — тоже закрывает. Кнопка визуально доминирует над NAV, чтобы
// оператор нашёл её без раздумий.
function CreateDocMenu({ role, onNavigate }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    const onEsc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const sections = useMemo(
    () =>
      CREATE_DOC_ITEMS.map((s) => ({
        ...s,
        items: s.items.filter((it) => canAccess(role, it.perm)),
      })).filter((s) => s.items.length),
    [role],
  )

  return (
    <div ref={boxRef} className="mx-3 mb-3 relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'w-full h-11 rounded-xl bg-brand text-brand-ink text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-md shadow-brand/25 hover:brightness-110 transition',
          open && 'ring-2 ring-brand/40',
        )}
      >
        <Plus size={17} strokeWidth={2.5} /> Создать документ
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-xl bg-surface border border-line shadow-xl overflow-hidden animate-fadeUp">
          {sections.map((s, si) => (
            <div key={s.section} className={si > 0 ? 'border-t border-line' : ''}>
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {s.section}
              </div>
              {s.items.map((it) => (
                <Link
                  key={it.to}
                  to={it.to}
                  onClick={() => {
                    setOpen(false)
                    onNavigate?.()
                  }}
                  className="flex items-center gap-2.5 px-3 h-9 text-[13px] text-ink hover:bg-brand-soft hover:text-brand transition"
                >
                  <it.icon size={15} className="text-muted" />
                  <span className="truncate">{it.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Sidebar({ open, onClose }) {
  const orders = useStore((s) => s.orders)
  const products = useStore((s) => s.products)
  const documents = useStore((s) => s.documents) || []
  const authAt = useStore((s) => s.authAt)
  const me = useCurrentUser()
  const activeOrders = orders.filter((o) =>
    ['new', 'confirmed', 'picking', 'packed'].includes(o.status),
  ).length
  const reserved = reservedByProduct(orders)
  const lowStock = products.filter((p) => availableStock(p, reserved) <= p.minStock).length

  const counts = { '/orders': activeOrders, '/products': lowStock }

  // По роли берём свой NAV-набор (manager — полный, stock/courier — свои,
  // заточенные под ежедневную задачу). Дополнительно фильтруем на всякий
  // случай через canAccess: если админ поменял права роли — пункты, ставшие
  // недоступными, автоматически скроются.
  const roleNav = navFor(me.role)
  const visibleNodes = roleNav.map((node) => {
    if (node.items) {
      const kept = node.items.filter((it) => canAccess(me.role, it.perm))
      return kept.length ? { ...node, items: kept } : null
    }
    return canAccess(me.role, node.perm) ? node : null
  }).filter(Boolean)

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cx(
          'fixed z-40 inset-y-0 left-0 w-[252px] bg-surface border-r border-line flex flex-col transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="h-16 flex items-center px-5 border-b border-line">
          <Logo />
        </div>
        <div className="pt-3">
          <CreateDocMenu role={me.role} onNavigate={onClose} />
        </div>
        <ShiftContextTile me={me} orders={orders} documents={documents} authAt={authAt} />
        <nav className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-0.5">
          {visibleNodes.map((node) =>
            node.items ? (
              <NavGroup
                key={node.key || node.label}
                node={node}
                counts={counts}
                onClose={onClose}
              />
            ) : (
              <NavItem key={node.to} item={node} counts={counts} onClose={onClose} />
            ),
          )}
        </nav>
        <div className="p-3 border-t border-line">
          <NavLink
            to="/assistant"
            onClick={onClose}
            className="block rounded-xl bg-gradient-to-br from-brand/15 to-brand/5 border border-brand/20 p-3 hover:border-brand/40 transition-colors"
          >
            <div className="flex items-center gap-2 text-brand font-medium text-[13px]">
              <Sparkles size={15} /> ИИ-помощник
            </div>
            <p className="text-[12px] text-muted mt-1 leading-relaxed">
              Спросите про остатки, долги и закупки — ответит по вашим данным.
            </p>
          </NavLink>
        </div>
      </aside>
    </>
  )
}

// Индикатор облачной синхронизации: зелёное облако — всё отправлено,
// стрелка с числом — ожидают отправки, перечёркнутое — ошибка (клик = повторить).
function SyncBadge() {
  const cloud = useStore((s) => s.cloud)
  const ready = useStore((s) => s.cloudReady)
  const pending = useStore((s) => s.syncPending || 0)
  const state = useStore((s) => s.syncState || 'ok')
  if (!cloud || !ready) return null
  const cfg =
    state === 'error'
      ? { Icon: CloudOff, cls: 'text-bad', title: `Ошибка синхронизации, изменений в очереди: ${pending}. Нажмите, чтобы повторить` }
      : pending > 0
        ? { Icon: CloudUpload, cls: 'text-warn', title: `Ожидает отправки: ${pending}` }
        : { Icon: Cloud, cls: 'text-ok', title: 'Синхронизировано с облаком' }
  return (
    <button
      onClick={() => syncNow()}
      title={cfg.title}
      className={cx(
        'relative h-10 w-10 grid place-items-center rounded-xl hover:bg-surface-2 shrink-0',
        cfg.cls,
      )}
    >
      <cfg.Icon size={19} />
      {pending > 0 && (
        <span className="absolute -top-0.5 -right-0.5 text-[10px] font-semibold min-w-4 h-4 px-1 grid place-items-center rounded-full bg-warn text-white">
          {pending > 99 ? '99+' : pending}
        </span>
      )}
    </button>
  )
}

// Кнопка «Касса» в шапке — всегда под рукой независимо от текущей страницы.
// На десктопе — полноценная кнопка с текстом; на мобиле — только иконка.
// Скрываем, если у текущей роли нет прав на заказы (курьер и т.п.).
function CashierButton() {
  const me = useCurrentUser()
  const nav = useNavigate()
  if (!canAccess(me.role, 'orders')) return null
  return (
    <button
      onClick={() => nav('/orders/new')}
      title="Открыть кассу"
      className="h-10 px-3 rounded-xl bg-brand text-brand-ink font-medium text-sm inline-flex items-center gap-2 shrink-0 hover:opacity-90 transition shadow-sm shadow-brand/25"
    >
      <ShoppingCart size={17} />
      <span className="hidden sm:inline">Касса</span>
    </button>
  )
}

// Хлебные крошки: раздел + при необходимости уточнение (номер заказа, «Правка»).
// Первый крош — Дашборд (если мы не на нём), потом текущий раздел, потом
// уточнение. Клик по крошу — переход в соответствующее место.
function useBreadcrumbs() {
  const { pathname } = useLocation()
  const editMatch = useMatch('/orders/:id/edit')

  if (pathname === '/') return [{ label: 'Дашборд' }]

  const item = NAV_ITEMS.find((n) =>
    n.end ? n.to === pathname : n.to !== '/' && pathname.startsWith(n.to),
  )
  const crumbs = [{ label: 'Дашборд', to: '/' }]
  if (item) crumbs.push({ label: item.label, to: item.to })
  else crumbs.push({ label: '—' })

  // Уточнение под конкретный маршрут.
  if (editMatch) {
    const tail = editMatch.params.id?.slice(-4) || ''
    crumbs.push({ label: `№${tail} · правка` })
  } else if (pathname === '/orders/new') {
    crumbs.push({ label: 'Новый · касса' })
  }
  return crumbs
}

function Breadcrumbs() {
  const crumbs = useBreadcrumbs()
  return (
    <nav aria-label="breadcrumbs" className="flex items-center gap-1.5 text-[13px] min-w-0">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1
        const cls = isLast
          ? 'font-semibold text-ink'
          : 'text-muted hover:text-ink transition-colors'
        return (
          <span key={i} className="flex items-center gap-1.5 min-w-0">
            {c.to && !isLast ? (
              <Link to={c.to} className={cx('truncate', cls)}>{c.label}</Link>
            ) : (
              <span className={cx('truncate', cls)}>{c.label}</span>
            )}
            {!isLast && <span className="text-muted/60 shrink-0">/</span>}
          </span>
        )
      })}
    </nav>
  )
}

function Topbar({ onMenu, onSearch }) {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains('dark'),
  )
  const toggleTheme = () => {
    const isDark = document.documentElement.classList.toggle('dark')
    localStorage.setItem('sklad.theme', isDark ? 'dark' : 'light')
    setDark(isDark)
  }

  return (
    <header className="h-16 shrink-0 border-b border-line bg-bg/80 backdrop-blur sticky top-0 z-20 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 lg:px-6">
      <button
        onClick={onMenu}
        className="lg:hidden h-9 w-9 grid place-items-center rounded-lg hover:bg-surface-2 shrink-0"
      >
        <Menu size={20} />
      </button>
      <div className="min-w-0 flex-shrink">
        <Breadcrumbs />
      </div>

      <button
        onClick={onSearch}
        className="ml-auto group flex items-center gap-2 h-10 px-3 rounded-xl bg-surface-2 border border-line text-muted hover:border-brand/40 transition w-full max-w-xs min-w-0"
      >
        <Search size={16} className="shrink-0" />
        <span className="text-sm truncate">Поиск по складу…</span>
        <kbd className="ml-auto hidden md:flex items-center gap-0.5 text-[11px] px-1.5 h-5 rounded bg-surface-3 border border-line">
          <Command size={11} /> K
        </kbd>
      </button>

      <CashierButton />
      <SyncBadge />
      <button
        onClick={toggleTheme}
        className="h-10 w-10 grid place-items-center rounded-xl hover:bg-surface-2 text-muted hover:text-ink shrink-0"
        title="Сменить тему"
      >
        {dark ? <Sun size={19} /> : <Moon size={19} />}
      </button>
      <ProfileMenu />
    </header>
  )
}

function ProfileMenu() {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const me = useCurrentUser()
  const cloud = useStore((s) => s.cloud)
  const logout = useStore((s) => s.logout)
  const cloudLogout = useStore((s) => s.cloudLogout)
  const doLogout = () => (cloud ? cloudLogout() : logout())
  const role = roleInfo(me.role)

  // Click-outside через слушатель, а не через fixed-backdrop:
  // раньше `<div fixed inset-0 z-30>` перекрывал всю шапку — клик по
  // любой другой кнопке (Касса, тема, sync) съедался бэкдропом, и
  // требовалось два клика подряд. Теперь бэкдропа нет, а меню
  // закрывается mousedown-ом вне menuRef. Esc тоже закрывает.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    const onEsc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 h-10 pl-1 pr-2 rounded-xl hover:bg-surface-2"
      >
        <Avatar name={me.name} color={role.color} size={32} />
        <div className="hidden md:block text-left leading-tight">
          <div className="text-[13px] font-medium">{me.name.split(' ')[0]}</div>
          <div className="text-[11px] text-muted">{role.label}</div>
        </div>
        <ChevronDown size={15} className="text-muted hidden md:block" />
      </button>
      {open && (
        <>
          <div className="absolute right-0 mt-1 w-60 card p-1.5 z-40 animate-fadeUp">
            <div className="flex items-center gap-2.5 px-2.5 py-2 mb-1 border-b border-line">
              <Avatar name={me.name} color={role.color} size={36} />
              <div className="min-w-0">
                <div className="text-[13px] font-medium truncate">{me.name}</div>
                <div className="text-[11px] text-muted">{role.label}</div>
              </div>
            </div>
            <button
              onClick={() => {
                setOpen(false)
                doLogout()
              }}
              className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-lg hover:bg-bad-soft text-bad text-sm font-medium"
            >
              <LogOut size={16} /> Выйти из системы
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function Layout() {
  const [navOpen, setNavOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const { pathname } = useLocation()
  const me = useCurrentUser()

  const item = NAV_ITEMS.find((n) =>
    n.end ? n.to === pathname : n.to !== '/' && pathname.startsWith(n.to),
  )
  const allowed = !item || canAccess(me.role, item.perm)

  return (
    <ConfirmProvider>
      <div className="min-h-screen bg-bg">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <CommandPalette open={cmdOpen} setOpen={setCmdOpen} />
        <SupportWidget />
        <div className="lg:pl-[252px] flex flex-col min-h-screen">
          <Topbar onMenu={() => setNavOpen(true)} onSearch={() => setCmdOpen(true)} />
          <main className="flex-1 p-4 lg:p-6 max-w-[1400px] w-full mx-auto">
            {allowed ? (
              <Suspense fallback={<PageLoader />}>
                <Outlet />
              </Suspense>
            ) : (
              <div className="grid place-items-center py-24 text-center">
                <div>
                  <div className="h-16 w-16 rounded-2xl bg-bad-soft text-bad grid place-items-center mx-auto mb-4">
                    <ShieldX size={30} />
                  </div>
                  <h2 className="text-lg font-semibold">Нет доступа</h2>
                  <p className="text-sm text-muted mt-1 max-w-xs">
                    Раздел недоступен для роли «{roleInfo(me.role).label}». Обратитесь к администратору.
                  </p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </ConfirmProvider>
  )
}
