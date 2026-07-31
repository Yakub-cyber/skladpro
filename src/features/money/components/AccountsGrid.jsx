import { Landmark, Plus, Wallet, X } from 'lucide-react'
import { cx } from '@/shared/ui'
import { money } from '@/shared/lib/format'

export default function AccountsGrid({ accounts, balances, filterAcc, setFilterAcc, onAddAccount }) {
  const total = accounts.reduce((a, x) => a + (balances[x.id] || 0), 0)

  return (
    <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {accounts.map((a) => {
          const balance = balances[a.id] || 0
          const Icon = a.kind === 'bank' ? Landmark : Wallet
          return (
            <button
              key={a.id}
              onClick={() => setFilterAcc(filterAcc === a.id ? 'all' : a.id)}
              className={cx(
                'card p-4 flex items-start gap-3 text-left transition hover:border-brand/40',
                filterAcc === a.id && 'border-brand ring-1 ring-brand/40',
              )}
            >
              <div
                className={cx(
                  'h-10 w-10 rounded-xl grid place-items-center shrink-0',
                  a.kind === 'bank' ? 'bg-info-soft text-info' : 'bg-warn-soft text-warn',
                )}
              >
                <Icon size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-muted">
                  {a.kind === 'bank' ? 'Расчётный счёт' : 'Касса'}
                </div>
                <div className="font-semibold text-[15px] truncate">{a.name}</div>
                <div
                  className={cx(
                    'mt-1.5 text-lg font-bold tabular-nums',
                    balance < 0 && 'text-bad',
                  )}
                >
                  {money(balance)}
                </div>
              </div>
            </button>
          )
        })}
        <button
          onClick={onAddAccount}
          className="card p-4 flex flex-col items-center justify-center gap-2 border-dashed text-muted hover:text-ink hover:border-brand/40"
        >
          <Plus size={22} />
          <span className="text-sm font-medium">Добавить счёт</span>
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted">Итого по счетам:</span>
        <span className={cx('text-lg font-bold tabular-nums', total < 0 && 'text-bad')}>
          {money(total)}
        </span>
        {filterAcc !== 'all' && (
          <button
            onClick={() => setFilterAcc('all')}
            className="ml-auto text-[12px] flex items-center gap-1 text-muted hover:text-ink"
          >
            <X size={13} /> сбросить фильтр
          </button>
        )}
      </div>
    </>
  )
}
