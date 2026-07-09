-- ─────────────────────────────────────────────────────────────────────────────
--  Миграция облачных данных на модель РЕЗЕРВИРОВАНИЯ остатков.
--  Выполнить ОДИН РАЗ в SQL-редакторе Supabase (для компаний, созданных до
--  перехода на резерв). Для новых компаний ничего делать не нужно — колонка
--  добавлена в schema.sql, а seed приходит уже с корректным stock_consumed.
--
--  Что меняется: раньше заказ списывал остаток при СОЗДАНИИ; теперь открытый
--  заказ лишь резервирует (списание при отгрузке). Поэтому открытым заказам
--  разово возвращаем остаток на склад (его удержит резерв, вычисляемый на лету),
--  а флаг stock_consumed выводим из статуса.
--
--  Идемпотентно: повторный запуск ничего не испортит (после первого прогона
--  stock_consumed у всех заказов уже НЕ NULL, поэтому возврат не повторяется).
--  Ограничение: коды маркировки «Честный знак» открытых заказов на сервере не
--  восстанавливаются (лежат внутри jsonb items) — учёт КМ поправится при работе
--  через клиент. Для складов без маркировки не актуально.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Колонка-флаг. Добавляем БЕЗ default, чтобы NULL отмечал «ещё не мигрирован».
alter table public.orders add column if not exists stock_consumed boolean;

-- 2) Разовый возврат остатка открытым заказам (которые по старой модели уже его
--    списали при создании). Суммируем количество по позициям и возвращаем товару.
update public.products p
set stock = coalesce(p.stock, 0) + gb.qty
from (
  select it->>'productId' as product_id,
         sum((it->>'qty')::numeric) as qty
  from public.orders o
  cross join lateral jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) as it
  where o.stock_consumed is null
    and o.status in ('new', 'confirmed', 'picking', 'packed')
  group by it->>'productId'
) gb
where p.id = gb.product_id;

-- 3) Проставляем флаг: отгружённые/доставленные уже списаны, остальные — нет.
update public.orders
set stock_consumed = (status in ('shipped', 'delivered'))
where stock_consumed is null;

-- 4) Теперь у колонки осмысленный default для будущих вставок.
alter table public.orders alter column stock_consumed set default false;
