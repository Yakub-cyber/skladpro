-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  СкладПро — единый скрипт применения ВСЕЙ схемы Supabase.                 ║
-- ║  Вставьте целиком в Supabase → SQL Editor → Run.                          ║
-- ║  Порядок фиксирован (каждый шаг опирается на предыдущий). Идемпотентно.  ║
-- ║  Отдельные файлы (schema.sql, schema_saas.sql, granular_rls.sql, …)      ║
-- ║  оставлены для точечного применения и разбора истории.                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 1. schema.sql — таблицы данных + временная политика auth_all             │
-- │    ⚠️ После этого шага RLS не изолирует компании! Не останавливайтесь.   │
-- └──────────────────────────────────────────────────────────────────────────┘

create table if not exists public.price_types (
  id          text primary key,
  name        text not null,
  color       text,
  is_default  boolean default false,
  sort        int default 0
);

create table if not exists public.warehouses (
  id       text primary key,
  name     text not null,
  address  text
);

create table if not exists public.cells (
  id            text primary key,
  warehouse_id  text references public.warehouses(id) on delete cascade,
  code          text,
  zone          text,
  x             int,
  y             int
);

create table if not exists public.products (
  id            text primary key,
  sku           text,
  name          text not null,
  category      text,
  unit          text default 'шт',
  price         numeric default 0,
  cost          numeric default 0,
  stock         numeric default 0,
  min_stock     numeric default 0,
  cell          text,
  warehouse_id  text,
  tags          jsonb default '[]'::jsonb,
  barcode       text,
  weighted      boolean default false,
  plu           int,
  marked        boolean default false,
  image         text,
  codes         jsonb default '[]'::jsonb,
  prices        jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);
create index if not exists idx_products_sku on public.products(sku);
create index if not exists idx_products_barcode on public.products(barcode);
create index if not exists idx_products_wh on public.products(warehouse_id);

create table if not exists public.customers (
  id            text primary key,
  name          text not null,
  type          text,
  city          text,
  contact       text,
  phone         text,
  email         text,
  total_spent   numeric default 0,
  bonus         numeric default 0,
  since         timestamptz default now(),
  price_type_id text,
  balance       numeric default 0
);

create table if not exists public.suppliers (
  id        text primary key,
  name      text not null,
  category  text,
  phone     text,
  city      text
);

create table if not exists public.employees (
  id        text primary key,
  name      text not null,
  role      text default 'stock',
  phone     text,
  pin       text,
  active    boolean default true,
  auth_uid  uuid
);

create table if not exists public.orders (
  id            text primary key,
  no            text,
  customer_id   text,
  customer_name text,
  items         jsonb default '[]'::jsonb,
  subtotal      numeric default 0,
  discount      numeric default 0,
  total         numeric default 0,
  price_type_id text,
  on_credit     boolean default false,
  status        text default 'new',
  stock_consumed boolean default false,
  priority      boolean default false,
  courier       text,
  assigned_to   text,
  address       text,
  shift_id      text,
  track         jsonb default '[]'::jsonb,
  created_at    timestamptz default now()
);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_customer on public.orders(customer_id);
create index if not exists idx_orders_created on public.orders(created_at desc);

create table if not exists public.invoices (
  id            text primary key,
  no            text,
  kind          text,
  party         text,
  party_id      text,
  items         jsonb default '[]'::jsonb,
  total         numeric default 0,
  price_type_id text,
  source        text,
  created_at    timestamptz default now()
);

create table if not exists public.movements (
  id          text primary key,
  type        text,
  product_id  text,
  name        text,
  qty         numeric,
  delta       numeric,
  reason      text,
  by          text,
  at          timestamptz default now()
);
create index if not exists idx_movements_at on public.movements(at desc);

create table if not exists public.shifts (
  id            text primary key,
  user_id       text,
  opened_at     timestamptz,
  closed_at     timestamptz,
  opening_cash  numeric default 0,
  closing_cash  numeric default 0,
  revenue       numeric default 0,
  orders_count  int default 0,
  moves_count   int default 0
);

create table if not exists public.audit (
  id       text primary key,
  at       timestamptz default now(),
  by       text,
  title    text,
  section  text,
  type     text
);
create index if not exists idx_audit_at on public.audit(at desc);

-- Включаем RLS на всех таблицах данных. Политику "auth_all" НЕ создаём,
-- потому что следующие шаги установят изоляцию по компании.
do $$
declare t text;
begin
  foreach t in array array[
    'price_types','warehouses','cells','products','customers','suppliers',
    'employees','orders','invoices','movements','shifts','audit'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 2. schema_saas.sql — компании, membership, company_id, tenant-изоляция  │
-- └──────────────────────────────────────────────────────────────────────────┘

create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan        text default 'free',
  created_at  timestamptz default now()
);

