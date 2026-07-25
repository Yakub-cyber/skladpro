// Кассовые ордера (упрощённая ф. КО-1 / КО-2) для moneyTx.
//
// Внимание: это компактные документы, не пиксельные копии официальной
// формы Госкомстата — но содержат все обязательные реквизиты:
// организация, № и дата, сумма (цифрами и прописью), «принято от» /
// «выдать», основание, подписи руководителя, бухгалтера, кассира и
// (в РКО) получателя. Достаточно для внутреннего кассового учёта.
import { esc, fmt, rublesToWords } from '../print'
import { purposeLabel } from '../money'

const dateRu = (iso) => new Date(iso || Date.now()).toLocaleDateString('ru-RU')

// ─── ПКО (КО-1) — приходный кассовый ордер ────────────────────────────────
export function ko1(tx, ctx) {
  const r = ctx.requisites || {}
  const cur = esc(ctx.currency)
  const from =
    ctx.customer?.name ||
    ctx.supplier?.name ||
    'Розничный покупатель'
  const reason = purposeLabel('in', tx.purpose)
  const account = ctx.account?.name || '—'

  return `
    <div class="muted" style="text-align:right;margin-bottom:2mm">Унифицированная форма № КО-1</div>
    <div class="req">
      <b>${esc(r.name || ctx.company)}</b>
      ${r.inn ? ` · ИНН ${esc(r.inn)}` : ''}
      ${r.kpp ? ` · КПП ${esc(r.kpp)}` : ''}
    </div>
    <h1 style="text-align:center">Приходный кассовый ордер № ${esc(tx.no)}</h1>
    <div class="muted" style="text-align:center;margin-bottom:5mm">от ${dateRu(tx.at)}</div>

    <table style="margin-bottom:4mm">
      <thead><tr>
        <th style="width:34%">Принято от</th>
        <th style="width:22%">Касса / счёт</th>
        <th class="r" style="width:22%">Сумма</th>
        <th style="width:22%">Основание</th>
      </tr></thead>
      <tbody><tr>
        <td>${esc(from)}</td>
        <td>${esc(account)}</td>
        <td class="r"><b>${fmt(tx.amount)} ${cur}</b></td>
        <td>${esc(reason)}${tx.note ? ' · ' + esc(tx.note) : ''}</td>
      </tr></tbody>
    </table>

    <div class="words">
      Сумма прописью: <b>${rublesToWords(tx.amount)}</b>
    </div>

    <div class="sign" style="margin-top:8mm">
      <div class="line">Руководитель${r.director ? ' · ' + esc(r.director) : ''}</div>
      <div class="line">Главный бухгалтер${r.accountant ? ' · ' + esc(r.accountant) : ''}</div>
    </div>
    <div class="sign" style="margin-top:6mm">
      <div class="line">Получил кассир${ctx.employee?.name ? ' · ' + esc(ctx.employee.name) : ''}</div>
      <div class="line">М. П.</div>
    </div>

    <div style="margin-top:10mm;border-top:1px dashed #999;padding-top:4mm">
      <div class="muted" style="text-align:center;margin-bottom:2mm">— — — — Квитанция к ПКО № ${esc(tx.no)} — — — —</div>
      <div class="parties">
        <div><b>Принято от:</b> ${esc(from)}</div>
        <div><b>Сумма:</b> <b>${fmt(tx.amount)} ${cur}</b></div>
        <div><b>Прописью:</b> ${rublesToWords(tx.amount)}</div>
        <div><b>Основание:</b> ${esc(reason)}${tx.note ? ' · ' + esc(tx.note) : ''}</div>
        <div><b>Дата:</b> ${dateRu(tx.at)}</div>
      </div>
      <div class="sign" style="margin-top:6mm">
        <div class="line">Гл. бухгалтер${r.accountant ? ' · ' + esc(r.accountant) : ''}</div>
        <div class="line">Кассир${ctx.employee?.name ? ' · ' + esc(ctx.employee.name) : ''}</div>
      </div>
    </div>`
}

