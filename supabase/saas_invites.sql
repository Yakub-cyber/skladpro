-- ── Приглашение сотрудников в компанию ───────────────────────────────────────
-- Админ/менеджер создаёт приглашение по email + роль. Сотрудник регистрируется
-- сам по этому email — при первом входе автоматически привязывается к компании.
-- Вставьте в Supabase → SQL Editor → Run.

create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,
  email       text not null,
  role        text default 'stock',
  name        text,
  created_at  timestamptz default now()
);
create index if not exists idx_invitations_email on public.invitations(lower(email));

-- RLS: приглашения могут создавать/удалять только admin или manager. Читать —
-- любой член компании (чтобы курьер видел, что ему приглашение уже пришло).
-- До этого политика была `for all` — курьер мог обойти UI-гейт и создать
-- приглашение через прямой Supabase API.
alter table public.invitations enable row level security;
drop policy if exists "inv_company" on public.invitations;
drop policy if exists "inv_read" on public.invitations;
drop policy if exists "inv_write" on public.invitations;

create policy "inv_read" on public.invitations
  for select to authenticated
  using (company_id = public.auth_company_id());

create policy "inv_write" on public.invitations
  for all to authenticated
  using (
    company_id = public.auth_company_id()
    and public.auth_role() in ('admin', 'manager')
  )
  with check (
    company_id = public.auth_company_id()
    and public.auth_role() in ('admin', 'manager')
  );

-- Принять приглашение: вызывается при первом входе, если у пользователя нет
-- компании. Находит СВЕЖЕЕ приглашение по email (order by created_at desc),
-- создаёт членство, удаляет использованное приглашение.
-- Если пользователь приглашён в несколько компаний — он попадёт в самое свежее;
-- остальные останутся в таблице (можно принять при следующем входе — но обычно
-- это редкий случай, важнее детерминированный выбор).
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
  select * into inv
    from public.invitations
    where lower(email) = lower(em)
    order by created_at desc
    limit 1;
  if inv.id is null then
    return null;
  end if;
  insert into public.memberships (user_id, company_id, role, name)
    values (auth.uid(), inv.company_id, inv.role, coalesce(inv.name, split_part(em, '@', 1)))
    on conflict (user_id, company_id) do nothing;
  delete from public.invitations
    where company_id = inv.company_id and lower(email) = lower(em);
  return inv.company_id;
end;
$$;
grant execute on function public.accept_invitation() to authenticated;