create table if not exists public.memberships (
  user_id     uuid references auth.users(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete cascade,
  role        text default 'admin',
  name        text,
  active      boolean default true,
  created_at  timestamptz default now(),
  primary key (user_id, company_id)
);

do $$
declare t text;
begin
  foreach t in array array[
    'price_types','warehouses','cells','products','customers','suppliers',
    'employees','orders','invoices','movements','shifts','audit'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists company_id uuid references public.companies(id) on delete cascade',
      t
    );
    execute format('create index if not exists idx_%I_company on public.%I(company_id)', t, t);
  end loop;
end $$;

-- Разовая очистка бесхозных демо-данных (без company_id) при первом запуске.
-- Идемпотентно: повторный запуск ничего не тронет (все существующие строки
-- к этому моменту уже привязаны к компании).
do $$
declare t text;
begin
  foreach t in array array[
    'price_types','warehouses','cells','products','customers','suppliers',
    'employees','orders','invoices','movements','shifts','audit'
  ]
  loop
    execute format('delete from public.%I where company_id is null', t);
  end loop;
end $$;

create or replace function public.auth_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id
  from public.memberships
  where user_id = auth.uid() and active
  limit 1
$$;

alter table public.companies enable row level security;
drop policy if exists "company_select" on public.companies;
drop policy if exists "company_insert" on public.companies;
create policy "company_select" on public.companies
  for select to authenticated using (id = public.auth_company_id());
create policy "company_insert" on public.companies
  for insert to authenticated with check (true);

alter table public.memberships enable row level security;
drop policy if exists "mem_self" on public.memberships;
drop policy if exists "mem_insert" on public.memberships;
create policy "mem_self" on public.memberships
  for select to authenticated using (user_id = auth.uid() or company_id = public.auth_company_id());
create policy "mem_insert" on public.memberships
  for insert to authenticated with check (user_id = auth.uid());

-- Промежуточная tenant_all политика — будет заменена гранулярными в шаге 3.
do $$
declare t text;
begin
  foreach t in array array[
    'price_types','warehouses','cells','products','customers','suppliers',
    'employees','orders','invoices','movements','shifts','audit'
  ]
  loop
    execute format('drop policy if exists "auth_all" on public.%I', t);
    execute format('drop policy if exists "tenant_all" on public.%I', t);
    execute format(
      'create policy "tenant_all" on public.%I for all to authenticated
         using (company_id = public.auth_company_id())
         with check (company_id = public.auth_company_id())',
      t
    );
  end loop;
end $$;

create or replace function public.create_company(p_name text, p_user_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cid uuid;
  uname text;
begin
  insert into public.companies (name) values (p_name) returning id into cid;
  uname := coalesce(
    nullif(p_user_name, ''),
    split_part((select email from auth.users where id = auth.uid()), '@', 1),
    'Администратор'
  );
  insert into public.memberships (user_id, company_id, role, name)
    values (auth.uid(), cid, 'admin', uname);
  return cid;
end;
$$;
grant execute on function public.create_company(text, text) to authenticated;

-- Подчистить бесхозные компании без участников.
delete from public.companies c
where not exists (select 1 from public.memberships m where m.company_id = c.id);

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 3. granular_rls.sql — роли (курьер vs остальные), self-политики          │
-- └──────────────────────────────────────────────────────────────────────────┘

create or replace function public.auth_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.memberships
  where user_id = auth.uid() and active
  limit 1
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'price_types','warehouses','cells','products','customers','suppliers',
    'employees','orders','invoices','movements','shifts','audit'
  ]
  loop
    execute format('drop policy if exists "tenant_all" on public.%I', t);
    execute format('drop policy if exists "%I_read"  on public.%I', t, t);
    execute format('drop policy if exists "%I_write" on public.%I', t, t);

    execute format(
      'create policy "%I_read" on public.%I for select to authenticated
         using (company_id = public.auth_company_id())', t, t);

    execute format(
      'create policy "%I_write" on public.%I for all to authenticated
         using (company_id = public.auth_company_id() and public.auth_role() <> ''courier'')
         with check (company_id = public.auth_company_id() and public.auth_role() <> ''courier'')',
      t, t);
  end loop;
end $$;

drop policy if exists "orders_courier_update" on public.orders;
create policy "orders_courier_update" on public.orders
  for update to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() = 'courier')
  with check (company_id = public.auth_company_id());

drop policy if exists "audit_insert_all" on public.audit;
create policy "audit_insert_all" on public.audit
  for insert to authenticated
  with check (company_id = public.auth_company_id());

drop policy if exists "employees_self" on public.employees;
create policy "employees_self" on public.employees
  for all to authenticated
  using (company_id = public.auth_company_id() and auth_uid = auth.uid())
  with check (company_id = public.auth_company_id() and auth_uid = auth.uid());

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 4. documents.sql — реестр складских документов                           │
-- └──────────────────────────────────────────────────────────────────────────┘

create table if not exists public.documents (
  id              text primary key,
  no              text,
  type            text,
  status          text default 'posted',
  items           jsonb default '[]'::jsonb,
  to_warehouse_id text,
  reason          text,
  note            text,
  total_qty       numeric default 0,
  "by"            text,
  created_at      timestamptz default now(),
  posted_at       timestamptz,
  cancelled_at    timestamptz,
  company_id      uuid references public.companies(id) on delete cascade
);
create index if not exists idx_documents_company on public.documents(company_id);

alter table public.documents enable row level security;
drop policy if exists "auth_all" on public.documents;
drop policy if exists "tenant_all" on public.documents;
create policy "tenant_all" on public.documents
  for all to authenticated
  using (company_id = public.auth_company_id())
  with check (company_id = public.auth_company_id());

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 5. settings_sync.sql — облачные настройки компании                       │
-- └──────────────────────────────────────────────────────────────────────────┘

create table if not exists public.settings (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now()
);

alter table public.settings enable row level security;

drop policy if exists "settings_read" on public.settings;
create policy "settings_read" on public.settings
  for select to authenticated
  using (company_id = public.auth_company_id());

drop policy if exists "settings_write" on public.settings;
create policy "settings_write" on public.settings
  for all to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() <> 'courier')
  with check (company_id = public.auth_company_id() and public.auth_role() <> 'courier');

