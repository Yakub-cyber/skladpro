-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  updated_at на всех таблицах данных — для разрешения конфликтов синка.   ║
-- ║                                                                          ║
-- ║  Клиент штампует updated_at при каждой отправке (см. lib/cloud.js).      ║
-- ║  При merge на bootstrap серверная запись побеждает локальную, если её    ║
-- ║  updated_at свежее (иначе устаревшее локальное перекроет свежее серверное ║
-- ║  — гонка last-write-wins без версий).                                    ║
-- ║                                                                          ║
-- ║  БЕЗ триггера BEFORE UPDATE: сохраняем клиентское значение, иначе        ║
-- ║  серверный триггер всегда «выигрывал» бы у клиентского времени и         ║
-- ║  сравнение теряло бы смысл. Гонки на самом сервере (два одновременных    ║
-- ║  upsert) остаются last-write-wins по времени поступления — базовое       ║
-- ║  улучшение, не CRDT.                                                     ║
-- ║                                                                          ║
-- ║  Идемпотентно. Запускать ПОСЛЕ schema.sql + schema_saas.sql.             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

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
