// ──────────────────────────────────────────────────────────────────────────
//  Ядро системы печати SkladPro.
//
//  ЧТО ЗДЕСЬ:
//    - printFrame({ title, bodyHtml }) — единая функция «открыть окно и
//      напечатать». Заменяет 6 разрозненных копий одного и того же паттерна
//      (window.open + document.write + <script>window.print</script>) по
//      странице.
//    - ctxFromStore(state, doc) — собирает вспомогательный контекст для
//      шаблонов: реквизиты компании, клиент/поставщик, счёт, сотрудник —
//      резолвит id-шки, лежащие в документе, в реальные объекты.
//    - TEMPLATES / renderTemplate — диспетчер: по типу документа возвращает
//      готовый HTML одного из шаблонов.
//
//  ЧЕГО ЗДЕСЬ НЕТ:
//    - Самих шаблонов (они в lib/templates/*.js) — только реестр и рендер.
//    - PDF-экспорта — только браузерный «Сохранить как PDF» из
//      системного диалога.
//    - UI — модалка предпросмотра в components/DocPreviewModal.jsx.
// ──────────────────────────────────────────────────────────────────────────
import { PRINT_CSS } from './print'
import * as sale from './templates/sale'
import * as refund from './templates/refund'
import * as purchase from './templates/purchase'
import * as purchaseOrder from './templates/purchaseOrder'
import * as cash from './templates/cash'
import * as stock from './templates/stock'

/**
 * Открыть окно печати с готовым HTML. Возвращает открытое окно (или null,
 * если браузер заблокировал попап или мы в тестовом окружении).
 * Автоматически подставляет <!doctype>, <head> с общим CSS и авто-триггер
 * window.print() после загрузки.
 */
