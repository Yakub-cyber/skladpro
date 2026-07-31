import { Filter as FilterIcon, Search } from 'lucide-react'
import { Card, Field, Input, Select, cx } from '@/shared/ui'

// CloudShop-стайл фильтров: узкая полоска с 4 основными полями и
// кнопкой «Фильтр», раскрывающей ещё 4 расширенных.
export default function TxFilters({
  q,
  setQ,
  period,
  setPeriod,
  txStatus,
  setTxStatus,
  txType,
  setTxType,
  filtersOpen,
  setFiltersOpen,
  accounts,
  customers,
  suppliers,
  employees,
  filterAcc,
  setFilterAcc,
  partyId,
  setPartyId,
  purposeFilter,
  setPurposeFilter,
  empId,
  setEmpId,
  purposeOptions,
}) {
  return (
    <Card className="p-3 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_auto]">
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
            <option value="today">Сегодня</option>
            <option value="week">7 дней</option>
            <option value="month">30 дней</option>
            <option value="all">Всё время</option>
          </Select>
        </Field>
        <Field label="Статус">
          <Select value={txStatus} onChange={(e) => setTxStatus(e.target.value)}>
            <option value="all">Все</option>
            <option value="posted">Проведён</option>
            <option value="cancelled">Отменён</option>
          </Select>
        </Field>
        <Field label="Тип">
          <Select value={txType} onChange={(e) => setTxType(e.target.value)}>
            <option value="all">Все</option>
            <option value="in">Приход</option>
            <option value="out">Расход</option>
            <option value="transfer">Перевод</option>
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
          <Field label="Счёт">
            <Select value={filterAcc} onChange={(e) => setFilterAcc(e.target.value)}>
              <option value="all">Все</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Контрагент">
            <Select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
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
          <Field label="Категория">
            <Select value={purposeFilter} onChange={(e) => setPurposeFilter(e.target.value)}>
              <option value="all">Все</option>
              {purposeOptions.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Автор">
            <Select value={empId} onChange={(e) => setEmpId(e.target.value)}>
              <option value="all">Все</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </Card>
  )
}
