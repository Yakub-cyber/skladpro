import { MapPin, Package, Scale, ShieldCheck } from 'lucide-react'
import { Badge, Empty } from '@/shared/ui'
import { money, num } from '@/shared/lib/format'
import { catInfo, isService, isKit, isRealProduct } from '@/shared/lib/constants'
import { computeKitStock } from '@/shared/lib/kit'
import { CAT_ICON, stockTone } from '@/features/products/constants'

// Мобильные карточки — без внутреннего горизонтального скролла таблицы.
// Крупное фото/иконка слева, компактная сводка справа.
export function ProductCards({ shown, list, onEdit, reserved, products }) {
  return (
    <div className="lg:hidden space-y-2">
      {shown.map((p) => {
        const c = catInfo(p.category)
        const Icon = CAT_ICON[c.icon] || Package
        return (
          <button
            key={p.id}
            onClick={() => onEdit(p)}
            className="w-full card p-3 flex items-center gap-3 text-left hover:border-brand/40 transition"
          >
            {p.image ? (
              <img
                src={p.image}
                alt=""
                className="h-14 w-14 rounded-xl object-cover shrink-0"
              />
            ) : (
              <div
                className="h-14 w-14 rounded-xl grid place-items-center shrink-0"
                style={{
                  background: `color-mix(in srgb, ${c.color} 16%, transparent)`,
                  color: c.color,
                }}
              >
                <Icon size={22} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[14px] leading-snug truncate flex items-center gap-1.5">
                {p.name}
                {isService(p) && (
                  <Badge tone="info" className="shrink-0 text-[10px]">услуга</Badge>
                )}
                {isKit(p) && (
                  <Badge tone="brand" className="shrink-0 text-[10px]">комплект</Badge>
                )}
                {p.weighted && <Scale size={12} className="text-info shrink-0" />}
                {p.marked && <ShieldCheck size={12} className="text-ok shrink-0" />}
              </div>
              <div className="text-[12px] text-muted truncate mt-0.5">
                {p.sku}
                {' · '}
                <span style={{ color: c.color }}>{p.category}</span>
                {!isService(p) && !isKit(p) && (
                  <>
                    {' · '}
                    <MapPin size={11} className="inline -mt-0.5" /> {p.cell}
                  </>
                )}
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="font-semibold text-[15px] tabular-nums">{money(p.price)}</span>
                {isRealProduct(p) ? (
                  <Badge tone={stockTone(p)}>
                    {num(p.stock)} {p.unit}
                  </Badge>
                ) : isKit(p) ? (
                  // Комплект: остаток = сколько наборов можно собрать из
                  // текущих остатков компонентов. Считается на лету.
                  <Badge tone="brand">
                    {num(computeKitStock(p, products))} {p.unit}
                  </Badge>
                ) : (
                  <span className="text-[11px] text-muted">без остатка</span>
                )}
              </div>
              {isRealProduct(p) && reserved[p.id] > 0 && (
                <div className="text-[11px] text-muted mt-0.5 tabular-nums">
                  резерв {num(reserved[p.id])} · дост. {num(p.stock - reserved[p.id])}
                </div>
              )}
            </div>
          </button>
        )
      })}
      {list.length === 0 && (
        <Empty icon={Package} title="Ничего не найдено" text="Измените запрос или фильтр." />
      )}
    </div>
  )
}