// ─── РКО (КО-2) — расходный кассовый ордер ────────────────────────────────
export function ko2(tx, ctx) {
  const r = ctx.requisites || {}
  const cur = esc(ctx.currency)
  const to =
    ctx.supplier?.name ||
    ctx.customer?.name ||
    'Получатель'
  const reason = purposeLabel('out', tx.purpose)
  const account = ctx.account?.name || '—'

  return `
    <div class="muted" style="text-align:right;margin-bottom:2mm">Унифицированная форма № КО-2</div>
    <div class="req">
      <b>${esc(r.name || ctx.company)}</b>
      ${r.inn ? ` · ИНН ${esc(r.inn)}` : ''}
      ${r.kpp ? ` · КПП ${esc(r.kpp)}` : ''}
    </div>
    <h1 style="text-align:center">Расходный кассовый ордер № ${esc(tx.no)}</h1>
    <div class="muted" style="text-align:center;margin-bottom:5mm">от ${dateRu(tx.at)}</div>

    <table style="margin-bottom:4mm">
      <thead><tr>
        <th style="width:34%">Выдать</th>
        <th style="width:22%">Из кассы / счёта</th>
        <th class="r" style="width:22%">Сумма</th>
        <th style="width:22%">Основание</th>
      </tr></thead>
      <tbody><tr>
        <td>${esc(to)}</td>
        <td>${esc(account)}</td>
        <td class="r"><b>${fmt(tx.amount)} ${cur}</b></td>
        <td>${esc(reason)}${tx.note ? ' · ' + esc(tx.note) : ''}</td>
      </tr></tbody>
    </table>

    <div class="words">
      Сумма прописью: <b>${rublesToWords(tx.amount)}</b>
    </div>

    <div class="sign" style="margin-top:8mm">
      <div class="line">Руководитель${r.director ? ' · ' + esc(r.director) : ''}</div>
      <div class="line">Главный бухгалтер${r.accountant ? ' · ' + esc(r.accountant) : ''}</div>
    </div>
    <div class="sign" style="margin-top:6mm">
      <div class="line">Получил${ctx.customer?.name || ctx.supplier?.name ? ' · ' + esc(to) : ''}</div>
      <div class="line">Выдал кассир${ctx.employee?.name ? ' · ' + esc(ctx.employee.name) : ''}</div>
    </div>
    <div class="muted" style="margin-top:6mm">По удостоверению личности (паспорт): _________________________</div>`
}

// ─── Справка о переводе между счетами (не унифицированная форма) ──────────
export function transferSlip(tx, ctx) {
  const r = ctx.requisites || {}
  const cur = esc(ctx.currency)
  return `
    <div class="req">
      <b>${esc(r.name || ctx.company)}</b>
      ${r.inn ? ` · ИНН ${esc(r.inn)}` : ''}
    </div>
    <h1>Справка о переводе № ${esc(tx.no)} от ${dateRu(tx.at)}</h1>
    <table>
      <tbody>
        <tr><th>Со счёта</th><td>${esc(ctx.account?.name || '—')}</td></tr>
        <tr><th>На счёт</th><td>${esc(ctx.toAccount?.name || '—')}</td></tr>
        <tr><th>Сумма</th><td><b>${fmt(tx.amount)} ${cur}</b></td></tr>
        <tr><th>Прописью</th><td>${rublesToWords(tx.amount)}</td></tr>
        ${tx.note ? `<tr><th>Комментарий</th><td>${esc(tx.note)}</td></tr>` : ''}
        <tr><th>Основание</th><td>Внутренний перевод между счетами</td></tr>
      </tbody>
    </table>
    <div class="sign" style="margin-top:10mm">
      <div class="line">Руководитель${r.director ? ' · ' + esc(r.director) : ''}</div>
      <div class="line">Главный бухгалтер${r.accountant ? ' · ' + esc(r.accountant) : ''}</div>
    </div>`
}
