-- BUNBUN OS / PRIVATE LOT RELEASE STAGING (SQL DESIGN + CI EXECUTION ONLY)
-- ABSOLUTELY DO NOT RUN THIS FILE ON THE LIVE SUPABASE PROJECT.
-- It is a draft for an isolated DB and requires a separate staging deployment,
-- verified authentic Owner login and approved physical opening before go-live.
--
-- Existing operational RPC record_multi_product_release is NOT changed here.
-- It must be replaced/guarded at cutover so no writers bypass lot accounting.

create schema if not exists bunbun_accounting;
revoke all on schema bunbun_accounting from public, anon, authenticated;
grant usage on schema bunbun_accounting to service_role;

-- Lot identity is a ROOT or derived split ID, not just lot_code (Bunbun
-- legitimately reuses one lot_code across several splits of one batch).
create table bunbun_accounting.finished_lot_positions (
  lot_key text primary key
    check (lot_key ~ '^(split:[1-9][0-9]*|opening:[A-Za-z0-9_-]{4,64})$'),
  product_id bigint not null references public.products(id) on delete restrict,
  source_type text not null
    check (source_type in ('DIRECT_RELEASE','FROZEN_CONVERSION','OPENING')),
  source_split_id bigint references public.production_batch_splits(id) on delete restrict,
  location text not null default 'FINISHED' check (location = 'FINISHED'),
  first_available_on date not null,
  source_evidence text not null check (char_length(btrim(source_evidence)) >= 6),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null,
  original_qty integer not null check (original_qty > 0),
  available_qty integer not null check (available_qty >= 0 and available_qty <= original_qty),
  created_at timestamptz not null default now(),
  check ((source_type = 'OPENING' and source_split_id is null
          and lot_key like 'opening:%')
      or (source_type <> 'OPENING' and source_split_id is not null
          and lot_key = 'split:' || source_split_id::text))
);

create index lot_positions_by_product
  on bunbun_accounting.finished_lot_positions(product_id, lot_key);

