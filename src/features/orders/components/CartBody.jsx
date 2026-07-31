import { Minus, Plus, Trash2, Check, ShoppingCart, Truck } from 'lucide-react'
import { Field, Select, Input, Empty, cx } from '@/shared/ui'
import { money } from '@/shared/lib/format'
import CustomerPicker from '@/features/orders/components/CustomerPicker'

// Общая форма итога чека (клиент, скидка, кнопка). Рендерится и в
// sticky-сайдбаре на десктопе, и в bottom-sheet на мобиле.
export default function CartBody({
  rows,
  count,
  subtotal,
  total,
  discount,
  setDiscount,
  onCredit,
  setOnCredit,
  customerId,
  customers,
  onPickCustomer,
  onAddCustomer,
  priceTypeId,
  priceTypes,
  onChangeType,
  onSetQty,
  onSetPrice,
  onSubmit,
  round3,
  address,
  setAddress,
  geoStatus,
  asOrder,
  setAsOrder,
  vatSummary,
  compact = false,
}) {
  return (
    <div className={cx('flex flex-col', compact ? 'gap-3' : 'gap-3 h-full')}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Клиент">
          <CustomerPicker
            customers={customers}
            customerId={customerId}
            onPick={onPickCustomer}
            onAdd={onAddCustomer}
          />
        </Field>
        <Field label="Цены">
          <Select value={priceTypeId} onChange={(e) => onChangeType(e.target.value)}>
            {priceTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
      </div>
      {/* Переключатель «чек ↔ заказ». Выключено (по умолчанию) — товар
          уходит с покупателем прямо сейчас, чек закрывается мгновенно.
          Включено — оформляем заказ с доставкой: попадает в /orders и
          идёт по воронке «подтверждён → сборка → в пути → доставлен». */}
      {setAsOrder && (
        <label
          className={cx(
            'flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition',
            asOrder
              ? 'bg-brand-soft border-brand/40'
              : 'bg-surface-2 border-line hover:border-brand/25',
          )}
        >
          <input
            type="checkbox"
            checked={!!asOrder}
            onChange={(e) => setAsOrder(e.target.checked)}
            className="h-4 w-4 accent-brand"
          />
          <Truck size={16} className={asOrder ? 'text-brand' : 'text-muted'} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">Оформить как заказ</div>
            <div className="text-[11.5px] text-muted leading-snug">
              {asOrder
                ? 'Попадёт в «Заказы», пойдёт по воронке: сборка → в пути → доставлен'
                : 'Обычный чек — товар отдаём сразу, продажа закрывается'}
            </div>
          </div>
        </label>
      )}
      {setAddress && asOrder && (
        <Field
          label="Адрес доставки"
          hint={
            geoStatus === 'found'
              ? '📍 адрес распознан, пин на карте будет точным'
              : geoStatus === 'searching'
                ? '…ищу координаты'
                : geoStatus === 'nohit'
                  ? 'не нашли координаты — Delivery покажет город без точного пина'
                  : 'необязательно; используется на карте доставки'
          }
        >
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="г. Казань, ул. Мира, 5"
          />
        </Field>
      )}

      <div className={cx('flex-1 min-h-[80px]', !compact && 'overflow-y-auto no-scrollbar -mx-1 px-1')}>
        {rows.length === 0 ? (
          <Empty icon={ShoppingCart} title="Чек пуст" text="Добавьте товары из каталога." />
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const base = Number(r.basePrice ?? r.price) || 0
              const price = Number(r.price) || 0
              const discounted = base > 0 && price < base
              return (
                <div key={r.productId} className="p-2.5 rounded-xl bg-surface-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-medium leading-snug">{r.name}</span>
                    <button onClick={() => onSetQty(r.productId, 0)} className="text-muted hover:text-bad shrink-0">
                      <Trash2 size={15} />
                    </button>
                  </div>
                  {/* Строка 1: qty */}
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => onSetQty(r.productId, round3(r.qty - (r.weighted ? 0.1 : 1)))}
                      className="h-7 w-7 rounded-lg bg-surface grid place-items-center hover:bg-surface-3"
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      value={r.qty}
                      min={r.weighted ? '0.001' : '1'}
                      step={r.weighted ? '0.1' : '1'}
                      onChange={(e) => onSetQty(r.productId, Math.max(0, +e.target.value))}
                      className="w-14 h-7 px-1 rounded-lg bg-surface border border-line text-sm text-center"
                    />
                    <button
                      onClick={() => onSetQty(r.productId, round3(r.qty + (r.weighted ? 0.1 : 1)))}
                      className="h-7 w-7 rounded-lg bg-surface grid place-items-center hover:bg-surface-3"
                    >
                      <Plus size={14} />
                    </button>
                    <span className="text-[11px] text-muted">{r.unit}</span>
                    <span className="ml-auto text-sm font-medium tabular-nums">
                      {money(r.qty * price)}
                    </span>
                  </div>
                  {/* Строка 2: цена (редактируемая) + база зачёркнутой если снижена */}
                  {onSetPrice && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[11px] text-muted">Цена</span>
                      <input
                        type="number"
                        value={r.price}
                        min="0"
                        step="0.01"
                        onChange={(e) => onSetPrice(r.productId, e.target.value)}
                        className={cx(
                          'w-24 h-7 px-2 rounded-lg bg-surface border text-sm text-right tabular-nums',
                          discounted ? 'border-ok text-ok font-medium' : 'border-line',
                        )}
                        title="Персональная цена по этой позиции"
                      />
                      <span className="text-[11px] text-muted">₽/{r.unit}</span>
                      {discounted && (
                        <span className="ml-auto text-[11px] text-muted line-through tabular-nums">
                          {money(base)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="border-t border-line pt-3 space-y-2">
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted">Скидка</span>
          <input
            type="number"
            min="0"
            max="100"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            className="w-14 h-8 px-2 rounded-lg bg-surface-2 border border-line text-sm text-center"
          />
          <span className="text-[12px] text-muted">%</span>
          {discount > 0 && (
            <span className="ml-auto text-[12px] text-muted line-through tabular-nums">
              {money(subtotal)}
            </span>
          )}
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted text-sm">Итого</span>
          <span className="text-2xl font-bold tabular-nums">{money(total)}</span>
        </div>
        {vatSummary && vatSummary.vat > 0 && (
          <div className="flex justify-between items-center text-[12px] text-muted">
            <span>в т.ч. НДС</span>
            <span className="tabular-nums">{money(vatSummary.vat)}</span>
          </div>
        )}
        {/* Крупная зелёная CTA на всю ширину чека — сумма на самой кнопке.
            F9 (в родителе) тоже открывает экран оплаты — подпись справа. */}
        <button
          onClick={onSubmit}
          disabled={!rows.length}
          className={cx(
            'w-full h-14 rounded-2xl flex items-center justify-center gap-2 text-white text-lg font-bold tracking-tight transition shadow-lg',
            rows.length
              ? 'bg-[var(--ok,#16a34a)] hover:brightness-110 shadow-emerald-500/25'
              : 'bg-surface-3 text-muted cursor-not-allowed shadow-none',
          )}
        >
          <Check size={22} />
          <span>ОПЛАТИТЬ · {money(total)}</span>
          <kbd className="ml-2 hidden md:inline text-[11px] font-semibold bg-black/20 rounded px-1.5 py-0.5">
            F9
          </kbd>
        </button>
      </div>
    </div>
  )
}
