-- ── Атомарное создание компании + членства (онбординг SaaS) ──────────────────
-- Решает гонку RLS: новый пользователь не может выбрать компанию,
-- пока у него нет членства. Функция выполняется с правами владельца.
-- Вставьте в Supabase → SQL Editor → Run.

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

-- Подчистить бесхозные компании без участников (от прошлых неудачных попыток)
delete from public.companies c
where not exists (select 1 from public.memberships m where m.company_id = c.id);
