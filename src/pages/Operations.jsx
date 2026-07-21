// Операции: тонкий роутер по вкладкам. Каждая вкладка — отдельный файл в
// pages/operations/. Общие элементы (ProductSearch, Toast, DOC_ICON, TABS)
// — в operations/_shared.jsx. Вкладка «Продажа» удалена — единственный
// путь продажи теперь касса (/orders/new + кнопка «Касса» в шапке). Так
// убран дубль «продажа как документ» vs. «продажа как заказ».
import { useState } from 'react'
import { cx } from '../components/ui'
import { TABS } from './operations/_shared'
import ReceiveTab from './operations/ReceiveTab'
import ReturnTab from './operations/ReturnTab'
import SupplierReturnTab from './operations/SupplierReturnTab'
import TransferTab from './operations/TransferTab'
import WriteOffTab from './operations/WriteOffTab'
import InventoryTab from './operations/InventoryTab'
import DocumentsTab from './operations/DocumentsTab'
import MarkingTab from './operations/MarkingTab'
import JournalTab from './operations/JournalTab'

const TAB_COMPONENT = {
  receive: ReceiveTab,
  sreturn: ReturnTab,
  preturn: SupplierReturnTab,
  transfer: TransferTab,
  writeoff: WriteOffTab,
  inventory: InventoryTab,
  registry: DocumentsTab,
  marking: MarkingTab,
  journal: JournalTab,
}

export default function Operations() {
  const [tab, setTab] = useState('receive')
  const Active = TAB_COMPONENT[tab] || ReceiveTab
  return (
    <div className="animate-fadeUp">
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">Документы</h2>
        <p className="text-sm text-muted">
          Продажа, закупка, возвраты, перемещение, списание и инвентаризация — каждое движение пишется в журнал.
        </p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cx(
              'flex items-center gap-2 px-3.5 h-10 rounded-xl text-[13px] font-medium whitespace-nowrap transition',
              tab === t.key ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-muted hover:text-ink',
            )}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      <Active />
    </div>
  )
}
