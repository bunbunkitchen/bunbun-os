-- BUNBUN OS
-- Migration 032: allow one operation key to cover multiple stock movements
-- A multi-product release is one logical transaction, so operation_key must
-- not be unique per movement row. Idempotency is handled by the RPC checking
-- whether the submitted operation key already exists.

alter table public.product_stock_movements
  drop constraint if exists product_stock_movements_operation_key_unique;

create index if not exists product_stock_movements_operation_key_idx
  on public.product_stock_movements (operation_key)
  where operation_key is not null;
