-- ============================================================
-- BUNBUN OS
-- Migration 025: sub-recipe -> ingredient inventory bridge
--
-- A recipe may be used as a sub-recipe by another recipe. When that
-- sub-recipe is produced, its successful finished quantity must also become
-- ingredient inventory so the parent recipe can consume it.
-- ============================================================

alter table public.recipes
  add column if not exists output_ingredient_id bigint
    references public.ingredients(id);

alter table public.recipes
  add column if not exists output_ingredient_qty_per_unit numeric(14,6)
    not null default 1
    check (output_ingredient_qty_per_unit > 0);

create index if not exists
recipes_output_ingredient_id_idx
on public.recipes (output_ingredient_id)
where output_ingredient_id is not null
  and is_deleted = false;


-- For the current Bunbun data model, a sub-recipe normally has the same name
-- as the ingredient it produces (for example: Recipe Kunafa -> Ingredient
-- Kunafa). Backfill that explicit relation once so existing recipes work.
update public.recipes r
set output_ingredient_id = i.id
from public.ingredients i
where r.output_ingredient_id is null
  and r.is_deleted = false
  and i.is_deleted = false
  and i.is_active = true
  and lower(btrim(i.nama)) = lower(btrim(r.nama));


-- Keep the convention working for newly-created recipes when a matching
-- ingredient already exists. An explicitly supplied output_ingredient_id is
-- never overwritten.
create or replace function public.sync_recipe_output_ingredient()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ingredient_id bigint;
begin
  if new.output_ingredient_id is not null then
    return new;
  end if;

  select i.id
  into v_ingredient_id
  from public.ingredients i
  where i.is_deleted = false
    and i.is_active = true
    and lower(btrim(i.nama)) = lower(btrim(new.nama))
  order by i.id
  limit 1;

  new.output_ingredient_id := v_ingredient_id;
  return new;
end;
$$;

drop trigger if exists sync_recipe_output_ingredient_before_write
on public.recipes;

create trigger sync_recipe_output_ingredient_before_write
before insert or update of nama, output_ingredient_id
on public.recipes
for each row
execute function public.sync_recipe_output_ingredient();


-- If an ingredient is created after its recipe, link the existing recipe too.
create or replace function public.sync_recipe_output_from_ingredient()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_deleted = false and new.is_active = true then
    update public.recipes
    set output_ingredient_id = new.id,
        updated_at = now()
    where output_ingredient_id is null
      and is_deleted = false
      and lower(btrim(nama)) = lower(btrim(new.nama));
  end if;

  return new;
end;
$$;

drop trigger if exists sync_recipe_output_from_ingredient_after_write
on public.ingredients;

create trigger sync_recipe_output_from_ingredient_after_write
after insert or update of nama, is_active, is_deleted
on public.ingredients
for each row
execute function public.sync_recipe_output_from_ingredient();


-- ============================================================
-- Replace baking RPC so successful output of a recipe that is configured as
-- a sub-recipe is posted to ingredient inventory atomically with FINISHED_IN.
-- ============================================================

