import { useMemo, useState } from 'react'
import {
  Plus,
  Phone,
  MapPin,
  Truck,
  Sparkles,
  PackageMinus,
  FileDown,
  Check,
} from 'lucide-react'
import {
  Card,
  Section,
  Button,
  Badge,
  Modal,
  Field,
  Input,
  Avatar,
} from '../components/ui'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'
import { reservedByProduct, availableStock } from '../lib/orders'

// Подбор поставщика под категорию товара
function supplierFor(category, suppliers) {
  const map = {
    Крепёж: 'Крепёж',
    Инструмент: 'Инструмент',
    Электрика: 'Электрика',
    Сантехника: 'Сантехника',
    ЛКМ: 'ЛКМ',
    Расходники: 'Расход',
  }
  const needle = map[category] || category
  return suppliers.find((s) => s.category.includes(needle)) || suppliers[0]
}

export default function Suppliers() {
  const { suppliers, products, orders, addInvoice, addSupplier } = useStore()
  const [adding, setAdding] = useState(false)
  const [done, setDone] = useState(null)

  // Рекомендованные закупки: всё ниже минимума по ДОСТУПНОМУ (остаток − резерв
  // открытых заказов), сгруппировано по поставщику. Зарезервированное вот-вот
  // отгрузится, поэтому заявка формируется вовремя и на нужное количество.
  const purchaseGroups = useMemo(() => {
    const reserved = reservedByProduct(orders)
    const low = products.filter((p) => availableStock(p, reserved) <= p.minStock)
    const groups = {}
    for (const p of low) {
      const sup = supplierFor(p.category, suppliers)
      ;(groups[sup.id] ||= { supplier: sup, items: [] }).items.push({
        productId: p.id,
        name: p.name,
        unit: p.unit,
        qty: Math.max(1, Math.ceil(p.minStock * 2 - availableStock(p, reserved))),
        price: p.cost,
      })
    }
    return Object.values(groups)
  }, [products, suppliers, orders])

  const createPO = (group) => {
    const total = group.items.reduce((a, it) => a + it.qty * it.price, 0)
    addInvoice({
      kind: 'in',
      party: group.supplier.name,
      partyId: group.supplier.id,
      items: group.items,
      total,
      source: 'Авто-заявка по низким остаткам',
    })
    setDone(group.supplier.id)
    setTimeout(() => setDone(null), 2500)
  }

  return (
    <div className="animate-fadeUp space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Поставщики и закупки</h2>
          <p className="text-sm text-muted">{suppliers.length} поставщиков</p>
        </div>
        <Button icon={Plus} onClick={() => setAdding(true)}>
          Добавить
        </Button>
      </div>

      {/* Рекомендованные закупки */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={16} className="text-brand" /> Рекомендованные закупки
          </span>
        }
        subtitle="ИИ собрал заявки по позициям ниже минимума"
      >
        {purchaseGroups.length === 0 ? (
          <p className="text-sm text-muted py-3 flex items-center gap-2">
            <Check size={16} className="text-ok" /> Все остатки в норме — закупки не требуются.
          </p>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {purchaseGroups.map((g) => {
              const total = g.items.reduce((a, it) => a + it.qty * it.price, 0)
              return (
                <div key={g.supplier.id} className="rounded-xl border border-line p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-8 w-8 rounded-lg bg-warn-soft text-warn grid place-items-center">
                      <PackageMinus size={16} />
                    </div>
                    <div>
                      <div className="font-medium text-sm">{g.supplier.name}</div>
                      <div className="text-[12px] text-muted">{g.supplier.category}</div>
                    </div>
                    <Badge tone="warn" className="ml-auto">
                      {g.items.length} поз.
                    </Badge>
                  </div>
                  <div className="space-y-1 mb-3">
                    {g.items.slice(0, 4).map((it) => (
                      <div key={it.productId} className="flex justify-between text-[13px]">
                        <span className="truncate pr-2 text-muted">{it.name}</span>
                        <span className="tabular-nums shrink-0">
                          +{num(it.qty)} {it.unit}
                        </span>
                      </div>
                    ))}
                    {g.items.length > 4 && (
                      <div className="text-[12px] text-muted">и ещё {g.items.length - 4}…</div>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-line">
                    <span className="text-sm">
                      ~<b className="tabular-nums">{money(total)}</b>
                    </span>
                    <Button
                      size="sm"
                      icon={done === g.supplier.id ? Check : FileDown}
                      variant={done === g.supplier.id ? 'soft' : 'primary'}
                      onClick={() => createPO(g)}
                    >
                      {done === g.supplier.id ? 'Заявка создана' : 'Создать заявку'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* Поставщики */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {suppliers.map((s) => (
          <Card key={s.id} className="p-4">
            <div className="flex items-center gap-3">
              <Avatar name={s.name} color="#38bdf8" />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{s.name}</div>
                <Badge tone="info" className="mt-1">
                  <Truck size={11} /> {s.category}
                </Badge>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-line space-y-1.5 text-[13px] text-muted">
              <a href={`tel:${s.phone}`} className="flex items-center gap-2 hover:text-brand">
                <Phone size={13} /> {s.phone}
              </a>
              <div className="flex items-center gap-2">
                <MapPin size={13} /> {s.city}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <AddSupplierModal open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}

function AddSupplierModal({ open, onClose }) {
  const addSupplier = useStore((s) => s.addSupplier)
  const [f, setF] = useState({ name: '', category: '', phone: '', city: '' })
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))
  const save = () => {
    if (!f.name) return
    addSupplier(f)
    setF({ name: '', category: '', phone: '', city: '' })
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новый поставщик"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={save} disabled={!f.name}>
            Добавить
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Название">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Категория">
          <Input
            value={f.category}
            onChange={(e) => set('category', e.target.value)}
            placeholder="Крепёж, Инструмент…"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Телефон">
            <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Город">
            <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
