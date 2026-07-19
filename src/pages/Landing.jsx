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

// Тарифная сетка — см. D:\Claude\skladpro\PRICING.md, раздел «Финальная сетка
// тарифов» и «Разложение фич по тарифам». Цены — при годовой оплате;
// помесячно = +30% (стандарт рынка).
const PLANS = [
  {
    name: 'Бесплатно',
    price: '0 ₽',
    period: 'навсегда',
    features: [
      '1 склад · 1 точка · 3 сотрудника',
      'До 100 товаров, 200 документов/мес',
      'Каталог, приход, продажа',
      'POS-касса (моб + десктоп)',
      'Инвентаризация, штрихкоды, ценники',
      '30 ИИ-запросов/мес',
    ],
    cta: 'Начать бесплатно',
  },
  {
    name: 'Старт',
    price: '990 ₽',
    period: 'в месяц при годовой оплате',
    features: [
      '1 склад · 1 точка · 5 сотрудников',
      'До 2 000 SKU · безлимит документов',
      'Маркировка «Честный знак»',
      'Базовая аналитика',
      '400 ИИ-запросов/мес',
      '2 ГБ фото',
    ],
    cta: 'Попробовать 14 дней',
  },
  {
    name: 'Бизнес',
    price: '1 990 ₽',
    period: 'в месяц при годовой оплате',
    featured: true,
    features: [
      '3 склада · 3 точки · 15 сотрудников',
      'Безлимит SKU',
      'CRM · программа лояльности · долги',
      'Категории цен (опт/розница)',
      'Карта склада + маршрут сборки',
      'Доставка по карте (Яндекс)',
      'Витрина на нашем поддомене',
      'Полная аналитика · 2 000 ИИ/мес',
    ],
    cta: 'Попробовать 14 дней',
  },
  {
    name: 'Профи',
    price: '3 990 ₽',
    period: 'в месяц при годовой оплате',
    features: [
      '10 складов · 10 точек · 50 сотрудников',
      'Всё из «Бизнес»',
      'Витрина на своём домене',
      'Меркурий · ЕГАИС · 1С',
      'Маркетплейсы (WB / Ozon / ЯМаркет)',
      'Автозаказы поставщикам',
      'API, Webhook, свои сценарии',
      'Безлимит ИИ · приоритетная поддержка',
    ],
    cta: 'Попробовать 14 дней',
  },
]

export default function Landing({ onStart, onConnect }) {
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
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onConnect}>
            Подключение
          </Button>
          <Button variant="soft" size="sm" onClick={onStart}>
            Войти
          </Button>
        </div>
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
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
          {PLANS.map((p) => (
            <div
              key={p.name}
              className={cx(
                'card p-5 relative flex flex-col',
                p.featured && 'border-brand ring-2 ring-brand/30',
              )}
            >
              {p.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-brand text-brand-ink text-[12px] font-semibold whitespace-nowrap">
                  Популярный
                </div>
              )}
              <div className="font-semibold text-lg">{p.name}</div>
              <div className="mt-3">
                <div className="text-[26px] font-bold tracking-tight leading-none">{p.price}</div>
                <div className="text-[12px] text-muted mt-1.5 leading-snug">{p.period}</div>
              </div>
              <ul className="mt-5 space-y-2 flex-1">
                {p.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-[13px]">
                    <Check size={15} className="text-brand shrink-0 mt-0.5" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
              <Button
                variant={p.featured ? 'primary' : 'soft'}
                className="w-full mt-5"
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
        <p className="text-center text-sm mt-3 space-x-4">
          <button className="text-brand font-medium hover:underline" onClick={onConnect}>
            Все модули и доплаты →
          </button>
          <button className="text-brand font-medium hover:underline" onClick={onConnect}>
            Как проходит подключение →
          </button>
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
        <div className="flex items-center gap-4">
          <button className="hover:text-ink transition" onClick={onConnect}>
            Подключение
          </button>
          <div className="flex items-center gap-1.5">
            <Users size={14} /> Мультитенантный SaaS
          </div>
        </div>
      </footer>
    </div>
  )
}
