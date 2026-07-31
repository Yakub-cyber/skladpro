// Подписка/тарифы SaaS. Живёт в settings.subscription:
//   { plan: 'trial'|'free'|'start'|'business'|'pro',
//     trialStartAt: ISO,
//     trialEndAt: ISO,
//     paidUntil: ISO|null,
//     autoRenew: bool }
//
// Ключевая идея: у нового пользователя стартует 14-дневный триал
// автоматически при первом логине (см. slices/hrSlice.js). Пока триал
// активен, все фичи доступны — это позволяет попробовать всё, не
// упираясь в лимиты. По истечении триала, если не оплатили — план
// автоматически падает в 'free' с урезанными лимитами (мягкий downgrade,
// а не блокировка — важно, чтобы пользователь не потерял доступ к своим
// данным).
//
// Реальная оплата подключится, когда добавим Stripe/ЮKassa. Пока
// Subscription.jsx умеет:
//   - показать статус (Trial · осталось N дней / План «Бизнес» · до 2027-03-14 / Free);
//   - апгрейд/downgrade вручную (кнопкой) — чтобы можно было протестить
//     каждый лимит без денег;
//   - алерт-баннер в топбаре, если триал заканчивается (< 3 дней) или
//     истёк.

export const TRIAL_DAYS = 14

export const PLAN_LIMITS = {
  trial: {
    label: 'Триал',
    warehouses: Infinity,
    employees: Infinity,
    products: Infinity,
    monthlyDocs: Infinity,
    aiMonthly: 30,
    features: '*',
  },
  free: {
    label: 'Бесплатно',
    warehouses: 1,
    employees: 3,
    products: 100,
    monthlyDocs: 200,
    aiMonthly: 30,
    features: ['pos', 'inventory', 'barcodes'],
  },
  start: {
    label: 'Старт',
    warehouses: 1,
    employees: 5,
    products: 2000,
    monthlyDocs: Infinity,
    aiMonthly: 400,
    features: ['pos', 'inventory', 'barcodes', 'marking'],
  },
  business: {
    label: 'Бизнес',
    warehouses: 3,
    employees: 15,
    products: Infinity,
    monthlyDocs: Infinity,
    aiMonthly: 2000,
    features: '*',
  },
  pro: {
    label: 'Профи',
    warehouses: 10,
    employees: 50,
    products: Infinity,
    monthlyDocs: Infinity,
    aiMonthly: Infinity,
    features: '*',
  },
}

// Начальный триал: 14 дней с момента вызова.
export function initialTrial(now = new Date().toISOString()) {
  const end = new Date(now)
  end.setDate(end.getDate() + TRIAL_DAYS)
  return {
    plan: 'trial',
    trialStartAt: now,
    trialEndAt: end.toISOString(),
    paidUntil: null,
    autoRenew: false,
  }
}

// Дней до конца триала. Отрицательное — просрочен.
export function trialDaysLeft(sub, now = new Date()) {
  if (!sub?.trialEndAt) return 0
  const end = new Date(sub.trialEndAt).getTime()
  const ms = end - now.getTime()
  return Math.ceil(ms / 86_400_000)
}

// Эффективный план: если триал ещё идёт — 'trial' (со всеми фичами);
// если истёк и не оплачено — 'free'; иначе то, что выбрано.
export function effectivePlan(sub, now = new Date()) {
  if (!sub) return 'free'
  if (sub.plan === 'trial') {
    return trialDaysLeft(sub, now) > 0 ? 'trial' : 'free'
  }
  // Платные планы: пока paidUntil > now — активен; иначе free.
  if (sub.paidUntil) {
    return new Date(sub.paidUntil).getTime() > now.getTime() ? sub.plan : 'free'
  }
  return sub.plan
}

// Проверка доступа к фиче на текущем плане. Всегда true для '*'-плана.
export function planAllows(sub, feature, now = new Date()) {
  const eff = effectivePlan(sub, now)
  const limits = PLAN_LIMITS[eff] || PLAN_LIMITS.free
  return limits.features === '*' || limits.features.includes(feature)
}

// Осталось до окончания оплаты (для UI-обратного отсчёта). null — если
// план free/trial или paidUntil не задан.
export function paidDaysLeft(sub, now = new Date()) {
  if (!sub?.paidUntil) return null
  const ms = new Date(sub.paidUntil).getTime() - now.getTime()
  return Math.ceil(ms / 86_400_000)
}

// Продлить платный план на N месяцев (простая арифметика, без tzdb).
export function extendPlan(currentPaidUntil, months = 1, now = new Date()) {
  const base = currentPaidUntil ? new Date(currentPaidUntil) : new Date(now)
  const start = base.getTime() > now.getTime() ? base : now
  const end = new Date(start)
  end.setMonth(end.getMonth() + months)
  return end.toISOString()
}
