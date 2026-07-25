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
import { useState } from 'react'
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
} from 'lucide-react'
import { Card, Section, Button, Badge, cx } from '../components/ui'
import { useStore } from '../store/useStore'

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
  // В MVP: план всегда «Демо» (Бесплатно), потому что биллинга ещё нет.
  // Когда прикрутим оплату — придёт с сервера в settings.subscription.plan.
  const [currentPlan] = useState('free')
  const companyName = useStore((s) => s.companyName) || 'Ваша компания'

  const cur = PLANS.find((p) => p.key === currentPlan) || PLANS[0]

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

      {/* Текущий план */}
      <Card className="p-5 border-brand/40 bg-brand-soft/30">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-muted">Текущий план</div>
            <div className="text-2xl font-bold mt-1">{cur.name}</div>
            <div className="text-[13px] text-muted mt-1">
              {cur.price} · {cur.period}
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
              // Открываем Connect как отдельный экран (он живёт в неавториз.
              // ветке для лендинга — из админки простой линк на #/ покажет
              // ей же, потому что маршрут / — это Dashboard. Пока просто
              // подсказка: см. модули ниже.)
              e.preventDefault()
              const el = document.getElementById('sub-plans')
              el?.scrollIntoView({ behavior: 'smooth' })
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
        subtitle="Оплата пока не подключена — тарифы доступны для теста."
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-stretch">
          {PLANS.map((p) => {
            const isCur = p.key === currentPlan
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
                    disabled
                  >
                    Выбрать (скоро)
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
        subtitle="Подключаются поверх любого платного тарифа. Полный список — в PRICING.md."
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

      <Card className="p-4 bg-surface-2/60 border-dashed">
        <div className="text-[13px] text-muted">
          Оплата подписки и модулей появится в следующем релизе. Сейчас все
          возможности доступны в режиме демо для тестирования.
        </div>
      </Card>
    </div>
  )
}
