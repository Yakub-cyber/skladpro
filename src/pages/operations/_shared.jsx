// Общие элементы вкладок Operations: поиск товара, тост об успехе,
// список вкладок для верхней навигации. Вынесено, чтобы каждая вкладка
// была компактным файлом со своей ответственностью.
import { useState } from 'react'
import {
  ArrowDownToLine,
  TrendingDown,
  Undo2,
  ClipboardCheck,
  History,
  Search,
  Check,
  ShoppingCart,
  ArrowLeftRight,
  Truck,
  FileText,
  ShieldCheck,
} from 'lucide-react'
import { useStore } from '../../store/useStore'
import { num } from '../../lib/format'

// Иконка по типу документа — используется в реестре и журнале.
export const DOC_ICON = {
  purchase: ArrowDownToLine,
  sale: ShoppingCart,
  sale_return: Undo2,
  supplier_return: Truck,
  transfer: ArrowLeftRight,
  writeoff: TrendingDown,
  inventory: ClipboardCheck,
}

// Табы верхней панели Operations. Порядок = порядок отрисовки.
export const TABS = [
  { key: 'sale', label: 'Продажа', icon: ShoppingCart },
  { key: 'receive', label: 'Закупка', icon: ArrowDownToLine },
  { key: 'sreturn', label: 'Возврат продажи', icon: Undo2 },
  { key: 'preturn', label: 'Возврат поставщику', icon: Truck },
  { key: 'transfer', label: 'Перемещение', icon: ArrowLeftRight },
  { key: 'writeoff', label: 'Списание', icon: TrendingDown },
  { key: 'inventory', label: 'Инвентаризация', icon: ClipboardCheck },
  { key: 'registry', label: 'Реестр', icon: FileText },
  { key: 'marking', label: 'Маркировка', icon: ShieldCheck },
  { key: 'journal', label: 'Журнал', icon: History },
]

// Поиск товара по названию/артикулу (используется в TransferTab, ReceiveTab,
// MoveForm). Первые 6 совпадений — без пагинации, потому что при вводе
// пользователь уточняет запрос.
export function ProductSearch({ onPick, placeholder = 'Найти товар по названию или артикулу…' }) {
  const products = useStore((s) => s.products)
  const [q, setQ] = useState('')
  const found = q
    ? products
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q.toLowerCase()) ||
            p.sku.toLowerCase().includes(q.toLowerCase()),
        )
        .slice(0, 6)
    : []
  return (
    <div className="relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 pl-9 pr-3 rounded-xl bg-surface-2 border border-line outline-none focus:border-brand text-sm"
      />
      {found.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 card p-1 max-h-56 overflow-y-auto">
          {found.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onPick(p)
                setQ('')
              }}
              className="w-full flex items-center justify-between gap-2 px-2.5 h-10 rounded-lg hover:bg-surface-2 text-left text-sm"
            >
              <span className="truncate">{p.name}</span>
              <span className="text-muted text-[12px] shrink-0">
                {p.sku} · ост. {num(p.stock)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Toast({ children }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-xl bg-ok-soft text-ok text-sm font-medium animate-fadeUp">
      <Check size={16} /> {children}
    </div>
  )
}
