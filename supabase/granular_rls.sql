-- ── Гранулярные права по ролям на уровне базы ────────────────────────────────
-- Все роли видят данные своей компании (read), но запись ограничена ролью:
--   admin / manager / stock — пишут (товары, склад, операции, заказы…)
--   courier (курьер)        — только чтение + смена статуса заказов
-- Запустите ПОСЛЕ schema_saas.sql. Вставьте в Supabase → SQL Editor → Run.

-- Роль текущего пользователя (security definer — без рекурсии)
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

-- Пересобираем политики: read для всех своей компании, write — кроме курьера
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

    -- чтение: любой член компании
    execute format(
      'create policy "%I_read" on public.%I for select to authenticated
         using (company_id = public.auth_company_id())', t, t);

    -- запись: все роли кроме курьера
    execute format(
      'create policy "%I_write" on public.%I for all to authenticated
         using (company_id = public.auth_company_id() and public.auth_role() <> ''courier'')
         with check (company_id = public.auth_company_id() and public.auth_role() <> ''courier'')',
      t, t);
  end loop;
end $$;

-- Курьер: может менять статус заказов (доставлен и т.п.)
drop policy if exists "orders_courier_update" on public.orders;
create policy "orders_courier_update" on public.orders
  for update to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() = 'courier')
  with check (company_id = public.auth_company_id());

-- Журнал действий: писать может любой член компании (логи входа курьера и т.п.)
drop policy if exists "audit_insert_all" on public.audit;
create policy "audit_insert_all" on public.audit
  for insert to authenticated
  with check (company_id = public.auth_company_id());

-- Каждый член компании может создать/обновить СВОЮ карточку сотрудника
-- (нужно при первом входе: bootstrap создаёт employee с auth_uid = текущий).
-- Без этого курьер не может завести свою запись и логинится дубликатом.
drop policy if exists "employees_self" on public.employees;
create policy "employees_self" on public.employees
  for all to authenticated
  using (company_id = public.auth_company_id() and auth_uid = auth.uid())
  with check (company_id = public.auth_company_id() and auth_uid = auth.uid());

-- Готово. Курьер — только чтение + статусы заказов + своя карточка; остальные роли пишут.
