-- ============================================================
-- BUNBUN OS
-- Migration 028: sales item order type
--
-- Dine In / Take Away berada di level ITEM,
-- bukan level transaksi.
-- ============================================================

alter table public.sale_items
add column if not exists order_type text;

alter table public.sale_items
drop constraint if exists sale_items_order_type_check;

alter table public.sale_items
add constraint sale_items_order_type_check
check (
  order_type is null
  or order_type in ('DINE_IN', 'TAKE_AWAY')
);

create index if not exists idx_sale_items_order_type
on public.sale_items(order_type);
