-- ── Своя карточка сотрудника (фикс роли курьера) ─────────────────────────────
-- Гранулярные права запрещают курьеру писать в employees. Но при первом входе
-- приложение создаёт карточку сотрудника (employee) с auth_uid = текущий
-- пользователь. Без права на свою запись курьер не сохраняется и логинится
-- каждый раз новым дубликатом → назначенные заказы «теряются».
--
-- Эта политика разрешает ЛЮБОМУ члену компании создавать/менять ТОЛЬКО свою
-- карточку (auth_uid = auth.uid()). Запустите в Supabase → SQL Editor → Run.
-- Идемпотентно. Требует уже применённого granular_rls.sql (функция auth_company_id).

drop policy if exists "employees_self" on public.employees;
create policy "employees_self" on public.employees
  for all to authenticated
  using (company_id = public.auth_company_id() and auth_uid = auth.uid())
  with check (company_id = public.auth_company_id() and auth_uid = auth.uid());

-- Готово. Теперь курьер сохраняет свою карточку и логинится стабильным id.
