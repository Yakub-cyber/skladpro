-- ── Приглашение сотрудников в компанию ───────────────────────────────────────
-- Админ создаёт приглашение по email + роль. Сотрудник регистрируется сам по
-- этому email — при первом входе автоматически привязывается к компании.
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

-- RLS: приглашениями управляют члены компании (видят/создают/удаляют свои)
alter table public.invitations enable row level security;
drop policy if exists "inv_company" on public.invitations;
create policy "inv_company" on public.invitations
  for all to authenticated
  using (company_id = public.auth_company_id())
  with check (company_id = public.auth_company_id());

-- Принять приглашение: вызывается при входе, если у пользователя нет компании.
-- Находит приглашение по email, создаёт членство, удаляет приглашение.
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
