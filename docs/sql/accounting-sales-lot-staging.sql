-- BUNBUN OS: PRIVATE SALE ↔ FINISHED LOT / REVERSAL CONTRACT
-- STRICTLY FOR EPHEMERAL POSTGRES 16 CI. NOT A SUPABASE MIGRATION.
-- This adds synthetic integrated sale tracking to the base lot writer gate,
-- NOT to frozen/shaping extended gate; a real staging migration MUST merge
-- all writer types, existing triggers, permissions and business workflows.
--
-- A sale moves the *exact lot* FINISHED -> SOLD. Cancellation may move
-- SOLD -> FINISHED only after separately evidenced PHYSICAL RESTOCK.
-- Financial-only cancellation of goods already consumed cannot claim stock.
-- No posting to bunbun_accounting.journals / bank / cash / receivable.

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

-- Extend BASE CI lot writer gate (not frozen/shaping gate) to sale mutations.
-- Legacy writers still blocked because an exact service transaction marker
-- is not available to old client-facing functions.
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

-- Replaces base CAFE_OUT deferred check with SALE OUT, RESTOCK IN, and
-- manual consignment OUT provenance checks. All require balanced real lot
-- quantities and the same product-level stock equation by transaction end.
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

  -- Exact conservation per referenced product and lots, including previous
  -- manual deliveries. A cancellation restores stock ONLY for a recorded
  -- original sale allocation and never wipes any original movement.
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
