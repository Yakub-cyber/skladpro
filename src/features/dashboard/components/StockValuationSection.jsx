import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, PackageMinus } from 'lucide-react'
import { Section, Card } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { money, num, plural } from '@/shared/lib/format'

// «Оценка склада» — виджет по образцу CloudShop. Две плашки-внимания
// (себестоимость=0 / отрицательный остаток) с прямыми ссылками на
// проблемные товары; и две карточки-сводки (Общая + По магазину).
// «Магазин» — WAREHOUSES[1] если задан, иначе WAREHOUSES[0]. Все цифры
// считаются от products (без запросов к серверу).
export default function StockValuationSection({ products }) {
  const warehouses = useStore((s) => s.warehouses) || []
  const stockValuation = useMemo(() => {
    // Считаем только физические товары (не услуги/комплекты — у kit
    // остаток вычисляется на лету, у услуги остатка нет).
    const goods = products.filter((p) => (p.type || 'product') === 'product')
    const sum = (arr) => arr.reduce((a, p) => a + (Number(p.stock) || 0), 0)
    const sumMoney = (arr, k) =>
      arr.reduce((a, p) => a + (Number(p.stock) || 0) * (Number(p[k]) || 0), 0)
    const total = {
      qty: sum(goods),
      retail: sumMoney(goods, 'price'),
      cost: sumMoney(goods, 'cost'),
    }
    // «По магазину» — из seed по умолчанию у всех wh1, поэтому если есть
    // wh2 (магазин) — покажем и его, иначе просто повторим общий.
    const shop = warehouses[1] || warehouses[0] || null
    const inShop = shop ? goods.filter((p) => p.warehouseId === shop.id) : goods
    const perShop = shop
      ? {
          name: shop.name,
          qty: sum(inShop),
          retail: sumMoney(inShop, 'price'),
          cost: sumMoney(inShop, 'cost'),
        }
      : null
    return {
      total,
      perShop,
      warnCost0: goods.filter((p) => p.stock > 0 && !p.cost).length,
      warnNeg: goods.filter((p) => p.stock < 0).length,
    }
  }, [products, warehouses])

  const { total, perShop, warnCost0, warnNeg } = stockValuation

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <PackageMinus size={16} className="text-brand" /> Оценка склада
        </span>
      }
      subtitle={`Позиций в каталоге: ${num(products.length)}`}
    >
      <div className="space-y-3">
        {warnCost0 > 0 && (
          <div className="rounded-xl bg-warn-soft/50 border border-warn/30 px-4 py-3 flex items-center gap-3">
            <AlertTriangle size={18} className="text-warn shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[13px] text-warn">Внимание</div>
              <div className="text-[13px]">
                у {warnCost0} {plural(warnCost0, 'позиции', 'позиций', 'позиций')} себестоимость
                равна 0 ₽
              </div>
            </div>
            <Link
              to="/products?cost=0"
              className="text-[12px] px-3 h-8 rounded-lg bg-surface hover:bg-surface-2 border border-line grid place-items-center whitespace-nowrap"
            >
              Показать
            </Link>
          </div>
        )}
        {warnNeg > 0 && (
          <div className="rounded-xl bg-bad-soft/50 border border-bad/30 px-4 py-3 flex items-center gap-3">
            <AlertTriangle size={18} className="text-bad shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[13px] text-bad">Внимание</div>
              <div className="text-[13px]">
                у {warnNeg} {plural(warnNeg, 'позиции', 'позиций', 'позиций')} остаток меньше 0
              </div>
            </div>
            <Link
              to="/products?stockStatus=out"
              className="text-[12px] px-3 h-8 rounded-lg bg-surface hover:bg-surface-2 border border-line grid place-items-center whitespace-nowrap"
            >
              Показать
            </Link>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <ValuationCard title="Общая оценка" data={total} />
          {perShop && <ValuationCard title={`В магазине «${perShop.name}»`} data={perShop} />}
        </div>
      </div>
    </Section>
  )
}

function ValuationCard({ title, data }) {
  return (
    <Card className="p-4">
      <div className="font-semibold text-[14px] mb-3">{title}</div>
      <div className="space-y-3">
        <div>
          <div className="text-[11.5px] text-muted">Количество товара</div>
          <div className="text-xl font-bold tabular-nums">{num(data.qty)} ед.</div>
        </div>
        <div>
          <div className="text-[11.5px] text-muted">В розничных ценах</div>
          <div className="text-xl font-bold tabular-nums">{money(data.retail)}</div>
        </div>
        <div>
          <div className="text-[11.5px] text-muted">По себестоимости</div>
          <div className="text-xl font-bold tabular-nums text-muted">{money(data.cost)}</div>
        </div>
      </div>
    </Card>
  )
}
