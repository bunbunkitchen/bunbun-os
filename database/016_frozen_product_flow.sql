-- ============================================================
-- BUNBUN OS
-- Migration 016: frozen product flow foundation
--
-- This migration is additive. It does not alter historical production
-- results or inventory_transactions.
-- ============================================================

-- Keep every existing production batch status valid, then add the two
-- parent-batch states needed before and after shaping is split.
alter table public.production_batches
  drop constraint if exists production_batches_status_check;

alter table public.production_batches
  add constraint production_batches_status_check
  check (
    status in (
      'Waiting',
      'Mixing',
      'Proofing',
      'Baking',
      'Cooling',
      'Packing',
      'Finished',
      'Shaping',
      'Split'
    )
  );


-- A split represents one physical portion after shaping. A FROZEN split is
-- also the frozen lot. A DIRECT split can originate from a frozen lot through
-- source_split_id.
create table if not exists public.production_batch_splits (
  id bigint generated always as identity primary key,

  production_batch_id bigint not null
    references public.production_batches(id),

  product_id bigint not null
    references public.products(id),

  source_split_id bigint
    references public.production_batch_splits(id),

  route text not null
    check (route in ('FROZEN', 'DIRECT', 'REJECT')),

  lot_code text,

  qty integer not null
    check (qty >= 0),

  baked_good_qty integer not null default 0
    check (baked_good_qty >= 0),

  baked_reject_qty integer not null default 0
    check (baked_reject_qty >= 0),

  status text not null
    check (
      (route = 'FROZEN' and status = 'FROZEN')
      or (
        route = 'DIRECT'
        and status in ('PROOFING', 'BAKING', 'BAKED')
      )
      or (route = 'REJECT' and status = 'REJECTED')
    ),

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  is_deleted boolean not null default false,

  constraint production_batch_splits_lot_code_by_route_check
    check (
      (route = 'FROZEN' and nullif(btrim(lot_code), '') is not null)
      or (route <> 'FROZEN' and lot_code is null)
    ),

  constraint production_batch_splits_source_by_route_check
    check (
      source_split_id is null or route = 'DIRECT'
    ),

  constraint production_batch_splits_baking_result_check
    check (
      baked_good_qty + baked_reject_qty <= qty
    ),

  constraint production_batch_splits_non_direct_result_check
    check (
      route = 'DIRECT'
      or (baked_good_qty = 0 and baked_reject_qty = 0)
    )
);

-- Frozen lot code is unique permanently, including soft-deleted historical
-- lots, so a lot reference can never become ambiguous.
create unique index if not exists
production_batch_splits_frozen_lot_code_unique
on public.production_batch_splits (lower(lot_code))
where route = 'FROZEN';

create index if not exists
production_batch_splits_batch_id_idx
on public.production_batch_splits (production_batch_id)
where is_deleted = false;

create index if not exists
production_batch_splits_product_id_idx
on public.production_batch_splits (product_id)
where is_deleted = false;

create index if not exists
production_batch_splits_source_split_id_idx
on public.production_batch_splits (source_split_id)
where source_split_id is not null and is_deleted = false;


-- Immutable-style product ledger. Positive quantities are signed by type:
-- FROZEN_IN / FINISHED_IN / OPENING_BALANCE add stock; FROZEN_OUT / CAFE_OUT
-- remove stock from their respective balances.
create table if not exists public.product_stock_movements (
  id bigint generated always as identity primary key,

  movement_date date not null,

  movement_type text not null
    check (
      movement_type in (
        'FROZEN_IN',
        'FROZEN_OUT',
        'FINISHED_IN',
        'CAFE_OUT',
        'OPENING_BALANCE'
      )
    ),

  product_id bigint not null
    references public.products(id),

  batch_split_id bigint
    references public.production_batch_splits(id),

  qty integer not null
    check (qty > 0),

  unit text not null default 'pcs'
    check (unit = 'pcs'),

  -- Every ledger entry has a UUID from its operational request. The unique
  -- index below makes a repeated request harmless instead of double-posting.
  operation_key uuid not null,

  notes text,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  is_deleted boolean not null default false,

  constraint product_stock_movements_split_required_check
    check (
      (movement_type in ('FROZEN_IN', 'FROZEN_OUT', 'FINISHED_IN')
        and batch_split_id is not null)
      or movement_type in ('CAFE_OUT', 'OPENING_BALANCE')
    )
);

create unique index if not exists
product_stock_movements_operation_key_unique
on public.product_stock_movements (operation_key);

create unique index if not exists
product_stock_movements_frozen_in_once_per_split
on public.product_stock_movements (batch_split_id)
where movement_type = 'FROZEN_IN' and is_deleted = false;

