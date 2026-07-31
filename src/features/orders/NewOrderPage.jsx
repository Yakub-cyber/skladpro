import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Search,
  X,
  ShoppingCart,
  Sparkles,
  Settings2,
} from 'lucide-react'
import { Card, Button, Badge, Modal, Empty, cx } from '@/shared/ui'
import DocPreviewModal from '@/shared/components/DocPreviewModal'
import { useStore } from '@/shared/store/useStore'
import { money, num } from '@/shared/lib/format'
import { CATEGORIES, priceFor } from '@/shared/lib/constants'
import { resolveScan } from '@/shared/lib/barcode'
import { reservedByProduct } from '@/shared/lib/orders'
import { geocodeAddress } from '@/shared/lib/geo'
import { computeKitStock } from '@/shared/lib/kit'
import { computeVatSummary } from '@/shared/lib/vat'
import { DEFAULT_POS, beep } from '@/features/orders/pos'
import SmartFind from '@/features/orders/components/SmartFind'
import ProductTile from '@/features/orders/components/ProductTile'
import CartBody from '@/features/orders/components/CartBody'
import PaymentModal from '@/features/orders/components/PaymentModal'
import AiInvoiceModal from '@/features/orders/components/AiInvoiceModal'
import PosSettingsModal from '@/features/orders/components/PosSettingsModal'
import ReceiptToast from '@/features/orders/components/ReceiptToast'
import MobileCartBar from '@/features/orders/components/MobileCartBar'
import Chip from '@/features/orders/components/Chip'

