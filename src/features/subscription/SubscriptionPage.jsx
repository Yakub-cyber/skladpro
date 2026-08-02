// Страница «Подписка» — доступна из NAV «Управление». Показывает:
//   - текущий план (в MVP хардкод «Демо» — реальная привязка появится
//     когда подключим биллинг),
//   - лимиты тарифа (склады/точки/сотрудники — из PLANS),
//   - модули с ценами (из тех же данных что и Connect.jsx для лендинга),
//   - кнопка «Улучшить план» ведёт на /connect (публичная страница
//     с деталями и оплатой).
//
// Данные для тарифов и модулей — те же, что на Landing/Connect (не
// импортируем, а копируем сокращённо — Connect живёт в неавторизованной
// ветке и требует onStart/onBack, которые нам тут не нужны).
import {
  Sparkles,
  Check,
  ArrowUpRight,
  ScanBarcode,
  MapPin,
  Users,
  Truck,
  Stethoscope,
  ShoppingBag,
  Zap,
  AlertTriangle,
} from 'lucide-react'
import { Card, Section, Button, Badge, cx } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { effectivePlan, trialDaysLeft, paidDaysLeft, extendPlan } from '@/shared/lib/subscription'

const PLANS = [
  {
    key: 'free',
    name: 'Бесплатно',
    price: '0 ₽',
    period: 'навсегда',
    features: [
      '1 склад · 1 точка · 3 сотрудника',
      'До 100 товаров, 200 документов/мес',
      'POS-касса, инвентаризация, штрихкоды',
      '30 ИИ-запросов/мес',
    ],
  },
  {
    key: 'start',
    name: 'Старт',
    price: '990 ₽',
    period: 'в месяц (годовая оплата)',
    features: [
      '1 склад · 1 точка · 5 сотрудников',
      'До 2 000 SKU · безлимит документов',
      'Маркировка «Честный знак»',
      '400 ИИ-запросов/мес',
    ],
  },
  {
    key: 'business',
    name: 'Бизнес',
    price: '1 990 ₽',
    period: 'в месяц (годовая оплата)',
    featured: true,
    features: [
      '3 склада · 3 точки · 15 сотрудников',
      'Безлимит SKU',
      'CRM · программа лояльности · долги',
      'Категории цен · маршруты по карте',
      '2 000 ИИ-запросов/мес',
    ],
  },
  {
    key: 'pro',
    name: 'Профи',
    price: '3 990 ₽',
    period: 'в месяц (годовая оплата)',
    features: [
      '10 складов · 10 точек · 50 сотрудников',
      'Всё из «Бизнес»',
      'API интеграции · маркетплейсы',
      'Персональный менеджер',
    ],
  },
]

const MODULES = [
  { icon: ScanBarcode, title: 'Маркировка «Честный знак»', price: '690 ₽/мес', from: 'от Старта' },
  { icon: MapPin, title: 'Карта склада + ячейки', price: '690 ₽/мес', from: 'от Старта' },
  { icon: Users, title: 'CRM для оптовиков', price: '690 ₽/мес', from: 'от Старта' },
  { icon: Truck, title: 'Доставка по карте', price: '990 ₽/мес', from: 'от Старта' },
  { icon: Stethoscope, title: 'Меркурий (ФГИС)', price: '490 ₽/мес', from: 'от Бизнеса' },
  { icon: ShoppingBag, title: 'Маркетплейсы (WB/Ozon/ЯМ)', price: '1 990 ₽/мес', from: 'от Бизнеса' },
]

