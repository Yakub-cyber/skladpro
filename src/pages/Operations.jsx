// Операции: тонкий роутер по вкладкам. Каждая вкладка — отдельный файл в
// pages/operations/. Общие элементы (ProductSearch, Toast, DOC_ICON, TABS)
// — в operations/_shared.jsx.
//
// UX: 11 плоских табов = слишком много, глаз теряется. Группируем в 3
// категории — «Приход · Расход · Служебное», внутри — короткий список
// действий. Плюс явная подсказка «Розничная продажа? Открой Кассу», т.к.
// «Продажа-документ» здесь ≠ пробить чек на /orders/new и это путает.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, ShoppingCart } from 'lucide-react'
import { cx } from '../components/ui'
import { TABS } from './operations/_shared'
import SaleTab from './operations/SaleTab'
import ReceiveTab from './operations/ReceiveTab'
import ReturnTab from './operations/ReturnTab'
import SupplierReturnTab from './operations/SupplierReturnTab'
import TransferTab from './operations/TransferTab'
import WriteOffTab from './operations/WriteOffTab'
import InventoryTab from './operations/InventoryTab'
import StockInTab from './operations/StockInTab'
import DocumentsTab from './operations/DocumentsTab'
import MarkingTab from './operations/MarkingTab'
import JournalTab from './operations/JournalTab'

const TAB_COMPONENT = {
  sale: SaleTab,
  receive: ReceiveTab,
  sreturn: ReturnTab,
  preturn: SupplierReturnTab,
  transfer: TransferTab,
  writeoff: WriteOffTab,
  inventory: InventoryTab,
  stockin: StockInTab,
  registry: DocumentsTab,
  marking: MarkingTab,
  journal: JournalTab,
}

// TABS сохраняем как источник иконок/лейблов, а порядок и группировку
// задаём здесь. «Возврат при продаже» относим к приходу (товар физически
// возвращается на склад), «возврат при покупке» — к расходу.
const CATEGORIES = [
  {
    key: 'in',
    label: 'Приход',
    hint: 'Оприходование товара на склад',
    tabs: ['receive', 'stockin', 'sreturn'],
  },
  {
    key: 'out',
    label: 'Расход',
    hint: 'Списание, продажа опт, возврат поставщику',
    tabs: ['sale', 'writeoff', 'preturn'],
  },
  {
    key: 'util',
    label: 'Служебное',
    hint: 'Перемещение, инвентаризация, реестр и журналы',
    tabs: ['transfer', 'inventory', 'registry', 'marking', 'journal'],
  },
]

const TAB_META = Object.fromEntries(TABS.map((t) => [t.key, t]))

// Куда попадает пользователь при переключении на категорию:
// первый таб внутри категории. Стейт хранит {catKey, tabKey}, при клике
// по категории — сбрасываем tabKey на первый.
export default function Operations() {
  const [cat, setCat] = useState('in')
  const currentCategory = useMemo(
    () => CATEGORIES.find((c) => c.key === cat) || CATEGORIES[0],
    [cat],
  )
  const [tab, setTab] = useState(currentCategory.tabs[0])
  // Если переключили категорию, а активный таб не входит в её список —
  // синхронизируем.
  const activeKey = currentCategory.tabs.includes(tab) ? tab : currentCategory.tabs[0]
  const Active = TAB_COMPONENT[activeKey] || SaleTab
  const activeMeta = TAB_META[activeKey]

  const changeCat = (nextKey) => {
    setCat(nextKey)
    const next = CATEGORIES.find((c) => c.key === nextKey)
    if (next) setTab(next.tabs[0])
  }

  return (
    <div className="animate-fadeUp">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">Документы</h2>
        <p className="text-sm text-muted">{currentCategory.hint}</p>
      </div>

      {/* Подсказка про Кассу видна только на «Продаже» — где пользователь
          обычно и путается: тут документ на опт, для розницы — /orders/new. */}
      {activeKey === 'sale' && (
        <Link
          to="/orders/new"
          className="mb-4 flex items-center gap-2.5 rounded-xl bg-info-soft border border-info/25 text-info px-3.5 py-2.5 hover:bg-info-soft/80 transition"
        >
          <ShoppingCart size={16} strokeWidth={2.2} className="shrink-0" />
          <span className="text-[13px] font-medium">
            Розничная продажа? Пробить чек — в Кассе (F9 → оплата)
          </span>
          <span className="ml-auto text-[13px] font-semibold">Открыть →</span>
        </Link>
      )}

      {/* Категории — крупный chip-переключатель */}
      <div className="flex gap-1.5 mb-3 p-1 bg-surface-2 rounded-xl w-fit">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => changeCat(c.key)}
            className={cx(
              'px-4 h-9 rounded-lg text-[13px] font-semibold transition',
              cat === c.key
                ? 'bg-surface text-ink shadow-sm'
                : 'text-muted hover:text-ink',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Под-табы выбранной категории */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4">
        {currentCategory.tabs.map((tk) => {
          const t = TAB_META[tk]
          if (!t) return null
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cx(
                'flex items-center gap-2 px-3.5 h-10 rounded-xl text-[13px] font-medium whitespace-nowrap transition',
                activeKey === t.key ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink',
              )}
            >
              <t.icon size={16} /> {t.label}
            </button>
          )
        })}
      </div>

      <Active />
    </div>
  )
}
