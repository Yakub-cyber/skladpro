import { Check, Tags, Trash2, X } from 'lucide-react'
import { plural } from '@/shared/lib/format'
import { printLabels } from '@/shared/lib/labels'
import { useConfirm } from '@/shared/components/Confirm'
import { useStore } from '@/shared/store/useStore'

// Sticky-тулбар при выделении. Всплывает сверху с массовыми
// действиями. Тёмный цвет — чтобы контрастировал с обычной таблицей.
export function BulkActions({ selected, shown, onClear }) {
  const removeProduct = useStore((s) => s.removeProduct)
  const confirm = useConfirm()

  return (
    <div className="sticky top-16 z-10 -mx-4 lg:-mx-6 px-4 lg:px-6 mb-3">
      <div className="rounded-xl bg-ink text-white shadow-xl shadow-ink/20 flex items-center gap-3 px-4 py-2.5 animate-fadeUp">
        <div className="h-5 w-5 rounded bg-brand grid place-items-center shrink-0">
          <Check size={13} strokeWidth={3} />
        </div>
        <span className="text-[13px] font-semibold">
          Выбрано {selected.size} {plural(selected.size, 'товар', 'товара', 'товаров')}
        </span>
        <div className="h-5 w-px bg-white/15 mx-1" />
        <button
          onClick={() => {
            const chosen = shown.filter((p) => selected.has(p.id)).map((p) => ({ p, qty: 1 }))
            if (chosen.length) printLabels(chosen)
          }}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/10 hover:bg-white/20 text-[12.5px] font-semibold transition"
        >
          <Tags size={14} /> Печать этикеток
        </button>
        <button
          onClick={async () => {
            const chosen = shown.filter((p) => selected.has(p.id))
            const ok = await confirm({
              title: `Удалить ${chosen.length} ${plural(chosen.length, 'товар', 'товара', 'товаров')}?`,
              body: 'Товары пропадут из каталога. История продаж и остатки в закрытых документах сохранятся.',
              details: chosen.length > 3
                ? `${chosen.slice(0, 3).map((p) => p.name).join(' · ')} и ещё ${chosen.length - 3}`
                : chosen.map((p) => p.name).join(' · '),
              tone: 'danger',
              okLabel: `Удалить ${chosen.length}`,
              requireInput: chosen.length >= 5 ? 'УДАЛИТЬ' : undefined,
            })
            if (ok) {
              // F1-1: removeProduct возвращает {ok:false} если товар
              // используется в открытых заказах/документах/PO. Раньше
              // результат отбрасывался — UI показывал «удалено», а
              // товар оставался. Теперь собираем skipped и алертим.
              const skipped = []
              chosen.forEach((p) => {
                const r = removeProduct(p.id)
                if (r && r.ok === false) skipped.push({ name: p.name, error: r.error })
              })
              if (skipped.length > 0) {
                alert(
                  `Не удалены (${skipped.length} из ${chosen.length}):\n\n` +
                    skipped.map((s) => `• ${s.name}: ${s.error}`).join('\n'),
                )
              }
              onClear()
            }
          }}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-bad text-white hover:brightness-110 text-[12.5px] font-semibold transition"
        >
          <Trash2 size={14} /> Удалить
        </button>
        <span className="ml-auto text-[11px] text-white/60 hidden sm:inline">ESC — снять выбор</span>
        <button
          onClick={onClear}
          className="h-7 w-7 grid place-items-center rounded-md hover:bg-white/10"
          title="Снять выбор"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
