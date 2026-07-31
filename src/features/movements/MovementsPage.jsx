// «Движение товара» — единая лента всех операций, влияющих на склад
// и деньги (documents + orders + invoices + moneyTx). Табличный вид
// в стиле CloudShop: sticky-заголовки дней, узкая полоска фильтров
// сверху с расширяемой панелью.
import { useMemo, useState } from 'react'
import { useStore } from '@/shared/store/useStore'
import { rangeFor } from '@/shared/lib/money'
import { buildTimeline, classify, dayLabel } from './timeline'
import MovementsFilters from './components/MovementsFilters'
import MovementsTable from './components/MovementsTable'

export default function Movements() {
  const state = useStore()
  const employees = state.employees || []
  const customers = state.customers || []
  const suppliers = state.suppliers || []
  const accounts = state.accounts || []

  const [period, setPeriod] = useState('month')
  const [kind, setKind] = useState('all')
  const [q, setQ] = useState('')
  const [empId, setEmpId] = useState('all')
  const [partyId] = useState('all') // старый ID-фильтр, оставлен для совместимости
  const [accId, setAccId] = useState('all')
  // CloudShop-стайл фильтры: docStatus / paymentStatus / from/to Party.
  const [docStatus, setDocStatus] = useState('all')
  const [paymentStatus, setPaymentStatus] = useState('all')
  const [fromParty, setFromParty] = useState('all')
  const [toParty, setToParty] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const timeline = useMemo(() => buildTimeline(state), [state])
  const range = useMemo(() => rangeFor(period), [period])

  const nameMatch = (name, id) => {
    if (id === 'all' || !name) return true
    const c = customers.find((x) => x.id === id)
    const s = suppliers.find((x) => x.id === id)
    const target = c?.name || s?.name
    return target && name.toLowerCase().includes(target.toLowerCase())
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return timeline.filter((r) => {
      if (range.from && r.at < range.from) return false
      if (range.to && r.at > range.to) return false
      const cls = classify(r)
      if (kind !== 'all' && cls !== kind) return false
      if (empId !== 'all' && r.by !== empId) return false
      if (partyId !== 'all') {
        const raw = r.raw
        const has =
          raw.customerId === partyId ||
          raw.supplierId === partyId ||
          raw.partyId === partyId
        if (!has) return false
      }
      if (fromParty !== 'all' && !nameMatch(r.from, fromParty)) return false
      if (toParty !== 'all' && !nameMatch(r.to, toParty)) return false
      if (docStatus !== 'all' && r.status !== docStatus) return false
      if (paymentStatus !== 'all') {
        const paid = Number(r.paid) || 0
        const sum = Number(r.sum) || 0
        const st =
          sum === 0 ? 'paid' : paid >= sum ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
        if (st !== paymentStatus) return false
      }
      if (accId !== 'all') {
        if (r.kind !== 'money') return false
        if (r.raw.accountId !== accId && r.raw.toAccountId !== accId) return false
      }
      if (s) {
        const hay = `${r.no} ${r.title} ${r.from || ''} ${r.to || ''}`.toLowerCase()
        if (!hay.includes(s)) return false
      }
      return true
    })
  }, [timeline, range, kind, empId, partyId, accId, q, docStatus, paymentStatus, fromParty, toParty])

  // Группировка по дням для sticky-заголовков.
  const groups = useMemo(() => {
    const g = []
    let cur = null
    for (const r of filtered.slice(0, 500)) {
      const label = dayLabel(r.at)
      if (!cur || cur.label !== label) {
        cur = { label, rows: [] }
        g.push(cur)
      }
      cur.rows.push(r)
    }
    return g
  }, [filtered])

  const nameOf = (id) => employees.find((e) => e.id === id)?.name || '—'
  const fmtTime = (iso) =>
    new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="animate-fadeUp space-y-4">
      <MovementsFilters
        q={q}
        setQ={setQ}
        period={period}
        setPeriod={setPeriod}
        docStatus={docStatus}
        setDocStatus={setDocStatus}
        paymentStatus={paymentStatus}
        setPaymentStatus={setPaymentStatus}
        kind={kind}
        setKind={setKind}
        filtersOpen={filtersOpen}
        setFiltersOpen={setFiltersOpen}
        empId={empId}
        setEmpId={setEmpId}
        fromParty={fromParty}
        setFromParty={setFromParty}
        toParty={toParty}
        setToParty={setToParty}
        accId={accId}
        setAccId={setAccId}
        employees={employees}
        customers={customers}
        suppliers={suppliers}
        accounts={accounts}
      />
      <MovementsTable
        groups={groups}
        totalCount={filtered.length}
        nameOf={nameOf}
        fmtTime={fmtTime}
      />
    </div>
  )
}
