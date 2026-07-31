import { MapPin, Package, Pencil, Scale, ShieldCheck } from 'lucide-react'
import { Card, Badge, Empty, cx } from '@/shared/ui'
import { money, num } from '@/shared/lib/format'
import { catInfo, isKit } from '@/shared/lib/constants'
import { computeKitStock } from '@/shared/lib/kit'
import { CAT_ICON, stockTone } from '@/features/products/constants'

export function ProductTable({ shown, list, cols, selected, onToggleOne, onToggleAll, onClearSelection, onEdit, reserved, products }) {
  return (
    <Card className="overflow-hidden hidden lg:block">
      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted text-[12px] text-left border-b border-line bg-surface-2/40">
              <th className="font-medium py-3 pl-4 pr-2 w-8">
                <input
                  type="checkbox"
                  checked={shown.length > 0 && shown.every((p) => selected.has(p.id))}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.size > 0 && !shown.every((p) => selected.has(p.id))
                  }}
                  onChange={(e) => {
                    if (e.target.checked) onToggleAll(shown.map((p) => p.id))
                    else onClearSelection()
                  }}
                  className="h-4 w-4 rounded cursor-pointer accent-brand"
                  aria-label="Выделить все"
                />
              </th>
              <th className="font-medium py-3 px-4">Товар</th>
              {cols.category && (
                <th className="font-medium py-3 px-3 hidden xl:table-cell">Категория</th>
              )}
              {cols.unit && (
                <th className="font-medium py-3 px-3 text-center">Ед.</th>
              )}
              {cols.cell && (
                <th className="font-medium py-3 px-3 hidden xl:table-cell">Ячейка</th>
              )}
              {cols.cost && (
                <th className="font-medium py-3 px-3 text-right">Себест.</th>
              )}
              {cols.price && (
                <th className="font-medium py-3 px-3 text-right">Цена</th>
              )}
              {cols.margin && (
                <th className="font-medium py-3 px-3 text-right">Маржа</th>
              )}
              {cols.minStock && (
                <th className="font-medium py-3 px-3 text-right">Мин.</th>
              )}
              {cols.reserved && (
                <th className="font-medium py-3 px-3 text-right">Резерв</th>
              )}
              {cols.available && (
                <th className="font-medium py-3 px-3 text-right">Доступно</th>
              )}
              {cols.stock && (
                <th className="font-medium py-3 px-4 text-right">Остаток</th>
              )}
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((p) => {
              const c = catInfo(p.category)
              const Icon = CAT_ICON[c.icon] || Package
              return (
                <tr
                  key={p.id}
                  className={cx(
                    'hover:bg-surface-2/50 transition cursor-pointer',
                    selected.has(p.id) && 'bg-brand-soft/40',
                  )}
                  onClick={() => onEdit(p)}
                >
                  <td className="py-2.5 pl-4 pr-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => onToggleOne(p.id)}
                      className="h-4 w-4 rounded cursor-pointer accent-brand"
                      aria-label={`Выделить ${p.name}`}
                    />
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-3">
                      {p.image ? (
                        <img
                          src={p.image}
                          alt=""
                          className="h-9 w-9 rounded-lg object-cover shrink-0"
                        />
                      ) : (
                        <div
                          className="h-9 w-9 rounded-lg grid place-items-center shrink-0"
                          style={{
                            background: `color-mix(in srgb, ${c.color} 16%, transparent)`,
                            color: c.color,
                          }}
                        >
                          <Icon size={17} />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-medium truncate flex items-center gap-1.5">
                          {p.name}
                          {p.weighted && (
                            <Scale size={13} className="text-info shrink-0" />
                          )}
                          {p.marked && (
                            <ShieldCheck size={13} className="text-ok shrink-0" />
                          )}
                        </div>
                        <div className="text-[12px] text-muted">{p.sku}</div>
                      </div>
                    </div>
                  </td>
                  {cols.category && (
                    <td className="py-2.5 px-3 hidden xl:table-cell">
                      <span className="text-[13px]" style={{ color: c.color }}>
                        {p.category}
                      </span>
                    </td>
                  )}
                  {cols.unit && (
                    <td className="py-2.5 px-3 text-center text-muted">
                      {p.unit}
                    </td>
                  )}
                  {cols.cell && (
                    <td className="py-2.5 px-3 hidden xl:table-cell">
                      <Badge tone="muted">
                        <MapPin size={11} /> {p.cell}
                      </Badge>
                    </td>
                  )}
                  {cols.cost && (
                    <td className="py-2.5 px-3 text-right tabular-nums text-muted">
                      {money(p.cost)}
                    </td>
                  )}
                  {cols.price && (
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                      {money(p.price)}
                    </td>
                  )}
                  {cols.margin && (
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      <span className={cx(p.price - p.cost > 0 ? 'text-ok' : 'text-muted')}>
                        {money((p.price || 0) - (p.cost || 0))}
                      </span>
                    </td>
                  )}
                  {cols.minStock && (
                    <td className="py-2.5 px-3 text-right tabular-nums text-muted">
                      {num(p.minStock || 0)}
                    </td>
                  )}
                  {cols.reserved && (
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {reserved[p.id] > 0 ? (
                        <span className="text-warn">{num(reserved[p.id])}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  )}
                  {cols.available && (
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                      {num(Math.max(0, p.stock - (reserved[p.id] || 0)))}
                    </td>
                  )}
                  {cols.stock && (
                    <td className="py-2.5 px-4 text-right">
                      {isKit(p) ? (
                        <Badge tone="brand">
                          {num(computeKitStock(p, products))} {p.unit}
                        </Badge>
                      ) : (
                        <Badge tone={stockTone(p)}>
                          {num(p.stock)} {p.unit}
                        </Badge>
                      )}
                    </td>
                  )}
                  <td className="py-2.5 pr-3 text-muted">
                    <Pencil size={15} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {list.length === 0 && (
          <Empty icon={Package} title="Ничего не найдено" text="Измените запрос или фильтр." />
        )}
      </div>
    </Card>
  )
}
