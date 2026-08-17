-- ============================================================
-- BUNBUN OS
-- Migration 026: correct Migration 025 backfill aggregation
-- ============================================================

-- Migration 025 may have been run with a recipe/batch join that can multiply
-- finished-stock movements when a recipe has multiple production batches.
-- Remove only the dedicated 025 backfill rows, then rebuild them from the
-- product-stock ledger directly.

delete from public.inventory_transactions
where transaction_type = 'PRODUCTION_IN'
  and production_batch_id is null
  and notes = 'Backfill stok sub-recipe dari saldo produk jadi saat Migration 025';

insert into public.inventory_transactions (
  transaction_date,
  transaction_type,
  ingredient_id,
  recipe_id,
  production_batch_id,
  purchase_id,
  qty,
  unit,
  notes,
  created_by,
  updated_by
)
select
  current_date,
  'PRODUCTION_IN',
  r.output_ingredient_id,
  r.id,
  null,
  null,
  balance.saldo * coalesce(r.output_ingredient_qty_per_unit, 1),
  i.satuan,
  'Backfill stok sub-recipe dari saldo produk jadi saat Migration 025',
  null,
  null
from public.recipes r
join public.ingredients i
  on i.id = r.output_ingredient_id
join lateral (
  select
    coalesce(sum(
      case
        when m.movement_type in ('FINISHED_IN', 'OPENING_BALANCE') then m.qty
        when m.movement_type = 'CAFE_OUT' then -m.qty
        else 0
      end
    ), 0)::numeric as saldo
  from public.product_stock_movements m
  where m.product_id = r.product_id
    and m.is_deleted = false
) balance on true
where r.is_deleted = false
  and r.output_ingredient_id is not null
  and balance.saldo > 0
  and not exists (
    select 1
    from public.inventory_transactions t
    where t.recipe_id = r.id
      and t.transaction_type = 'PRODUCTION_IN'
      and t.production_batch_id is null
      and t.notes = 'Backfill stok sub-recipe dari saldo produk jadi saat Migration 025'
      and t.is_deleted = false
  );