create unique index if not exists
product_stock_movements_finished_in_once_per_split
on public.product_stock_movements (batch_split_id)
where movement_type = 'FINISHED_IN' and is_deleted = false;

create index if not exists
product_stock_movements_product_date_idx
on public.product_stock_movements (product_id, movement_date)
where is_deleted = false;

create index if not exists
product_stock_movements_frozen_lot_idx
on public.product_stock_movements (batch_split_id, movement_type)
where is_deleted = false;


drop trigger if exists set_production_batch_splits_updated_at
on public.production_batch_splits;

create trigger set_production_batch_splits_updated_at
before update on public.production_batch_splits
for each row
execute function public.set_updated_at();

drop trigger if exists set_product_stock_movements_updated_at
on public.product_stock_movements;

create trigger set_product_stock_movements_updated_at
before update on public.product_stock_movements
for each row
execute function public.set_updated_at();


-- Direct reads are available to operational roles. Inserts and updates are
-- intentionally only performed by the RPCs below, so ledger invariants cannot
-- be bypassed from the client.
alter table public.production_batch_splits enable row level security;
alter table public.product_stock_movements enable row level security;

drop policy if exists "Operational users can read production batch splits"
on public.production_batch_splits;

create policy "Operational users can read production batch splits"
on public.production_batch_splits
for select
to authenticated
using (
  public.is_owner_baker_or_helper()
  and is_deleted = false
);

drop policy if exists "Operational users can read product stock movements"
on public.product_stock_movements;

create policy "Operational users can read product stock movements"
on public.product_stock_movements
for select
to authenticated
using (
  public.is_owner_baker_or_helper()
  and is_deleted = false
);

revoke all on table public.production_batch_splits from anon;
revoke all on table public.product_stock_movements from anon;
revoke all on table public.production_batch_splits from authenticated;
revoke all on table public.product_stock_movements from authenticated;
grant select on table public.production_batch_splits to authenticated;
grant select on table public.product_stock_movements to authenticated;


-- Shared authorization guard for every operational RPC.
create or replace function public.assert_frozen_flow_operator()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null
    or not public.is_owner_baker_or_helper() then
    raise exception 'Akses operasional produksi tidak diizinkan.'
      using errcode = '42501';
  end if;

  return v_user_id;
end;
$$;


