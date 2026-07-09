-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  СкладПро — схема базы данных Supabase (Postgres)                      ║
-- ║  Вставьте целиком в Supabase → SQL Editor → Run.                      ║
-- ║  Вложенные структуры (позиции, цены, трек) хранятся в jsonb —          ║
-- ║  это минимизирует изменения в коде на этапе перехода.                  ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- ── Справочники ────────────────────────────────────────────────────────────
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

-- ── Товары ──────────────────────────────────────────────────────────────────
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
  image         text,                       -- url из Storage или dataURL
  codes         jsonb default '[]'::jsonb,   -- коды маркировки «Честный знак»
  prices        jsonb default '{}'::jsonb,   -- { price_type_id: цена }
  created_at    timestamptz default now()
);
create index if not exists idx_products_sku on public.products(sku);
create index if not exists idx_products_barcode on public.products(barcode);
create index if not exists idx_products_wh on public.products(warehouse_id);

-- ── Контрагенты ──────────────────────────────────────────────────────────────
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
  balance       numeric default 0            -- задолженность (долг)
);

create table if not exists public.suppliers (
  id        text primary key,
  name      text not null,
  category  text,
  phone     text,
  city      text
);

-- ── Сотрудники ───────────────────────────────────────────────────────────────
create table if not exists public.employees (
  id        text primary key,
  name      text not null,
  role      text default 'stock',
  phone     text,
  pin       text,
  active    boolean default true,
  auth_uid  uuid                              -- связь с Supabase Auth (позже)
);

-- ── Заказы и документы ───────────────────────────────────────────────────────
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
  stock_consumed boolean default false,         -- остаток физически списан (при отгрузке)
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
  kind          text,                         -- 'in' приход / 'out' расход
  party         text,
  party_id      text,
  items         jsonb default '[]'::jsonb,
  total         numeric default 0,
  price_type_id text,
  source        text,
  created_at    timestamptz default now()
);

-- ── Складские движения и журналы ─────────────────────────────────────────────
create table if not exists public.movements (
  id          text primary key,
  type        text,                           -- in/writeoff/return/inventory
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

-- ── Безопасность (RLS) ───────────────────────────────────────────────────────
-- На этапе перехода: доступ к данным имеют только авторизованные пользователи
-- (вход через Supabase Auth). Гранулярность по ролям добавим следующим шагом.
do $$
declare t text;
begin
  foreach t in array array[
    'price_types','warehouses','cells','products','customers','suppliers',
    'employees','orders','invoices','movements','shifts','audit'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "auth_all" on public.%I', t);
    execute format(
      'create policy "auth_all" on public.%I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- Готово. Таблицы созданы, RLS включена.
