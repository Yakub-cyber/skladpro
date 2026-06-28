-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  documents — реестр складских документов (закупка/продажа/списание/        ║
-- ║  возвраты/перемещение/инвентаризация) с номером и статусом                 ║
-- ║  (черновик/проведён/отменён). Применять ПОСЛЕ schema.sql + schema_saas.sql ║
-- ║  Код устойчив к отсутствию таблицы — до применения этого SQL приложение    ║
-- ║  работает, документы просто не синхронизируются.                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.documents (
  id              text primary key,
  no              text,
  type            text,                        -- purchase/sale/writeoff/sale_return/supplier_return/transfer/inventory
  status          text default 'posted',       -- draft / posted / cancelled
  items           jsonb default '[]'::jsonb,   -- [{productId,name,unit,qty,(prevStock|fromWh)}]
  to_warehouse_id text,                         -- склад назначения (перемещение)
  reason          text,
  note            text,
  total_qty       numeric default 0,
  "by"            text,                         -- id сотрудника
  created_at      timestamptz default now(),
  posted_at       timestamptz,
  cancelled_at    timestamptz,
  company_id      uuid references public.companies(id) on delete cascade
);

create index if not exists idx_documents_company on public.documents(company_id);

-- RLS: тенант видит/пишет только свои документы (как остальные таблицы)
alter table public.documents enable row level security;
drop policy if exists "auth_all" on public.documents;
drop policy if exists "tenant_all" on public.documents;
create policy "tenant_all" on public.documents
  for all to authenticated
  using (company_id = public.auth_company_id())
  with check (company_id = public.auth_company_id());
