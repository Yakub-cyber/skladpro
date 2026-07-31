# Как устроен проект

Кратко: **где что лежит и куда добавлять новый код**. Написано для новичка,
чтобы через час можно было сориентироваться самостоятельно.

## Структура папок

```
src/
├── main.jsx                    # bootstrap приложения (ReactDOM.render)
├── App.jsx                     # роутер: какая страница на каком URL
├── index.css                   # глобальные стили (Tailwind + переменные)
│
├── app/                        # ИНФРАСТРУКТУРА приложения
│   ├── layout/                 # общий Layout (сайдбар/шапка/навигация)
│   └── providers/              # обёртки: Confirm, Theme, ErrorBoundary
│
├── features/                   # каждая ФИЧА — своя папка
│   ├── dashboard/
│   │   ├── DashboardPage.jsx   # страница-роут (тонкая, только сборка)
│   │   ├── DashboardStockPage.jsx      # ролевые варианты рядом
│   │   ├── DashboardCourierPage.jsx
│   │   └── components/         # компоненты, нужные ТОЛЬКО этой странице
│   │       ├── DashboardManager.jsx
│   │       └── StockValuationSection.jsx
│   │
│   ├── products/{ProductsPage.jsx, components/}
│   ├── orders/{OrdersPage.jsx, NewOrderPage.jsx, EditOrderPage.jsx, components/}
│   ├── operations/{OperationsPage.jsx, tabs/}
│   ├── money/{MoneyPage.jsx}
│   ├── shifts/{JournalPage.jsx, CashiersPage.jsx}
│   ├── customers/, suppliers/, warehouse/, movements/, invoices/,
│   ├── delivery/, analytics/, assistant/, storefront/, tracking/,
│   ├── landing/, auth/, subscription/, employees/, connect/, settings/
│
└── shared/                     # ОБЩЕЕ (нейтрально к домену)
    ├── ui/                     # design system: Button, Input, Section, ...
    │   └── index.jsx           # `import { Button } from '@/shared/ui'`
    ├── components/             # общие «умные»: Confirm, ErrorBoundary,
    │                           #   CommandPalette, DocPreviewModal, ...
    ├── api/                    # HTTP-клиент к бэкенду
    │   └── index.js            # apiFetch, apiSignIn, apiSyncPush, ...
    ├── store/                  # zustand-стор
    │   ├── useStore.js
    │   ├── seed.js
    │   ├── persistMigrate.js
    │   └── slices/{cloudSlice, hrSlice}.js
    └── lib/                    # ЧИСТЫЕ функции (без React, без стора)
        ├── format.js, id.js, constants.js, crypto.js, vat.js
        ├── orders.js, posting.js, batches.js, cost.js, money.js
        ├── ai.js, cloud.js, outbox.js, subscription.js
        └── print/              # печатные формы (ТОРГ-12, УПД, ...)
            ├── printCore.js, print.js
            └── templates/*.js
```

## 5 правил, которые всё определяют

**1. Alias `@/` = `src/`.** Пиши `@/shared/ui`, не `../../../shared/ui`.

```jsx
import { Button, Input } from '@/shared/ui'
import { useStore } from '@/shared/store/useStore'
import { money } from '@/shared/lib/format'
import { apiCreateExport } from '@/shared/api'
```

**2. Новая фича → новая папка в `features/`.** Никаких «пожалуй кину в
общий components». В папке фичи может быть что угодно нужное только ей:
`components/`, `hooks/`, `utils/`.

**3. Что-то нужно 2+ фичам → выноси в `shared/`.**
- Кирпичик UI (кнопка, инпут) — в `shared/ui/`.
- Функция без JSX (форматирование, расчёт) — в `shared/lib/`.
- «Умный» компонент (модалка, виджет) — в `shared/components/`.
- HTTP-запрос — в `shared/api/`.

**4. Страница > 500 строк → разбивай.** Одна страница = один тонкий файл
`FooPage.jsx` + подкомпоненты в `components/`. Пример: `features/dashboard/`
разбит на `DashboardPage.jsx` (18 строк — только router по ролям) +
`components/DashboardManager.jsx` (главный view) + `components/StockValuationSection.jsx`.

**5. Тесты — рядом с source.** `shared/lib/vat.js` → `shared/lib/vat.test.js`.
Vitest сам подхватывает по маске `**/*.{test,spec}.{js,jsx}`.

## Куда положить новый файл — решай так

1. Это компонент? → JSX.
   - Он реюзается на 2+ страницах? → `shared/components/` или `shared/ui/`.
   - Только для одной страницы? → `features/<та-страница>/components/`.
2. Это чистая функция? → `shared/lib/`.
3. Это HTTP-обёртка к бэкенду? → `shared/api/`.
4. Это React hook, специфичный для фичи? → `features/<та-фича>/hooks/`.
5. Это глобальный zustand action? → `shared/store/useStore.js` или один из
   слайсов в `shared/store/slices/`.

## Как проверить, что не сломал

```bash
npm run lint     # ESLint — не должно быть errors (warnings ок)
npx vitest run   # 336 юнит-тестов — все зелёные
npm run build    # Vite production build — должен пройти
npm run dev      # локально пощупать в браузере
```

## Полезные подсказки IDE

- VS Code читает `jsconfig.json` — alias `@/` автодополняется и
  «go to definition» работает.
- Расширение ESLint показывает ошибки inline.
- Расширение Tailwind CSS IntelliSense подсказывает классы.

## История имён

Раньше проект был просто `pages/*.jsx` — 28 страниц без структуры, некоторые
на 2000+ строк. Reorg 2026-07-31 переложил в feature-based, вырезав крупные
страницы на компоненты. См. коммит `refactor: feature-based structure`.