export default function Subscription() {
  // B2: серверная подписка (getState в bootstrap) — источник истины.
  // Fallback на legacy sub из settings, если серверная не пришла (dev/offline).
  const serverSubscription = useStore((s) => s.serverSubscription)
  const sub = serverSubscription?.subscription
    ? {
        plan: serverSubscription.subscription.plan,
        trialStartAt: serverSubscription.subscription.trialStartedAt,
        trialEndAt: serverSubscription.subscription.trialEndsAt,
        paidUntil: serverSubscription.subscription.paidUntil,
      }
    : useStore.getState().settings?.subscription
  const updateSettings = useStore((s) => s.updateSettings)
  const refreshSubscription = useStore((s) => s.refreshSubscription)
  const companyName = useStore((s) => s.companyName) || 'Ваша компания'

  // Эффективный план: активный триал / оплаченный / free при истечении.
  const effective = serverSubscription?.effectivePlan || effectivePlan(sub)
  const daysLeftTrial = serverSubscription?.trialDaysLeft ?? trialDaysLeft(sub)
  const daysLeftPaid = paidDaysLeft(sub)
  const cur = PLANS.find((p) => p.key === (sub?.plan === 'trial' ? 'business' : effective)) || PLANS[0]
  const isTrial = sub?.plan === 'trial' && daysLeftTrial > 0
  const isTrialExpired = sub?.plan === 'trial' && daysLeftTrial <= 0

  // B2: реальная оплата через ЮKassa. Если сервер вернул confirmation_url —
  // редиректим пользователя. Если ЮKassa не настроена (503 BILLING_DISABLED),
  // fallback на legacy-«демо» кнопку — updateSettings меняет только локальный
  // subscription, чтобы админ мог посмотреть, как выглядит оплаченный вид.
  const activatePlan = async (planKey) => {
    // pro/business/start — реальный checkout, остальное — легаси
    if (['start', 'business', 'pro'].includes(planKey)) {
      try {
        const { apiCreateCheckout } = await import('@/shared/api')
        const r = await apiCreateCheckout(planKey, 1)
        if (r?.ok && r.body?.confirmationUrl) {
          window.location.assign(r.body.confirmationUrl)
          return
        }
        if (r?.status === 503 || r?.body?.error?.code === 'BILLING_DISABLED') {
          // eslint-disable-next-line no-alert
          alert('Онлайн-оплата временно недоступна. Свяжитесь с поддержкой для активации тарифа.')
        } else if (r?.body?.error?.message) {
          // eslint-disable-next-line no-alert
          alert(r.body.error.message)
          return
        }
      } catch { /* fallback ниже */ }
    }
    // Fallback — локальная активация до подключения платёжного провайдера.
    const now = new Date()
    const end = extendPlan(null, 1, now)
    updateSettings({
      subscription: {
        ...(sub || {}),
        plan: planKey,
        paidUntil: end,
        autoRenew: true,
      },
    })
    // Синкнем с сервером — вдруг super-admin выставил план вручную.
    refreshSubscription?.()
  }

  return (
    <div className="animate-fadeUp space-y-5 max-w-5xl">
      <div>
        <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Sparkles size={20} className="text-brand" /> Подписка
        </h2>
        <p className="text-sm text-muted">
          {companyName} · {cur.name} · {cur.period}
        </p>
      </div>

      {/* Триал-баннер: если истёк — красный, если < 3 дней — жёлтый. */}
      {isTrialExpired && (
        <Card className="p-4 bg-bad-soft border-bad/40">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-bad shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-bad">Триал закончился</div>
              <div className="text-[13px] text-muted mt-0.5">
                Вы сейчас на плане «Бесплатно» — с лимитами. Выберите тариф
                ниже, чтобы вернуть полный доступ.
              </div>
            </div>
          </div>
        </Card>
      )}
      {isTrial && daysLeftTrial <= 3 && (
        <Card className="p-4 bg-warn-soft border-warn/40">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-warn shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-warn">
                Триал заканчивается через {daysLeftTrial} {daysLeftTrial === 1 ? 'день' : 'дня'}
              </div>
              <div className="text-[13px] text-muted mt-0.5">
                После окончания план автоматически станет «Бесплатным».
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Текущий план */}
      <Card className="p-5 border-brand/40 bg-brand-soft/30">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-muted flex items-center gap-2">
              Текущий план
              {isTrial && <Badge tone="brand">Триал · {daysLeftTrial} дн.</Badge>}
              {daysLeftPaid > 0 && <Badge tone="ok">до {new Date(sub.paidUntil).toLocaleDateString('ru-RU')}</Badge>}
            </div>
            <div className="text-2xl font-bold mt-1">
              {isTrial ? 'Триал (полный доступ)' : cur.name}
            </div>
            <div className="text-[13px] text-muted mt-1">
              {isTrial
                ? `Все фичи «Бизнес» бесплатно ещё ${daysLeftTrial} ${daysLeftTrial === 1 ? 'день' : 'дней'}`
                : `${cur.price} · ${cur.period}`}
            </div>
            <ul className="mt-4 space-y-1.5 text-[13px]">
              {cur.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check size={15} className="text-brand shrink-0 mt-0.5" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
          <a
            href="#/"
            className="shrink-0"
            onClick={(e) => {
              e.preventDefault()
              document.getElementById('sub-plans')?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            <Button icon={ArrowUpRight}>Улучшить план</Button>
          </a>
        </div>
      </Card>

      {/* Все тарифы */}
      <Section
        id="sub-plans"
        title={
          <span className="flex items-center gap-2">
            <Zap size={16} className="text-brand" /> Все тарифы
          </span>
        }
        subtitle="Выберите подходящий тариф для вашего бизнеса."
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-stretch">
          {PLANS.map((p) => {
            // F1-8: во время триала effectivePlan='business' — раньше
            // на карточке «Бизнес» рисовался бейдж «Ваш план» и убиралась
            // кнопка «Активировать». Пользователь думал что уже платит.
            // Теперь isCur считает только по оплаченному плану.
            const isCur = p.key === effective && sub?.plan !== 'trial'
            return (
              <div
                key={p.key}
                className={cx(
                  'card p-4 flex flex-col relative',
                  p.featured && !isCur && 'border-brand ring-1 ring-brand/30',
                  isCur && 'border-ok ring-1 ring-ok/30',
                )}
              >
                {p.featured && !isCur && (
                  <Badge tone="brand" className="absolute -top-2 left-4">
                    Популярный
                  </Badge>
                )}
                {isCur && (
                  <Badge tone="ok" className="absolute -top-2 left-4">
                    Ваш план
                  </Badge>
                )}
                <div className="font-semibold text-[15px]">{p.name}</div>
                <div className="text-xl font-bold mt-2 tabular-nums">{p.price}</div>
                <div className="text-[11px] text-muted mt-0.5">{p.period}</div>
                <ul className="mt-3 space-y-1 flex-1 text-[12px]">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5">
                      <Check size={12} className="text-brand shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {!isCur && (
                  <Button
                    variant={p.featured ? 'primary' : 'soft'}
                    className="w-full mt-3"
                    size="sm"
                    onClick={() => activatePlan(p.key)}
                  >
                    Выбрать тариф
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {/* Модули */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={16} className="text-brand" /> Дополнительные модули
          </span>
        }
        subtitle="Подключаются поверх любого платного тарифа."
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {MODULES.map((m) => (
            <div key={m.title} className="card p-4 flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-info-soft text-info grid place-items-center shrink-0">
                <m.icon size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[14px]">{m.title}</div>
                <div className="text-[12px] text-muted mt-0.5">{m.from}</div>
                <div className="text-sm font-semibold text-brand mt-1 tabular-nums">
                  {m.price}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

    </div>
  )
}