export default function NewOrder({ fullscreen = false }) {
  const nav = useNavigate()
  const { customers, products, priceTypes, addOrder, addCustomer, orders } = useStore()
  const defType = priceTypes.find((t) => t.default)?.id || priceTypes[0]?.id
  const reserved = useMemo(() => reservedByProduct(orders), [orders])
  // Для kit доступный остаток вычисляется по компонентам (свой stock у
  // комплекта не хранится), для остальных — обычный p.stock − резерв.
  const availOf = (p) => {
    if (p.type === 'kit') return computeKitStock(p, products)
    return (p.stock || 0) - (reserved[p.id] || 0)
  }

  const [customerId, setCustomerId] = useState('')
  const [priceTypeId, setPriceTypeId] = useState(defType)
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [onCredit, setOnCredit] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [msg, setMsg] = useState('')
  const [mobileCart, setMobileCart] = useState(false) // bottom-sheet чека
  const [payOpen, setPayOpen] = useState(false) // модалка выбора способа оплаты
  const [savedAt, setSavedAt] = useState(0) // время последнего автосейва (для UI-статуса)
  // Адрес доставки: раньше сохранялся только city клиента (плоско, без
  // геокода) — при построении маршрута в Delivery получали случайные
  // пины. Теперь адрес редактируемый, а на blur / debounce мы гоняем
  // Nominatim → сохраняем order.geo при создании.
  const [address, setAddress] = useState('')
  const [geo, setGeo] = useState(null) // { lat, lng, displayName } или null
  // ИИ-накладная прямо в кассе: юзер вставляет текст → aiParseInvoice
  // (LLM или локальный fallback) → выбирает позиции → они летят в чек.
  // Раньше требовалось уходить на /invoices; теперь весь цикл без смены
  // экрана.
  const [aiOpen, setAiOpen] = useState(false)
  // Галочка «Доставка»: по умолчанию выключена — касса пробивает
  // розничный чек (kind='retail', закрывается сразу). Включённая
  // превращает продажу в заказ с воронкой статусов (kind='order').
  const [asOrder, setAsOrder] = useState(false)
  // POS-режим: настройки оборудования + тост последнего чека.
  const [posOpen, setPosOpen] = useState(false)
  const [lastReceipt, setLastReceipt] = useState(null)
  const [printOrder, setPrintOrder] = useState(null)
  const settings = useStore((s) => s.settings) || {}
  const posSettings = settings.pos || DEFAULT_POS

  // ── Автосейв корзины ─────────────────────────────────────────────────
  // На /orders/new частая ситуация: кассир пробивает 100 позиций опт-клиенту,
  // случайно закрыл вкладку / зашёл в клиента / открыл другой заказ. Без
  // автосейва — всё с нуля. Сохраняем черновик в localStorage при каждом
  // изменении и восстанавливаем при возврате.
  // F2-8: раньше DRAFT_KEY был глобальным — если на одной машине
  // работают два кассира, второй восстанавливал черновик первого
  // (или наоборот, тёр). Теперь ключ привязан к authUserId. Если
  // пользователь не залогинен (маловероятно на /pos) — общий ключ.
  const authUserId = useStore((s) => s.authUserId)
  const DRAFT_KEY = 'sklad.newOrder.draft.' + (authUserId || 'guest')
  const DRAFT_TTL_MS = 6 * 60 * 60 * 1000 // 6 часов — типичная смена
  const restoredRef = useRef(false)
  // Восстановление один раз на mount. Если черновик просрочен — игнорируем.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (!raw) { restoredRef.current = true; return }
      const d = JSON.parse(raw)
      if (!d?.at || Date.now() - d.at > DRAFT_TTL_MS) {
        localStorage.removeItem(DRAFT_KEY)
        restoredRef.current = true
        return
      }
      if (d.customerId) setCustomerId(d.customerId)
      if (d.priceTypeId) setPriceTypeId(d.priceTypeId)
      if (Array.isArray(d.rows) && d.rows.length) setRows(d.rows)
      if (typeof d.discount === 'number') setDiscount(d.discount)
      if (typeof d.onCredit === 'boolean') setOnCredit(d.onCredit)
      setSavedAt(d.at)
    } catch {}
    restoredRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Сохранение при каждом изменении полей чека. Дебаунс 400мс, чтобы не
  // писать в localStorage на каждый keystroke qty.
  useEffect(() => {
    if (!restoredRef.current) return
    if (!rows.length && !customerId && !discount) {
      // Пустой чек — стираем черновик, чтобы «Очистить» не оставлял хвост.
      localStorage.removeItem(DRAFT_KEY)
      setSavedAt(0)
      return
    }
    const t = setTimeout(() => {
      try {
        const at = Date.now()
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          customerId, priceTypeId, rows, discount, onCredit, at,
        }))
        setSavedAt(at)
      } catch {}
    }, 400)
    return () => clearTimeout(t)
  }, [rows, customerId, priceTypeId, discount, onCredit])

  const isCreditType = (id) =>
    priceTypes.find((t) => t.id === id)?.name.toLowerCase().includes('долг')

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return products.filter((p) => {
      const okC = cat === 'all' || p.category === cat
      const okQ =
        !s ||
        p.name.toLowerCase().includes(s) ||
        p.sku.toLowerCase().includes(s) ||
        p.tags?.some((t) => t.includes(s))
      return okC && okQ
    })
  }, [products, q, cat])

  const round3 = (n) => Math.round(n * 1000) / 1000

  const add = (p, qty = 1) => {
    setMsg('')
    const inCart = rows.find((x) => x.productId === p.id)?.qty || 0
    if (inCart + qty > availOf(p)) {
      setMsg(
        `«${p.name}»: доступно ${num(Math.max(0, availOf(p)))} ${p.unit} (остальное в резерве) — заказ всё равно можно оформить`,
      )
    }
    setRows((r) =>
      r.find((x) => x.productId === p.id)
        ? r.map((x) => (x.productId === p.id ? { ...x, qty: round3(x.qty + qty) } : x))
        : [
            ...r,
            {
              productId: p.id,
              name: p.name,
              qty,
              price: priceFor(p, priceTypeId),
              basePrice: priceFor(p, priceTypeId), // база — для показа скидки в строке
              unit: p.unit,
              cell: p.cell,
              weighted: p.weighted,
            },
          ],
    )
  }

  const setQty = (id, qty) =>
    setRows((r) =>
      qty <= 0
        ? r.filter((x) => x.productId !== id)
        : r.map((x) => (x.productId === id ? { ...x, qty } : x)),
    )
  // Персональная цена для строки — оптовику критично: клиент N торгуется,
  // цена меняется прямо в чеке. Сохраняем базовую (basePrice) — по ней
  // считаем скидку и показываем «зачёркнутую» когда цена ниже.
  const setPrice = (id, price) =>
    setRows((r) =>
      r.map((x) =>
        x.productId === id ? { ...x, price: Math.max(0, Number(price) || 0) } : x,
      ),
    )

  const selectCustomer = (id) => {
    setCustomerId(id)
    const c = customers.find((x) => x.id === id)
    if (c?.priceTypeId) changeType(c.priceTypeId)
    // Префилл адреса из клиента: сначала сохранённый address, иначе city.
    // Юзер может тут же отредактировать в поле «Адрес доставки».
    if (c?.address) setAddress(c.address)
    else if (c?.city) setAddress(c.city)
    setGeo(null) // адрес поменялся — сбрасываем гео, догеокодим в effect
  }
  // Debounce геокодинга: как только адрес перестал меняться на 800 мс,
  // спрашиваем Nominatim и сохраняем { lat, lng } — они уедут в
  // order.geo при создании заказа (см. finalSubmit → addOrder).
  useEffect(() => {
    const q = (address || '').trim()
    if (q.length < 4) {
      setGeo(null)
      return
    }
    const t = setTimeout(async () => {
      const hit = await geocodeAddress(q)
      if (hit) setGeo(hit)
    }, 800)
    return () => clearTimeout(t)
  }, [address])
  const changeType = (ptId) => {
    setPriceTypeId(ptId)
    setOnCredit(isCreditType(ptId))
    setRows((rr) =>
      rr.map((x) => {
        const p = products.find((pp) => pp.id === x.productId)
        if (!p) return x
        const newBase = priceFor(p, ptId)
        return { ...x, price: newBase, basePrice: newBase }
      }),
    )
  }
  // Создание клиента inline. addCustomer в сторе не возвращает id — берём
  // свежесозданный из состояния (он всегда в начале списка).
  const createCustomer = (data) => {
    addCustomer(data)
    const fresh = useStore.getState().customers[0]
    return fresh?.id
  }

  const onScan = (code) => {
    const r = resolveScan(code, products)
    if (!r) {
      setMsg(`Штрихкод «${code}» не найден`)
      return
    }
    if (posSettings.scanSound) beep()
    add(r.product, r.weighed ? r.weightKg : 1)
  }

  const subtotal = rows.reduce((a, r) => a + r.qty * r.price, 0)
  // C3: НДС по позициям. rows содержат productId — берём ставку из
  // каталога (product.vatRate или fallback компании). Показываем в
  // «Итого · в т.ч. НДС X ₽» и сохраняем в order.vatSummary.
  const vatSummary = useMemo(
    () => computeVatSummary(rows, products, settings),
    [rows, products, settings],
  )
  const total = Math.round(subtotal * (1 - (Number(discount) || 0) / 100))
  const count = rows.reduce((a, r) => a + r.qty, 0)
  const rowsById = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.productId, r])),
    [rows],
  )

  // Клик по «Оплатить» открывает экран выбора способа оплаты.
  // Клавиша F9 (см. useEffect ниже) делает то же самое.
  const openPay = () => {
    if (!rows.length) return
    setPayOpen(true)
  }

  // Финальное оформление после выбора способа оплаты в PaymentModal.
  // payment: { method: 'cash'|'card'|'credit'|'mixed', cashPaid, cardPaid, change }
  const finalSubmit = (payment) => {
    const cust = customers.find((c) => c.id === customerId)
    const r = addOrder({
      // Без галочки «Доставка» — обычный розничный чек: закрывается
      // сразу, товар физически ушёл, воронка статусов не нужна.
      // С галочкой — заказ с доставкой, идёт по воронке.
      kind: asOrder ? 'order' : 'retail',
      customerId: cust?.id || 'retail',
      customerName: cust?.name || 'Розничный покупатель',
      items: rows,
      subtotal,
      discount: Number(discount) || 0,
      total,
      priceTypeId,
      // Долг — теперь производная от способа оплаты (для обратной совместимости
      // с существующей логикой резервов/долгов клиента в сторе).
      onCredit: payment.method === 'credit',
      payment,
      // C3: сохраняем разбивку НДС на момент продажи, чтобы отчёты и
      // печать чека не зависели от последующего изменения product.vatRate.
      vatSummary,
      address: address || cust?.city || 'Самовывоз',
      // Гео из Nominatim, чтобы Delivery.jsx нарисовал пин на реальном
      // месте, а не в хешированной точке рядом с центром города.
      geo: geo ? { lat: geo.lat, lng: geo.lng } : undefined,
      courier: 'Самовывоз',
    })
    if (r && r.ok === false) {
      // B5 сработал: сумма оплаты меньше total (или другая валидация).
      // PaymentModal остаётся открытым — покажем алерт.
      alert(r.error || 'Не удалось провести чек')
      return
    }
    const fresh = useStore.getState().orders[0]
    // Заказ создан — черновик больше не нужен, чтобы возврат на /orders/new
    // не восстанавливал уже проведённый чек.
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
    setPayOpen(false)
    setMobileCart(false)
    // В fullscreen (окно кассира) остаёмся на месте — кассир пробивает
    // чеки один за другим и не должен «улетать» в админку. Показываем
    // короткий тост с номером чека и чистим корзину.
    if (fullscreen) {
      setRows([])
      setDiscount(0)
      setCustomerId('')
      setAddress('')
      setGeo(null)
      setAsOrder(false)
      setLastReceipt(fresh)
      if (posSettings.autoPrint) setPrintOrder(fresh)
      setTimeout(() => setLastReceipt(null), 6000)
      return
    }
    nav(`/orders?id=${fresh.id}`)
  }

  // Клавиатурные хоткеи кассы:
  //   F9  → открыть экран оплаты (стандарт 1С/Frontol)
  //   /   → сфокусировать SmartFind (только если фокус не в поле)
  useEffect(() => {
    const onKey = (e) => {
      if (payOpen) return // модалка сама обрабатывает Enter/Esc
      if (e.key === 'F9') {
        e.preventDefault()
        openPay()
      }
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault()
        document.querySelector('input[placeholder^="Поиск товара"]')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payOpen, rows.length])

  const cartProps = {
    rows,
    count,
    subtotal,
    total,
    discount,
    setDiscount,
    customerId,
    customers,
    onPickCustomer: selectCustomer,
    onAddCustomer: createCustomer,
    priceTypeId,
    priceTypes,
    onChangeType: changeType,
    onSetQty: setQty,
    onSetPrice: setPrice,
    onSubmit: openPay,
    round3,
    address,
    setAddress,
    asOrder,
    setAsOrder,
    vatSummary,
    geoStatus: geo
      ? 'found'
      : address.trim().length >= 4
        ? 'searching'
        : 'idle',
  }

  // Fullscreen-режим = отдельное окно (`/pos`), Layout вокруг не рисуется.
  // Даём странице заполнить всё окно и добавляем padding+фон, которых
  // обычно давал Layout.jsx (main.p-4 lg:p-6).
  const outerCls = fullscreen
    ? 'animate-fadeUp p-4 lg:p-6 max-w-[1400px] w-full mx-auto min-h-screen bg-bg'
    : 'animate-fadeUp pb-24 lg:pb-0'

  // «Назад» — если окно открыто как терминал (fullscreen), логичнее его
  // закрыть, а не тащить внутрь /orders. Если window.close() блокируется
  // (окно открыто не через window.open) — фолбэк на переход в /orders.
  const goBack = () => {
    if (fullscreen) {
      try {
        window.close()
        // Задержка на случай блокировки — если окно ещё открыто, идём в /orders
        setTimeout(() => nav('/orders'), 200)
      } catch {
        nav('/orders')
      }
    } else {
      nav('/orders')
    }
  }

  return (
    <div className={outerCls}>
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="icon" icon={fullscreen ? X : ArrowLeft} onClick={goBack} title={fullscreen ? 'Закрыть кассу' : 'К заказам'} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold tracking-tight">
            {fullscreen ? 'Касса' : 'Новый заказ'}
          </h2>
          <p className="text-sm text-muted hidden sm:block">
            {fullscreen
              ? 'Ищите или сканируйте товар — он попадёт в чек. F9 — оплата.'
              : 'Касса: ищите или сканируйте товар — он попадёт в чек.'}
          </p>
        </div>
        {savedAt > 0 && rows.length > 0 && (
          <span
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md bg-ok-soft text-ok text-[11.5px] font-semibold"
            title={`Черновик сохранён ${new Date(savedAt).toLocaleTimeString('ru-RU')}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-ok" />
            Черновик сохранён
          </span>
        )}
        <Button
          variant="soft"
          icon={Sparkles}
          onClick={() => setAiOpen(true)}
          title="Распознать накладную из текста"
        >
          <span className="hidden sm:inline">ИИ-накладная</span>
        </Button>
        {fullscreen && (
          <Button
            variant="soft"
            size="icon"
            icon={Settings2}
            onClick={() => setPosOpen(true)}
            title="Настройки оборудования"
          />
        )}
      </div>

      {lastReceipt && (
        <ReceiptToast
          receipt={lastReceipt}
          onPrint={() => setPrintOrder(lastReceipt)}
          onDismiss={() => setLastReceipt(null)}
        />
      )}

      <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
        {/* Каталог */}
        <div className="space-y-4 min-w-0">
          <SmartFind
            query={q}
            setQuery={setQ}
            onScan={onScan}
            msg={msg}
            scanMode={posSettings.scanMode}
          />

          <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
            <Chip active={cat === 'all'} onClick={() => setCat('all')}>Все</Chip>
            {CATEGORIES.map((c) => (
              <Chip key={c.key} active={cat === c.key} onClick={() => setCat(c.key)}>
                {c.key}
              </Chip>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {list.map((p) => (
              <ProductTile
                key={p.id}
                p={p}
                availOf={availOf}
                priceTypeId={priceTypeId}
                row={rowsById[p.id]}
                onAdd={add}
                onSetQty={setQty}
                round3={round3}
              />
            ))}
          </div>
          {list.length === 0 && <Empty icon={Search} title="Ничего не найдено" />}
        </div>

        {/* Чек — desktop sticky sidebar */}
        <Card className="hidden lg:flex p-4 lg:sticky lg:top-20 flex-col max-h-[calc(100dvh-6rem)]">
          <div className="flex items-center gap-2 mb-3">
            <ShoppingCart size={18} className="text-brand" />
            <h3 className="font-semibold">Чек</h3>
            {count > 0 && <Badge tone="brand" className="ml-auto">{num(count)}</Badge>}
          </div>
          <CartBody {...cartProps} />
        </Card>
      </div>

      <MobileCartBar
        rows={rows}
        count={count}
        total={total}
        onOpen={() => setMobileCart(true)}
      />

      <Modal
        open={mobileCart}
        onClose={() => setMobileCart(false)}
        title={
          <span className="flex items-center gap-2">
            <ShoppingCart size={16} className="text-brand" />
            Чек {count > 0 && <Badge tone="brand">{num(count)}</Badge>}
          </span>
        }
      >
        <CartBody {...cartProps} compact />
      </Modal>

      {/* Экран выбора способа оплаты — открывается по клику «Оплатить» или F9.
          Управляет всей логикой оплаты (кроме создания заказа) внутри себя,
          а на подтверждение вызывает finalSubmit(payment). */}
      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        total={total}
        onConfirm={finalSubmit}
      />

      {/* Модалка «ИИ-накладная»: вставил текст → распознал → добавил
          выбранные позиции в чек. LLM-режим включается автоматически,
          если в Настройках задан ProxyAPI-ключ; иначе — локальный парсер. */}
      <AiInvoiceModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        products={products}
        onAdd={(items) => {
          items.forEach((it) => {
            const p = products.find((x) => x.id === it.productId)
            if (p) add(p, it.qty)
          })
          setAiOpen(false)
        }}
      />

      {/* Настройки кассового оборудования — только в POS-окне. */}
      {posOpen && <PosSettingsModal onClose={() => setPosOpen(false)} />}

      {/* Печать чека: тот же движок, что и в /orders (шаблон 'sale'). */}
      {printOrder && (
        <DocPreviewModal
          doc={printOrder}
          category="sale"
          onClose={() => setPrintOrder(null)}
        />
      )}
    </div>
  )
}
