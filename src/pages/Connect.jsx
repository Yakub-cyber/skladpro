import {
  Boxes,
  ArrowRight,
  ArrowLeft,
  Check,
  UserPlus,
  PackageSearch,
  ReceiptText,
  Users,
  KeyRound,
  Landmark,
  FileSignature,
  CloudCog,
  ScanBarcode,
  Wine,
  QrCode,
  ExternalLink,
  ShieldCheck,
  HelpCircle,
  MapPin,
  Truck,
  ShoppingBag,
  Stethoscope,
  Blocks,
} from 'lucide-react'
import { Button } from '../components/ui'

const STEPS = [
  {
    icon: UserPlus,
    title: '1. Регистрация — минута',
    text: 'Создайте аккаунт и компанию. Демо-данные уже внутри: можно сразу посмотреть, как всё работает.',
  },
  {
    icon: PackageSearch,
    title: '2. Каталог и остатки',
    text: 'Заведите товары вручную или импортируйте список. Штрихкоды, партии, себестоимость — считаются автоматически.',
  },
  {
    icon: ReceiptText,
    title: '3. Касса и фискализация',
    text: 'В Настройках введите реквизиты вашей кассы (АТОЛ Онлайн) и QR-код СБП от вашего банка. Чеки уходят в ФНС через вашего ОФД.',
  },
  {
    icon: Users,
    title: '4. Команда и запуск',
    text: 'Добавьте сотрудников, назначьте роли и PIN-коды. Откройте смену — можно продавать.',
  },
]

// Что клиент оформляет на свою компанию (мы — ПО, стороной расчётов не являемся)
const REQUIREMENTS = [
  {
    icon: KeyRound,
    title: 'Электронная подпись (КЭП)',
    who: 'Всем',
    text: 'Нужна для регистрации кассы, «Честного знака» и ЕГАИС. Выдаётся бесплатно в ФНС, потребуется токен (~2 000 ₽).',
    link: { label: 'УЦ ФНС России', href: 'https://www.nalog.gov.ru/rn77/related_activities/ucfns/' },
  },
  {
    icon: Landmark,
    title: 'Касса (ККТ) и её регистрация в ФНС',
    who: 'Если принимаете оплату от физлиц',
    text: 'По 54-ФЗ касса оформляется на вашу компанию. Физическая ККТ с фискальным накопителем или аренда облачной кассы. Регистрация — онлайн в личном кабинете ФНС.',
    link: { label: 'Кабинет ККТ — nalog.gov.ru', href: 'https://www.nalog.gov.ru' },
  },
  {
    icon: FileSignature,
    title: 'Договор с ОФД',
    who: 'Всем, у кого есть ККТ',
    text: 'Оператор фискальных данных передаёт чеки в налоговую. Заключается онлайн за один день, ~3 000 ₽ в год за кассу.',
    link: { label: 'Платформа ОФД', href: 'https://platformaofd.ru' },
  },
  {
    icon: CloudCog,
    title: 'Аккаунт АТОЛ Онлайн',
    who: 'Если облачная касса',
    text: 'Аренда облачной ККТ для продаж без физической кассы. Из личного кабинета понадобятся логин, пароль, код группы и ИНН — их вы вводите в настройках СкладПро.',
    link: { label: 'online.atol.ru', href: 'https://online.atol.ru' },
  },
  {
    icon: ScanBarcode,
    title: '«Честный знак»',
    who: 'Если торгуете маркированными товарами',
    text: 'Регистрация в системе маркировки бесплатна, нужна КЭП. СкладПро сканирует DataMatrix на кассе и ведёт учёт кодов.',
    link: { label: 'честныйзнак.рф', href: 'https://честныйзнак.рф' },
  },
  {
    icon: Wine,
    title: 'ЕГАИС',
    who: 'Только для алкоголя',
    text: 'Подключение через Росалкогольрегулирование: УТМ и крипто-ключ (~2–3 тыс ₽/год).',
    link: { label: 'fsrar.gov.ru', href: 'https://fsrar.gov.ru' },
  },
  {
    icon: QrCode,
    title: 'СБП — оплата по QR',
    who: 'Если хотите принимать QR-платежи',
    text: 'Подключается в вашем банке (Т-Бизнес, Точка, Сбер и др.), комиссия 0,4–0,7%. Полученный QR-код вставляете в настройки кассы.',
    link: { label: 'О СБП — sbp.nspk.ru', href: 'https://sbp.nspk.ru' },
  },
]

