-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  СкладПро → SaaS: мультитенантность                                    ║
-- ║  Запустите ПОСЛЕ schema.sql. Добавляет компании (тенанты) и изоляцию   ║
-- ║  данных: каждая компания видит только свои записи (RLS по company_id). ║
-- ║  Вставьте целиком в Supabase → SQL Editor → Run.                       ║
-- ╚══════════════════════════════════════════════════════════════════════╝

-- 1. Компании (тенанты) и участники ───────────────────────────────────────────
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan        text default 'free',
  created_at  timestamptz default now()
);

-- связь пользователя Supabase Auth с компанией + роль
create table if not exists public.memberships (
  user_id     uuid references auth.users(id) on delete cascade,
  company_id  uuid references public.companies(id) on delete cascade,
  role        text default 'admin',
  name        text,
  active      boolean default true,
  created_at  timestamptz default now(),
  primary key (user_id, company_id)
);

-- 2. company_id во все таблицы данных ─────────────────────────────────────────
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

-- 3. Очистка бесхозных демо-данных (они без компании и больше не видны) ────────
truncate table
  public.price_types, public.warehouses, public.cells, public.products,
  public.customers, public.suppliers, public.employees, public.orders,
  public.invoices, public.movements, public.shifts, public.audit;

-- 4. Текущая компания пользователя (security definer — без рекурсии в RLS) ─────
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

-- 5. RLS для companies и memberships ──────────────────────────────────────────
alter table public.companies enable row level security;
drop policy if exists "company_select" on public.companies;
drop policy if exists "company_insert" on public.companies;
create policy "company_select" on public.companies
  for select to authenticated using (id = public.auth_company_id());
-- любой авторизованный может создать СВОЮ компанию (онбординг)
create policy "company_insert" on public.companies
  for insert to authenticated with check (true);

alter table public.memberships enable row level security;
drop policy if exists "mem_self" on public.memberships;
drop policy if exists "mem_insert" on public.memberships;
create policy "mem_self" on public.memberships
  for select to authenticated using (user_id = auth.uid() or company_id = public.auth_company_id());
create policy "mem_insert" on public.memberships
  for insert to authenticated with check (user_id = auth.uid());

-- 6. RLS таблиц данных: только своя компания ─────────────────────────────────
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

-- 7. Атомарное создание компании + членства (онбординг) ──────────────────────
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

-- Готово. Данные изолированы по компаниям.
