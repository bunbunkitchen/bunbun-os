-- ISOLATED STAGING pkgrqalpazhwdcxmthvb ONLY. Caller must verify ref.
-- Real operational schema adapter; no synthetic tables or relaxed constraints.
-- No UI activation, public RPC replacement, cost posting or opening approval.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';

create schema if not exists bunbun_accounting;
revoke all on schema bunbun_accounting from public, anon, authenticated;
grant usage on schema bunbun_accounting to service_role;

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

    perform 1 from bunbun_accounting.finished_lot_positions
    where product_id = v_product_id order by lot_key for update;

    select coalesce(sum(available_qty),0) into v_available_stock
    from bunbun_accounting.finished_lot_positions
    where product_id = v_product_id and location = 'FINISHED';
    select coalesce(sum(case
      when movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN')
        then qty
      when movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -qty
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


create table bunbun_accounting.lot_tracking_control (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'OFF' check (mode in ('OFF','ON')),
  cutover_on date,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  check (mode = 'OFF' or (
    cutover_on is not null and approved_by is not null and approved_at is not null
  ))
);

insert into bunbun_accounting.lot_tracking_control (singleton,mode)
values (true,'OFF');

alter table bunbun_accounting.lot_tracking_control enable row level security;
revoke all on bunbun_accounting.lot_tracking_control from public,anon,authenticated;
grant select on bunbun_accounting.lot_tracking_control to service_role;

create or replace function bunbun_accounting.enforce_lot_stock_writer()
returns trigger language plpgsql security invoker
set search_path = pg_catalog
as $fn$
declare
 v_control bunbun_accounting.lot_tracking_control%rowtype;
 v_marker text;
begin
 select * into v_control
 from bunbun_accounting.lot_tracking_control where singleton;
 if not found then
   raise exception 'Lot tracking control missing, block stock mutation';
 end if;
 if v_control.mode = 'OFF' then
   if tg_op = 'DELETE' then return old; end if;
   return new;
 end if;

 if tg_op <> 'INSERT' then
   raise exception 'Tracked stock is append-only; reverse through reviewed lot-aware procedure';
 end if;
 v_marker := current_setting('bunbun_accounting.lot_write_operation', true);
 if current_user <> 'service_role' or
    new.operation_key is null or
    v_marker is distinct from new.operation_key::text or
    new.movement_type <> 'CAFE_OUT' or
    new.sale_id is not null or
    new.movement_date < v_control.cutover_on then
   raise exception 'Lot tracking active: untracked stock writer denied';
 end if;
 return new;
end
$fn$;

create trigger protect_tracked_stock_mutation
before insert or update or delete on public.product_stock_movements
for each row execute function bunbun_accounting.enforce_lot_stock_writer();

create or replace function bunbun_accounting.assert_tracked_movement_allocated()
returns trigger language plpgsql security invoker
set search_path = pg_catalog
as $fn$
declare
 v_control bunbun_accounting.lot_tracking_control%rowtype;
 v_header bunbun_accounting.lot_release_operations%rowtype;
 v_qty bigint;
 v_lines integer;
 v_lot_key text;
 v_lot_used bigint;
 v_lot_decrement bigint;
begin
 select * into v_control from bunbun_accounting.lot_tracking_control
 where singleton;
 if not found then raise exception 'Lot tracking control missing'; end if;
 if v_control.mode = 'OFF' then return null; end if;

 select * into v_header from bunbun_accounting.lot_release_operations
 where operation_key = new.operation_key;
 if not found or v_header.status <> 'RECORDED'
   or v_header.movement_date <> new.movement_date
   or v_header.operation_key <> new.operation_key then
   raise exception 'Tracked movement must belong to a recorded lot release operation';
 end if;
 select coalesce(sum(a.qty),0),count(*) into v_qty,v_lines
 from bunbun_accounting.lot_release_allocations a
 join bunbun_accounting.finished_lot_positions l
  on l.lot_key=a.lot_key
 where a.stock_movement_id=new.id
   and a.operation_key=new.operation_key
   and a.product_id=new.product_id
   and l.product_id=new.product_id;
 if v_lines <= 0 or v_qty <> new.qty then
   raise exception 'Tracked CAFE_OUT has incomplete or incompatible lot allocations';
 end if;

 for v_lot_key in
   select distinct lot_key
   from bunbun_accounting.lot_release_allocations
   where stock_movement_id=new.id
 loop
   select original_qty - available_qty into v_lot_decrement
   from bunbun_accounting.finished_lot_positions
   where lot_key=v_lot_key;
   select coalesce(sum(qty),0) into v_lot_used
   from bunbun_accounting.lot_release_allocations
   where lot_key=v_lot_key;
   if v_lot_decrement is null or v_lot_decrement <> v_lot_used then
     raise exception 'Lot position does not reconcile with recorded allocations';
   end if;
 end loop;
 return null;
end
$fn$;

create constraint trigger verify_lot_allocation_before_commit
after insert on public.product_stock_movements
deferrable initially deferred
for each row execute function bunbun_accounting.assert_tracked_movement_allocated();

revoke all on function bunbun_accounting.enforce_lot_stock_writer()
 from public,anon,authenticated;
revoke all on function bunbun_accounting.assert_tracked_movement_allocated()
 from public,anon,authenticated;


create table bunbun_accounting.frozen_lot_positions (
  source_split_id bigint primary key
    references public.production_batch_splits(id) on delete restrict,
  product_id bigint not null references public.products(id),
  source_movement_id bigint not null unique
    references public.product_stock_movements(id) on delete restrict,
  original_qty integer not null check (original_qty > 0),
  available_qty integer not null check (available_qty >= 0 and available_qty <= original_qty),
  first_available_on date not null,
  evidence_ref text not null check (length(btrim(evidence_ref)) >= 6),
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null
);

create table bunbun_accounting.frozen_conversion_operations (
  operation_key uuid primary key,
  source_split_id bigint not null references public.production_batch_splits(id),
  direct_split_id bigint not null unique references public.production_batch_splits(id),
  stock_movement_id bigint not null unique references public.product_stock_movements(id),
  product_id bigint not null references public.products(id),
  movement_date date not null,
  qty integer not null check (qty > 0),
  evidence_ref text not null check (length(btrim(evidence_ref)) >= 6),
  actor_id uuid not null references auth.users(id),
  status text not null check (status = 'RECORDED'),
  created_at timestamptz not null default now()
);

create index frozen_conversion_source_index
  on bunbun_accounting.frozen_conversion_operations(source_split_id);

create table bunbun_accounting.baking_operations (
  operation_key uuid primary key,
  direct_split_id bigint not null unique references public.production_batch_splits(id),
  stock_movement_id bigint unique references public.product_stock_movements(id),
  product_id bigint not null references public.products(id),
  movement_date date not null,
  good_qty integer not null check (good_qty >= 0),
  reject_qty integer not null check (reject_qty >= 0),
  evidence_ref text not null check (length(btrim(evidence_ref)) >= 6),
  actor_id uuid not null references auth.users(id),
  status text not null check (status = 'RECORDED'),
  created_at timestamptz not null default now(),
  check ((good_qty > 0 and stock_movement_id is not null)
      or (good_qty = 0 and stock_movement_id is null))
);

alter table bunbun_accounting.frozen_lot_positions enable row level security;
alter table bunbun_accounting.frozen_conversion_operations enable row level security;
alter table bunbun_accounting.baking_operations enable row level security;
revoke all on bunbun_accounting.frozen_lot_positions,
  bunbun_accounting.frozen_conversion_operations,
  bunbun_accounting.baking_operations from public, anon, authenticated;
grant select, insert, update on bunbun_accounting.frozen_lot_positions to service_role;
grant select, insert on bunbun_accounting.frozen_conversion_operations,
  bunbun_accounting.baking_operations to service_role;
grant select, insert, update on public.production_batch_splits to service_role;
grant usage, select on all sequences in schema public to service_role;

create or replace function bunbun_accounting.block_frozen_baking_event_edit()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
begin
  raise exception 'Recorded frozen/baking provenance cannot be updated or deleted';
end
$fn$;
create trigger frozen_conversion_immutable
before update or delete on bunbun_accounting.frozen_conversion_operations
for each row execute function bunbun_accounting.block_frozen_baking_event_edit();
create trigger baking_operation_immutable
before update or delete on bunbun_accounting.baking_operations
for each row execute function bunbun_accounting.block_frozen_baking_event_edit();

create or replace function bunbun_accounting.enforce_lot_stock_writer()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
 v_mode text;
 v_cutover date;
 v_marker text;
begin
 select mode,cutover_on into v_mode,v_cutover
 from bunbun_accounting.lot_tracking_control where singleton;
 if not found then raise exception 'Lot control missing'; end if;
 if v_mode='OFF' then
   if tg_op='DELETE' then return old; end if;
   return new;
 end if;
 if tg_op<>'INSERT' then
   raise exception 'Tracked stock is append-only';
 end if;
 v_marker:=current_setting('bunbun_accounting.lot_write_operation',true);
 if current_user<>'service_role' or new.operation_key is null
   or v_marker is distinct from new.operation_key::text
   or new.movement_date < v_cutover
   or new.movement_type not in ('CAFE_OUT','FROZEN_OUT','FINISHED_IN')
   or (new.movement_type='CAFE_OUT' and new.sale_id is not null)
   or (new.movement_type in ('FROZEN_OUT','FINISHED_IN')
      and (new.batch_split_id is null or new.sale_id is not null)) then
   raise exception 'Lot tracking active: untracked stock writer denied';
 end if;
 return new;
end
$fn$;

create or replace function bunbun_accounting.assert_tracked_movement_allocated()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
 v_control bunbun_accounting.lot_tracking_control%rowtype;
 v_release bunbun_accounting.lot_release_operations%rowtype;
 v_frozen bunbun_accounting.frozen_conversion_operations%rowtype;
 v_baking bunbun_accounting.baking_operations%rowtype;
 v_lot_key text;
 v_qty bigint;
 v_lines integer;
 v_used bigint;
 v_balance bigint;
 v_slot bunbun_accounting.finished_lot_positions%rowtype;
 v_parent bunbun_accounting.frozen_lot_positions%rowtype;
 v_derived public.production_batch_splits%rowtype;
begin
 select * into v_control from bunbun_accounting.lot_tracking_control
 where singleton;
 if not found then raise exception 'Missing lot control'; end if;
 if v_control.mode='OFF' then return null; end if;

 if new.movement_type='FROZEN_OUT' then
   select * into v_frozen from bunbun_accounting.frozen_conversion_operations
   where operation_key=new.operation_key
     and stock_movement_id=new.id;
   if not found or v_frozen.status<>'RECORDED'
     or v_frozen.source_split_id<>new.batch_split_id
     or v_frozen.product_id<>new.product_id
     or v_frozen.qty<>new.qty
     or v_frozen.movement_date<>new.movement_date then
     raise exception 'Frozen OUT is not backed by a recorded conversion';
   end if;
   select * into v_parent from bunbun_accounting.frozen_lot_positions
   where source_split_id=v_frozen.source_split_id;
   select * into v_derived from public.production_batch_splits
   where id=v_frozen.direct_split_id;
   if not found or v_derived.source_split_id<>v_parent.source_split_id
     or v_derived.route<>'DIRECT' or v_derived.status not in ('PROOFING','BAKING','BAKED')
     or v_derived.product_id<>new.product_id
     or v_derived.qty<>new.qty then
     raise exception 'Derived split does not reflect frozen conversion';
   end if;
   if v_derived.status='BAKED' and not exists (
     select 1 from bunbun_accounting.baking_operations
     where direct_split_id=v_derived.id and status='RECORDED'
   ) then
     raise exception 'Baked frozen derivative has no verified baking event';
   end if;
   select coalesce(sum(qty),0) into v_used
   from bunbun_accounting.frozen_conversion_operations
   where source_split_id=v_frozen.source_split_id and status='RECORDED';
   if v_parent.source_split_id is null or
     v_parent.original_qty-v_parent.available_qty<>v_used then
     raise exception 'Frozen position and conversions are not reconciled';
   end if;
   return null;
 end if;

 if new.movement_type='FINISHED_IN' then
   select * into v_baking from bunbun_accounting.baking_operations
   where operation_key=new.operation_key and stock_movement_id=new.id;
   if not found or v_baking.status<>'RECORDED'
     or v_baking.direct_split_id<>new.batch_split_id
     or v_baking.product_id<>new.product_id
     or v_baking.good_qty<>new.qty
     or v_baking.movement_date<>new.movement_date then
     raise exception 'Finished IN is not backed by an audited baking event';
   end if;
   select * into v_derived from public.production_batch_splits
   where id=v_baking.direct_split_id;
   if not found or v_derived.status<>'BAKED'
     or v_derived.route<>'DIRECT'
     or v_derived.qty<>v_baking.good_qty+v_baking.reject_qty
     or v_derived.baked_good_qty<>v_baking.good_qty
     or v_derived.baked_reject_qty<>v_baking.reject_qty then
     raise exception 'Baked split quantity or reject count not reconciled';
   end if;
   select * into v_slot from bunbun_accounting.finished_lot_positions
   where source_split_id=v_baking.direct_split_id;
   if not found or v_slot.lot_key<>'split:'||v_baking.direct_split_id::text
     or v_slot.original_qty<>new.qty
     or v_slot.product_id<>new.product_id
     or (v_derived.source_split_id is null and v_slot.source_type<>'DIRECT_RELEASE')
     or (v_derived.source_split_id is not null and v_slot.source_type<>'FROZEN_CONVERSION') then
     raise exception 'Finished lot position missing or origin mismatched';
   end if;
   return null;
 end if;

 if new.movement_type<>'CAFE_OUT' then
   raise exception 'Unexpected stock writer type on tracked ledger';
 end if;

 select * into v_release from bunbun_accounting.lot_release_operations
 where operation_key=new.operation_key;
 if not found or v_release.status<>'RECORDED'
   or v_release.movement_date<>new.movement_date then
   raise exception 'Tracked release operation not recorded';
 end if;
 select coalesce(sum(a.qty),0),count(*) into v_qty,v_lines
 from bunbun_accounting.lot_release_allocations a
 join bunbun_accounting.finished_lot_positions l
   on l.lot_key=a.lot_key
 where a.operation_key=new.operation_key and a.stock_movement_id=new.id
   and a.product_id=new.product_id and l.product_id=new.product_id;
 if v_lines=0 or v_qty<>new.qty then
   raise exception 'Tracked CAFE_OUT does not equal exact lot allocations';
 end if;
 for v_lot_key in
   select distinct lot_key from bunbun_accounting.lot_release_allocations
   where stock_movement_id=new.id
 loop
   select original_qty-available_qty into v_balance
   from bunbun_accounting.finished_lot_positions where lot_key=v_lot_key;
   select coalesce(sum(qty),0) into v_used
   from bunbun_accounting.lot_release_allocations where lot_key=v_lot_key;
   if v_balance is null or v_balance<>v_used then
     raise exception 'Lot stock and allocations are not balanced';
   end if;
 end loop;
 return null;
end
$fn$;


create or replace function bunbun_accounting.record_frozen_to_direct_staging(
 p_source_split_id bigint,p_qty integer,p_movement_date date,
 p_evidence_ref text,p_operation_key uuid,p_actor_id uuid
) returns jsonb
language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
 v_owner uuid;
 v_mode text;
 v_cutover date;
 v_parent public.production_batch_splits%rowtype;
 v_lot bunbun_accounting.frozen_lot_positions%rowtype;
 v_existing bunbun_accounting.frozen_conversion_operations%rowtype;
 v_direct_id bigint;
 v_movement_id bigint;
 v_available bigint;
 v_stock bigint;
begin
 if current_user<>'service_role' then raise exception 'Service required'; end if;
 select id into v_owner from public.profiles
 where id=p_actor_id and role::text='owner' and is_active=true;
 if not found then raise exception 'Active Owner required'; end if;
 select mode,cutover_on into v_mode,v_cutover
 from bunbun_accounting.lot_tracking_control where singleton;
 if v_mode<>'ON' or p_movement_date is null
   or p_movement_date<v_cutover or p_operation_key is null
   or p_qty is null or p_qty<=0 or
   length(btrim(coalesce(p_evidence_ref,'')))<6 then
   raise exception 'Reviewed cutover date, positive quantity and evidence required';
 end if;
 if exists(select 1 from bunbun_accounting.lot_release_operations
           where operation_key=p_operation_key)
   or exists(select 1 from bunbun_accounting.baking_operations
           where operation_key=p_operation_key) then
   raise exception 'Operation key already belongs to a different stock event';
 end if;
 select * into v_existing
 from bunbun_accounting.frozen_conversion_operations
 where operation_key=p_operation_key;
 if found then
   if v_existing.source_split_id<>p_source_split_id or v_existing.qty<>p_qty
     or v_existing.movement_date<>p_movement_date
     or v_existing.evidence_ref<>p_evidence_ref
     or v_existing.actor_id<>p_actor_id then
     raise exception 'Frozen operation key reused with different event';
   end if;
   return jsonb_build_object('already_exists',true,
     'direct_split_id',v_existing.direct_split_id,
     'stock_movement_id',v_existing.stock_movement_id,
     'accounting_posted',false);
 end if;

 select * into v_parent from public.production_batch_splits
 where id=p_source_split_id and is_deleted=false;
 if not found or v_parent.route<>'FROZEN' or v_parent.status<>'FROZEN' then
   raise exception 'Active FROZEN root split not found';
 end if;
 perform 1 from public.products
 where id=v_parent.product_id and is_active=true and is_deleted=false
 for update;
 if not found then raise exception 'Product inactive'; end if;
 select * into v_parent from public.production_batch_splits
 where id=p_source_split_id and is_deleted=false for update;
 select * into v_lot from bunbun_accounting.frozen_lot_positions
 where source_split_id=p_source_split_id for update;
 if not found or v_lot.product_id<>v_parent.product_id
   or v_lot.first_available_on>p_movement_date
   or v_lot.available_qty<p_qty then
   raise exception 'Frozen lot is missing or insufficient';
 end if;
 if not exists (
   select 1 from public.product_stock_movements m
   where m.id=v_lot.source_movement_id
     and m.movement_type='FROZEN_IN'
     and m.batch_split_id=v_parent.id
     and m.product_id=v_parent.product_id
     and m.qty=v_lot.original_qty
     and m.is_deleted=false
 ) or v_lot.original_qty>v_parent.qty then
   raise exception 'Frozen root position lacks original matching FROZEN_IN stock';
 end if;
 select coalesce(sum(case when movement_type='FROZEN_IN' then qty
                        when movement_type='FROZEN_OUT' then -qty
                        else 0 end),0) into v_stock
 from public.product_stock_movements where batch_split_id=p_source_split_id
   and is_deleted=false;
 if v_stock<>v_lot.available_qty then
   raise exception 'Frozen position diverges from source stock movements';
 end if;

 insert into public.production_batch_splits
   (production_batch_id,product_id,source_split_id,route,qty,status)
 values (v_parent.production_batch_id,v_parent.product_id,
   p_source_split_id,'DIRECT',p_qty,'PROOFING')
 returning id into v_direct_id;

 perform set_config('bunbun_accounting.lot_write_operation',
   p_operation_key::text,true);
 insert into public.product_stock_movements
   (movement_date,movement_type,product_id,batch_split_id,qty,unit,
    operation_key,sale_id,notes,created_by,updated_by)
 values (p_movement_date,'FROZEN_OUT',v_parent.product_id,p_source_split_id,
   p_qty,'pcs',p_operation_key,null,
   'Frozen dikeluarkan untuk proofing — lot tracked',p_actor_id,p_actor_id)
 returning id into v_movement_id;

 update bunbun_accounting.frozen_lot_positions
 set available_qty=available_qty-p_qty where source_split_id=p_source_split_id;
 insert into bunbun_accounting.frozen_conversion_operations
   (operation_key,source_split_id,direct_split_id,stock_movement_id,
    product_id,movement_date,qty,evidence_ref,actor_id,status)
 values (p_operation_key,p_source_split_id,v_direct_id,v_movement_id,
   v_parent.product_id,p_movement_date,p_qty,p_evidence_ref,p_actor_id,'RECORDED');

 return jsonb_build_object('already_exists',false,
   'direct_split_id',v_direct_id,'stock_movement_id',v_movement_id,
   'remaining_frozen_qty',v_lot.available_qty-p_qty,
   'accounting_posted',false);
end
$fn$;

create or replace function bunbun_accounting.record_tracked_baking_staging(
 p_direct_split_id bigint,p_good_qty integer,p_reject_qty integer,
 p_movement_date date,p_evidence_ref text,p_operation_key uuid,p_actor_id uuid
) returns jsonb
language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
 v_owner uuid;
 v_mode text;
 v_cutover date;
 v_split public.production_batch_splits%rowtype;
 v_prev bunbun_accounting.baking_operations%rowtype;
 v_frozen bunbun_accounting.frozen_conversion_operations%rowtype;
 v_movement_id bigint;
 v_lot_key text;
 v_type text;
begin
 if current_user<>'service_role' then raise exception 'Service required'; end if;
 select id into v_owner from public.profiles
 where id=p_actor_id and role::text='owner' and is_active=true;
 if not found then raise exception 'Active Owner required'; end if;
 select mode,cutover_on into v_mode,v_cutover
 from bunbun_accounting.lot_tracking_control where singleton;
 if v_mode<>'ON' or p_movement_date is null or
   p_movement_date<v_cutover or p_operation_key is null or
   p_good_qty is null or p_reject_qty is null or
   p_good_qty<0 or p_reject_qty<0 or
   p_good_qty+p_reject_qty<=0 or
   length(btrim(coalesce(p_evidence_ref,'')))<6 then
   raise exception 'Reviewed cutover, quantities and baking evidence required';
 end if;
 if exists(select 1 from bunbun_accounting.lot_release_operations
           where operation_key=p_operation_key)
   or exists(select 1 from bunbun_accounting.frozen_conversion_operations
           where operation_key=p_operation_key) then
   raise exception 'Operation key already belongs to a different stock event';
 end if;
 select * into v_prev from bunbun_accounting.baking_operations
 where operation_key=p_operation_key;
 if found then
   if v_prev.direct_split_id<>p_direct_split_id
     or v_prev.good_qty<>p_good_qty or v_prev.reject_qty<>p_reject_qty
     or v_prev.movement_date<>p_movement_date
     or v_prev.evidence_ref<>p_evidence_ref
     or v_prev.actor_id<>p_actor_id then
     raise exception 'Baking operation key reused with a different event';
   end if;
   return jsonb_build_object('already_exists',true,
     'direct_split_id',v_prev.direct_split_id,
     'stock_movement_id',v_prev.stock_movement_id,
     'accounting_posted',false);
 end if;

 select * into v_split from public.production_batch_splits
 where id=p_direct_split_id and is_deleted=false;
 if not found or v_split.route<>'DIRECT' then
   raise exception 'DIRECT split not found';
 end if;
 perform 1 from public.products
 where id=v_split.product_id and is_active=true and is_deleted=false
 for update;
 if not found then raise exception 'Product inactive'; end if;
 select * into v_split from public.production_batch_splits
 where id=p_direct_split_id and is_deleted=false for update;
 if v_split.status not in ('PROOFING','BAKING') then
   raise exception 'Split already baked or not ready';
 end if;
 if p_good_qty+p_reject_qty<>v_split.qty then
   raise exception 'Baked good plus reject must equal original split quantity';
 end if;
 if exists(select 1 from bunbun_accounting.baking_operations
           where direct_split_id=p_direct_split_id) then
   raise exception 'Direct split already has a different baking event';
 end if;
 if exists (
   select 1 from public.product_stock_movements
   where batch_split_id=p_direct_split_id
     and movement_type='FINISHED_IN' and is_deleted=false
 ) then
   raise exception 'DIRECT split already received finished goods from an earlier writer';
 end if;
 if v_split.source_split_id is not null then
   select * into v_frozen from bunbun_accounting.frozen_conversion_operations
   where direct_split_id=p_direct_split_id and status='RECORDED';
   if not found or v_frozen.source_split_id<>v_split.source_split_id
     or v_frozen.product_id<>v_split.product_id
     or v_frozen.qty<>v_split.qty or
     v_frozen.movement_date>p_movement_date then
     raise exception 'Frozen-derived DIRECT split lacks source conversion evidence';
   end if;
   v_type:='FROZEN_CONVERSION';
 else
   v_type:='DIRECT_RELEASE';
 end if;

 update public.production_batch_splits set baked_good_qty=p_good_qty,
   baked_reject_qty=p_reject_qty,status='BAKED'
 where id=p_direct_split_id;
 v_movement_id:=null;
 if p_good_qty>0 then
   v_lot_key:='split:'||p_direct_split_id::text;
   perform set_config('bunbun_accounting.lot_write_operation',
     p_operation_key::text,true);
   insert into public.product_stock_movements
     (movement_date,movement_type,product_id,batch_split_id,qty,unit,
      operation_key,sale_id,notes,created_by,updated_by)
   values (p_movement_date,'FINISHED_IN',v_split.product_id,
     p_direct_split_id,p_good_qty,'pcs',p_operation_key,null,
     'Baking lot tracked — biaya belum disahkan',p_actor_id,p_actor_id)
   returning id into v_movement_id;
   insert into bunbun_accounting.finished_lot_positions
     (lot_key,product_id,source_type,source_split_id,location,
      first_available_on,source_evidence,approved_by,approved_at,
      original_qty,available_qty)
   values (v_lot_key,v_split.product_id,v_type,p_direct_split_id,
     'FINISHED',p_movement_date,p_evidence_ref,p_actor_id,now(),
     p_good_qty,p_good_qty);
 end if;
 insert into bunbun_accounting.baking_operations
   (operation_key,direct_split_id,stock_movement_id,product_id,
    movement_date,good_qty,reject_qty,evidence_ref,actor_id,status)
 values (p_operation_key,p_direct_split_id,v_movement_id,
   v_split.product_id,p_movement_date,p_good_qty,p_reject_qty,
   p_evidence_ref,p_actor_id,'RECORDED');
 return jsonb_build_object('already_exists',false,
   'direct_split_id',p_direct_split_id,
   'stock_movement_id',v_movement_id,
   'finished_qty',p_good_qty,'reject_qty',p_reject_qty,
   'accounting_posted',false);
end
$fn$;

revoke all on function bunbun_accounting.record_frozen_to_direct_staging(
 bigint,integer,date,text,uuid,uuid) from public,anon,authenticated;
revoke all on function bunbun_accounting.record_tracked_baking_staging(
 bigint,integer,integer,date,text,uuid,uuid) from public,anon,authenticated;
grant execute on function bunbun_accounting.record_frozen_to_direct_staging(
 bigint,integer,date,text,uuid,uuid) to service_role;
grant execute on function bunbun_accounting.record_tracked_baking_staging(
 bigint,integer,integer,date,text,uuid,uuid) to service_role;

create table bunbun_accounting.shaping_operations (
  operation_key uuid primary key,
  batch_id bigint not null unique references public.production_batches(id) on delete restrict,
  product_id bigint not null references public.products(id),
  frozen_split_id bigint unique references public.production_batch_splits(id),
  direct_split_id bigint unique references public.production_batch_splits(id),
  reject_split_id bigint unique references public.production_batch_splits(id),
  frozen_movement_id bigint unique references public.product_stock_movements(id),
  movement_date date not null,
  frozen_qty integer not null check (frozen_qty >= 0),
  direct_qty integer not null check (direct_qty >= 0),
  reject_qty integer not null check (reject_qty >= 0),
  frozen_lot_code text,
  evidence_ref text not null check (length(btrim(evidence_ref)) >= 6),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  status text not null check (status = 'RECORDED'),
  check (frozen_qty+direct_qty+reject_qty > 0),
  check (
    ((frozen_qty > 0) = (frozen_split_id is not null)) and
    ((frozen_qty > 0) = (frozen_movement_id is not null)) and
    ((frozen_qty > 0) = (nullif(btrim(frozen_lot_code),'') is not null)) and
    ((direct_qty > 0) = (direct_split_id is not null)) and
    ((reject_qty > 0) = (reject_split_id is not null))
  )
);

alter table bunbun_accounting.shaping_operations enable row level security;
revoke all on bunbun_accounting.shaping_operations from public,anon,authenticated;
grant select,insert on bunbun_accounting.shaping_operations to service_role;
grant select,update on public.production_batches to service_role;
grant select on public.production_orders,public.recipes to service_role;



create trigger shaping_operation_immutable
before update or delete on bunbun_accounting.shaping_operations
for each row execute function bunbun_accounting.block_frozen_baking_event_edit();

create or replace function bunbun_accounting.refresh_tracked_batch_progress(
 p_batch_id bigint, p_actor_id uuid
) returns jsonb
language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
 v_batch public.production_batches%rowtype;
 v_target bigint;
 v_root_qty bigint;
 v_root_reject bigint;
 v_baked_good bigint;
 v_baked_reject bigint;
 v_frozen_remaining bigint;
 v_unbaked bigint;
 v_direct_qty bigint;
 v_source_split_count integer;
 v_status text;
begin
 select * into v_batch from public.production_batches
 where id=p_batch_id and is_deleted=false for update;
 if not found then raise exception 'Batch induk tidak ditemukan'; end if;
 if not exists (
   select 1 from bunbun_accounting.shaping_operations
   where batch_id=p_batch_id and status='RECORDED'
 ) then
   raise exception 'Batch belum memiliki shaping operation tercatat';
 end if;
 if v_batch.target<>trunc(v_batch.target) or v_batch.target<=0
   or v_batch.target>2147483647 then
   raise exception 'Target batch harus jumlah unit bulat positif';
 end if;
 v_target:=v_batch.target::bigint;

 select coalesce(sum(qty),0),
        coalesce(sum(qty) filter(where route='REJECT'),0),
        count(*) into v_root_qty,v_root_reject,v_source_split_count
 from public.production_batch_splits
 where production_batch_id=p_batch_id and is_deleted=false
   and source_split_id is null;
 if v_root_qty<>v_target or v_source_split_count=0 then
   raise exception 'Total split shaping asal tidak sesuai target batch';
 end if;
 if exists(
   select 1 from public.production_batch_splits s
   where s.production_batch_id=p_batch_id and s.is_deleted=false
     and s.source_split_id is not null and
     not exists(
       select 1 from public.production_batch_splits root
       where root.id=s.source_split_id and
         root.production_batch_id=p_batch_id and
         root.product_id=s.product_id and root.route='FROZEN' and
         root.is_deleted=false
     )
 ) then raise exception 'Split turunan tidak berasal dari frozen root batch ini'; end if;

 select coalesce(sum(s.baked_good_qty),0),
        coalesce(sum(s.baked_reject_qty),0),
        count(*) filter(where s.status<>'BAKED'),
        count(*) into v_baked_good,v_baked_reject,v_unbaked,v_direct_qty
 from public.production_batch_splits s
 where s.production_batch_id=p_batch_id and s.is_deleted=false
   and s.route='DIRECT';

 if exists (
   select 1 from public.production_batch_splits s
   where s.production_batch_id=p_batch_id and s.route='DIRECT'
     and s.is_deleted=false and s.status='BAKED'
     and s.baked_good_qty+s.baked_reject_qty<>s.qty
 ) then raise exception 'Hasil baking tidak sama dengan jumlah split'; end if;

 select coalesce(sum(case when m.movement_type='FROZEN_IN' then m.qty
                          when m.movement_type='FROZEN_OUT' then -m.qty
                          else 0 end),0)
 into v_frozen_remaining
 from public.product_stock_movements m
 join public.production_batch_splits s on s.id=m.batch_split_id
 where s.production_batch_id=p_batch_id and s.route='FROZEN'
   and s.is_deleted=false and m.is_deleted=false;
 if v_frozen_remaining<0 then
   raise exception 'Saldo freezer batch tidak boleh negatif';
 end if;
 if exists (
   select 1 from public.production_batch_splits s
   join bunbun_accounting.frozen_lot_positions f on f.source_split_id=s.id
   where s.production_batch_id=p_batch_id and s.route='FROZEN' and
     s.is_deleted=false and f.available_qty<>
       (select coalesce(sum(case when m.movement_type='FROZEN_IN' then m.qty
                               when m.movement_type='FROZEN_OUT' then -m.qty
                               else 0 end),0)
        from public.product_stock_movements m
        where m.batch_split_id=s.id and m.is_deleted=false)
 ) then
   raise exception 'Saldo frozen batch berbeda dari posisi lot';
 end if;

 v_status:=case when v_unbaked=0 and v_frozen_remaining=0
    then 'Finished' else 'Split' end;
 update public.production_batches
 set selesai=v_baked_good,
     reject=v_root_reject+v_baked_reject,
     status=v_status,
     updated_by=p_actor_id
 where id=p_batch_id;
 return jsonb_build_object(
   'batch_id',p_batch_id,'status',v_status,
   'finished_qty',v_baked_good,
   'reject_qty',v_root_reject+v_baked_reject,
   'remaining_frozen_qty',v_frozen_remaining,
   'unbaked_direct_count',v_unbaked,
   'original_target',v_target
 );
end
$fn$;

create or replace function bunbun_accounting.update_batch_after_recorded_event()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
 v_batch_id bigint;
begin
 if tg_table_name='shaping_operations' then
   v_batch_id:=new.batch_id;
 elsif tg_table_name='baking_operations' then
   select production_batch_id into v_batch_id
   from public.production_batch_splits where id=new.direct_split_id;
 else
   raise exception 'Unexpected source for batch progress update';
 end if;
 perform bunbun_accounting.refresh_tracked_batch_progress(
   v_batch_id,new.actor_id);
 return new;
end
$fn$;

create trigger sync_parent_after_shaping
after insert on bunbun_accounting.shaping_operations
for each row execute function bunbun_accounting.update_batch_after_recorded_event();

create trigger sync_parent_after_baking
after insert on bunbun_accounting.baking_operations
for each row execute function bunbun_accounting.update_batch_after_recorded_event();


create or replace function bunbun_accounting.enforce_lot_stock_writer()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
 v_mode text;
 v_cutover date;
 v_marker text;
begin
 select mode,cutover_on into v_mode,v_cutover
 from bunbun_accounting.lot_tracking_control where singleton;
 if not found then raise exception 'Lot control missing'; end if;
 if v_mode='OFF' then
   if tg_op='DELETE' then return old; end if;
   return new;
 end if;
 if tg_op<>'INSERT' then
   raise exception 'Tracked stock is append-only';
 end if;
 v_marker:=current_setting('bunbun_accounting.lot_write_operation',true);
 if current_user<>'service_role' or new.operation_key is null
   or v_marker is distinct from new.operation_key::text
   or new.movement_date < v_cutover
   or new.movement_type not in
     ('CAFE_OUT','FROZEN_IN','FROZEN_OUT','FINISHED_IN')
   or (new.movement_type='CAFE_OUT' and new.sale_id is not null)
   or (new.movement_type in ('FROZEN_IN','FROZEN_OUT','FINISHED_IN')
      and (new.batch_split_id is null or new.sale_id is not null)) then
   raise exception 'Lot tracking active: untracked stock writer denied';
 end if;
 return new;
end
$fn$;

create or replace function bunbun_accounting.verify_shaping_frozen_in()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
 v_mode text;
 v_op bunbun_accounting.shaping_operations%rowtype;
 v_split public.production_batch_splits%rowtype;
 v_frozen bunbun_accounting.frozen_lot_positions%rowtype;
 v_converted bigint;
begin
 select mode into v_mode from bunbun_accounting.lot_tracking_control where singleton;
 if not found then raise exception 'Lot control missing'; end if;
 if v_mode='OFF' or new.movement_type<>'FROZEN_IN' then return null; end if;
 select * into v_op from bunbun_accounting.shaping_operations
 where operation_key=new.operation_key and frozen_movement_id=new.id
   and status='RECORDED';
 if not found or v_op.frozen_qty<>new.qty or v_op.product_id<>new.product_id
   or v_op.movement_date<>new.movement_date or
   v_op.frozen_split_id<>new.batch_split_id then
   raise exception 'FROZEN_IN lacks matching shaping operation';
 end if;
 select * into v_split from public.production_batch_splits
 where id=new.batch_split_id;
 if not found or v_split.route<>'FROZEN' or v_split.source_split_id is not null
   or v_split.production_batch_id<>v_op.batch_id
   or v_split.product_id<>new.product_id or v_split.qty<>new.qty
   or v_split.status<>'FROZEN' or
   v_split.lot_code is distinct from v_op.frozen_lot_code then
   raise exception 'Shaping source split does not match FROZEN_IN';
 end if;
 select * into v_frozen from bunbun_accounting.frozen_lot_positions
 where source_split_id=v_split.id;
 if not found or v_frozen.product_id<>new.product_id or
   v_frozen.source_movement_id<>new.id or
   v_frozen.original_qty<>new.qty or
   v_frozen.first_available_on<>new.movement_date then
   raise exception 'Frozen lot position is not backed by shaping movement';
 end if;
 select coalesce(sum(qty),0) into v_converted
 from bunbun_accounting.frozen_conversion_operations
 where source_split_id=v_split.id and status='RECORDED';
 if v_frozen.available_qty + v_converted <> new.qty then
   raise exception 'Shaping frozen position differs from original minus conversions';
 end if;
 return null;
end
$fn$;

create constraint trigger verify_shaping_frozen_in_commit
after insert on public.product_stock_movements
deferrable initially deferred
for each row execute function bunbun_accounting.verify_shaping_frozen_in();

alter function bunbun_accounting.assert_tracked_movement_allocated()
rename to assert_tracked_movement_previous;

create or replace function bunbun_accounting.assert_tracked_movement_allocated()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
 v_mode text;
begin
 select mode into v_mode from bunbun_accounting.lot_tracking_control where singleton;
 if not found then raise exception 'Lot control missing'; end if;
 if v_mode='OFF' then return null; end if;
 if new.movement_type='FROZEN_IN' then return null; end if;
 return null;
end
$fn$;

drop trigger verify_lot_allocation_before_commit on public.product_stock_movements;
create constraint trigger verify_lot_allocation_before_commit
after insert on public.product_stock_movements
deferrable initially deferred
for each row
when (new.movement_type <> 'FROZEN_IN')
execute function bunbun_accounting.assert_tracked_movement_previous();

drop function bunbun_accounting.assert_tracked_movement_allocated();


create or replace function bunbun_accounting.record_tracked_shaping_staging(
 p_batch_id bigint, p_product_id bigint,
 p_frozen_qty integer, p_direct_qty integer, p_reject_qty integer,
 p_frozen_lot_code text, p_movement_date date,
 p_evidence_ref text, p_operation_key uuid, p_actor_id uuid
) returns jsonb
language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
 v_actor uuid;
 v_control bunbun_accounting.lot_tracking_control%rowtype;
 v_existing bunbun_accounting.shaping_operations%rowtype;
 v_batch public.production_batches%rowtype;
 v_recipe_product bigint;
 v_freezer_split_id bigint;
 v_direct_split_id bigint;
 v_reject_split_id bigint;
 v_stock_movement_id bigint;
 v_target bigint;
 v_total bigint;
 v_progress jsonb;
begin
 if current_user<>'service_role' then raise exception 'Trusted service required'; end if;
 select id into v_actor from public.profiles
 where id=p_actor_id and role::text='owner' and is_active=true;
 if not found then raise exception 'Active Owner required'; end if;

 select * into v_control from bunbun_accounting.lot_tracking_control
 where singleton;
 if not found or v_control.mode<>'ON' or p_movement_date is null
   or p_movement_date<v_control.cutover_on or p_operation_key is null
   or p_frozen_qty is null or p_direct_qty is null or p_reject_qty is null
   or p_frozen_qty<0 or p_direct_qty<0 or p_reject_qty<0
   or length(btrim(coalesce(p_evidence_ref,'')))<6 then
   raise exception 'Shaping needs cutover, valid quantities, UUID and evidence';
 end if;
 v_total:=p_frozen_qty::bigint+p_direct_qty::bigint+p_reject_qty::bigint;
 if v_total<=0 or v_total>2147483647 then
   raise exception 'Shaping total is outside allowed unit range';
 end if;
 if (p_frozen_qty>0 and (p_frozen_lot_code is null or
       nullif(btrim(p_frozen_lot_code),'') is null))
    or (p_frozen_qty=0 and p_frozen_lot_code is not null) then
   raise exception 'Frozen lot code required only for positive frozen quantity';
 end if;
 if exists(select 1 from bunbun_accounting.lot_release_operations
           where operation_key=p_operation_key)
   or exists(select 1 from bunbun_accounting.frozen_conversion_operations
           where operation_key=p_operation_key)
   or exists(select 1 from bunbun_accounting.baking_operations
           where operation_key=p_operation_key) then
   raise exception 'Operation key belongs to a different tracked workflow';
 end if;

 select * into v_batch from public.production_batches
 where id=p_batch_id and is_deleted=false for update;
 if not found then raise exception 'Production batch not found'; end if;
 if p_frozen_qty>0 and btrim(p_frozen_lot_code) IS DISTINCT FROM
   (CASE WHEN v_batch.kode LIKE 'PB-%' THEN 'LOT-'||substring(v_batch.kode from 4)
        ELSE 'LOT-'||v_batch.kode END) THEN
   RAISE EXCEPTION 'Frozen lot code must match automatic batch lot code';
 end if;

 select * into v_existing from bunbun_accounting.shaping_operations
 where batch_id=p_batch_id;
 if found then
   if v_existing.operation_key<>p_operation_key or
     v_existing.product_id<>p_product_id or
     v_existing.frozen_qty<>p_frozen_qty or
     v_existing.direct_qty<>p_direct_qty or
     v_existing.reject_qty<>p_reject_qty or
     v_existing.frozen_lot_code is distinct from
       nullif(btrim(p_frozen_lot_code),'') or
     v_existing.movement_date<>p_movement_date or
     v_existing.evidence_ref<>p_evidence_ref or
     v_existing.actor_id<>p_actor_id then
     raise exception 'Batch was shaped already with a different request';
   end if;
   return jsonb_build_object('already_exists',true,
     'batch_id',p_batch_id,'frozen_split_id',v_existing.frozen_split_id,
     'direct_split_id',v_existing.direct_split_id,
     'reject_split_id',v_existing.reject_split_id,
     'frozen_movement_id',v_existing.frozen_movement_id,
     'accounting_posted',false);
 end if;

 if v_batch.status<>'Shaping' or not v_batch.inventory_consumed then
   raise exception 'Batch must be Shaping with material consumption recorded';
 end if;
 if v_batch.target<>trunc(v_batch.target)
   or v_batch.target<=0 or v_batch.target>2147483647 then
   raise exception 'Invalid integer batch target';
 end if;
 v_target:=v_batch.target::bigint;
 if v_total<>v_target then
   raise exception 'Frozen, direct and reject shaping must total batch target';
 end if;
 if exists (
   select 1 from public.production_batch_splits
   where production_batch_id=p_batch_id and is_deleted=false
 ) then
   raise exception 'Batch already has source split records';
 end if;
 select r.product_id into v_recipe_product
 from public.production_orders o
 join public.recipes r on r.id=o.recipe_id
 join public.products p on p.id=r.product_id
 where o.id=v_batch.production_order_id and
   o.is_deleted=false and r.is_deleted=false
   and p.is_deleted=false and p.is_active=true;
 if v_recipe_product is null or
    v_recipe_product<>p_product_id then
   raise exception 'Shaping product differs from active production recipe';
 end if;

 perform 1 from public.products where id=p_product_id
   and is_active=true and is_deleted=false for update;
 if not found then raise exception 'Shaping product inactive'; end if;

 if p_frozen_qty>0 then
   insert into public.production_batch_splits
     (production_batch_id,product_id,route,lot_code,qty,status)
   values (p_batch_id,p_product_id,'FROZEN',btrim(p_frozen_lot_code),
           p_frozen_qty,'FROZEN')
   returning id into v_freezer_split_id;

   perform set_config('bunbun_accounting.lot_write_operation',
       p_operation_key::text,true);
   insert into public.product_stock_movements
     (movement_date,movement_type,product_id,batch_split_id,
      qty,unit,operation_key,sale_id,notes,created_by,updated_by)
   values (p_movement_date,'FROZEN_IN',p_product_id,
           v_freezer_split_id,p_frozen_qty,'pcs',p_operation_key,
           null,'Shaping frozen root — audited lot',p_actor_id,p_actor_id)
   returning id into v_stock_movement_id;

   insert into bunbun_accounting.frozen_lot_positions
     (source_split_id,product_id,source_movement_id,
      original_qty,available_qty,first_available_on,evidence_ref,
      reviewed_by,reviewed_at)
   values (v_freezer_split_id,p_product_id,v_stock_movement_id,
       p_frozen_qty,p_frozen_qty,p_movement_date,p_evidence_ref,p_actor_id,now());
 end if;
 if p_direct_qty>0 then
   insert into public.production_batch_splits
     (production_batch_id,product_id,route,qty,status)
   values (p_batch_id,p_product_id,'DIRECT',p_direct_qty,'PROOFING')
   returning id into v_direct_split_id;
 end if;
 if p_reject_qty>0 then
   insert into public.production_batch_splits
     (production_batch_id,product_id,route,qty,status)
   values (p_batch_id,p_product_id,'REJECT',p_reject_qty,'REJECTED')
   returning id into v_reject_split_id;
 end if;

 insert into bunbun_accounting.shaping_operations
   (operation_key,batch_id,product_id,
    frozen_split_id,direct_split_id,reject_split_id,
    frozen_movement_id,movement_date,frozen_qty,direct_qty,reject_qty,
    frozen_lot_code,evidence_ref,actor_id,status)
 values (p_operation_key,p_batch_id,p_product_id,
    v_freezer_split_id,v_direct_split_id,v_reject_split_id,
    v_stock_movement_id,p_movement_date,
    p_frozen_qty,p_direct_qty,p_reject_qty,
    nullif(btrim(p_frozen_lot_code),''),
    p_evidence_ref,p_actor_id,'RECORDED');

 select jsonb_build_object(
   'batch_id',b.id,'status',b.status,
   'finished_qty',b.selesai,'reject_qty',b.reject
 ) into v_progress
 from public.production_batches b where b.id=p_batch_id;
 return jsonb_build_object(
   'already_exists',false,'batch_id',p_batch_id,
   'frozen_split_id',v_freezer_split_id,
   'direct_split_id',v_direct_split_id,
   'reject_split_id',v_reject_split_id,
   'frozen_movement_id',v_stock_movement_id,
   'progress',v_progress,
   'accounting_posted',false,'cogs_created',false
 );
end
$fn$;

revoke all on function bunbun_accounting.record_tracked_shaping_staging(
 bigint,bigint,integer,integer,integer,text,date,text,uuid,uuid)
from public,anon,authenticated;
grant execute on function bunbun_accounting.record_tracked_shaping_staging(
 bigint,bigint,integer,integer,integer,text,date,text,uuid,uuid)
to service_role;
revoke all on function bunbun_accounting.refresh_tracked_batch_progress(
 bigint,uuid) from public,anon,authenticated;
grant execute on function bunbun_accounting.refresh_tracked_batch_progress(
 bigint,uuid) to service_role;

create table bunbun_accounting.lot_sale_transactions (
  operation_key uuid primary key,
  action text not null check(action in ('SALE_CREATE','SALE_CANCEL')),
  fingerprint text not null check(length(fingerprint)=32),
  sale_id bigint references public.sales(id),
  related_sale_id bigint references public.sales(id),
  actor_id uuid not null references auth.users(id),
  evidence_ref text not null check(length(btrim(evidence_ref))>=6),
  status text not null default 'PROCESSING'
    check(status in ('PROCESSING','RECORDED')),
  created_at timestamptz not null default now(),
  unique (action,sale_id)
);

create table bunbun_accounting.lot_sale_out_allocations (
  id bigint generated always as identity primary key,
  operation_key uuid not null references bunbun_accounting.lot_sale_transactions(operation_key),
  sale_id bigint not null references public.sales(id),
  stock_movement_id bigint not null references public.product_stock_movements(id),
  lot_key text not null references bunbun_accounting.finished_lot_positions(lot_key),
  product_id bigint not null references public.products(id),
  qty integer not null check(qty>0),
  created_at timestamptz not null default now(),
  unique(stock_movement_id,lot_key)
);

create table bunbun_accounting.lot_sale_return_allocations (
  id bigint generated always as identity primary key,
  operation_key uuid not null references bunbun_accounting.lot_sale_transactions(operation_key),
  original_allocation_id bigint not null unique
    references bunbun_accounting.lot_sale_out_allocations(id) on delete restrict,
  sale_id bigint not null references public.sales(id),
  stock_movement_id bigint not null references public.product_stock_movements(id),
  lot_key text not null references bunbun_accounting.finished_lot_positions(lot_key),
  product_id bigint not null references public.products(id),
  qty integer not null check(qty>0),
  created_at timestamptz not null default now(),
  unique(stock_movement_id,lot_key)
);

create table bunbun_accounting.lot_sale_replacements (
  old_sale_id bigint primary key references public.sales(id),
  new_sale_id bigint not null unique references public.sales(id),
  cancel_operation_key uuid not null unique
    references bunbun_accounting.lot_sale_transactions(operation_key),
  new_operation_key uuid not null unique
    references bunbun_accounting.lot_sale_transactions(operation_key),
  fingerprint text not null check(length(fingerprint)=32),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check(old_sale_id<>new_sale_id)
);

create index lot_sale_out_by_sale on bunbun_accounting.lot_sale_out_allocations(sale_id,lot_key);
create index lot_sale_return_by_sale on bunbun_accounting.lot_sale_return_allocations(sale_id,lot_key);

alter table bunbun_accounting.lot_sale_transactions enable row level security;
alter table bunbun_accounting.lot_sale_out_allocations enable row level security;
alter table bunbun_accounting.lot_sale_return_allocations enable row level security;
alter table bunbun_accounting.lot_sale_replacements enable row level security;
revoke all on all tables in schema bunbun_accounting from public,anon,authenticated;
revoke all on all sequences in schema bunbun_accounting from public,anon,authenticated;
grant select,insert,update on bunbun_accounting.lot_sale_transactions to service_role;
grant select,insert on bunbun_accounting.lot_sale_out_allocations,
  bunbun_accounting.lot_sale_return_allocations,
  bunbun_accounting.lot_sale_replacements to service_role;
grant usage,select on all sequences in schema bunbun_accounting to service_role;

create or replace function bunbun_accounting.prevent_recorded_sale_lot_edit()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
begin
  if tg_table_name='lot_sale_transactions' and tg_op='UPDATE'
    and old.status='PROCESSING' and new.status='RECORDED'
    and new.action=old.action and new.operation_key=old.operation_key
    and new.fingerprint=old.fingerprint and new.actor_id=old.actor_id
    and new.evidence_ref=old.evidence_ref
    and new.sale_id is not null then
    return new;
  end if;
  raise exception 'Recorded sale-lot evidence is immutable; use compensating event';
end
$fn$;

create trigger immutable_sale_operation
before update or delete on bunbun_accounting.lot_sale_transactions
for each row execute function bunbun_accounting.prevent_recorded_sale_lot_edit();
create trigger immutable_sale_out_allocation
before update or delete on bunbun_accounting.lot_sale_out_allocations
for each row execute function bunbun_accounting.prevent_recorded_sale_lot_edit();
create trigger immutable_sale_return_allocation
before update or delete on bunbun_accounting.lot_sale_return_allocations
for each row execute function bunbun_accounting.prevent_recorded_sale_lot_edit();
create trigger immutable_sale_replacement
before update or delete on bunbun_accounting.lot_sale_replacements
for each row execute function bunbun_accounting.prevent_recorded_sale_lot_edit();

create or replace function bunbun_accounting.enforce_lot_stock_writer()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
  v_mode text;
  v_cutover date;
  v_marker text;
begin
  select mode,cutover_on into v_mode,v_cutover
  from bunbun_accounting.lot_tracking_control where singleton;
  if not found then raise exception 'Lot tracking control missing'; end if;
  if v_mode='OFF' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op<>'INSERT' then
    raise exception 'Tracked stock append-only; reviewed reversal required';
  end if;
  v_marker:=current_setting('bunbun_accounting.lot_write_operation',true);
  if current_user<>'service_role'
    or new.operation_key is null
    or v_marker is distinct from new.operation_key::text
    or new.movement_date<v_cutover
    or new.movement_type not in ('CAFE_OUT','CAFE_IN')
    or (new.movement_type='CAFE_IN' and new.sale_id is null) then
    raise exception 'Lot tracking active: untracked sale/stock writer denied';
  end if;
  return new;
end
$fn$;

create or replace function bunbun_accounting.assert_tracked_movement_allocated()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
  v_mode text;
  v_header bunbun_accounting.lot_sale_transactions%rowtype;
  v_manual bunbun_accounting.lot_release_operations%rowtype;
  v_sale public.sales%rowtype;
  v_sum bigint;
  v_count integer;
  v_mismatch bigint;
  v_stock bigint;
  v_lot_total bigint;
  v_lot_key text;
  v_lot_delta bigint;
  v_out bigint;
  v_in bigint;
  v_manual_out bigint;
  v_sale_qty numeric;
begin
  select mode into v_mode from bunbun_accounting.lot_tracking_control where singleton;
  if not found then raise exception 'Lot tracking control missing'; end if;
  if v_mode='OFF' then return null; end if;

  if new.movement_type='CAFE_OUT' and new.sale_id is null then
    select * into v_manual from bunbun_accounting.lot_release_operations
    where operation_key=new.operation_key and status='RECORDED';
    if not found or v_manual.movement_date<>new.movement_date then
      raise exception 'Manual release lacks recorded lot source';
    end if;
    select coalesce(sum(a.qty),0),count(*) into v_sum,v_count
    from bunbun_accounting.lot_release_allocations a
    join bunbun_accounting.finished_lot_positions l on l.lot_key=a.lot_key
    where a.operation_key=new.operation_key and a.stock_movement_id=new.id
      and a.product_id=new.product_id and l.product_id=new.product_id;
  elsif new.movement_type='CAFE_OUT' and new.sale_id is not null then
    select * into v_header from bunbun_accounting.lot_sale_transactions
    where operation_key=new.operation_key and action='SALE_CREATE'
      and status='RECORDED';
    select * into v_sale from public.sales where id=new.sale_id;
    if v_header.operation_key is null or v_header.sale_id<>new.sale_id
      or v_sale.operation_key<>new.operation_key
      or v_sale.sale_date<>new.movement_date then
      raise exception 'SALE_OUT movement lacks matching recorded sale operation';
    end if;
    select sum(si.quantity) into v_sale_qty
    from public.sale_items si
    where si.sale_id=new.sale_id and si.product_id=new.product_id;
    if v_sale_qty is null or v_sale_qty<>new.qty then
      raise exception 'Sale line quantity differs from stock movement';
    end if;
    select coalesce(sum(a.qty),0),count(*) into v_sum,v_count
    from bunbun_accounting.lot_sale_out_allocations a
    join bunbun_accounting.finished_lot_positions l on l.lot_key=a.lot_key
    where a.operation_key=new.operation_key
      and a.stock_movement_id=new.id and a.sale_id=new.sale_id
      and a.product_id=new.product_id and l.product_id=new.product_id;
  elsif new.movement_type='CAFE_IN' and new.sale_id is not null then
    select * into v_header from bunbun_accounting.lot_sale_transactions
    where operation_key=new.operation_key and action='SALE_CANCEL'
      and status='RECORDED';
    select * into v_sale from public.sales where id=new.sale_id;
    if v_header.operation_key is null or v_header.sale_id<>new.sale_id
      or v_sale.is_deleted<>true or new.movement_date<v_sale.sale_date then
      raise exception 'CAFE_IN lacks recorded physical sale cancellation';
    end if;
    select coalesce(sum(a.qty),0),count(*) into v_sum,v_count
    from bunbun_accounting.lot_sale_return_allocations a
    join bunbun_accounting.lot_sale_out_allocations original
      on original.id=a.original_allocation_id
    join bunbun_accounting.finished_lot_positions l on l.lot_key=a.lot_key
    where a.operation_key=new.operation_key and a.stock_movement_id=new.id
      and a.sale_id=new.sale_id and a.product_id=new.product_id
      and original.sale_id=a.sale_id and original.lot_key=a.lot_key
      and original.qty=a.qty and original.product_id=a.product_id
      and l.product_id=new.product_id;
  else
    raise exception 'Untracked stock movement type during active lot cutover';
  end if;
  if v_count=0 or v_sum<>new.qty then
    raise exception 'Stock movement does not match complete per-lot allocation';
  end if;

  select coalesce(sum(case
    when movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN') then qty
    when movement_type='CAFE_OUT' then -qty else 0 end),0)
  into v_stock from public.product_stock_movements
  where product_id=new.product_id and is_deleted=false;
  select coalesce(sum(available_qty),0)
  into v_lot_total from bunbun_accounting.finished_lot_positions
  where product_id=new.product_id;
  if v_stock<>v_lot_total then
    raise exception 'Finished balance and tracked lot positions do not reconcile';
  end if;

  for v_lot_key in
    select lot_key from bunbun_accounting.finished_lot_positions
    where product_id=new.product_id
  loop
    select original_qty-available_qty into v_lot_delta
    from bunbun_accounting.finished_lot_positions where lot_key=v_lot_key;
    select coalesce(sum(qty),0) into v_manual_out
    from bunbun_accounting.lot_release_allocations
    where lot_key=v_lot_key;
    select coalesce(sum(qty),0) into v_out
    from bunbun_accounting.lot_sale_out_allocations
    where lot_key=v_lot_key;
    select coalesce(sum(qty),0) into v_in
    from bunbun_accounting.lot_sale_return_allocations
    where lot_key=v_lot_key;
    if v_lot_delta<>v_manual_out+v_out-v_in then
      raise exception 'Sale/reversal/manual lot balance mismatch';
    end if;
  end loop;
  return null;
end
$fn$;

revoke all on function bunbun_accounting.prevent_recorded_sale_lot_edit()
 from public,anon,authenticated;
create or replace function bunbun_accounting.record_sale_with_lots_staging(
 p_sale_date date,p_channel text,p_evidence_ref text,p_items jsonb,
 p_operation_key uuid,p_actor_id uuid
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog as $fn$
declare
 v_gate bunbun_accounting.lot_tracking_control%rowtype;
 v_op bunbun_accounting.lot_sale_transactions%rowtype;
 v_sale_id bigint;
 v_fingerprint text;
 v_item jsonb;
 v_alloc jsonb;
 v_product public.products%rowtype;
 v_lot bunbun_accounting.finished_lot_positions%rowtype;
 v_pid bigint;
 v_qty integer;
 v_price numeric(18,2);
 v_lot_qty integer;
 v_lot_key text;
 v_allocated bigint;
 v_total numeric(18,2):=0;
 v_available bigint;
 v_stock bigint;
 v_movement_id bigint;
 v_seen bigint[]:=array[]::bigint[];
 v_seen_lots text[];
begin
 if current_user<>'service_role' or not exists(
   select 1 from public.profiles where id=p_actor_id
    and role::text='owner' and is_active=true) then
   raise exception 'Active Owner through trusted service required'; end if;
 select * into v_gate from bunbun_accounting.lot_tracking_control where singleton;
 if not found or v_gate.mode<>'ON' or p_sale_date is null or
   p_sale_date<v_gate.cutover_on or p_operation_key is null or
   length(btrim(coalesce(p_channel,'')))<2 or
   length(btrim(coalesce(p_evidence_ref,'')))<6 or
   jsonb_typeof(p_items)<>'array' or
   jsonb_array_length(p_items) not between 1 and 100 then
   raise exception 'Sale requires active CI cutover, channel, items and evidence'; end if;
 v_fingerprint:=md5(concat_ws('|',p_sale_date::text,p_channel,
   p_evidence_ref,p_items::text));
 insert into bunbun_accounting.lot_sale_transactions
  (operation_key,action,fingerprint,actor_id,evidence_ref)
 values (p_operation_key,'SALE_CREATE',v_fingerprint,p_actor_id,p_evidence_ref)
 on conflict(operation_key) do nothing;
 select * into v_op from bunbun_accounting.lot_sale_transactions
  where operation_key=p_operation_key for update;
 if v_op.action<>'SALE_CREATE' or v_op.fingerprint<>v_fingerprint
   or v_op.actor_id<>p_actor_id then
   raise exception 'Sale operation key reused with different request'; end if;
 if v_op.status='RECORDED' then
   return jsonb_build_object('sale_id',v_op.sale_id,
     'already_exists',true,'financial_posted',false); end if;
 if exists(
  select 1 from jsonb_array_elements(p_items) j
  where coalesce(j.value->>'productId','') !~ '^[1-9][0-9]{0,14}$'
   or coalesce(j.value->>'quantity','') !~ '^[1-9][0-9]{0,5}$'
   or coalesce(j.value->>'sellingPrice','') !~ '^[0-9]{1,9}(\.[0-9]{1,2})?$'
   or coalesce(j.value->>'orderType','') not in ('DINE_IN','TAKE_AWAY')
   or jsonb_typeof(j.value->'allocations')<>'array'
 ) then raise exception 'Invalid sale items or price'; end if;

 insert into public.sales
  (sale_date,sales_channel,total_amount,notes,is_deleted,
   operation_key,created_by,updated_by)
 values (p_sale_date,btrim(p_channel),0,
   'Staging lot sale; finance not posted',false,
   p_operation_key,p_actor_id,p_actor_id) returning id into v_sale_id;

 for v_item in select value from jsonb_array_elements(p_items)
   order by (value->>'productId')::bigint
 loop
  v_pid:=(v_item->>'productId')::bigint;
  v_qty:=(v_item->>'quantity')::integer;
  v_price:=(v_item->>'sellingPrice')::numeric(18,2);
  if v_pid=any(v_seen) then raise exception 'Duplicate sale product'; end if;
  v_seen:=array_append(v_seen,v_pid);
  select * into v_product from public.products
    where id=v_pid and is_active=true and is_deleted=false for update;
  if not found then raise exception 'Inactive sale product'; end if;
  perform 1 from bunbun_accounting.finished_lot_positions
    where product_id=v_pid order by lot_key for update;
  select coalesce(sum(available_qty),0) into v_available
  from bunbun_accounting.finished_lot_positions where product_id=v_pid;
  select coalesce(sum(case
    when movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN') then qty
    when movement_type='CAFE_OUT' then -qty else 0 end),0) into v_stock
  from public.product_stock_movements
  where product_id=v_pid and is_deleted=false;
  if v_stock<>v_available then raise exception 'Sale stock/lot divergence'; end if;
  if v_qty>v_available then raise exception 'Sale stock insufficient'; end if;
  if jsonb_array_length(v_item->'allocations') not between 1 and 100 then
    raise exception 'Every sale product requires lot sources'; end if;
  v_allocated:=0;
  v_seen_lots:=array[]::text[];
  for v_alloc in select value from jsonb_array_elements(v_item->'allocations')
  loop
   v_lot_key:=v_alloc->>'lotKey';
   if coalesce(v_lot_key,'') !~ '^(split:[1-9][0-9]*|opening:[A-Za-z0-9_-]{4,64})$'
    or coalesce(v_alloc->>'qty','') !~ '^[1-9][0-9]{0,5}$' then
     raise exception 'Invalid sale lot ID or qty'; end if;
   if v_lot_key=any(v_seen_lots) then raise exception 'Duplicate sale lot'; end if;
   v_seen_lots:=array_append(v_seen_lots,v_lot_key);
   v_lot_qty:=(v_alloc->>'qty')::integer;
   select * into v_lot from bunbun_accounting.finished_lot_positions
   where lot_key=v_lot_key for update;
   if not found or v_lot.product_id<>v_pid or v_lot.location<>'FINISHED'
     or v_lot.first_available_on>p_sale_date
     or v_lot.available_qty<v_lot_qty then
     raise exception 'Wrong or insufficient sale lot'; end if;
   v_allocated:=v_allocated+v_lot_qty;
   if v_allocated>v_qty then raise exception 'Sale lot quantity overflow'; end if;
  end loop;
  if v_allocated<>v_qty then raise exception 'Sale lot quantity mismatch'; end if;
  v_total:=v_total+v_qty*v_price;
  insert into public.sale_items
   (sale_id,product_id,product_sku,product_name,quantity,
    selling_price,subtotal,order_type)
  values(v_sale_id,v_pid,v_product.sku,v_product.nama,v_qty,
    v_price,v_qty*v_price,v_item->>'orderType');
  perform set_config('bunbun_accounting.lot_write_operation',
    p_operation_key::text,true);
  insert into public.product_stock_movements
   (movement_date,movement_type,product_id,qty,unit,
    operation_key,sale_id,notes,is_deleted,created_by,updated_by)
  values(p_sale_date,'CAFE_OUT',v_pid,v_qty,'pcs',p_operation_key,v_sale_id,
    'Sale source lot',false,p_actor_id,p_actor_id)
  returning id into v_movement_id;
  for v_alloc in select value from jsonb_array_elements(v_item->'allocations')
  loop
   v_lot_key:=v_alloc->>'lotKey';
   v_lot_qty:=(v_alloc->>'qty')::integer;
   update bunbun_accounting.finished_lot_positions
     set available_qty=available_qty-v_lot_qty where lot_key=v_lot_key;
   insert into bunbun_accounting.lot_sale_out_allocations
     (operation_key,sale_id,stock_movement_id,lot_key,product_id,qty)
   values(p_operation_key,v_sale_id,v_movement_id,v_lot_key,v_pid,v_lot_qty);
  end loop;
 end loop;
 update public.sales set total_amount=v_total where id=v_sale_id;
 update bunbun_accounting.lot_sale_transactions
   set sale_id=v_sale_id,status='RECORDED' where operation_key=p_operation_key;
 return jsonb_build_object('sale_id',v_sale_id,'already_exists',false,
   'total_amount',v_total,'stock_traced',true,
   'financial_posted',false,'cogs_posted',false);
end $fn$;
revoke all on function bunbun_accounting.record_sale_with_lots_staging(
 date,text,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function bunbun_accounting.record_sale_with_lots_staging(
 date,text,text,jsonb,uuid,uuid) to service_role;
create or replace function bunbun_accounting.cancel_lot_sale_staging(
 p_sale_id bigint,p_return_date date,p_evidence_ref text,
 p_physically_returned boolean,p_operation_key uuid,p_actor_id uuid
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog as $fn$
declare
 v_gate bunbun_accounting.lot_tracking_control%rowtype;
 v_old public.sales%rowtype;
 v_existing bunbun_accounting.lot_sale_transactions%rowtype;
 v_fingerprint text;
 v_pid record;
 v_original record;
 v_lot bunbun_accounting.finished_lot_positions%rowtype;
 v_qty integer;
 v_stock bigint;
 v_pos bigint;
 v_movement_id bigint;
begin
 if current_user<>'service_role' or not exists(
   select 1 from public.profiles where id=p_actor_id
    and role::text='owner' and is_active=true) then
   raise exception 'Active Owner via trusted service required'; end if;
 select * into v_gate from bunbun_accounting.lot_tracking_control where singleton;
 if not found or v_gate.mode<>'ON' or
   p_return_date is null or p_return_date<v_gate.cutover_on
   or p_operation_key is null or
   length(btrim(coalesce(p_evidence_ref,'')))<6
   or p_physically_returned is distinct from true then
   raise exception 'Physical return evidence required; financial cancellation must not restock sold goods';
 end if;
 v_fingerprint:=md5(concat_ws('|',p_sale_id::text,
   p_return_date::text,p_evidence_ref,'RESELLABLE_PHYSICAL_RETURN'));
 select * into v_old from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Original sale missing'; end if;
 select * into v_existing from bunbun_accounting.lot_sale_transactions
 where operation_key=p_operation_key for update;
 if found then
  if v_existing.action<>'SALE_CANCEL' or
     v_existing.sale_id<>p_sale_id or
     v_existing.fingerprint<>v_fingerprint or
     v_existing.actor_id<>p_actor_id then
     raise exception 'Cancellation operation key reused with changed request'; end if;
  if v_existing.status='RECORDED' then
    return jsonb_build_object('sale_id',p_sale_id,'already_exists',true,
      'stock_reversed',true,'financial_posted',false); end if;
 end if;
 if v_old.is_deleted then
   raise exception 'Sale already canceled'; end if;
 if p_return_date<v_old.sale_date then
   raise exception 'Return date before sale'; end if;
 if not exists(select 1 from bunbun_accounting.lot_sale_transactions
  where action='SALE_CREATE' and sale_id=p_sale_id
   and operation_key=v_old.operation_key and status='RECORDED') then
   raise exception 'Historical sale has no verified original lot allocation';
 end if;
 if exists(select 1 from bunbun_accounting.lot_sale_transactions
  where action='SALE_CANCEL' and sale_id=p_sale_id) then
   raise exception 'Sale already has cancellation operation'; end if;
 insert into bunbun_accounting.lot_sale_transactions
  (operation_key,action,fingerprint,sale_id,actor_id,evidence_ref)
 values(p_operation_key,'SALE_CANCEL',v_fingerprint,p_sale_id,
  p_actor_id,p_evidence_ref);
 for v_pid in
   select distinct product_id from bunbun_accounting.lot_sale_out_allocations
   where sale_id=p_sale_id order by product_id
 loop
  perform 1 from public.products where id=v_pid.product_id for update;
  perform 1 from bunbun_accounting.finished_lot_positions
    where product_id=v_pid.product_id order by lot_key for update;
  select coalesce(sum(available_qty),0) into v_pos
   from bunbun_accounting.finished_lot_positions where product_id=v_pid.product_id;
  select coalesce(sum(case
    when movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN') then qty
    when movement_type='CAFE_OUT' then -qty else 0 end),0) into v_stock
  from public.product_stock_movements
  where product_id=v_pid.product_id and is_deleted=false;
  if v_pos<>v_stock then raise exception 'Cannot return against divergent stock'; end if;
  select sum(qty)::integer into v_qty
   from bunbun_accounting.lot_sale_out_allocations
   where sale_id=p_sale_id and product_id=v_pid.product_id;
  if v_qty is null or v_qty<=0 then
    raise exception 'Missing original lot cost/quantity source'; end if;

  perform set_config('bunbun_accounting.lot_write_operation',
    p_operation_key::text,true);
  insert into public.product_stock_movements
   (movement_date,movement_type,product_id,qty,unit,
    operation_key,sale_id,notes,is_deleted,created_by,updated_by)
  values(p_return_date,'CAFE_IN',v_pid.product_id,v_qty,'pcs',
   p_operation_key,p_sale_id,
   'Physically verified return to original sale lot',
   false,p_actor_id,p_actor_id) returning id into v_movement_id;

  for v_original in
    select * from bunbun_accounting.lot_sale_out_allocations
    where sale_id=p_sale_id and product_id=v_pid.product_id order by lot_key
  loop
   select * into v_lot from bunbun_accounting.finished_lot_positions
   where lot_key=v_original.lot_key for update;
   if not found or v_lot.product_id<>v_pid.product_id or
      v_lot.available_qty+v_original.qty>v_lot.original_qty then
      raise exception 'Original lot cannot accept returned stock'; end if;
   update bunbun_accounting.finished_lot_positions
    set available_qty=available_qty+v_original.qty
    where lot_key=v_original.lot_key;
   insert into bunbun_accounting.lot_sale_return_allocations
    (operation_key,original_allocation_id,sale_id,stock_movement_id,
      lot_key,product_id,qty)
   values(p_operation_key,v_original.id,p_sale_id,v_movement_id,
     v_original.lot_key,v_original.product_id,v_original.qty);
  end loop;
 end loop;
 update public.sales set is_deleted=true,updated_by=p_actor_id
 where id=p_sale_id;
 update bunbun_accounting.lot_sale_transactions
  set status='RECORDED' where operation_key=p_operation_key;
 return jsonb_build_object('sale_id',p_sale_id,'already_exists',false,
  'stock_reversed',true,'financial_posted',false,
  'financial_reversal_pending',true);
end $fn$;
revoke all on function bunbun_accounting.cancel_lot_sale_staging(
 bigint,date,text,boolean,uuid,uuid) from public,anon,authenticated;
grant execute on function bunbun_accounting.cancel_lot_sale_staging(
 bigint,date,text,boolean,uuid,uuid) to service_role;
create or replace function bunbun_accounting.replace_lot_sale_staging(
 p_old_sale_id bigint,p_new_date date,p_new_channel text,
 p_return_evidence text,p_new_sale_evidence text,
 p_physically_returned boolean,p_new_items jsonb,
 p_cancel_key uuid,p_new_sale_key uuid,p_actor_id uuid
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog as $fn$
declare
 v_previous bunbun_accounting.lot_sale_replacements%rowtype;
 v_fingerprint text;
 v_cancel jsonb;
 v_new jsonb;
 v_new_id bigint;
begin
 if current_user<>'service_role' then raise exception 'Service required'; end if;
 if p_cancel_key is null or p_new_sale_key is null or
   p_cancel_key=p_new_sale_key then
   raise exception 'Two distinct operation IDs required for sale edit'; end if;
 v_fingerprint:=md5(concat_ws('|',p_old_sale_id::text,p_new_date::text,
   p_new_channel,p_return_evidence,p_new_sale_evidence,
   p_new_items::text,p_actor_id::text,p_physically_returned::text));
 select * into v_previous from bunbun_accounting.lot_sale_replacements
 where old_sale_id=p_old_sale_id;
 if found then
   if v_previous.cancel_operation_key<>p_cancel_key or
     v_previous.new_operation_key<>p_new_sale_key or
     v_previous.actor_id<>p_actor_id or
     v_previous.fingerprint<>v_fingerprint then
     raise exception 'Sale already replaced with different request'; end if;
   return jsonb_build_object('old_sale_id',p_old_sale_id,
     'new_sale_id',v_previous.new_sale_id,
     'already_exists',true,'financial_posted',false);
 end if;
 v_cancel:=bunbun_accounting.cancel_lot_sale_staging(
   p_old_sale_id,p_new_date,p_return_evidence,p_physically_returned,
   p_cancel_key,p_actor_id);
 v_new:=bunbun_accounting.record_sale_with_lots_staging(
   p_new_date,p_new_channel,p_new_sale_evidence,p_new_items,
   p_new_sale_key,p_actor_id);
 v_new_id:=(v_new->>'sale_id')::bigint;
 insert into bunbun_accounting.lot_sale_replacements
  (old_sale_id,new_sale_id,cancel_operation_key,new_operation_key,
   fingerprint,actor_id)
 values(p_old_sale_id,v_new_id,p_cancel_key,p_new_sale_key,
   v_fingerprint,p_actor_id);
 return jsonb_build_object('old_sale_id',p_old_sale_id,
   'new_sale_id',v_new_id,'already_exists',false,
   'stock_reversed_and_reissued',true,
   'financial_posted',false,'financial_reversal_pending',true);
end $fn$;
revoke all on function bunbun_accounting.replace_lot_sale_staging(
 bigint,date,text,text,text,boolean,jsonb,uuid,uuid,uuid)
 from public,anon,authenticated;
grant execute on function bunbun_accounting.replace_lot_sale_staging(
 bigint,date,text,text,text,boolean,jsonb,uuid,uuid,uuid) to service_role;
create or replace function bunbun_accounting.record_single_cafe_release_staging(
  p_product_id bigint,
  p_qty integer,
  p_movement_date date,
  p_destination text,
  p_evidence_ref text,
  p_allocations jsonb,
  p_operation_key uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
  v_gate bunbun_accounting.lot_tracking_control%rowtype;
  v_result jsonb;
  v_item jsonb;
  v_id bigint;
  v_movement_ids jsonb;
begin
  if current_user<>'service_role' then
    raise exception 'Trusted service role required'; end if;
  if p_product_id is null or p_product_id<=0 or
    p_qty is null or p_qty<=0 or p_movement_date is null or
    nullif(btrim(coalesce(p_destination,'')),'') is null or
    length(btrim(coalesce(p_evidence_ref,'')))<6 or
    p_operation_key is null or
    jsonb_typeof(p_allocations)<>'array' or
    jsonb_array_length(p_allocations) not between 1 and 100 then
    raise exception 'Valid product, qty, destination, evidence and explicit lots required';
  end if;
  select * into v_gate from bunbun_accounting.lot_tracking_control
  where singleton;
  if not found or v_gate.mode<>'ON'
    or p_movement_date<v_gate.cutover_on then
    raise exception 'Lot tracking cutover is not approved for this movement';
  end if;

  v_item:=jsonb_build_array(jsonb_build_object(
    'productId',p_product_id,
    'quantity',p_qty,
    'allocations',p_allocations
  ));
  v_result:=bunbun_accounting.record_lot_assigned_release(
    p_movement_date,
    btrim(p_destination),
    'CAFE_CONSIGNMENT',
    btrim(p_evidence_ref),
    v_item,
    p_operation_key,
    p_actor_id
  );
  v_movement_ids:=v_result->'movement_ids';
  if jsonb_typeof(v_movement_ids)<>'array'
    or jsonb_array_length(v_movement_ids)<>1 then
    raise exception 'Single cafe release must have exactly one stock movement';
  end if;
  v_id:=(v_movement_ids->>0)::bigint;
  return jsonb_build_object(
    'movement_id',v_id,
    'product_id',p_product_id,
    'deposited_qty',p_qty,
    'remaining_finished_qty',(
      select coalesce(sum(available_qty),0)
      from bunbun_accounting.finished_lot_positions
      where product_id=p_product_id and location='FINISHED'
    ),
    'already_exists',v_result->'already_exists',
    'source_lot_verified_in_ci',true,
    'recognized_sale',false,
    'cogs_posted',false,
    'cash_posted',false
  );
end
$fn$;
revoke all on function bunbun_accounting.record_single_cafe_release_staging(
  bigint,integer,date,text,text,jsonb,uuid,uuid)
from public,anon,authenticated;
grant execute on function bunbun_accounting.record_single_cafe_release_staging(
  bigint,integer,date,text,text,jsonb,uuid,uuid)
to service_role;

create table bunbun_accounting.product_lot_adjustments (
  operation_key uuid primary key,
  fingerprint text not null check(length(fingerprint)=32),
  movement_id bigint unique references public.product_stock_movements(id),
  product_id bigint not null references public.products(id),
  direction text not null check(direction in ('IN','OUT')),
  qty integer not null check(qty>0),
  movement_date date not null,
  reason text not null check(length(btrim(reason))>=3),
  notes text not null check(length(btrim(notes))>=3),
  evidence_ref text not null check(length(btrim(evidence_ref))>=6),
  reverse_of uuid unique references bunbun_accounting.product_lot_adjustments(operation_key),
  actor_id uuid not null references auth.users(id),
  status text not null default 'PROCESSING'
    check(status in ('PROCESSING','RECORDED')),
  created_at timestamptz not null default now(),
  check ((direction='IN')=(reverse_of is not null))
);

create table bunbun_accounting.product_lot_adjustment_lines (
  id bigint generated always as identity primary key,
  operation_key uuid not null references bunbun_accounting.product_lot_adjustments(operation_key),
  movement_id bigint not null references public.product_stock_movements(id),
  lot_key text not null references bunbun_accounting.finished_lot_positions(lot_key),
  product_id bigint not null references public.products(id),
  direction text not null check(direction in ('IN','OUT')),
  qty integer not null check(qty>0),
  reverses_line_id bigint unique references bunbun_accounting.product_lot_adjustment_lines(id),
  created_at timestamptz not null default now(),
  unique(operation_key,lot_key),
  unique(movement_id,lot_key),
  check ((direction='IN')=(reverses_line_id is not null))
);
create index adjustment_lines_by_lot
  on bunbun_accounting.product_lot_adjustment_lines(lot_key,operation_key);

alter table bunbun_accounting.product_lot_adjustments enable row level security;
alter table bunbun_accounting.product_lot_adjustment_lines enable row level security;
revoke all on bunbun_accounting.product_lot_adjustments,
  bunbun_accounting.product_lot_adjustment_lines
from public,anon,authenticated;
grant select,insert,update on bunbun_accounting.product_lot_adjustments
  to service_role;
grant select,insert on bunbun_accounting.product_lot_adjustment_lines
  to service_role;
grant usage,select on all sequences in schema bunbun_accounting to service_role;

create or replace function bunbun_accounting.prevent_recorded_adjustment_edit()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $fn$
begin
  if tg_table_name='product_lot_adjustments' and tg_op='UPDATE'
    and old.status='PROCESSING' and new.status='RECORDED'
    and new.operation_key=old.operation_key and
    new.fingerprint=old.fingerprint and new.actor_id=old.actor_id
    and new.product_id=old.product_id and new.direction=old.direction
    and new.qty=old.qty and new.movement_date=old.movement_date
    and new.reason=old.reason and new.notes=old.notes
    and new.evidence_ref=old.evidence_ref
    and new.reverse_of is not distinct from old.reverse_of
    and old.movement_id is null and new.movement_id is not null then
      return new;
  end if;
  raise exception 'Lot adjustment audit is immutable; create a reviewed reversal';
end
$fn$;

create trigger prevent_adjustment_header_edit
before update or delete on bunbun_accounting.product_lot_adjustments
for each row execute function bunbun_accounting.prevent_recorded_adjustment_edit();
create trigger prevent_adjustment_line_edit
before update or delete on bunbun_accounting.product_lot_adjustment_lines
for each row execute function bunbun_accounting.prevent_recorded_adjustment_edit();

create or replace function bunbun_accounting.enforce_lot_stock_writer()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $fn$
declare
 v_mode text;
 v_cutover date;
 v_marker text;
begin
 select mode,cutover_on into v_mode,v_cutover
 from bunbun_accounting.lot_tracking_control where singleton;
 if not found then raise exception 'Lot tracking control missing'; end if;
 if v_mode='OFF' then
  if tg_op='DELETE' then return old; end if;
  return new;
 end if;
 if tg_op<>'INSERT' then
   raise exception 'Tracked stock is append-only';
 end if;
 v_marker:=current_setting('bunbun_accounting.lot_write_operation',true);
 if current_user<>'service_role' or new.operation_key is null
    or v_marker is distinct from new.operation_key::text
    or new.movement_date<v_cutover
    or new.movement_type not in ('CAFE_OUT','ADJUSTMENT_IN','ADJUSTMENT_OUT')
    or (new.movement_type in ('ADJUSTMENT_IN','ADJUSTMENT_OUT')
      and (new.sale_id is not null or new.batch_split_id is not null))
    or (new.movement_type='CAFE_OUT' and new.sale_id is not null) then
    raise exception 'Untracked stock writer denied by lot cutover';
 end if;
 return new;
end
$fn$;

create or replace function bunbun_accounting.assert_tracked_movement_allocated()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $fn$
declare
 v_control bunbun_accounting.lot_tracking_control%rowtype;
 v_qty bigint;
 v_count integer;
 v_adjustment bunbun_accounting.product_lot_adjustments%rowtype;
 v_release bunbun_accounting.lot_release_operations%rowtype;
 v_stock bigint;
 v_positions bigint;
 v_lot record;
 v_out bigint;
 v_in bigint;
 v_manual bigint;
begin
 select * into v_control from bunbun_accounting.lot_tracking_control where singleton;
 if not found then raise exception 'Lot control missing'; end if;
 if v_control.mode='OFF' then return null; end if;
 if new.movement_type in ('ADJUSTMENT_IN','ADJUSTMENT_OUT') then
   select * into v_adjustment from bunbun_accounting.product_lot_adjustments
   where operation_key=new.operation_key and movement_id=new.id
     and product_id=new.product_id and movement_date=new.movement_date
     and direction=case when new.movement_type='ADJUSTMENT_IN' then 'IN' else 'OUT' end
     and status='RECORDED';
   if not found or v_adjustment.qty<>new.qty then
     raise exception 'Adjustment stock lacks reviewed operation and exact qty';
   end if;
   select coalesce(sum(a.qty),0),count(*) into v_qty,v_count
   from bunbun_accounting.product_lot_adjustment_lines a
   join bunbun_accounting.finished_lot_positions l
    on l.lot_key=a.lot_key and l.product_id=a.product_id
   where a.operation_key=new.operation_key and a.movement_id=new.id
     and a.product_id=new.product_id and a.direction=v_adjustment.direction;
 elsif new.movement_type='CAFE_OUT' and new.sale_id is null then
   select * into v_release from bunbun_accounting.lot_release_operations
   where operation_key=new.operation_key and status='RECORDED'
     and movement_date=new.movement_date;
   if not found then raise exception 'Missing manual cafe lot release evidence'; end if;
   select coalesce(sum(a.qty),0),count(*) into v_qty,v_count
   from bunbun_accounting.lot_release_allocations a
   join bunbun_accounting.finished_lot_positions l
    on l.lot_key=a.lot_key and l.product_id=a.product_id
   where a.operation_key=new.operation_key and a.stock_movement_id=new.id
     and a.product_id=new.product_id;
 else
   raise exception 'Unexpected writer bypassed isolated lot adjustment gate';
 end if;
 if v_count=0 or v_qty<>new.qty then
   raise exception 'Movement qty not equal source lot allocation';
 end if;

 select coalesce(sum(case
  when movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN')
   then qty
  when movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -qty
  else 0 end),0)
 into v_stock from public.product_stock_movements
 where product_id=new.product_id and is_deleted=false;
 select coalesce(sum(available_qty),0) into v_positions
 from bunbun_accounting.finished_lot_positions
 where product_id=new.product_id and location='FINISHED';
 if v_stock<>v_positions then
   raise exception 'Stock and finished lot positions are not reconciled';
 end if;

 for v_lot in
   select lot_key,original_qty,available_qty
   from bunbun_accounting.finished_lot_positions
   where product_id=new.product_id
 loop
  select coalesce(sum(qty),0) into v_manual
  from bunbun_accounting.lot_release_allocations where lot_key=v_lot.lot_key;
  select coalesce(sum(qty),0) into v_out
  from bunbun_accounting.product_lot_adjustment_lines
  where lot_key=v_lot.lot_key and direction='OUT';
  select coalesce(sum(qty),0) into v_in
  from bunbun_accounting.product_lot_adjustment_lines
  where lot_key=v_lot.lot_key and direction='IN';
  if v_lot.original_qty-v_lot.available_qty<>v_manual+v_out-v_in then
    raise exception 'Lot consumed/adjusted balance does not reconcile';
  end if;
 end loop;
 return null;
end
$fn$;

revoke all on function bunbun_accounting.prevent_recorded_adjustment_edit()
from public,anon,authenticated;
revoke all on function bunbun_accounting.assert_tracked_movement_allocated()
from public,anon,authenticated;
create or replace function bunbun_accounting.record_product_lot_adjustment_staging(
 p_product_id bigint,p_direction text,p_qty integer,p_movement_date date,
 p_reason text,p_notes text,p_evidence_ref text,p_allocations jsonb,
 p_reverse_of uuid,p_operation_key uuid,p_actor_id uuid
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
 v_gate bunbun_accounting.lot_tracking_control%rowtype;
 v_product public.products%rowtype;
 v_prev bunbun_accounting.product_lot_adjustments%rowtype;
 v_original bunbun_accounting.product_lot_adjustments%rowtype;
 v_original_line record;
 v_fingerprint text;
 v_movement_id bigint;
 v_type text;
 v_balance bigint;
 v_stock bigint;
 v_allocated bigint:=0;
 v_lot bunbun_accounting.finished_lot_positions%rowtype;
 v_alloc jsonb;
 v_key text;
 v_lot_qty integer;
 v_seen text[]:=array[]::text[];
 v_count integer:=0;
begin
 if current_user<>'service_role' or not exists(
   select 1 from public.profiles where id=p_actor_id
     and role::text='owner' and is_active=true) then
   raise exception 'Active Owner via trusted service required for adjustment';
 end if;
 select * into v_gate from bunbun_accounting.lot_tracking_control where singleton;
 if not found or v_gate.mode<>'ON' or p_operation_key is null or
   p_movement_date is null or p_movement_date<v_gate.cutover_on or
   p_product_id is null or p_product_id<=0 or
   p_direction not in ('IN','OUT') or p_qty is null or p_qty<=0 or
   p_qty>100000 or length(btrim(coalesce(p_reason,'')))<3 or
   length(btrim(coalesce(p_notes,'')))<3 or
   length(btrim(coalesce(p_evidence_ref,'')))<6 then
   raise exception 'Adjustment requires Owner, active cutover, qty, reason, notes and evidence';
 end if;
 if (p_direction='IN' and (p_reverse_of is null or p_allocations is not null))
   or (p_direction='OUT' and
      (p_reverse_of is not null or jsonb_typeof(p_allocations)<>'array'
       or jsonb_array_length(p_allocations) not between 1 and 100)) then
   raise exception 'IN requires original OUT key; OUT requires explicitly assigned source lots';
 end if;
 if exists(select 1 from bunbun_accounting.lot_release_operations
   where operation_key=p_operation_key) then
   raise exception 'Operation key already belongs to cafe lot release';
 end if;

 select * into v_product from public.products
 where id=p_product_id and is_deleted=false and is_active=true for update;
 if not found then raise exception 'Active product not found'; end if;

 v_fingerprint:=md5(concat_ws('|',p_product_id::text,p_direction,
    p_qty::text,p_movement_date::text,btrim(p_reason),
    btrim(p_notes),btrim(p_evidence_ref),
    coalesce(p_allocations::text,'<none>'),
    coalesce(p_reverse_of::text,'<none>')));
 select * into v_prev from bunbun_accounting.product_lot_adjustments
 where operation_key=p_operation_key for update;
 if found then
   if v_prev.fingerprint<>v_fingerprint or
      v_prev.actor_id<>p_actor_id then
     raise exception 'Adjustment operation key reused with different request';
   end if;
   if v_prev.status='RECORDED' then
     return jsonb_build_object(
       'already_exists',true,'movement_id',v_prev.movement_id,
       'adjustment_type',v_prev.direction,
       'remaining_balance',(
         select coalesce(sum(available_qty),0)
         from bunbun_accounting.finished_lot_positions
         where product_id=p_product_id
       ),
       'cash_posted',false,'recipe_hpp_changed',false,
       'accounting_posted',false);
   end if;
   raise exception 'Incomplete adjustment operation must be reviewed';
 end if;
 perform 1 from bunbun_accounting.finished_lot_positions
 where product_id=p_product_id order by lot_key for update;
 select coalesce(sum(available_qty),0) into v_balance
 from bunbun_accounting.finished_lot_positions
 where product_id=p_product_id;
 select coalesce(sum(case
  when movement_type in ('FINISHED_IN','OPENING_BALANCE',
    'CAFE_IN','ADJUSTMENT_IN') then qty
  when movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -qty
  else 0 end),0) into v_stock
 from public.product_stock_movements
 where product_id=p_product_id and is_deleted=false;
 if v_stock<>v_balance then
   raise exception 'Adjustment refused: product stock and lot positions differ';
 end if;

 if p_direction='IN' then
   select * into v_original from bunbun_accounting.product_lot_adjustments
   where operation_key=p_reverse_of and direction='OUT'
     and product_id=p_product_id and status='RECORDED';
   if not found or v_original.qty<>p_qty or
      v_original.movement_date>p_movement_date then
     raise exception 'Adjustment IN requires matching earlier OUT with same product and qty';
   end if;
   if exists(select 1 from bunbun_accounting.product_lot_adjustments
     where reverse_of=p_reverse_of) then
     raise exception 'Original adjustment OUT already restored';
   end if;
 else
   if p_qty>v_balance then
     raise exception 'Finished lot quantity insufficient for OUT adjustment';
   end if;
   for v_alloc in select value from jsonb_array_elements(p_allocations) loop
     v_key:=v_alloc->>'lotKey';
     if coalesce(v_key,'') !~ '^(split:[1-9][0-9]*|opening:[A-Za-z0-9_-]{4,64})$'
       or coalesce(v_alloc->>'qty','') !~ '^[1-9][0-9]{0,5}$' then
       raise exception 'Invalid adjustment lot identity or qty';
     end if;
     if v_key=any(v_seen) then
       raise exception 'Duplicate lot within adjustment';
     end if;
     v_seen:=array_append(v_seen,v_key);
     v_lot_qty:=(v_alloc->>'qty')::integer;
     select * into v_lot from bunbun_accounting.finished_lot_positions
     where lot_key=v_key for update;
     if not found or v_lot.product_id<>p_product_id
       or v_lot.location<>'FINISHED'
       or v_lot.first_available_on>p_movement_date
       or v_lot.available_qty<v_lot_qty then
       raise exception 'Adjustment cannot consume this source lot';
     end if;
     v_allocated:=v_allocated+v_lot_qty;
     if v_allocated>p_qty then
       raise exception 'Adjustment lot quantities exceed requested qty';
     end if;
   end loop;
   if v_allocated<>p_qty then
     raise exception 'Adjustment lot quantities do not equal product qty';
   end if;
 end if;

 insert into bunbun_accounting.product_lot_adjustments (
  operation_key,fingerprint,product_id,direction,qty,movement_date,
  reason,notes,evidence_ref,reverse_of,actor_id)
 values(p_operation_key,v_fingerprint,p_product_id,p_direction,
  p_qty,p_movement_date,btrim(p_reason),btrim(p_notes),
  btrim(p_evidence_ref),p_reverse_of,p_actor_id);

 v_type:=case when p_direction='OUT' then 'ADJUSTMENT_OUT'
      else 'ADJUSTMENT_IN' end;
 perform set_config('bunbun_accounting.lot_write_operation',
   p_operation_key::text,true);
 insert into public.product_stock_movements (
   movement_date,movement_type,product_id,qty,unit,
   operation_key,batch_split_id,sale_id,notes,is_deleted,created_by,updated_by
 ) values(p_movement_date,v_type,p_product_id,p_qty,'pcs',
   p_operation_key,null,null,
   'Alasan: '||btrim(p_reason)||' | Catatan: '||btrim(p_notes)||
   ' | Bukti: '||btrim(p_evidence_ref),
   false,p_actor_id,p_actor_id)
 returning id into v_movement_id;

 if p_direction='OUT' then
   for v_alloc in select value from jsonb_array_elements(p_allocations) loop
     v_key:=v_alloc->>'lotKey';
     v_lot_qty:=(v_alloc->>'qty')::integer;
     update bunbun_accounting.finished_lot_positions
     set available_qty=available_qty-v_lot_qty where lot_key=v_key;
     insert into bunbun_accounting.product_lot_adjustment_lines
       (operation_key,movement_id,lot_key,product_id,direction,qty)
     values(p_operation_key,v_movement_id,v_key,p_product_id,'OUT',v_lot_qty);
     v_count:=v_count+1;
   end loop;
 else
   for v_original_line in
     select * from bunbun_accounting.product_lot_adjustment_lines
     where operation_key=p_reverse_of and direction='OUT'
     order by lot_key
   loop
     select * into v_lot from bunbun_accounting.finished_lot_positions
     where lot_key=v_original_line.lot_key for update;
     if not found or v_lot.product_id<>p_product_id
       or v_lot.available_qty+v_original_line.qty>v_lot.original_qty then
       raise exception 'Restored lot exceeds original approved quantity';
     end if;
     update bunbun_accounting.finished_lot_positions
     set available_qty=available_qty+v_original_line.qty
     where lot_key=v_original_line.lot_key;
     insert into bunbun_accounting.product_lot_adjustment_lines
       (operation_key,movement_id,lot_key,product_id,direction,qty,
        reverses_line_id)
     values(p_operation_key,v_movement_id,v_original_line.lot_key,
       p_product_id,'IN',v_original_line.qty,v_original_line.id);
     v_allocated:=v_allocated+v_original_line.qty;
     v_count:=v_count+1;
   end loop;
   if v_allocated<>p_qty or v_count=0 then
     raise exception 'Adjusted IN reversal does not exactly match original lot lines';
   end if;
 end if;
 update bunbun_accounting.product_lot_adjustments
 set movement_id=v_movement_id,status='RECORDED'
 where operation_key=p_operation_key;

 return jsonb_build_object(
   'already_exists',false,
   'movement_id',v_movement_id,'product_id',p_product_id,
   'adjustment_type',p_direction,'qty',p_qty,
   'previous_balance',v_balance,
   'remaining_balance',case when p_direction='IN'
    then v_balance+p_qty else v_balance-p_qty end,
   'lot_count',v_count,'cash_posted',false,
   'recipe_hpp_changed',false,'accounting_posted',false,
   'source_cost_review_pending',true
 );
end
$fn$;

revoke all on function bunbun_accounting.record_product_lot_adjustment_staging(
 bigint,text,integer,date,text,text,text,jsonb,uuid,uuid,uuid)
from public,anon,authenticated;
grant execute on function bunbun_accounting.record_product_lot_adjustment_staging(
 bigint,text,integer,date,text,text,text,jsonb,uuid,uuid,uuid)
to service_role;

create or replace function bunbun_accounting.enforce_lot_stock_writer()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
  v_control bunbun_accounting.lot_tracking_control%rowtype;
  v_marker text;
begin
  select * into v_control from bunbun_accounting.lot_tracking_control
  where singleton;
  if not found then raise exception 'Unified lot cutover control missing'; end if;
  if v_control.mode='OFF' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op<>'INSERT' then
    raise exception 'Unified lot tracking is append-only; recorded reversal required';
  end if;
  v_marker:=current_setting('bunbun_accounting.lot_write_operation',true);
  if current_user<>'service_role' or new.operation_key is null
     or v_marker is distinct from new.operation_key::text
     or new.movement_date<v_control.cutover_on
     or new.movement_type not in (
       'FROZEN_IN','FROZEN_OUT','FINISHED_IN',
       'CAFE_OUT','CAFE_IN','ADJUSTMENT_IN','ADJUSTMENT_OUT')
     or (new.movement_type in ('FROZEN_IN','FROZEN_OUT','FINISHED_IN')
         and (new.batch_split_id is null or new.sale_id is not null))
     or (new.movement_type in ('CAFE_OUT','CAFE_IN',
                                  'ADJUSTMENT_IN','ADJUSTMENT_OUT')
         and new.batch_split_id is not null)
     or (new.movement_type='CAFE_IN' and new.sale_id is null)
     or (new.movement_type in ('ADJUSTMENT_IN','ADJUSTMENT_OUT')
         and new.sale_id is not null) then
    raise exception 'Unified lot gate rejected untracked or malformed stock movement';
  end if;
  return new;
end
$fn$;

create or replace function bunbun_accounting.assert_unified_lot_movement()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
  v_control bunbun_accounting.lot_tracking_control%rowtype;
  v_shape bunbun_accounting.shaping_operations%rowtype;
  v_conversion bunbun_accounting.frozen_conversion_operations%rowtype;
  v_baking bunbun_accounting.baking_operations%rowtype;
  v_release bunbun_accounting.lot_release_operations%rowtype;
  v_sale_event bunbun_accounting.lot_sale_transactions%rowtype;
  v_sale public.sales%rowtype;
  v_adjustment bunbun_accounting.product_lot_adjustments%rowtype;
  v_source_split public.production_batch_splits%rowtype;
  v_derived_split public.production_batch_splits%rowtype;
  v_frozen bunbun_accounting.frozen_lot_positions%rowtype;
  v_finished bunbun_accounting.finished_lot_positions%rowtype;
  v_verified bigint;
  v_lines bigint;
  v_qty_expected numeric;
  v_stock bigint;
  v_positions bigint;
  v_used bigint;
  v_out bigint;
  v_in bigint;
  v_manual bigint;
  v_adjust_out bigint;
  v_adjust_in bigint;
  v_lot record;
  v_root record;
begin
  select * into v_control from bunbun_accounting.lot_tracking_control
  where singleton;
  if not found then raise exception 'Unified lot cutover control missing'; end if;
  if v_control.mode='OFF' then return null; end if;

  if new.movement_type='FROZEN_IN' then
    select * into v_shape from bunbun_accounting.shaping_operations
    where operation_key=new.operation_key and frozen_movement_id=new.id
      and product_id=new.product_id and movement_date=new.movement_date
      and frozen_qty=new.qty and status='RECORDED';
    if not found or v_shape.frozen_split_id<>new.batch_split_id then
      raise exception 'Unified FROZEN_IN missing shaping operation';
    end if;
    select * into v_source_split from public.production_batch_splits
    where id=new.batch_split_id and is_deleted=false;
    if not found or v_source_split.route<>'FROZEN'
      or v_source_split.source_split_id is not null
      or v_source_split.qty<>new.qty
      or v_source_split.product_id<>new.product_id
      or v_source_split.production_batch_id<>v_shape.batch_id
      or v_source_split.lot_code is distinct from v_shape.frozen_lot_code then
      raise exception 'Unified FROZEN_IN not supported by original frozen split';
    end if;
    select * into v_frozen from bunbun_accounting.frozen_lot_positions
    where source_split_id=new.batch_split_id
      and source_movement_id=new.id
      and original_qty=new.qty
      and first_available_on=new.movement_date;
    if not found or v_frozen.product_id<>new.product_id then
      raise exception 'Unified FROZEN_IN root lot is not validated';
    end if;

  elsif new.movement_type='FROZEN_OUT' then
    select * into v_conversion
    from bunbun_accounting.frozen_conversion_operations
    where operation_key=new.operation_key and stock_movement_id=new.id
      and source_split_id=new.batch_split_id
      and product_id=new.product_id
      and qty=new.qty and movement_date=new.movement_date
      and status='RECORDED';
    if not found then
      raise exception 'Unified FROZEN_OUT missing conversion evidence';
    end if;
    select * into v_source_split from public.production_batch_splits
    where id=new.batch_split_id and route='FROZEN' and is_deleted=false;
    select * into v_derived_split from public.production_batch_splits
    where id=v_conversion.direct_split_id and is_deleted=false;
    if v_source_split.id is null or v_derived_split.id is null
      or v_derived_split.source_split_id<>new.batch_split_id
      or v_derived_split.production_batch_id<>v_source_split.production_batch_id
      or v_derived_split.route<>'DIRECT'
      or v_derived_split.qty<>new.qty
      or v_derived_split.product_id<>new.product_id
      or v_derived_split.status not in ('PROOFING','BAKING','BAKED') then
      raise exception 'Unified FROZEN_OUT derived split lineage invalid';
    end if;
    if v_derived_split.status='BAKED' and not exists(
      select 1 from bunbun_accounting.baking_operations
      where direct_split_id=v_derived_split.id and status='RECORDED'
    ) then
      raise exception 'Unified frozen derivative baked without result';
    end if;

  elsif new.movement_type='FINISHED_IN' then
    select * into v_baking from bunbun_accounting.baking_operations
    where operation_key=new.operation_key and stock_movement_id=new.id
      and direct_split_id=new.batch_split_id
      and product_id=new.product_id
      and movement_date=new.movement_date
      and good_qty=new.qty and status='RECORDED';
    if not found then
      raise exception 'Unified FINISHED_IN missing baking evidence';
    end if;
    select * into v_source_split from public.production_batch_splits
    where id=new.batch_split_id and is_deleted=false;
    if not found or v_source_split.route<>'DIRECT'
      or v_source_split.status<>'BAKED'
      or v_source_split.qty<>v_baking.good_qty+v_baking.reject_qty
      or v_source_split.baked_good_qty<>v_baking.good_qty
      or v_source_split.baked_reject_qty<>v_baking.reject_qty then
      raise exception 'Unified FINISHED_IN quantities do not match baked split';
    end if;
    select * into v_finished from bunbun_accounting.finished_lot_positions
    where source_split_id=new.batch_split_id and product_id=new.product_id
      and lot_key='split:'||new.batch_split_id::text
      and original_qty=new.qty;
    if not found
      or (v_source_split.source_split_id is null
          and v_finished.source_type<>'DIRECT_RELEASE')
      or (v_source_split.source_split_id is not null
          and v_finished.source_type<>'FROZEN_CONVERSION') then
      raise exception 'Unified FINISHED_IN source finished lot invalid';
    end if;

  elsif new.movement_type='CAFE_OUT' and new.sale_id is null then
    select * into v_release from bunbun_accounting.lot_release_operations
    where operation_key=new.operation_key
      and movement_date=new.movement_date and status='RECORDED';
    if not found then
      raise exception 'Unified manual cafe shipment lacks recorded operation';
    end if;
    select coalesce(sum(a.qty),0),count(*) into v_verified,v_lines
    from bunbun_accounting.lot_release_allocations a
    join bunbun_accounting.finished_lot_positions l on l.lot_key=a.lot_key
    where a.operation_key=new.operation_key
      and a.stock_movement_id=new.id and a.product_id=new.product_id
      and l.product_id=new.product_id;

  elsif new.movement_type='CAFE_OUT' and new.sale_id is not null then
    select * into v_sale_event from bunbun_accounting.lot_sale_transactions
    where operation_key=new.operation_key and action='SALE_CREATE'
      and sale_id=new.sale_id and status='RECORDED';
    select * into v_sale from public.sales where id=new.sale_id;
    if v_sale_event.operation_key is null or v_sale.id is null
      or v_sale.operation_key<>new.operation_key
      or v_sale.sale_date<>new.movement_date then
      raise exception 'Unified sale CAFE_OUT lacks recorded sale/header';
    end if;
    select sum(quantity) into v_qty_expected from public.sale_items
    where sale_id=new.sale_id and product_id=new.product_id;
    if v_qty_expected is null or v_qty_expected<>new.qty then
      raise exception 'Unified sale CAFE_OUT qty mismatch sale_items';
    end if;
    select coalesce(sum(a.qty),0),count(*) into v_verified,v_lines
    from bunbun_accounting.lot_sale_out_allocations a
    join bunbun_accounting.finished_lot_positions l on l.lot_key=a.lot_key
    where a.operation_key=new.operation_key and a.sale_id=new.sale_id
      and a.stock_movement_id=new.id and a.product_id=new.product_id
      and l.product_id=new.product_id;

  elsif new.movement_type='CAFE_IN' then
    select * into v_sale_event from bunbun_accounting.lot_sale_transactions
    where operation_key=new.operation_key and action='SALE_CANCEL'
      and sale_id=new.sale_id and status='RECORDED';
    select * into v_sale from public.sales where id=new.sale_id;
    if v_sale_event.operation_key is null or v_sale.id is null
      or v_sale.is_deleted<>true or new.movement_date<v_sale.sale_date then
      raise exception 'Unified sale CAFE_IN lacks physical return cancellation';
    end if;
    select coalesce(sum(a.qty),0),count(*) into v_verified,v_lines
    from bunbun_accounting.lot_sale_return_allocations a
    join bunbun_accounting.lot_sale_out_allocations original
      on original.id=a.original_allocation_id
    join bunbun_accounting.finished_lot_positions l on l.lot_key=a.lot_key
    where a.operation_key=new.operation_key and a.stock_movement_id=new.id
      and a.sale_id=new.sale_id and a.product_id=new.product_id
      and original.sale_id=a.sale_id and original.lot_key=a.lot_key
      and original.product_id=a.product_id and original.qty=a.qty
      and l.product_id=new.product_id;

  elsif new.movement_type in ('ADJUSTMENT_OUT','ADJUSTMENT_IN') then
    select * into v_adjustment from bunbun_accounting.product_lot_adjustments
    where operation_key=new.operation_key and movement_id=new.id
      and product_id=new.product_id and qty=new.qty
      and movement_date=new.movement_date
      and direction=case when new.movement_type='ADJUSTMENT_OUT'
        then 'OUT' else 'IN' end and status='RECORDED';
    if not found then
      raise exception 'Unified adjustment lacks recorded source lot evidence';
    end if;
    select coalesce(sum(a.qty),0),count(*) into v_verified,v_lines
    from bunbun_accounting.product_lot_adjustment_lines a
    join bunbun_accounting.finished_lot_positions l on l.lot_key=a.lot_key
    where a.operation_key=new.operation_key
      and a.movement_id=new.id and a.product_id=new.product_id
      and a.direction=v_adjustment.direction and l.product_id=new.product_id;
    if v_adjustment.direction='IN' then
      if not exists(
        select 1 from bunbun_accounting.product_lot_adjustments original
        where original.operation_key=v_adjustment.reverse_of
          and original.direction='OUT' and original.status='RECORDED'
          and original.product_id=new.product_id and original.qty=new.qty
      ) or exists(
        select 1 from bunbun_accounting.product_lot_adjustment_lines a
        left join bunbun_accounting.product_lot_adjustment_lines o
          on o.id=a.reverses_line_id
        where a.operation_key=new.operation_key and
          (o.id is null or o.direction<>'OUT'
           or o.operation_key<>v_adjustment.reverse_of
           or a.lot_key<>o.lot_key or a.qty<>o.qty
           or a.product_id<>o.product_id)
      ) then
        raise exception 'Unified adjustment IN not tied to exact original OUT';
      end if;
    end if;
  else
    raise exception 'Unified stock movement has no allowed source type';
  end if;

  if new.movement_type in (
    'CAFE_OUT','CAFE_IN','ADJUSTMENT_IN','ADJUSTMENT_OUT'
  ) and (v_lines=0 or v_verified<>new.qty) then
    raise exception 'Unified movement qty has incomplete product/lot allocations';
  end if;

  for v_root in select * from bunbun_accounting.frozen_lot_positions loop
    select * into v_source_split from public.production_batch_splits
    where id=v_root.source_split_id and route='FROZEN' and is_deleted=false;
    if not found or v_source_split.product_id<>v_root.product_id
      or v_root.original_qty>v_source_split.qty then
      raise exception 'Unified frozen position has no original split';
    end if;
    if not exists (
      select 1 from public.product_stock_movements m
      where m.id=v_root.source_movement_id and
        m.movement_type='FROZEN_IN' and
        m.batch_split_id=v_root.source_split_id and
        m.product_id=v_root.product_id and
        m.qty=v_root.original_qty and not m.is_deleted
    ) then
      raise exception 'Unified frozen position forged source movement';
    end if;
    select coalesce(sum(qty),0) into v_used
    from bunbun_accounting.frozen_conversion_operations
    where source_split_id=v_root.source_split_id and status='RECORDED';
    if v_root.original_qty-v_root.available_qty<>v_used then
      raise exception 'Unified frozen original minus balance != converted qty';
    end if;
    select coalesce(sum(case
       when m.movement_type='FROZEN_IN' then m.qty
       when m.movement_type='FROZEN_OUT' then -m.qty else 0 end),0)
    into v_stock from public.product_stock_movements m
    where m.batch_split_id=v_root.source_split_id and not m.is_deleted;
    if v_stock<>v_root.available_qty then
      raise exception 'Unified frozen movement ledger != frozen position';
    end if;
  end loop;

  for v_lot in select id from public.products where is_deleted=false loop
    select coalesce(sum(case
       when movement_type in ('FINISHED_IN','OPENING_BALANCE',
         'CAFE_IN','ADJUSTMENT_IN') then qty
       when movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -qty
       else 0 end),0) into v_stock
    from public.product_stock_movements
    where product_id=v_lot.id and not is_deleted;
    select coalesce(sum(available_qty),0) into v_positions
    from bunbun_accounting.finished_lot_positions
    where product_id=v_lot.id and location='FINISHED';
    if v_stock<>v_positions then
      raise exception 'Unified finished product movement balance != source lots: product %',
        v_lot.id;
    end if;
  end loop;

  for v_lot in
    select lot_key,original_qty,available_qty,product_id
    from bunbun_accounting.finished_lot_positions
  loop
    select coalesce(sum(qty),0) into v_manual
    from bunbun_accounting.lot_release_allocations
    where lot_key=v_lot.lot_key;
    select coalesce(sum(qty),0) into v_out
    from bunbun_accounting.lot_sale_out_allocations
    where lot_key=v_lot.lot_key;
    select coalesce(sum(qty),0) into v_in
    from bunbun_accounting.lot_sale_return_allocations
    where lot_key=v_lot.lot_key;
    select coalesce(sum(qty),0) into v_adjust_out
    from bunbun_accounting.product_lot_adjustment_lines
    where lot_key=v_lot.lot_key and direction='OUT';
    select coalesce(sum(qty),0) into v_adjust_in
    from bunbun_accounting.product_lot_adjustment_lines
    where lot_key=v_lot.lot_key and direction='IN';
    if v_lot.original_qty-v_lot.available_qty<>
       v_manual+v_out-v_in+v_adjust_out-v_adjust_in then
      raise exception 'Unified finished lot consumption/returns != lot position: %',
        v_lot.lot_key;
    end if;
  end loop;
  return null;
end
$fn$;

drop trigger if exists verify_lot_allocation_before_commit
  on public.product_stock_movements;
drop trigger if exists verify_shaping_frozen_in_commit
  on public.product_stock_movements;
drop trigger if exists verify_unified_lot_movement_commit
  on public.product_stock_movements;
create constraint trigger verify_unified_lot_movement_commit
after insert on public.product_stock_movements
deferrable initially deferred
for each row execute function bunbun_accounting.assert_unified_lot_movement();

revoke all on function bunbun_accounting.enforce_lot_stock_writer()
 from public,anon,authenticated;
revoke all on function bunbun_accounting.assert_unified_lot_movement()
 from public,anon,authenticated;
create or replace function bunbun_accounting.guard_unified_position_write()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
  v_mode text;
  v_marker text;
begin
  select mode into v_mode from bunbun_accounting.lot_tracking_control
  where singleton;
  if not found then raise exception 'Unified stock cutover control missing'; end if;
  if v_mode='OFF' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='DELETE' then
    raise exception 'Tracked lot positions cannot be deleted';
  end if;
  v_marker:=current_setting('bunbun_accounting.lot_write_operation',true);
  if current_user<>'service_role' or
     nullif(btrim(coalesce(v_marker,'')),'') is null then
    raise exception 'Lot positions require trusted atomic stock operation';
  end if;
  if tg_table_name='finished_lot_positions' then
    if tg_op='INSERT' then
      if new.source_type='OPENING' then
        raise exception 'Unreviewed opening lot creation blocked until signed cutover';
      end if;
    elsif new.lot_key is distinct from old.lot_key or
      new.product_id is distinct from old.product_id or
      new.source_type is distinct from old.source_type or
      new.source_split_id is distinct from old.source_split_id or
      new.location is distinct from old.location or
      new.first_available_on is distinct from old.first_available_on or
      new.source_evidence is distinct from old.source_evidence or
      new.approved_by is distinct from old.approved_by or
      new.approved_at is distinct from old.approved_at or
      new.original_qty is distinct from old.original_qty or
      new.created_at is distinct from old.created_at then
      raise exception 'Finished lot provenance and original quantity are immutable';
    end if;
  elsif tg_table_name='frozen_lot_positions' then
    if tg_op='UPDATE' and (
      new.source_split_id is distinct from old.source_split_id or
      new.product_id is distinct from old.product_id or
      new.source_movement_id is distinct from old.source_movement_id or
      new.original_qty is distinct from old.original_qty or
      new.first_available_on is distinct from old.first_available_on or
      new.evidence_ref is distinct from old.evidence_ref or
      new.reviewed_by is distinct from old.reviewed_by or
      new.reviewed_at is distinct from old.reviewed_at
    ) then
      raise exception 'Frozen lot provenance and original quantity are immutable';
    end if;
  else
    raise exception 'Unexpected lot position table';
  end if;
  return new;
end
$fn$;

create or replace function bunbun_accounting.assert_unified_position_balance()
returns trigger language plpgsql security invoker
set search_path=pg_catalog
as $fn$
declare
 v_mode text;
 v_lot_key text;
 v_product_id bigint;
 v_root bigint;
 v_position bigint;
 v_stock bigint;
 v_qty_used bigint;
 v_manual bigint;
 v_sold bigint;
 v_returned bigint;
 v_adjust_out bigint;
 v_adjust_in bigint;
 v_source_move bigint;
 v_original integer;
 v_available integer;
begin
 select mode into v_mode from bunbun_accounting.lot_tracking_control
 where singleton;
 if not found then raise exception 'Unified lot control missing'; end if;
 if v_mode='OFF' then return null; end if;

 if tg_table_name='finished_lot_positions' then
   v_lot_key:=new.lot_key;
   v_product_id:=new.product_id;
   select original_qty,available_qty into v_original,v_available
   from bunbun_accounting.finished_lot_positions where lot_key=v_lot_key;
   if not found then raise exception 'Finished lot record disappeared'; end if;

   select coalesce(sum(qty),0) into v_manual
   from bunbun_accounting.lot_release_allocations where lot_key=v_lot_key;
   select coalesce(sum(qty),0) into v_sold
   from bunbun_accounting.lot_sale_out_allocations where lot_key=v_lot_key;
   select coalesce(sum(qty),0) into v_returned
   from bunbun_accounting.lot_sale_return_allocations where lot_key=v_lot_key;
   select coalesce(sum(qty),0) into v_adjust_out
   from bunbun_accounting.product_lot_adjustment_lines
   where lot_key=v_lot_key and direction='OUT';
   select coalesce(sum(qty),0) into v_adjust_in
   from bunbun_accounting.product_lot_adjustment_lines
   where lot_key=v_lot_key and direction='IN';
   if v_original-v_available<>
      v_manual+v_sold-v_returned+v_adjust_out-v_adjust_in then
     raise exception 'Finished position cannot change without matching lot allocations';
   end if;
   select coalesce(sum(available_qty),0) into v_position
   from bunbun_accounting.finished_lot_positions
   where product_id=v_product_id and location='FINISHED';
   select coalesce(sum(case
     when movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN')
       then qty
     when movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -qty
     else 0 end),0) into v_stock
   from public.product_stock_movements
   where product_id=v_product_id and not is_deleted;
   if v_position<>v_stock then
     raise exception 'Finished lot position update diverges from product stock movement';
   end if;
 elsif tg_table_name='frozen_lot_positions' then
   v_root:=new.source_split_id;
   select original_qty,available_qty,source_movement_id
   into v_original,v_available,v_source_move
   from bunbun_accounting.frozen_lot_positions
   where source_split_id=v_root;
   if not found or not exists(
       select 1 from public.product_stock_movements
       where id=v_source_move and movement_type='FROZEN_IN'
         and batch_split_id=v_root and qty=v_original and not is_deleted
     ) then
     raise exception 'Frozen position missing original intake movement';
   end if;
   select coalesce(sum(qty),0) into v_qty_used
   from bunbun_accounting.frozen_conversion_operations
   where source_split_id=v_root and status='RECORDED';
   if v_original-v_available<>v_qty_used then
     raise exception 'Frozen position cannot change without recorded conversion';
   end if;
   select coalesce(sum(case
     when movement_type='FROZEN_IN' then qty
     when movement_type='FROZEN_OUT' then -qty else 0 end),0) into v_stock
   from public.product_stock_movements
   where batch_split_id=v_root and not is_deleted;
   if v_stock<>v_available then
     raise exception 'Frozen position update diverges from stock movements';
   end if;
 else
   raise exception 'Unexpected position table for unified deferred check';
 end if;
 return null;
end
$fn$;

create trigger protect_unified_finished_position
before insert or update or delete on bunbun_accounting.finished_lot_positions
for each row execute function bunbun_accounting.guard_unified_position_write();
create trigger protect_unified_frozen_position
before insert or update or delete on bunbun_accounting.frozen_lot_positions
for each row execute function bunbun_accounting.guard_unified_position_write();

create constraint trigger verify_unified_finished_position_commit
after insert or update on bunbun_accounting.finished_lot_positions
deferrable initially deferred
for each row execute function bunbun_accounting.assert_unified_position_balance();
create constraint trigger verify_unified_frozen_position_commit
after insert or update on bunbun_accounting.frozen_lot_positions
deferrable initially deferred
for each row execute function bunbun_accounting.assert_unified_position_balance();

revoke all on function bunbun_accounting.guard_unified_position_write()
 from public,anon,authenticated;
revoke all on function bunbun_accounting.assert_unified_position_balance()
 from public,anon,authenticated;
COMMIT;
