-- ============================================================
-- BUNBUN OS
-- Migration 027: sub-recipe inventory only
--
-- Sub-recipes are intermediate production outputs, not finished
-- products. Their successful production belongs in ingredient
-- inventory and must not appear in Stok Produk Jadi.
-- ============================================================

-- Block future FINISHED_IN movements for products whose recipe is
-- configured as a sub-recipe. The baking RPC from Migration 025 still
-- records the ingredient inventory transaction atomically in the same
-- database transaction, so this trigger only prevents the redundant
-- finished-product ledger entry.

create or replace function public.prevent_sub_recipe_finished_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.movement_type = 'FINISHED_IN' then
    if exists (
      select 1
      from public.recipes r
      where r.product_id = new.product_id
        and r.output_ingredient_id is not null
        and r.is_deleted = false
    ) then
      return null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_sub_recipe_finished_stock_before_insert
on public.product_stock_movements;

create trigger prevent_sub_recipe_finished_stock_before_insert
before insert on public.product_stock_movements
for each row
execute function public.prevent_sub_recipe_finished_stock();

-- Existing FINISHED_IN rows created for sub-recipes before this migration
-- are legacy ledger entries. Soft-delete them so they no longer inflate
-- Stok Produk Jadi. The corresponding inventory backfill was already
-- created by Migrations 025-026.
update public.product_stock_movements m
set is_deleted = true,
    updated_at = now()
where m.movement_type = 'FINISHED_IN'
  and m.is_deleted = false
  and exists (
    select 1
    from public.recipes r
    where r.product_id = m.product_id
      and r.output_ingredient_id is not null
      and r.is_deleted = false
  );