-- Atomically records the complete split of one shaped parent batch. The sum
-- must equal the source batch target, preventing untracked remainder or an
-- over-allocation. It also records FROZEN_IN for the newly-created lot.
create or replace function public.record_shaping_split(
  p_production_batch_id bigint,
  p_product_id bigint,
  p_frozen_qty integer,
  p_direct_qty integer,
  p_reject_qty integer,
  p_frozen_lot_code text,
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
  v_batch public.production_batches%rowtype;
  v_recipe_product_id bigint;
  v_frozen_split_id bigint;
  v_direct_split_id bigint;
  v_reject_split_id bigint;
begin
  v_user_id := public.assert_frozen_flow_operator();

  if p_frozen_qty is null or p_direct_qty is null or p_reject_qty is null
    or p_frozen_qty < 0 or p_direct_qty < 0 or p_reject_qty < 0 then
    raise exception 'Jumlah shaping harus berupa bilangan bulat non-negatif.';
  end if;

  if p_operation_key is null then
    raise exception 'operation_key wajib diisi untuk pembagian shaping.';
  end if;

  if p_movement_date is null then
    raise exception 'Tanggal pembagian shaping wajib diisi.';
  end if;

  select b.* into v_batch
  from public.production_batches b
  where b.id = p_production_batch_id
    and b.is_deleted = false
  for update;

  if not found then
    raise exception 'Production batch tidak ditemukan.';
  end if;

  if v_batch.status <> 'Shaping' then
    raise exception 'Batch harus berada pada status Shaping sebelum dibagi.';
  end if;

  if v_batch.target <> trunc(v_batch.target)
    or p_frozen_qty + p_direct_qty + p_reject_qty <> v_batch.target::integer then
    raise exception 'Total frozen, direct, dan reject harus tepat sama dengan target batch.';
  end if;

  select r.product_id into v_recipe_product_id
  from public.production_orders o
  join public.recipes r on r.id = o.recipe_id
  join public.products p on p.id = r.product_id
  where o.id = v_batch.production_order_id
    and o.is_deleted = false
    and r.is_deleted = false
    and p.is_deleted = false
    and p.is_active = true;

  if v_recipe_product_id is null or v_recipe_product_id <> p_product_id then
    raise exception 'Produk harus sesuai dengan produk yang terhubung pada recipe batch.';
  end if;

  if exists (
    select 1
    from public.production_batch_splits s
    where s.production_batch_id = v_batch.id
      and s.is_deleted = false
  ) then
    raise exception 'Hasil shaping untuk batch ini sudah pernah dibagi.';
  end if;

  if p_frozen_qty > 0
    and nullif(btrim(p_frozen_lot_code), '') is null then
    raise exception 'Kode lot wajib diisi ketika ada hasil frozen.';
  end if;

  if p_frozen_qty = 0 and p_frozen_lot_code is not null then
    raise exception 'Kode lot hanya boleh diisi ketika ada hasil frozen.';
  end if;

  if p_frozen_qty > 0 then
    insert into public.production_batch_splits (
      production_batch_id, product_id, route, lot_code, qty, status,
      created_by, updated_by
    ) values (
      v_batch.id, p_product_id, 'FROZEN', btrim(p_frozen_lot_code),
      p_frozen_qty, 'FROZEN', v_user_id, v_user_id
    ) returning id into v_frozen_split_id;

    insert into public.product_stock_movements (
      movement_date, movement_type, product_id, batch_split_id, qty, unit,
      operation_key, notes, created_by, updated_by
    ) values (
      p_movement_date, 'FROZEN_IN', p_product_id, v_frozen_split_id,
      p_frozen_qty, 'pcs', p_operation_key, 'Hasil shaping masuk freezer',
      v_user_id, v_user_id
    );
  end if;

  if p_direct_qty > 0 then
    insert into public.production_batch_splits (
      production_batch_id, product_id, route, qty, status, created_by, updated_by
    ) values (
      v_batch.id, p_product_id, 'DIRECT', p_direct_qty, 'PROOFING',
      v_user_id, v_user_id
    ) returning id into v_direct_split_id;
  end if;

  if p_reject_qty > 0 then
    insert into public.production_batch_splits (
      production_batch_id, product_id, route, qty, status, created_by, updated_by
    ) values (
      v_batch.id, p_product_id, 'REJECT', p_reject_qty, 'REJECTED',
      v_user_id, v_user_id
    ) returning id into v_reject_split_id;
  end if;

  update public.production_batches
  set status = 'Split',
      selesai = 0,
      reject = p_reject_qty,
      updated_by = v_user_id
  where id = v_batch.id;

  return jsonb_build_object(
    'production_batch_id', v_batch.id,
    'frozen_split_id', v_frozen_split_id,
    'direct_split_id', v_direct_split_id,
    'reject_split_id', v_reject_split_id
  );
end;
$$;


-- Atomically releases a quantity from one frozen lot and creates the direct
-- portion that will continue through proofing and baking.
create or replace function public.release_frozen_stock(
  p_frozen_split_id bigint,
  p_qty integer,
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
  v_frozen_split public.production_batch_splits%rowtype;
  v_frozen_balance integer;
  v_direct_split_id bigint;
begin
  v_user_id := public.assert_frozen_flow_operator();

  if p_qty is null or p_qty <= 0 then
    raise exception 'Jumlah frozen yang dikeluarkan harus lebih dari 0.';
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

  select s.* into v_frozen_split
  from public.production_batch_splits s
  where s.id = p_frozen_split_id
    and s.is_deleted = false
  for update;

  if not found or v_frozen_split.route <> 'FROZEN'
    or v_frozen_split.status <> 'FROZEN' then
    raise exception 'Lot frozen tidak ditemukan atau tidak dapat dikeluarkan.';
  end if;

  select coalesce(sum(
    case
      when m.movement_type = 'FROZEN_IN' then m.qty
      when m.movement_type = 'FROZEN_OUT' then -m.qty
      else 0
    end
  ), 0)::integer into v_frozen_balance
  from public.product_stock_movements m
  where m.batch_split_id = v_frozen_split.id
    and m.is_deleted = false;

  if p_qty > v_frozen_balance then
    raise exception 'Stok frozen lot tidak cukup. Saldo tersedia: % pcs.', v_frozen_balance;
  end if;

  insert into public.product_stock_movements (
    movement_date, movement_type, product_id, batch_split_id, qty, unit,
    operation_key, notes, created_by, updated_by
  ) values (
    p_movement_date, 'FROZEN_OUT', v_frozen_split.product_id,
    v_frozen_split.id, p_qty, 'pcs', p_operation_key,
    'Frozen dikeluarkan untuk proofing', v_user_id, v_user_id
  );

  insert into public.production_batch_splits (
    production_batch_id, product_id, source_split_id, route, qty, status,
    created_by, updated_by
  ) values (
    v_frozen_split.production_batch_id, v_frozen_split.product_id,
    v_frozen_split.id, 'DIRECT', p_qty, 'PROOFING', v_user_id, v_user_id
  ) returning id into v_direct_split_id;

  return jsonb_build_object(
    'frozen_split_id', v_frozen_split.id,
    'released_qty', p_qty,
    'remaining_frozen_qty', v_frozen_balance - p_qty,
    'direct_split_id', v_direct_split_id
  );
end;
$$;


-- Atomically records the complete baking result of a direct portion and adds
-- only successful output to finished-goods stock.
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

  -- Serialize aggregate updates for sibling direct splits. Without this lock,
  -- two baking requests for the same parent could each calculate totals before
  -- seeing the other's committed result.
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
    'production_batch_reject_qty', v_total_reject
  );
end;
$$;


-- Atomically removes product stock that has been baked successfully and is
-- being deposited to the cafe. It may span multiple baking lots, hence the
-- optional batch split reference is intentionally not required here.
create or replace function public.record_cafe_deposit(
  p_product_id bigint,
  p_qty integer,
  p_movement_date date,
  p_operation_key uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_finished_balance integer;
  v_movement_id bigint;
begin
  v_user_id := public.assert_frozen_flow_operator();

  if p_qty is null or p_qty <= 0 then
    raise exception 'Jumlah setoran ke kafe harus lebih dari 0.';
  end if;

  if p_movement_date is null or p_operation_key is null then
    raise exception 'Tanggal dan operation_key wajib diisi.';
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = p_product_id
      and p.is_deleted = false
      and p.is_active = true
  ) then
    raise exception 'Produk aktif tidak ditemukan.';
  end if;

  if exists (
    select 1 from public.product_stock_movements m
    where m.operation_key = p_operation_key
  ) then
    raise exception 'Permintaan ini sudah pernah dicatat.' using errcode = '23505';
  end if;

  -- Serialize all cafe deposits for one product. This prevents two concurrent
  -- requests from reading the same finished-goods balance.
  perform 1
  from public.products p
  where p.id = p_product_id
  for update;

  select coalesce(sum(
    case
      when m.movement_type in ('FINISHED_IN', 'OPENING_BALANCE') then m.qty
      when m.movement_type = 'CAFE_OUT' then -m.qty
      else 0
    end
  ), 0)::integer into v_finished_balance
  from public.product_stock_movements m
  where m.product_id = p_product_id
    and m.is_deleted = false;

  if p_qty > v_finished_balance then
    raise exception 'Stok produk jadi tidak cukup. Saldo tersedia: % pcs.', v_finished_balance;
  end if;

  insert into public.product_stock_movements (
    movement_date, movement_type, product_id, qty, unit, operation_key,
    notes, created_by, updated_by
  ) values (
    p_movement_date, 'CAFE_OUT', p_product_id, p_qty, 'pcs', p_operation_key,
    nullif(btrim(p_notes), ''), v_user_id, v_user_id
  ) returning id into v_movement_id;

  return jsonb_build_object(
    'movement_id', v_movement_id,
    'product_id', p_product_id,
    'deposited_qty', p_qty,
    'remaining_finished_qty', v_finished_balance - p_qty
  );
end;
$$;


-- Functions are the only write surface for the new operational flow.
revoke all on function public.assert_frozen_flow_operator() from public;
revoke all on function public.record_shaping_split(bigint, bigint, integer, integer, integer, text, date, uuid) from public;
revoke all on function public.release_frozen_stock(bigint, integer, date, uuid) from public;
revoke all on function public.record_baking_result(bigint, integer, integer, date, uuid) from public;
revoke all on function public.record_cafe_deposit(bigint, integer, date, uuid, text) from public;

revoke all on function public.assert_frozen_flow_operator() from anon;
revoke all on function public.record_shaping_split(bigint, bigint, integer, integer, integer, text, date, uuid) from anon;
revoke all on function public.release_frozen_stock(bigint, integer, date, uuid) from anon;
revoke all on function public.record_baking_result(bigint, integer, integer, date, uuid) from anon;
revoke all on function public.record_cafe_deposit(bigint, integer, date, uuid, text) from anon;

grant execute on function public.record_shaping_split(bigint, bigint, integer, integer, integer, text, date, uuid) to authenticated;
grant execute on function public.release_frozen_stock(bigint, integer, date, uuid) to authenticated;
grant execute on function public.record_baking_result(bigint, integer, integer, date, uuid) to authenticated;
grant execute on function public.record_cafe_deposit(bigint, integer, date, uuid, text) to authenticated;
