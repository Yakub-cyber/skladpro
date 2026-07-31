import { Filter as FilterIcon, Search } from 'lucide-react'
import { Card, Field, Input, Select, cx } from '@/shared/ui'

const PERIODS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: '7 дней' },
  { key: 'month', label: '30 дней' },
  { key: 'all', label: 'Всё время' },
]

const KIND_TABS = [
  { key: 'all', label: 'Все' },
  { key: 'goods-in', label: 'Товар: приход' },
  { key: 'goods-out', label: 'Товар: расход' },
  { key: 'money-in', label: 'Деньги: приход' },
  { key: 'money-out', label: 'Деньги: расход' },
]

// CloudShop-стайл фильтров: узкая верхняя полоска (5 полей) + справа
// кнопка «Фильтр», раскрывающая панель с расширенными параметрами
// (Автор, Отправитель, Получатель, Касса/счёт).
export default function MovementsFilters({
  q,
  setQ,
  period,
  setPeriod,
  docStatus,
  setDocStatus,
  paymentStatus,
  setPaymentStatus,
  kind,
  setKind,
  filtersOpen,
  setFiltersOpen,
  empId,
  setEmpId,
  fromParty,
  setFromParty,
  toParty,
  setToParty,
  accId,
  setAccId,
  employees,
  customers,
  suppliers,
  accounts,
}) {
  return (
    <Card className="p-3 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))_auto]">
        <Field label="Поиск">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Номер или комментарий…"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Дата">
          <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Статус">
          <Select value={docStatus} onChange={(e) => setDocStatus(e.target.value)}>
            <option value="all">Все</option>
            <option value="posted">Проведён</option>
            <option value="draft">Черновик</option>
            <option value="cancelled">Отменён</option>
          </Select>
        </Field>
        <Field label="Оплата">
          <Select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
            <option value="all">Все</option>
            <option value="paid">Оплачено</option>
            <option value="partial">Частично</option>
            <option value="unpaid">Не оплачено</option>
          </Select>
        </Field>
        <Field label="Тип">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KIND_TABS.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="&nbsp;">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={cx(
              'h-10 px-4 rounded-xl border text-sm font-medium inline-flex items-center gap-2 transition',
              filtersOpen
                ? 'bg-brand text-brand-ink border-brand'
                : 'bg-surface-2 border-line hover:border-brand/40',
            )}
          >
            <FilterIcon size={15} />
            Фильтр
          </button>
        </Field>
      </div>
      {filtersOpen && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 pt-3 border-t border-line animate-fadeUp">
          <Field label="Автор">
            <Select value={empId} onChange={(e) => setEmpId(e.target.value)}>
              <option value="all">Все</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Отправитель">
            <Select value={fromParty} onChange={(e) => setFromParty(e.target.value)}>
              <option value="all">Все</option>
              <optgroup label="Клиенты">
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
              <optgroup label="Поставщики">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <Field label="Получатель">
            <Select value={toParty} onChange={(e) => setToParty(e.target.value)}>
              <option value="all">Все</option>
              <optgroup label="Клиенты">
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
              <optgroup label="Поставщики">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <Field label="Касса / счёт">
            <Select value={accId} onChange={(e) => setAccId(e.target.value)}>
              <option value="all">Все</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </Card>
  )
}