// Дополнительные модули — цены и раздел «Модули» в PRICING.md.
// 6 самых востребованных; полная таблица — в PRICING.md.
const MODULES = [
  {
    icon: ScanBarcode,
    title: 'Маркировка «Честный знак»',
    text: 'Скан DataMatrix на кассе, учёт кодов, выбытие при продаже и возврате.',
    price: '690 ₽/мес',
    from: 'от Старта',
  },
  {
    icon: MapPin,
    title: 'Карта склада + ячейки',
    text: 'Визуальная карта с ячейками, маршрут сборки заказа и подсказки где искать товар.',
    price: '690 ₽/мес',
    from: 'от Старта',
  },
  {
    icon: Users,
    title: 'CRM для оптовиков',
    text: 'Сегменты клиентов, история покупок, комментарии менеджера, лояльность.',
    price: '690 ₽/мес',
    from: 'от Старта',
  },
  {
    icon: Truck,
    title: 'Доставка по карте',
    text: 'Оптимальные маршруты по реальным дорогам (Яндекс Router), назначение курьеров.',
    price: '990 ₽/мес',
    from: 'от Старта',
  },
  {
    icon: Stethoscope,
    title: 'Меркурий (ветеринарный ФГИС)',
    text: 'Для молочки, мяса, рыбы. Приёмка ВСД, гашение, оформление возвратов.',
    price: '490 ₽/мес',
    from: 'от Бизнеса',
  },
  {
    icon: ShoppingBag,
    title: 'Маркетплейсы',
    text: 'Wildberries, Ozon, ЯМаркет — синхронизация остатков и заказов в одном окне.',
    price: '1 990 ₽/мес',
    from: 'от Бизнеса',
  },
]

const WE_DO = [
  'Программа, обновления и новые функции',
  'Хранение данных, синхронизация и резервные копии',
  'Формирование чеков и передача в вашу кассу и вашему ОФД',
  'Учёт кодов маркировки при продаже и возврате',
  'Помощь при подключении и настройке',
]

const YOU_DO = [
  'Касса зарегистрирована на вашу компанию в ФНС',
  'Действующие договоры с ОФД и банком (СБП)',
  'Актуальные реквизиты кассы в настройках СкладПро',
  'Кассовая дисциплина: смены, выдача чеков покупателям',
  'Лицензии и регистрации для маркировки и алкоголя',
]

const FAQ = [
  {
    q: 'Можно работать без кассы?',
    a: 'Да. Складской учёт, заказы, накладные и аналитика работают без фискализации. Кассу подключите, когда оформите документы.',
  },
  {
    q: 'У нас уже есть касса и договор с ОФД',
    a: 'Отлично — ничего переоформлять не нужно. Просто введите действующие реквизиты в настройках, и чеки пойдут через вашу кассу.',
  },
  {
    q: 'Сколько времени занимает подключение?',
    a: 'Если документы готовы — один день. Оформление кассы и ОФД с нуля обычно занимает 1–2 недели, СкладПро можно осваивать параллельно.',
  },
  {
    q: 'Нужен ли программист?',
    a: 'Нет. Всё подключается в настройках по шагам с этой страницы. Если что-то не получается — напишите в поддержку, поможем.',
  },
]