export function printFrame({ title = 'Документ', bodyHtml = '', extraCss = '' } = {}) {
  if (typeof window === 'undefined' || !window.open) return null
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escTitle(title)}</title>
<style>${PRINT_CSS}${extraCss}</style></head><body>${bodyHtml}
<script>window.onload=()=>window.print()</script></body></html>`
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (w) {
    w.document.write(html)
    w.document.close()
  }
  return w
}

// Простая экранизация <title> — там не нужен полный HTML-esc, только < & >.
function escTitle(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])
}

/**
 * Собрать контекст для шаблона. Принимает state целиком (`useStore.getState()`)
 * и документ (любого из 4 типов); возвращает объект, из которого шаблон
 * достаёт реквизиты, клиента, поставщика, счёт.
 *
 * @param {object} state
 * @param {object} doc — может быть order | document | purchaseOrder | moneyTx
 * @returns {{ settings, requisites, company, currency, customer, supplier, account, employee, override }}
 */
export function ctxFromStore(state = {}, doc = {}, override = {}) {
  const settings = state.settings || {}
  const requisites = { ...(settings.requisites || {}), ...(override.requisites || {}) }
  // Клиент: сначала customerId, потом customerName (для старых заказов).
  const customer =
    (doc.customerId && (state.customers || []).find((c) => c.id === doc.customerId)) ||
    (doc.customerName ? { name: doc.customerName } : null)
  const supplier =
    (doc.supplierId && (state.suppliers || []).find((s) => s.id === doc.supplierId)) ||
    (doc.supplierName ? { name: doc.supplierName } : null)
  const account =
    (doc.accountId && (state.accounts || []).find((a) => a.id === doc.accountId)) || null
  const toAccount =
    (doc.toAccountId && (state.accounts || []).find((a) => a.id === doc.toAccountId)) || null
  const employee =
    (doc.by && (state.employees || []).find((e) => e.id === doc.by)) || null
  return {
    settings,
    requisites,
    company: requisites.name || settings.company || 'Организация',
    currency: settings.currency || '₽',
    customer,
    supplier,
    account,
    toAccount,
    employee,
    override,
  }
}

/**
 * Реестр шаблонов. Ключ — категория документа, значение — массив шаблонов
 * с ключом (для селектора «Шаблон» в DocPreviewModal) и рендер-функцией
 * (doc, ctx) → htmlString.
 *
 * Категории (documentCategory):
 *   'sale'          — order или documents.type='sale'
 *   'purchase'      — documents.type='purchase' или 'stockin'
 *   'sale_return', 'supplier_return', 'transfer', 'writeoff', 'inventory'
 *                   — обобщённый stock-шаблон
 *   'purchaseOrder' — заказ поставщику
 *   'moneyIn'       — moneyTx.type='in'   → КО-1
 *   'moneyOut'      — moneyTx.type='out'  → КО-2
 *   'moneyTransfer' — moneyTx.type='transfer' → простая справка
 */
export const TEMPLATES = {
  sale: [
    { key: 'bill', label: 'Счёт на оплату', render: sale.bill },
    { key: 'torg12', label: 'ТОРГ-12', render: sale.torg12 },
    { key: 'upd', label: 'УПД (счёт-фактура)', render: sale.upd },
    { key: 'cheque', label: 'Товарный чек', render: sale.cheque },
    { key: 'waybill', label: 'Ярлык доставки', render: sale.waybill },
  ],
  // F1-3: возврат по чеку — свой шаблон «Возврат по чеку №…»
  // с ссылкой на оригинал (doc.origOrderId) и причиной. Раньше refund
  // печатался как обычный товарный чек с плюсовыми суммами → путаница.
  refund: [
    { key: 'cheque', label: 'Чек возврата', render: refund.refundCheque },
  ],
  purchase: [
    { key: 'receiveAct', label: 'Приёмный акт', render: purchase.receiveAct },
    { key: 'm4', label: 'Приходный ордер (М-4)', render: purchase.m4 },
  ],
  purchaseOrder: [
    { key: 'poRequest', label: 'Заявка поставщику', render: purchaseOrder.poRequest },
  ],
  moneyIn: [{ key: 'ko1', label: 'Приходный ордер (КО-1)', render: cash.ko1 }],
  moneyOut: [{ key: 'ko2', label: 'Расходный ордер (КО-2)', render: cash.ko2 }],
  moneyTransfer: [{ key: 'transferSlip', label: 'Справка о переводе', render: cash.transferSlip }],
  stock: [{ key: 'docPrint', label: 'Складской документ', render: stock.docPrint }],
}

/**
 * Определить категорию документа для DocPreviewModal.
 * Не читает store — принимает уже разрешённый объект.
 */
export function detectCategory(doc = {}) {
  // moneyTx
  if (doc.type === 'in' && 'accountId' in doc) return 'moneyIn'
  if (doc.type === 'out' && 'accountId' in doc) return 'moneyOut'
  if (doc.type === 'transfer' && 'accountId' in doc) return 'moneyTransfer'
  // purchaseOrder
  if (String(doc.no || '').startsWith('ЗКП')) return 'purchaseOrder'
  // order из state.orders (не documents) — имеет payment/priceTypeId/track
  if (!doc.type && (doc.customerId || doc.customerName)) return 'sale'
  // documents по типу
  const t = doc.type
  if (t === 'sale') return 'sale'
  if (t === 'purchase' || t === 'stockin') return 'purchase'
  if (t === 'sale_return' || t === 'supplier_return' || t === 'transfer' || t === 'writeoff' || t === 'inventory') return 'stock'
  return 'stock'
}

/**
 * Отрендерить шаблон и вернуть HTML строкой. Не открывает окно печати —
 * это делает printFrame.
 */
export function renderTemplate(category, templateKey, doc, ctx) {
  const list = TEMPLATES[category]
  if (!list) return `<div>Нет шаблонов для категории «${category}»</div>`
  const tpl = list.find((t) => t.key === templateKey) || list[0]
  try {
    return tpl.render(doc, ctx) || ''
  } catch (e) {
    return `<div style="color:red;padding:20px">Ошибка рендера шаблона «${tpl.label}»:<br>${e.message}</div>`
  }
}
