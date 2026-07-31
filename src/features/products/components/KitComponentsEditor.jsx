import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { money, num } from '@/shared/lib/format'

// Редактор состава комплекта — список товаров с qty × шт. Кнопка «сумма
// составляющих» подставляет цену комплекта как сумму розничных цен
// компонентов (для ориентира; ручная цена задаётся отдельно, ниже она
// же). Комплект не хранит собственный остаток: при продаже списываются
// компоненты, а доступное количество наборов = min(component.stock /
// component.qty). См. lib/kit.js и lib/posting.js expandItem().
export function KitComponentsEditor({
  components,
  onChange,
  allProducts,
  currentId,
  onFillPriceFromComponents,
}) {
  const [q, setQ] = useState('')
  // Кандидаты для состава — только обычные товары (не услуги, не другой
  // комплект, не сам этот комплект).
  const candidates = allProducts
    .filter((p) => p.id !== currentId && (p.type || 'product') === 'product')
    .filter((p) => {
      const s = q.trim().toLowerCase()
      return !s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)
    })
    .slice(0, 6)

  const componentPriceTotal = components.reduce((s, c) => {
    const p = allProducts.find((x) => x.id === c.productId)
    return s + (Number(p?.price) || 0) * (Number(c.qty) || 0)
  }, 0)

  const add = (p) => {
    if (components.find((c) => c.productId === p.id)) return
    onChange([...components, { productId: p.id, qty: 1 }])
    setQ('')
  }
  const setQty = (id, qty) =>
    onChange(
      qty <= 0
        ? components.filter((c) => c.productId !== id)
        : components.map((c) => (c.productId === id ? { ...c, qty } : c)),
    )

  return (
    <div className="rounded-xl border border-brand/30 bg-brand-soft/40 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] font-medium">Состав комплекта</span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <span className="text-[12px] text-muted">
            Розница: <b className="text-ink tabular-nums">{money(componentPriceTotal)}</b>
          </span>
          <button
            type="button"
            onClick={() => onFillPriceFromComponents?.(componentPriceTotal)}
            className="text-[12px] px-2 h-7 rounded-lg bg-surface hover:bg-surface-2 border border-line whitespace-nowrap"
            title="Установить цену комплекта = сумма розничных цен"
          >
            Взять как цену
          </button>
        </div>
      </div>

      {components.length > 0 ? (
        <div className="space-y-1.5">
          {components.map((c) => {
            const p = allProducts.find((x) => x.id === c.productId)
            if (!p) {
              return (
                <div key={c.productId} className="p-2 rounded-lg bg-surface border border-line text-[12px] text-bad">
                  Товар не найден: {c.productId}{' '}
                  <button onClick={() => setQty(c.productId, 0)} className="ml-1 underline">
                    удалить
                  </button>
                </div>
              )
            }
            // Наборов «можно собрать» из этого компонента при текущей qty.
            const perKit = Number(c.qty) || 0
            const maxKits = perKit > 0 ? Math.floor((Number(p.stock) || 0) / perKit) : 0
            return (
              <div key={c.productId} className="flex items-center gap-2 p-2 rounded-lg bg-surface">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate">{p.name}</div>
                  <div className="text-[11px] text-muted">
                    {p.sku} · {money(p.price)}/{p.unit} · ост. {num(p.stock)} → на {maxKits} наб.
                  </div>
                </div>
                <input
                  type="number"
                  min="0.001"
                  step="1"
                  value={c.qty}
                  onChange={(e) => setQty(c.productId, +e.target.value)}
                  className="w-20 h-8 px-1 rounded-lg bg-surface-2 border border-line text-sm text-center tabular-nums"
                />
                <span className="text-[12px] text-muted w-8">{p.unit}</span>
                <button
                  onClick={() => setQty(c.productId, 0)}
                  className="text-muted hover:text-bad"
                  title="Убрать"
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-[12px] text-muted italic">
          Добавьте товары в состав комплекта.
        </div>
      )}

      {/* Добавление товара в состав */}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Найти товар для добавления в комплект…"
          className="w-full h-9 pl-8 pr-3 rounded-lg bg-surface border border-line text-[13px] outline-none focus:border-brand"
        />
        {q && candidates.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-10 card p-1 max-h-56 overflow-y-auto">
            {candidates.map((p) => (
              <button
                key={p.id}
                onClick={() => add(p)}
                className="w-full flex items-center justify-between gap-2 px-2 h-9 rounded-md hover:bg-surface-2 text-left text-[13px]"
              >
                <span className="truncate">{p.name}</span>
                <span className="text-muted text-[11px] shrink-0">
                  {p.sku} · {money(p.price)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
