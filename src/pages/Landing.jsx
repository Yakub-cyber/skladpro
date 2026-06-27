import {
  Boxes,
  Sparkles,
  Warehouse,
  Navigation,
  ScanLine,
  BarChart3,
  Users,
  ShieldCheck,
  Check,
  ArrowRight,
  Cloud,
} from 'lucide-react'
import { Button, cx } from '../components/ui'

const FEATURES = [
  { icon: Sparkles, title: 'ИИ-накладные', text: 'Пишете состав текстом — получаете готовый документ с ценами' },
  { icon: Warehouse, title: 'Карта склада', text: 'Несколько складов, ячейки, поиск товара и маршрут сборки' },
  { icon: Navigation, title: 'Доставка по карте', text: 'Оптимальный объезд заказов по реальным дорогам' },
  { icon: ScanLine, title: 'Касса и сканер', text: 'POS-экран, штрихкоды, весовой товар, «Честный знак»' },
  { icon: BarChart3, title: 'Аналитика', text: 'Прогноз спроса, выручка по периодам, рекомендации закупок' },
  { icon: ShieldCheck, title: 'Роли и доступ', text: 'Сотрудники, кассовые смены, журнал всех действий' },
]

const PLANS = [
  {
    name: 'Бесплатно',
    price: '0 ₽',
    period: 'навсегда',
    features: ['1 склад', 'До 3 сотрудников', 'Товары, заказы, касса', 'Базовая аналитика'],
    cta: 'Начать бесплатно',
  },
  {
    name: 'Бизнес',
    price: '1 990 ₽',
    period: 'в месяц',
    featured: true,
    features: [
      'Склады и сотрудники — без лимита',
      'Все ИИ-функции',
      'Доставка по карте, маршруты',
      'Категории цен, долги, лояльность',
      'Полная аналитика и отчёты',
    ],
    cta: 'Попробовать 14 дней',
  },
  {
    name: 'Корпоративный',
    price: 'По запросу',
    period: 'индивидуально',
    features: ['Всё из «Бизнес»', 'Интеграции и API', 'Маркетплейсы (WB/Ozon)', 'Приоритетная поддержка'],
    cta: 'Связаться',
  },
]

export default function Landing({ onStart }) {
  return (
    <div className="min-h-screen bg-bg text-ink overflow-x-hidden">
      {/* Шапка */}
      <header className="h-16 flex items-center px-5 lg:px-10 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-brand grid place-items-center text-brand-ink">
            <Boxes size={20} strokeWidth={2.3} />
          </div>
          <div className="font-semibold tracking-tight">
            Склад<span className="text-brand">Про</span>
          </div>
        </div>
        <Button variant="soft" size="sm" className="ml-auto" onClick={onStart}>
          Войти
        </Button>
      </header>

      {/* Hero */}
      <section className="px-5 lg:px-10 max-w-6xl mx-auto pt-12 pb-16 text-center">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-soft text-brand text-[13px] font-medium mb-5">
          <Cloud size={14} /> Облачный SaaS для опта и склада
        </div>
        <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.1] max-w-3xl mx-auto">
          Складской учёт и продажи <span className="text-brand">с искусственным интеллектом</span>
        </h1>
        <p className="text-muted text-base sm:text-lg mt-5 max-w-2xl mx-auto leading-relaxed">
          Товары, заказы, доставка, касса и аналитика — в одном месте. Накладные из текста, карта склада, маршруты по реальным дорогам. Работает из браузера, данные в облаке.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
          <Button size="lg" icon={ArrowRight} onClick={onStart}>
            Начать бесплатно
          </Button>
          <Button size="lg" variant="outline" onClick={onStart}>
            Войти в аккаунт
          </Button>
        </div>
        <div className="text-[13px] text-muted mt-4">Без карты · регистрация за минуту · бесплатный тариф навсегда</div>
      </section>

      {/* Возможности */}
      <section className="px-5 lg:px-10 max-w-6xl mx-auto py-12">
        <h2 className="text-2xl font-semibold text-center mb-2">Всё для управления складом</h2>
        <p className="text-muted text-center mb-10">От приёмки до доставки клиенту</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-5">
              <div className="h-11 w-11 rounded-xl bg-brand-soft text-brand grid place-items-center mb-3">
                <f.icon size={22} />
              </div>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-[13px] text-muted mt-1 leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Тарифы */}
      <section className="px-5 lg:px-10 max-w-6xl mx-auto py-12">
        <h2 className="text-2xl font-semibold text-center mb-2">Тарифы</h2>
        <p className="text-muted text-center mb-10">Начните бесплатно, платите по мере роста</p>
        <div className="grid md:grid-cols-3 gap-4 items-start">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={cx(
                'card p-6 relative',
                p.featured && 'border-brand ring-2 ring-brand/30',
              )}
            >
              {p.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-brand text-brand-ink text-[12px] font-semibold">
                  Популярный
                </div>
              )}
              <div className="font-semibold text-lg">{p.name}</div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-3xl font-bold tracking-tight">{p.price}</span>
                <span className="text-[13px] text-muted">{p.period}</span>
              </div>
              <ul className="mt-5 space-y-2.5">
                {p.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-sm">
                    <Check size={16} className="text-brand shrink-0 mt-0.5" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
              <Button
                variant={p.featured ? 'primary' : 'soft'}
                className="w-full mt-6"
                onClick={onStart}
              >
                {p.cta}
              </Button>
            </div>
          ))}
        </div>
        <p className="text-center text-[12px] text-muted mt-6">
          Оплата подключается на следующем этапе. Сейчас все тарифы доступны для теста.
        </p>
      </section>

      {/* CTA-низ */}
      <section className="px-5 lg:px-10 max-w-6xl mx-auto py-12">
        <div className="rounded-2xl bg-gradient-to-r from-brand to-info p-8 sm:p-12 text-center text-white relative overflow-hidden">
          <div className="relative z-10">
            <h2 className="text-2xl sm:text-3xl font-semibold">Запустите свой склад за минуту</h2>
            <p className="text-white/85 mt-2">Зарегистрируйтесь — демо-данные уже внутри, можно сразу пробовать.</p>
            <Button size="lg" variant="soft" className="mt-6 !bg-white !text-brand" icon={ArrowRight} onClick={onStart}>
              Создать аккаунт
            </Button>
          </div>
          <Boxes size={180} className="absolute -right-8 -bottom-12 text-white/10" />
        </div>
      </section>

      <footer className="px-5 lg:px-10 max-w-6xl mx-auto py-8 border-t border-line flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
        <div className="flex items-center gap-2">
          <Boxes size={16} className="text-brand" /> СкладПро · {new Date().getFullYear()}
        </div>
        <div className="flex items-center gap-1.5">
          <Users size={14} /> Мультитенантный SaaS на Supabase
        </div>
      </footer>
    </div>
  )
}
