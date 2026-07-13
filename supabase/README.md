# SQL-миграции СкладПро (Supabase)

## ⚠️ Важно: без полной цепочки данные всех компаний открыты

Базовый `schema.sql` включает RLS с политикой `using(true)` — на этой стадии
**любой авторизованный пользователь видит все строки всех компаний**. Изоляция
по тенанту появляется только после `schema_saas.sql`, а гранулярные права
(курьер vs остальные) — после `granular_rls.sql`. Применяйте цепочку целиком
и в указанном порядке.

## Быстрый способ — один файл

Открыть Supabase → **SQL Editor**, вставить содержимое `apply_all.sql` целиком
и нажать **Run**. Все миграции идемпотентны — можно запускать повторно.

## Пошагово (если нужно применять по одному)

Порядок обязателен: каждая следующая миграция опирается на объекты
предыдущих (`companies`, `auth_company_id()`, `auth_role()`).

| # | Файл                       | Что добавляет                                                        |
|---|----------------------------|----------------------------------------------------------------------|
| 1 | `schema.sql`               | Все таблицы данных + временная политика `auth_all`                   |
| 2 | `schema_saas.sql`          | Компании/членства, `company_id` во всех таблицах, `tenant_all`, `auth_company_id()`, `create_company()` |
| 3 | `granular_rls.sql`         | Разделение read/write по ролям, `auth_role()`, `orders_courier_update`, `audit_insert_all`, `employees_self` |
| 4 | `documents.sql`            | Реестр складских документов (`documents` + RLS)                      |
| 5 | `settings_sync.sql`        | Облачные настройки компании (`settings` + RLS + `updated_at`-триггер) |
| 6 | `saas_invites.sql`         | Приглашения сотрудников (`invitations`, `accept_invitation()`)       |
| 7 | `add_assigned_to.sql`      | Колонка `orders.assigned_to` (курьер)                                |
| 8 | `updated_at.sql`           | Колонка `updated_at` на всех таблицах данных (для разрешения конфликтов синка) |
| 9 | `reservation_migration.sql`| Колонка `orders.stock_consumed` + разовый возврат остатка открытым заказам |

Дополнительные фиксы (уже включены в файлы выше, но оставлены на случай, если
база создана давно и нужно точечно применить):

- `fix_create_company.sql` — актуальная версия `create_company()` + чистка бесхозных компаний.
- `fix_employee_self.sql` — актуальная политика `employees_self` для курьера.

Применять их поверх основной цепочки безопасно (идемпотентно).

## Проверка после применения

```sql
-- Все таблицы данных должны иметь колонку company_id
select table_name from information_schema.columns
where table_schema = 'public' and column_name = 'company_id'
order by 1;

-- Не должно быть таблиц данных с политикой auth_all (using true)
select tablename, policyname from pg_policies
where schemaname = 'public' and policyname = 'auth_all';

-- Функции безопасности должны существовать
select proname from pg_proc where proname in
  ('auth_company_id','auth_role','create_company','accept_invitation');
```

Если первый запрос не показал ни одной таблицы, `schema_saas.sql` не применён —
данные компаний **не изолированы**, немедленно докатите миграции.

## Идемпотентность

Все файлы можно запускать повторно без побочных эффектов
(`create table if not exists`, `create index if not exists`,
`create or replace function`, `drop policy if exists ... create policy ...`).
Исключение: `schema_saas.sql` содержит `truncate` демо-данных без `company_id`
(строка ~48) — это выполняется один раз на пустой базе; при повторном
запуске очищать уже нечего.
