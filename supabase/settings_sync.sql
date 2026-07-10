-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  Настройки компании в облаке: реквизиты (ИНН/КПП/банк), валюта и пр.   ║
-- ║  Одна jsonb-строка на компанию. Без неё настройки живут только в       ║
-- ║  localStorage — на другом устройстве счёт печатается без реквизитов.   ║
-- ║  Идемпотентно: можно запускать повторно.                               ║
-- ║  Вставьте целиком в Supabase → SQL Editor → Run.                       ║
-- ╚══════════════════════════════════════════════════════════════════════╝

create table if not exists public.settings (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz default now()
);

alter table public.settings enable row level security;

-- Читают все сотрудники компании
drop policy if exists "settings_read" on public.settings;
create policy "settings_read" on public.settings
  for select to authenticated
  using (company_id = public.auth_company_id());

-- Пишут все, кроме курьера (как у остальных таблиц данных, см. granular_rls.sql)
drop policy if exists "settings_write" on public.settings;
create policy "settings_write" on public.settings
  for all to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() <> 'courier')
  with check (company_id = public.auth_company_id() and public.auth_role() <> 'courier');

-- updated_at обновляется при каждом upsert
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
