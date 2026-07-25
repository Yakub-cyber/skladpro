// Универсальный шаблон для складских документов, где нет цен и НДС:
// transfer (ПРМ) / writeoff (СПС) / inventory (ИНВ) / sale_return (ВЗП) /
// supplier_return (ВЗС). Заменяет старый DocumentsTab.printDocument,
// добавляя реквизиты компании из настроек (раньше их не было).
import { esc, fmt, plural } from '../print'

const dateRu = (iso) => new Date(iso || Date.now()).toLocaleDateString('ru-RU')

const DOC_TITLES = {
  transfer: 'Накладная на перемещение',
  writeoff: 'Акт списания',
  inventory: 'Акт инвентаризации',
  sale_return: 'Акт возврата от покупателя',
  supplier_return: 'Акт возврата поставщику',
  purchase: 'Приёмный акт',
  sale: 'Расходная накладная',
  stockin: 'Акт оприходования',
}

export function docPrint(doc, ctx) {
  const r = ctx.requisites || {}
  const items = doc.items || []
  const totalQty = items.reduce((a, it) => a + (Number(it.qty) || 0), 0)
  const title = DOC_TITLES[doc.type] || 'Складской документ'
  const contragent =
    ctx.customer?.name || ctx.supplier?.name || null

  // Для inventory показываем 3 колонки: было/факт/разница.
  const isInv = doc.type === 'inventory'
  const rows = items
    .map((it, i) => {
      if (isInv) {
        const prev = Number(it.prevStock) || 0
        const fact = Number(it.qty) || 0
        const diff = fact - prev
        const diffCls = diff > 0 ? 'r' : diff < 0 ? 'r' : 'r'
        return `<tr>
          <td class="c">${i + 1}</td>
          <td>${esc(it.name)}</td>
          <td class="c">${esc(it.unit || 'шт')}</td>
          <td class="r">${fmt(prev)}</td>
          <td class="r">${fmt(fact)}</td>
          <td class="${diffCls}"><b>${diff > 0 ? '+' : ''}${fmt(diff)}</b></td>
        </tr>`
      }
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(it.name)}</td>
        <td class="c">${esc(it.unit || 'шт')}</td>
        <td class="r">${fmt(it.qty)}</td>
      </tr>`
    })
    .join('')

  const head = isInv
    ? '<tr><th>№</th><th>Наименование</th><th>Ед.</th><th class="r">Учётный остаток</th><th class="r">Факт</th><th class="r">Разница</th></tr>'
    : '<tr><th>№</th><th>Наименование</th><th>Ед.</th><th class="r">Кол-во</th></tr>'

  const cols = isInv ? 6 : 4

  return `
    <div class="req">
      <b>${esc(ctx.company)}</b>
      ${r.inn ? ` · ИНН ${esc(r.inn)}` : ''}
      ${r.address ? ` · ${esc(r.address)}` : ''}
    </div>
    <h1>${title} № ${esc(doc.no)} от ${dateRu(doc.createdAt)}</h1>
    <div class="parties">
      ${contragent ? `<div><b>Контрагент:</b> ${esc(contragent)}</div>` : ''}
      ${doc.reason ? `<div><b>Причина:</b> ${esc(doc.reason)}</div>` : ''}
      ${doc.note ? `<div><b>Примечание:</b> ${esc(doc.note)}</div>` : ''}
    </div>
    <table>
      <thead>${head}</thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="${cols}">Всего позиций: <b>${items.length}</b> · единиц: <b>${fmt(totalQty)}</b></td></tr>
      </tfoot>
    </table>
    <div style="margin-top:6mm">
      Данные подтверждаю, ${items.length} ${plural(items.length, ['наименование', 'наименования', 'наименований'])} на общее количество ${fmt(totalQty)} ед.
    </div>
    <div class="sign" style="margin-top:8mm">
      <div class="line">Составил${r.director ? ' · ' + esc(r.director) : ''}</div>
      <div class="line">Проверил</div>
    </div>
    <div class="sign" style="margin-top:6mm">
      <div class="line">М. П.</div>
      <div class="line">Утверждаю</div>
    </div>`
}