create or replace function public.settings_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists settings_touch on public.settings;
create trigger settings_touch
  before update on public.settings
  for each row execute function public.settings_touch();

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 6. saas_invites.sql — приглашения сотрудников в компанию                 │
-- └──────────────────────────────────────────────────────────────────────────┘

create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,
  email       text not null,
  role        text default 'stock',
  name        text,
  created_at  timestamptz default now()
);
create index if not exists idx_invitations_email on public.invitations(lower(email));

alter table public.invitations enable row level security;
drop policy if exists "inv_company" on public.invitations;
create policy "inv_company" on public.invitations
  for all to authenticated
  using (company_id = public.auth_company_id())
  with check (company_id = public.auth_company_id());

create or replace function public.accept_invitation()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  em  text;
  inv public.invitations%rowtype;
begin
  select email into em from auth.users where id = auth.uid();
  select * into inv from public.invitations where lower(email) = lower(em) limit 1;
  if inv.id is null then
    return null;
  end if;
  insert into public.memberships (user_id, company_id, role, name)
    values (auth.uid(), inv.company_id, inv.role, coalesce(inv.name, split_part(em, '@', 1)))
    on conflict (user_id, company_id) do nothing;
  delete from public.invitations where company_id = inv.company_id and lower(email) = lower(em);
  return inv.company_id;
end;
$$;
grant execute on function public.accept_invitation() to authenticated;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 7. add_assigned_to.sql — курьер на заказе                                │
-- └──────────────────────────────────────────────────────────────────────────┘

alter table public.orders add column if not exists assigned_to text;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 8. updated_at на таблицах данных — для разрешения конфликтов синка       │
-- └──────────────────────────────────────────────────────────────────────────┘

do $$
declare t text;
begin
  foreach t in array array[
    'price_types','warehouses','cells','products','customers','suppliers',
    'employees','orders','invoices','documents','movements','shifts','audit'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists updated_at timestamptz default now()',
      t
    );
    execute format(
      'create index if not exists idx_%I_updated on public.%I(updated_at)', t, t);
  end loop;
end $$;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 9. reservation_migration.sql — модель резервирования остатков            │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Колонка-флаг (без default, чтобы NULL отмечал «ещё не мигрирован»).
alter table public.orders add column if not exists stock_consumed boolean;

-- Разовый возврат остатка открытым заказам старой модели.
update public.products p
set stock = coalesce(p.stock, 0) + gb.qty
from (
  select it->>'productId' as product_id,
         sum((it->>'qty')::numeric) as qty
  from public.orders o
  cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) as it
  where o.stock_consumed is null
    and o.status in ('new', 'confirmed', 'picking', 'packed')
  group by it->>'productId'
) gb
where p.id = gb.product_id;

update public.orders
set stock_consumed = (status in ('shipped', 'delivered'))
where stock_consumed is null;

alter table public.orders alter column stock_consumed set default false;

-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  Готово. Все таблицы созданы, RLS + гранулярные права + функции         ║
-- ║  auth_company_id/auth_role/create_company/accept_invitation активны.    ║
-- ║  Проверить: см. supabase/README.md → «Проверка после применения».        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