export default function Connect({ onStart, onBack }) {
  return (
    <div className="min-h-screen bg-bg text-ink overflow-x-hidden">
      {/* Шапка */}
      <header className="h-16 flex items-center gap-3 px-5 lg:px-10 max-w-6xl mx-auto">
        <button className="flex items-center gap-2.5" onClick={onBack}>
          <div className="h-9 w-9 rounded-xl bg-brand grid place-items-center text-brand-ink">
            <Boxes size={20} strokeWidth={2.3} />
          </div>
          <div className="font-semibold tracking-tight">
            Склад<span className="text-brand">Про</span>
          </div>
        </button>
        <Button variant="ghost" size="sm" icon={ArrowLeft} className="ml-auto" onClick={onBack}>
          На главную
        </Button>
        <Button variant="soft" size="sm" onClick={onStart}>
          Войти
        </Button>
      </header>

      {/* Hero */}
      <section className="px-5 lg:px-10 max-w-6xl mx-auto pt-12 pb-12 text-center">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-[1.15] max-w-3xl mx-auto">
          Подключение <span className="text-brand">за один день</span>
        </h1>
        <p className="text-muted text-base sm:text-lg mt-5 max-w-2xl mx-auto leading-relaxed">
          СкладПро работает с вашей кассой, вашим ОФД и вашим банком. Ниже — четыре шага запуска
          и список того, что оформляется на вашу компанию.
        </p>
      </section>

      {/* Шаги */}
      <section className="px-5 lg:px-10 max-w-6xl mx-auto pb-12">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((s) => (
            <div key={s.title} className="card p-5">
              <div className="h-11 w-11 rounded-xl bg-brand-soft text-brand grid place-items-center mb-3">
                <s.icon size={22} />
              </div>
              <h3 className="font-semibold text-[15px]">{s.title}</h3>
              <p className="text-[13px] text-muted mt-1 leading-relaxed">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Что оформляет клиент */}
      <section className="px-5 lg:px-10 max-w-6xl mx-auto py-12">
        <h2 className="text-2xl font-semibold text-center mb-2">Что понадобится с вашей стороны</h2>
        <p className="text-muted text-center mb-10 max-w-2xl mx-auto">
          По закону касса, договор с ОФД и системы маркировки оформляются на продавца.
          Это делается один раз — дальше всё работает в СкладПро автоматически.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {REQUIREMENTS.map((r) => (
            <div key={r.title} className="card p-5 flex flex-col">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-xl bg-brand-soft text-brand grid place-items-center shrink-0">
                  <r.icon size={20} />
                </div>
                <div className="text-[12px] px-2 py-0.5 rounded-full bg-surface-2 text-muted">{r.who}</div>
              </div>
              <h3 className="font-semibold text-[15px]">{r.title}</h3>
              <p className="text-[13px] text-muted mt-1 leading-relaxed flex-1">{r.text}</p>
              <a
                href={r.link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] text-brand font-medium mt-3 hover:underline"
              >
                {r.link.label} <ExternalLink size={13} />
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Дополнительные модули */}
      <section className="px-5 lg:px-10 max-w-6xl mx-auto py-12">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-soft text-brand text-[12px] font-medium mb-3">
            <Blocks size={13} /> Гибкая монетизация
          </div>
          <h2 className="text-2xl font-semibold mb-2">Дополнительные модули</h2>
          <p className="text-muted max-w-2xl mx-auto">
            Не покупайте лишнее — начните с базового тарифа и добавляйте только те модули,
            которые нужны вашему бизнесу.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.map((m) => (
            <div key={m.title} className="card p-5 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="h-11 w-11 rounded-xl bg-brand-soft text-brand grid place-items-center">
                  <m.icon size={22} />
                </div>
                <div className="text-[11px] px-2 py-0.5 rounded-full bg-surface-2 text-muted whitespace-nowrap">
                  {m.from}
                </div>
              </div>
              <h3 className="font-semibold text-[15px]">{m.title}</h3>
              <p className="text-[13px] text-muted mt-1 leading-relaxed flex-1">{m.text}</p>
              <div className="mt-4 pt-3 border-t border-line">
                <span className="font-bold text-brand text-lg">{m.price}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-[13px] text-muted mt-6 max-w-2xl mx-auto">
          Полный список модулей и цен доплат за сотрудников/точки/склады — в тарифной сетке
          после регистрации. Скидка 20% при подключении 3+ модулей.
        </p>
      </section>

      {/* Зоны ответственности */}
      <section className="px-5 lg:px-10 max-w-6xl mx-auto py-12">
        <h2 className="text-2xl font-semibold text-center mb-2">Кто за что отвечает</h2>
        <p className="text-muted text-center mb-10 max-w-2xl mx-auto">
          Честное разделение: мы — программа, вы — продавец и сторона расчётов.
        </p>
        <div className="grid md:grid-cols-2 gap-4 items-start">
          <div className="card p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="h-9 w-9 rounded-xl bg-brand-soft text-brand grid place-items-center">
                <ShieldCheck size={18} />
              </div>
              <div className="font-semibold">Делает СкладПро</div>
            </div>
            <ul className="space-y-2.5">
              {WE_DO.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <Check size={16} className="text-brand shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="h-9 w-9 rounded-xl bg-surface-2 text-ink grid place-items-center">
                <Landmark size={18} />
              </div>
              <div className="font-semibold">На вашей стороне</div>
            </div>
            <ul className="space-y-2.5">
              {YOU_DO.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <Check size={16} className="text-muted shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="text-center text-[12px] text-muted mt-6 max-w-2xl mx-auto">
          Применение ККТ — обязанность продавца (54-ФЗ). СкладПро формирует и передаёт чеки через вашу
          кассу и вашего ОФД, но стороной расчётов не является.
        </p>
      </section>

      {/* FAQ */}
      <section className="px-5 lg:px-10 max-w-6xl mx-auto py-12">
        <h2 className="text-2xl font-semibold text-center mb-10">Частые вопросы</h2>
        <div className="grid md:grid-cols-2 gap-4 max-w-4xl mx-auto">
          {FAQ.map((f) => (
            <div key={f.q} className="card p-5">
              <div className="flex items-start gap-2.5">
                <HelpCircle size={18} className="text-brand shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-[15px]">{f.q}</h3>
                  <p className="text-[13px] text-muted mt-1 leading-relaxed">{f.a}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 lg:px-10 max-w-6xl mx-auto py-12">
        <div className="rounded-2xl bg-gradient-to-r from-brand to-info p-8 sm:p-12 text-center text-white relative overflow-hidden">
          <div className="relative z-10">
            <h2 className="text-2xl sm:text-3xl font-semibold">Начните с бесплатного тарифа</h2>
            <p className="text-white/85 mt-2">
              Учёт и склад заработают сразу — кассу подключите, когда будут готовы документы.
            </p>
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
        <button className="hover:text-ink transition" onClick={onBack}>
          На главную
        </button>
      </footer>
    </div>
  )
}