create table bunbun_accounting.lot_release_operations (
  operation_key uuid primary key,
  payload_fingerprint text not null check (length(payload_fingerprint) = 32),
  movement_date date not null,
  destination text not null check (char_length(btrim(destination)) >= 2),
  destination_type text not null check
    (destination_type in ('CAFE_CONSIGNMENT','EVENT_RELEASE',
                         'DIRECT_ORDER_RELEASE','SAMPLE_RELEASE','OTHER_RELEASE')),
  evidence_ref text not null check (char_length(btrim(evidence_ref)) >= 6),
  status text not null default 'PROCESSING' check (status in ('PROCESSING','RECORDED')),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table bunbun_accounting.lot_release_allocations (
  id bigint generated always as identity primary key,
  operation_key uuid not null references bunbun_accounting.lot_release_operations(operation_key)
    on delete restrict,
  stock_movement_id bigint not null references public.product_stock_movements(id)
    on delete restrict,
  lot_key text not null references bunbun_accounting.finished_lot_positions(lot_key)
    on delete restrict,
  product_id bigint not null references public.products(id) on delete restrict,
  qty integer not null check (qty > 0),
  created_at timestamptz not null default now(),
  unique (stock_movement_id, lot_key)
);

create index lot_release_allocations_by_lot
  on bunbun_accounting.lot_release_allocations(lot_key, stock_movement_id);

-- Once recorded, the allocation is permanent audit evidence.
create or replace function bunbun_accounting.protect_recorded_lot_release()
returns trigger language plpgsql security invoker
set search_path = pg_catalog
as $fn$
begin
  if tg_table_name = 'lot_release_allocations' then
    raise exception 'Lot allocations are immutable: create a reviewed reversal';
  end if;
  if tg_table_name = 'lot_release_operations' and old.status = 'RECORDED' then
    raise exception 'Recorded lot release cannot be edited or deleted';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$fn$;

create trigger lot_release_allocation_immutable
before update or delete on bunbun_accounting.lot_release_allocations
for each row execute function bunbun_accounting.protect_recorded_lot_release();

create trigger lot_release_operation_immutable
before update or delete on bunbun_accounting.lot_release_operations
for each row execute function bunbun_accounting.protect_recorded_lot_release();

-- Atomic release of FINISHED lot stock + existing product-level stock movement.
-- Only a trusted staging service_role may invoke after validating the REAL
-- Owner JWT/session. The actor_id is NEVER accepted from an untrusted browser.
-- The function itself checks fresh active Owner profile as defense in depth.
--
-- p_items JSON:
-- [{"productId":1,"quantity":8,"allocations":[{"lotKey":"split:101","qty":5},
--                                           {"lotKey":"split:102","qty":3}]}]
--
-- The service must send a newly authenticated, stable operation_key UUID.
create or replace function bunbun_accounting.record_lot_assigned_release(
  p_movement_date date,
  p_destination text,
  p_destination_type text,
  p_evidence_ref text,
  p_items jsonb,
  p_operation_key uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql security invoker
set search_path = pg_catalog
as $fn$
declare
  v_fingerprint text;
  v_existing bunbun_accounting.lot_release_operations%rowtype;
  v_item jsonb;
  v_allocation jsonb;
  v_product_id bigint;
  v_qty integer;
  v_alloc_qty integer;
  v_alloc_total bigint;
  v_product public.products%rowtype;
  v_lot bunbun_accounting.finished_lot_positions%rowtype;
  v_lot_key text;
  v_seen_products bigint[] := array[]::bigint[];
  v_seen_lots text[];
  v_balanced_stock bigint;
  v_available_stock bigint;
  v_movement_id bigint;
  v_movement_ids bigint[] := array[]::bigint[];
  v_count integer := 0;
  v_alloc_count integer := 0;
begin
  if current_user <> 'service_role' then
    raise exception 'Trusted service role required for lot release';
  end if;
  if p_actor_id is null or not exists (
    select 1 from public.profiles
    where id = p_actor_id and role::text = 'owner' and is_active = true
  ) then
    raise exception 'Active Owner approval required for lot release';
  end if;
  if p_movement_date is null or p_operation_key is null or
    p_movement_date < date '2026-11-01' then
    -- The date literal here is a CI-stage floor only, NOT an approved
    -- Bunbun production cutover. Production must query approved opening.
    raise exception 'Approved cutover and operation key required';
  end if;
  if p_destination is null or char_length(btrim(p_destination)) < 2
     or char_length(p_destination) > 160
     or p_destination_type not in (
       'CAFE_CONSIGNMENT','EVENT_RELEASE','DIRECT_ORDER_RELEASE',
       'SAMPLE_RELEASE','OTHER_RELEASE'
     )
     or p_evidence_ref is null or char_length(btrim(p_evidence_ref)) < 6 then
    raise exception 'Destination classification and evidence required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 100 then
    raise exception 'Release requires 1-100 products';
  end if;
  v_fingerprint := md5(concat_ws('|',
    p_movement_date::text, p_destination, p_destination_type,
    p_evidence_ref, p_items::text
  ));

  -- UNIQUE operation key serializes retries; different payload is rejected.
  insert into bunbun_accounting.lot_release_operations
    (operation_key, payload_fingerprint, movement_date, destination,
     destination_type, evidence_ref, actor_id)
  values
    (p_operation_key, v_fingerprint, p_movement_date, btrim(p_destination),
     p_destination_type, p_evidence_ref, p_actor_id)
  on conflict (operation_key) do nothing;

  select * into v_existing from bunbun_accounting.lot_release_operations
  where operation_key = p_operation_key for update;

  if v_existing.payload_fingerprint <> v_fingerprint or
    v_existing.actor_id <> p_actor_id then
    raise exception 'Operation key reused with different release payload or actor';
  end if;
  if v_existing.status = 'RECORDED' then
    return jsonb_build_object(
      'operation_key', p_operation_key, 'already_exists', true,
      'movement_ids', (
        select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb)
        from public.product_stock_movements m
        where m.operation_key = p_operation_key and m.is_deleted = false
      )
    );
  end if;

  -- Lock products in canonical ID order; existing Bunbun RPCs also lock
  -- product row before checking aggregate finished stock. At activation
  -- EVERY finished-out path must be switched to this controlled writer.
  for v_item in
    select value from jsonb_array_elements(p_items)
    order by (value->>'productId')::bigint
  loop
    if coalesce(v_item->>'productId','') !~ '^[1-9][0-9]*$' or
      coalesce(v_item->>'quantity','') !~ '^[1-9][0-9]*$' or
      jsonb_typeof(v_item->'allocations') <> 'array' or
      jsonb_array_length(v_item->'allocations') = 0 then
      raise exception 'Invalid product and lot quantities';
    end if;
    v_product_id := (v_item->>'productId')::bigint;
    v_qty := (v_item->>'quantity')::integer;
    if v_product_id = any(v_seen_products) then
      raise exception 'Duplicate product in release';
    end if;
    v_seen_products := array_append(v_seen_products, v_product_id);

    select * into v_product from public.products
    where id = v_product_id and is_deleted = false and is_active = true
    for update;
    if not found then raise exception 'Active product not found'; end if;

    -- Lock all finished positions belonging to this product, so competing
    -- allocations cannot each spend the same physical lot units.
    perform 1 from bunbun_accounting.finished_lot_positions
    where product_id = v_product_id order by lot_key for update;

    select coalesce(sum(available_qty),0) into v_available_stock
    from bunbun_accounting.finished_lot_positions
    where product_id = v_product_id and location = 'FINISHED';
    select coalesce(sum(case
      when movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN')
        then qty
      when movement_type = 'CAFE_OUT' then -qty
      else 0 end),0) into v_balanced_stock
    from public.product_stock_movements
    where product_id = v_product_id and is_deleted = false;

    if v_available_stock <> v_balanced_stock then
      raise exception 'Finished stock/lot ledger diverged; cutover reconciliation required';
    end if;
    if v_qty > v_available_stock then
      raise exception 'Finished stock insufficient for requested release';
    end if;

    v_alloc_total := 0;
    v_seen_lots := array[]::text[];
    for v_allocation in select value from jsonb_array_elements(v_item->'allocations')
    loop
      v_lot_key := v_allocation->>'lotKey';
      if coalesce(v_lot_key,'') !~ '^(split:[1-9][0-9]*|opening:[A-Za-z0-9_-]{4,64})$'
         or coalesce(v_allocation->>'qty','') !~ '^[1-9][0-9]*$' then
        raise exception 'Invalid lot identity or quantity';
      end if;
      v_alloc_qty := (v_allocation->>'qty')::integer;
      if v_lot_key = any(v_seen_lots) then
        raise exception 'Duplicate lot in one product release';
      end if;
      v_seen_lots := array_append(v_seen_lots, v_lot_key);
      select * into v_lot from bunbun_accounting.finished_lot_positions
      where lot_key = v_lot_key for update;

      if not found or v_lot.product_id <> v_product_id or
        v_lot.location <> 'FINISHED' or
        v_lot.first_available_on > p_movement_date then
        raise exception 'Lot is not available for this product/release date';
      end if;
      if v_lot.available_qty < v_alloc_qty then
        raise exception 'Requested lot quantity exceeds available stock';
      end if;
      v_alloc_total := v_alloc_total + v_alloc_qty;
      if v_alloc_total > v_qty then
        raise exception 'Lot allocation exceeds requested product quantity';
      end if;
    end loop;
    if v_alloc_total <> v_qty then
      raise exception 'Lot allocations do not equal product release quantity';
    end if;

    -- Only for the current SQL transaction: the trigger allows this exact
    -- operation's stock INSERT; deferred constraint then proves its complete
    -- per-lot allocations at commit. Marker alone is not authorization.
    perform set_config(
      'bunbun_accounting.lot_write_operation', p_operation_key::text, true
    );

    insert into public.product_stock_movements (
      movement_date, movement_type, product_id, qty, unit, operation_key,
      sale_id, notes, is_deleted, created_by, updated_by
    ) values (
      p_movement_date, 'CAFE_OUT', v_product_id, v_qty, 'pcs', p_operation_key,
      null, 'Lot tracked ' || p_destination_type || ': ' || btrim(p_destination),
      false, p_actor_id, p_actor_id
    ) returning id into v_movement_id;

    for v_allocation in select value from jsonb_array_elements(v_item->'allocations')
    loop
      v_lot_key := v_allocation->>'lotKey';
      v_alloc_qty := (v_allocation->>'qty')::integer;
      update bunbun_accounting.finished_lot_positions
        set available_qty = available_qty - v_alloc_qty
      where lot_key = v_lot_key;
      insert into bunbun_accounting.lot_release_allocations
        (operation_key, stock_movement_id, lot_key, product_id, qty)
      values
        (p_operation_key, v_movement_id, v_lot_key, v_product_id, v_alloc_qty);
      v_alloc_count := v_alloc_count + 1;
    end loop;
    v_count := v_count + 1;
    v_movement_ids := array_append(v_movement_ids, v_movement_id);
  end loop;

  update bunbun_accounting.lot_release_operations
    set status = 'RECORDED' where operation_key = p_operation_key;

  return jsonb_build_object(
    'operation_key', p_operation_key, 'already_exists', false,
    'movement_ids', to_jsonb(v_movement_ids),
    'product_count', v_count, 'allocation_count', v_alloc_count,
    'accounting_posted', false, 'cogs_created', false
  );
end
$fn$;

-- Strict private access, not an exposed public RPC.
alter table bunbun_accounting.finished_lot_positions enable row level security;
alter table bunbun_accounting.lot_release_operations enable row level security;
alter table bunbun_accounting.lot_release_allocations enable row level security;

revoke all on all tables in schema bunbun_accounting
  from public, anon, authenticated;
revoke all on all sequences in schema bunbun_accounting
  from public, anon, authenticated;
revoke all on function bunbun_accounting.record_lot_assigned_release(
  date,text,text,text,jsonb,uuid,uuid
) from public, anon, authenticated;
grant usage on schema bunbun_accounting to service_role;
grant select, insert, update on all tables in schema bunbun_accounting to service_role;
grant usage, select on all sequences in schema bunbun_accounting to service_role;
grant execute on function bunbun_accounting.record_lot_assigned_release(
  date,text,text,text,jsonb,uuid,uuid
) to service_role;

-- TODO BEFORE ANY REAL DEPLOY:
-- 1. Remove CI-only cutoff literal and query the immutable approved opening.
-- 2. Introduce trusted backend service verifying genuine Owner JWT,
--    live auth session, source invoices, physical count, and source lot IDs.
-- 3. Bind each split to real FINISHED_IN/FROZEN_OUT events; forbid manually
--    seeding "approved" rows without proof and cost audit.
-- 4. Handle outgoing sale RPC, cafe returns, reversals, adjustments, deletions,
--    historical opening stock and all other finished-product writers in the
--    SAME lot ledger. Do not activate while old RPCs can bypass it.
-- 5. Add cross-session concurrency tests and source truth integrity tests.
-- 6. Roll forward with isolated Supabase staging, RLS/security advisor,
--    genuine Owner/Baker Auth and rollback drill before production.
