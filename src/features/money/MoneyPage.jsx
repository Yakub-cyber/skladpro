// Финансовый модуль «Деньги». По схеме CloudShop: карточки счетов сверху,
// три кнопки «Приход / Расход / Перевод», ниже — сводка за период,
// фильтры и лента транзакций.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Wallet,
} from 'lucide-react'
import { Button, Card, Empty } from '@/shared/ui'
import DocPreviewModal from '@/shared/components/DocPreviewModal'
import { useStore } from '@/shared/store/useStore'
import {
  MONEY_PURPOSES,
  accountBalances,
  rangeFor,
  summarize,
} from '@/shared/lib/money'
import AccountsGrid from './components/AccountsGrid'
import AccountModal from './components/AccountModal'
import MoneyTxModal from './components/MoneyTxModal'
import SummaryPanel from './components/SummaryPanel'
import TxFilters from './components/TxFilters'
import TxRow from './components/TxRow'

export default function Money() {
  const accounts = useStore((s) => s.accounts) || []
  const moneyTx = useStore((s) => s.moneyTx) || []
  const customers = useStore((s) => s.customers) || []
  const suppliers = useStore((s) => s.suppliers) || []
  const employees = useStore((s) => s.employees) || []
  const addMoneyTx = useStore((s) => s.addMoneyTx)
  const cancelMoneyTx = useStore((s) => s.cancelMoneyTx)
  const addAccount = useStore((s) => s.addAccount)

  const [modal, setModal] = useState(null) // null | 'in' | 'out' | 'transfer' | 'account'
  const [filterAcc, setFilterAcc] = useState('all')
  const [printTx, setPrintTx] = useState(null)
  const [period, setPeriod] = useState('month')
  // CloudShop-стайл фильтров: верхняя полоска (Поиск/Дата/Статус/Тип) +
  // кнопка «Фильтр», раскрывающая расширенные (Счёт/Контрагент/Категория/Автор).
  const [q, setQ] = useState('')
  const [txStatus, setTxStatus] = useState('all')
  const [txType, setTxType] = useState('all')
  const [partyId, setPartyId] = useState('all')
  const [purposeFilter, setPurposeFilter] = useState('all')
  const [empId, setEmpId] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)

  // ?new=in|out|transfer из CTA «Создать документ» — открывает нужную
  // модалку и стирает параметр, чтобы возврат стрелкой не открывал её
  // ещё раз.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const n = params.get('new')
    if (n === 'in' || n === 'out' || n === 'transfer') {
      setModal(n)
      const next = new URLSearchParams(params)
      next.delete('new')
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const balances = useMemo(
    () => accountBalances(accounts, moneyTx),
    [accounts, moneyTx],
  )

  // Сводка за выбранный период (и опционально по одному счёту). При
  // «Всё время» from=null — суммы считаются от самой первой транзакции.
  // Переводы включаются в приход/расход только при фильтре по счёту.
  const range = useMemo(() => rangeFor(period), [period])
  const summary = useMemo(
    () =>
      summarize(moneyTx, {
        from: range.from,
        to: range.to,
        accountId: filterAcc === 'all' ? null : filterAcc,
      }),
    [moneyTx, range, filterAcc],
  )

  const visibleTx = useMemo(() => {
    const s = q.trim().toLowerCase()
    return moneyTx.filter((t) => {
      // F1-6: селект «Дата» раньше фильтровал только сводку. Лента
      // показывала всё — юзер выбирал «Сегодня», сводка сжималась,
      // а лента оставалась «Всё время». Теперь оба используют range.
      if (range.from && t.at < range.from) return false
      if (range.to && t.at > range.to) return false
      if (filterAcc !== 'all' && t.accountId !== filterAcc && t.toAccountId !== filterAcc) return false
      if (txStatus !== 'all' && (t.status || 'posted') !== txStatus) return false
      if (txType !== 'all' && t.type !== txType) return false
      if (partyId !== 'all' && t.customerId !== partyId && t.supplierId !== partyId) return false
      if (purposeFilter !== 'all' && (t.purpose || '') !== purposeFilter) return false
      if (empId !== 'all' && t.by !== empId) return false
      if (s) {
        const hay = `${t.no || ''} ${t.note || ''}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [moneyTx, range, filterAcc, txStatus, txType, partyId, purposeFilter, empId, q])

  // Все встреченные назначения (для селекта «Категория»): справочник
  // in/out/transfer + фактически использованные ключи из moneyTx (на
  // случай старых записей с purpose, которого больше нет в справочнике).
  const purposeOptions = useMemo(() => {
    const seen = new Map()
    for (const kind of ['in', 'out', 'transfer']) {
      for (const p of MONEY_PURPOSES[kind] || []) seen.set(p.key, p.label)
    }
    for (const t of moneyTx) {
      if (t.purpose && !seen.has(t.purpose)) seen.set(t.purpose, t.purpose)
    }
    return Array.from(seen.entries()).map(([key, label]) => ({ key, label }))
  }, [moneyTx])

  return (
    <div className="animate-fadeUp space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Деньги</h2>
          <p className="text-sm text-muted">
            Кассы, счета, движение средств. Приход / расход / перевод между счетами.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Button icon={ArrowDownToLine} onClick={() => setModal('in')}>
            Приход
          </Button>
          <Button icon={ArrowUpFromLine} variant="soft" onClick={() => setModal('out')}>
            Расход
          </Button>
          <Button icon={ArrowLeftRight} variant="soft" onClick={() => setModal('transfer')}>
            Перевод
          </Button>
        </div>
      </div>

      <AccountsGrid
        accounts={accounts}
        balances={balances}
        filterAcc={filterAcc}
        setFilterAcc={setFilterAcc}
        onAddAccount={() => setModal('account')}
      />

      <SummaryPanel
        summary={summary}
        period={period}
        setPeriod={setPeriod}
        filteredByAccount={filterAcc !== 'all'}
      />

      <TxFilters
        q={q}
        setQ={setQ}
        period={period}
        setPeriod={setPeriod}
        txStatus={txStatus}
        setTxStatus={setTxStatus}
        txType={txType}
        setTxType={setTxType}
        filtersOpen={filtersOpen}
        setFiltersOpen={setFiltersOpen}
        accounts={accounts}
        customers={customers}
        suppliers={suppliers}
        employees={employees}
        filterAcc={filterAcc}
        setFilterAcc={setFilterAcc}
        partyId={partyId}
        setPartyId={setPartyId}
        purposeFilter={purposeFilter}
        setPurposeFilter={setPurposeFilter}
        empId={empId}
        setEmpId={setEmpId}
        purposeOptions={purposeOptions}
      />

      <Card className="overflow-hidden">
        {visibleTx.length === 0 ? (
          <Empty
            icon={Wallet}
            title="Пока нет движений"
            text="Нажмите «Приход», «Расход» или «Перевод», чтобы записать движение денег."
          />
        ) : (
          <div className="divide-y divide-line">
            {visibleTx.map((t) => (
              <TxRow
                key={t.id}
                tx={t}
                accounts={accounts}
                customers={customers}
                suppliers={suppliers}
                onCancel={() => cancelMoneyTx(t.id)}
                onPrint={() => setPrintTx(t)}
              />
            ))}
          </div>
        )}
      </Card>

      {modal === 'in' && (
        <MoneyTxModal
          type="in"
          accounts={accounts}
          customers={customers}
          suppliers={suppliers}
          onClose={() => setModal(null)}
          onSubmit={(tx) => addMoneyTx({ ...tx, type: 'in' })}
        />
      )}
      {modal === 'out' && (
        <MoneyTxModal
          type="out"
          accounts={accounts}
          customers={customers}
          suppliers={suppliers}
          onClose={() => setModal(null)}
          onSubmit={(tx) => addMoneyTx({ ...tx, type: 'out' })}
        />
      )}
      {modal === 'transfer' && (
        <MoneyTxModal
          type="transfer"
          accounts={accounts}
          customers={customers}
          suppliers={suppliers}
          onClose={() => setModal(null)}
          onSubmit={(tx) => addMoneyTx({ ...tx, type: 'transfer' })}
        />
      )}
      {modal === 'account' && (
        <AccountModal onClose={() => setModal(null)} onSubmit={(a) => addAccount(a)} />
      )}
      {printTx && (
        <DocPreviewModal
          doc={printTx}
          category={
            printTx.type === 'in'
              ? 'moneyIn'
              : printTx.type === 'out'
                ? 'moneyOut'
                : 'moneyTransfer'
          }
          onClose={() => setPrintTx(null)}
        />
      )}
    </div>
  )
}
