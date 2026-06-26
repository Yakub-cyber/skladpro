import { useEffect, useMemo, useState } from 'react'
import {
  Truck,
  MapPin,
  Phone,
  Check,
  Clock,
  Navigation,
  Printer,
  Flag,
  Route as RouteIcon,
  Package,
} from 'lucide-react'
import { Card, Button, Badge, StatusBadge, Empty, cx } from '../components/ui'
import DeliveryMapLeaflet from '../components/DeliveryMapLeaflet'
import { useStore } from '../store/useStore'
import { money, num } from '../lib/format'
import { buildDeliveryRoute, geoLatLng, DEPOT, fetchOsrmRoute, fmtDuration } from '../lib/geo'

const TRUCKS = ['Газель А231 РТ', 'Газель В784 КX', 'Бортовой КамАЗ Е512', 'Каблук С310 АН']
const DELIVERABLE = ['new', 'confirmed', 'picking', 'packed', 'shipped']

export default function Delivery() {
  const { orders, customers, setOrderStatus } = useStore()
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [inited, setInited] = useState(false)
  const [truck, setTruck] = useState(TRUCKS[0])
  const [osrm, setOsrm] = useState(null) // реальный маршрут по дорогам
  const [loadingRoute, setLoadingRoute] = useState(false)

  const candidates = useMemo(
    () =>
      orders.filter(
        (o) => DELIVERABLE.includes(o.status) && o.courier !== 'Самовывоз',
      ),
    [orders],
  )

  useEffect(() => {
    if (!inited && candidates.length) {
      setSelectedIds(new Set(candidates.slice(0, 8).map((o) => o.id)))
      setInited(true)
    }
  }, [candidates, inited])

  const selectedOrders = candidates.filter((o) => selectedIds.has(o.id))
  const route = useMemo(
    () => buildDeliveryRoute(selectedOrders.map((o) => geoLatLng(o))),
    [selectedOrders],
  )
  const orderedStops = route.order.map((i) => selectedOrders[i])
  const totalSum = selectedOrders.reduce((a, o) => a + o.total, 0)

  // точки для карты (в порядке объезда)
  const stops = orderedStops.map((o, i) => ({
    ...geoLatLng(o),
    id: o.id,
    n: i + 1,
    title: o.customerName,
    label: o.address,
    priority: o.priority,
  }))

  // запрос реального маршрута по дорогам (OSRM) при изменении набора точек
  const stopKey = orderedStops.map((o) => o.id).join(',')
  useEffect(() => {
    let cancelled = false
    if (!orderedStops.length) {
      setOsrm(null)
      return
    }
    setLoadingRoute(true)
    const wpts = [DEPOT, ...stops, DEPOT]
    fetchOsrmRoute(wpts).then((r) => {
      if (!cancelled) {
        setOsrm(r)
        setLoadingRoute(false)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopKey])

  const distKm = osrm?.km ?? route.distanceKm
  const durMin = osrm?.min ?? route.minutes

  const toggle = (id) =>
    setSelectedIds((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const phoneOf = (o) => customers.find((c) => c.id === o.customerId)?.phone

  return (
    <div className="animate-fadeUp">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            Доставка
            <Badge tone="brand">
              <Navigation size={12} /> маршрут
            </Badge>
          </h2>
          <p className="text-sm text-muted">
            Отметьте заказы на развоз — построим короткий объезд от склада и обратно.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
        {/* Выбор заказов */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Заказы к доставке</h3>
            <button
              onClick={() =>
                setSelectedIds((s) =>
                  s.size === candidates.length
                    ? new Set()
                    : new Set(candidates.map((o) => o.id)),
                )
              }
              className="text-[12px] text-brand font-medium"
            >
              {selectedIds.size === candidates.length ? 'Снять все' : 'Выбрать все'}
            </button>
          </div>

          <div className="space-y-2 max-h-[58vh] overflow-y-auto no-scrollbar">
            {candidates.map((o) => {
              const on = selectedIds.has(o.id)
              return (
                <button
                  key={o.id}
                  onClick={() => toggle(o.id)}
                  className={cx(
                    'w-full text-left p-3 rounded-xl border transition flex gap-3 items-start',
                    on ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand/40',
                  )}
                >
                  <span
                    className={cx(
                      'h-5 w-5 rounded-md grid place-items-center shrink-0 mt-0.5 border',
                      on ? 'bg-brand border-brand text-brand-ink' : 'border-line',
                    )}
                  >
                    {on && <Check size={13} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm tabular-nums flex items-center gap-1.5">
                        {o.priority && <Flag size={12} className="text-bad" />}
                        {o.no}
                      </span>
                      <StatusBadge status={o.status} />
                    </div>
                    <div className="text-[13px] mt-0.5 truncate">{o.customerName}</div>
                    <div className="text-[12px] text-muted flex items-center gap-1 mt-0.5">
                      <MapPin size={11} /> {o.address}
                    </div>
                  </div>
                </button>
              )
            })}
            {candidates.length === 0 && (
              <Empty icon={Package} title="Нет заказов к доставке" text="Соберите заказы — и они появятся здесь." />
            )}
          </div>
        </Card>

        {/* Карта + маршрут */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <RouteIcon size={17} className="text-brand" /> Оптимальный маршрут
              </h3>
              <div className="flex items-center gap-2">
                <select
                  value={truck}
                  onChange={(e) => setTruck(e.target.value)}
                  className="h-9 px-2.5 rounded-lg bg-surface-2 border border-line text-[13px] outline-none focus:border-brand"
                >
                  {TRUCKS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="soft"
                  icon={Printer}
                  disabled={!orderedStops.length}
                  onClick={() => printRoute(truck, orderedStops, { ...route, distanceKm: distKm }, phoneOf)}
                >
                  Лист водителя
                </Button>
              </div>
            </div>

            {selectedOrders.length === 0 ? (
              <Empty icon={Navigation} title="Выберите заказы слева" text="Маршрут построится автоматически." />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <Mini icon={MapPin} label="Точек" value={num(selectedOrders.length)} />
                  <Mini
                    icon={Navigation}
                    label={osrm ? 'Путь по дорогам' : 'Путь (оценка)'}
                    value={loadingRoute ? '…' : `${distKm} км`}
                  />
                  <Mini icon={Clock} label="В пути" value={loadingRoute ? '…' : fmtDuration(durMin)} />
                </div>
                <DeliveryMapLeaflet
                  depot={DEPOT}
                  stops={stops}
                  line={osrm?.line}
                  className="h-[440px] rounded-xl overflow-hidden border border-line"
                />
                <div className="mt-2 text-[12px] text-muted flex items-center gap-1.5">
                  <span className={cx('w-2 h-2 rounded-full', osrm ? 'bg-ok' : 'bg-warn')} />
                  {loadingRoute
                    ? 'Строим маршрут по дорогам…'
                    : osrm
                      ? 'Реальный маршрут по дорогам (OSRM) на карте OpenStreetMap'
                      : 'Прямые линии (сервис маршрутизации недоступен)'}
                </div>
              </>
            )}
          </Card>

          {/* Список точек по порядку */}
          {orderedStops.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Порядок объезда</h3>
                <span className="text-[12px] text-muted">
                  Итого к выдаче: <b className="text-ink">{money(totalSum)}</b>
                </span>
              </div>
              <div className="space-y-2">
                {orderedStops.map((o, i) => {
                  const phone = phoneOf(o)
                  return (
                    <div
                      key={o.id}
                      className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-2"
                    >
                      <span className="h-7 w-7 shrink-0 rounded-full bg-brand text-brand-ink text-[13px] font-semibold grid place-items-center">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate flex items-center gap-1.5">
                          {o.customerName}
                          {o.priority && <Flag size={12} className="text-bad" />}
                        </div>
                        <div className="text-[12px] text-muted truncate flex items-center gap-1">
                          <MapPin size={11} /> {o.address} · {o.no}
                        </div>
                      </div>
                      <div className="text-right shrink-0 hidden sm:block">
                        <div className="text-sm font-medium tabular-nums">{money(o.total)}</div>
                        <div className="text-[11px] text-muted">~{route.legs[i]} км</div>
                      </div>
                      {phone && (
                        <a
                          href={`tel:${phone}`}
                          className="h-8 w-8 grid place-items-center rounded-lg bg-surface-3 text-muted hover:text-brand shrink-0"
                          title={phone}
                        >
                          <Phone size={15} />
                        </a>
                      )}
                      <Button
                        size="sm"
                        icon={Check}
                        onClick={() => setOrderStatus(o.id, 'delivered')}
                      >
                        Доставлен
                      </Button>
                    </div>
                  )
                })}
                <div className="flex items-center gap-3 p-2.5 rounded-xl bg-ok-soft text-ok">
                  <span className="h-7 w-7 shrink-0 rounded-full bg-ok text-white grid place-items-center">
                    <Truck size={15} />
                  </span>
                  <span className="text-sm font-medium">
                    Возврат на склад · всего {distKm} км, {fmtDuration(durMin)}
                  </span>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Mini({ icon: Icon, label, value }) {
  return (
    <div className="p-3 rounded-xl bg-surface-2 text-center">
      <Icon size={16} className="text-brand mx-auto mb-1" />
      <div className="text-[15px] font-semibold leading-none">{value}</div>
      <div className="text-[11px] text-muted mt-1">{label}</div>
    </div>
  )
}

function printRoute(truck, stops, route, phoneOf) {
  const rows = stops
    .map(
      (o, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${esc(o.customerName)}<div class="m">${esc(o.no)}</div></td>
      <td>${esc(o.address)}</td>
      <td>${esc(phoneOf(o) || '')}</td>
      <td class="r">${num(o.total)} ₽</td>
      <td class="r">~${route.legs[i]} км</td>
      <td class="sign"></td>
    </tr>`,
    )
    .join('')
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Маршрутный лист</title>
  <style>
    *{font-family:Arial,sans-serif}body{margin:0;padding:28px;color:#111;font-size:13px}
    h1{font-size:18px;margin:0}.muted{color:#666}.m{color:#888;font-size:11px}
    .head{border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px;display:flex;justify-content:space-between}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:7px 8px;text-align:left;vertical-align:top}
    th{background:#f0f0f0;font-size:12px}td.c,th.c{text-align:center}td.r,th.r{text-align:right}
    .sign{width:90px}.tot{margin-top:12px;font-weight:bold;text-align:right}
    @media print{body{padding:0}}
  </style></head><body>
  <div class="head"><div><h1>Маршрутный лист доставки</h1>
  <div class="muted">${new Date().toLocaleDateString('ru-RU')} · ${stops.length} точек · ${route.distanceKm} км</div></div>
  <div style="text-align:right"><b>Машина:</b> ${esc(truck)}<br><span class="muted">Водитель: _____________</span></div></div>
  <table><thead><tr><th class="c">№</th><th>Клиент</th><th>Адрес</th><th>Телефон</th><th class="r">Сумма</th><th class="r">Плечо</th><th>Подпись</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <div class="tot">Итого к выдаче: ${num(stops.reduce((a, o) => a + o.total, 0))} ₽</div>
  <script>window.onload=()=>window.print()</script></body></html>`
  const w = window.open('', '_blank', 'width=900,height=900')
  if (w) {
    w.document.write(html)
    w.document.close()
  }
}

const esc = (s = '') =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