create or replace function public.record_baking_result(
  p_direct_split_id bigint,
  p_baked_good_qty integer,
  p_baked_reject_qty integer,
  p_movement_date date,
  p_operation_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_direct_split public.production_batch_splits%rowtype;
  v_total_good integer;
  v_total_reject integer;
  v_frozen_remaining integer;
  v_all_direct_baked boolean;
  v_recipe_id bigint;
  v_output_ingredient_id bigint;
  v_output_qty_per_unit numeric(14,6);
  v_output_unit text;
begin
  v_user_id := public.assert_frozen_flow_operator();

  if p_baked_good_qty is null or p_baked_reject_qty is null
    or p_baked_good_qty < 0 or p_baked_reject_qty < 0 then
    raise exception 'Hasil baking harus berupa bilangan bulat non-negatif.';
  end if;

  if p_movement_date is null or p_operation_key is null then
    raise exception 'Tanggal dan operation_key wajib diisi.';
  end if;

  if exists (
    select 1 from public.product_stock_movements m
    where m.operation_key = p_operation_key
  ) then
    raise exception 'Permintaan ini sudah pernah dicatat.' using errcode = '23505';
  end if;

  select s.* into v_direct_split
  from public.production_batch_splits s
  where s.id = p_direct_split_id
    and s.is_deleted = false
  for update;

  if not found or v_direct_split.route <> 'DIRECT'
    or v_direct_split.status not in ('PROOFING', 'BAKING') then
    raise exception 'Bagian direct tidak ditemukan atau hasil baking sudah dicatat.';
  end if;

  if p_baked_good_qty + p_baked_reject_qty <> v_direct_split.qty then
    raise exception 'Total berhasil dan reject baking harus tepat sama dengan jumlah bagian direct.';
  end if;

  perform 1
  from public.production_batches b
  where b.id = v_direct_split.production_batch_id
    and b.is_deleted = false
  for update;

  if not found then
    raise exception 'Production batch induk tidak ditemukan.';
  end if;

  update public.production_batch_splits
  set baked_good_qty = p_baked_good_qty,
      baked_reject_qty = p_baked_reject_qty,
      status = 'BAKED',
      updated_by = v_user_id
  where id = v_direct_split.id;

  if p_baked_good_qty > 0 then
    insert into public.product_stock_movements (
      movement_date, movement_type, product_id, batch_split_id, qty, unit,
      operation_key, notes, created_by, updated_by
    ) values (
      p_movement_date, 'FINISHED_IN', v_direct_split.product_id,
      v_direct_split.id, p_baked_good_qty, 'pcs', p_operation_key,
      'Hasil baking produk jadi', v_user_id, v_user_id
    );

    -- Find the recipe that produced this batch and its optional ingredient
    -- output mapping.
    select o.recipe_id,
           r.output_ingredient_id,
           r.output_ingredient_qty_per_unit,
           i.satuan
    into v_recipe_id,
         v_output_ingredient_id,
         v_output_qty_per_unit,
         v_output_unit
    from public.production_batches b
    join public.production_orders o
      on o.id = b.production_order_id
    join public.recipes r
      on r.id = o.recipe_id
    left join public.ingredients i
      on i.id = r.output_ingredient_id
    where b.id = v_direct_split.production_batch_id
      and b.is_deleted = false
      and o.is_deleted = false
      and r.is_deleted = false;

    if v_output_ingredient_id is not null then
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
      ) values (
        p_movement_date,
        'PRODUCTION_IN',
        v_output_ingredient_id,
        v_recipe_id,
        v_direct_split.production_batch_id,
        null,
        p_baked_good_qty * coalesce(v_output_qty_per_unit, 1),
        v_output_unit,
        'Hasil produksi sub-recipe masuk inventory',
        v_user_id,
        v_user_id
      );
    end if;
  end if;

  select coalesce(sum(s.baked_good_qty), 0)::integer,
         coalesce(sum(
           case when s.route = 'REJECT' then s.qty else s.baked_reject_qty end
         ), 0)::integer
  into v_total_good, v_total_reject
  from public.production_batch_splits s
  where s.production_batch_id = v_direct_split.production_batch_id
    and s.is_deleted = false;

  select coalesce(sum(
    case
      when m.movement_type = 'FROZEN_IN' then m.qty
      when m.movement_type = 'FROZEN_OUT' then -m.qty
      else 0
    end
  ), 0)::integer into v_frozen_remaining
  from public.product_stock_movements m
  join public.production_batch_splits s on s.id = m.batch_split_id
  where s.production_batch_id = v_direct_split.production_batch_id
    and m.is_deleted = false
    and s.is_deleted = false;

  select bool_and(s.status = 'BAKED') into v_all_direct_baked
  from public.production_batch_splits s
  where s.production_batch_id = v_direct_split.production_batch_id
    and s.route = 'DIRECT'
    and s.is_deleted = false;

  update public.production_batches
  set selesai = v_total_good,
      reject = v_total_reject,
      status = case
        when coalesce(v_all_direct_baked, true)
          and v_frozen_remaining = 0 then 'Finished'
        else 'Split'
      end,
      updated_by = v_user_id
  where id = v_direct_split.production_batch_id;

  return jsonb_build_object(
    'direct_split_id', v_direct_split.id,
    'baked_good_qty', p_baked_good_qty,
    'baked_reject_qty', p_baked_reject_qty,
    'production_batch_finished_qty', v_total_good,
    'production_batch_reject_qty', v_total_reject,
    'output_ingredient_id', v_output_ingredient_id,
    'output_ingredient_qty',
      case
        when v_output_ingredient_id is null then 0
        else p_baked_good_qty * coalesce(v_output_qty_per_unit, 1)
      end
  );
end;
$$;


-- ============================================================
-- One-time bridge for already-produced finished stock.
-- This converts the current finished-goods balance into ingredient inventory
-- for recipes that already have an output ingredient mapping.
-- ============================================================

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
  join public.production_orders o
    on o.recipe_id = r.id
  join public.production_batches b
    on b.production_order_id = o.id
  where m.product_id = r.product_id
    and m.is_deleted = false
    and b.is_deleted = false
    and o.is_deleted = false
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
