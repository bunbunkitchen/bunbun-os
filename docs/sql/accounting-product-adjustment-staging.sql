-- BUNBUN OS — FINISHED PRODUCT ADJUSTMENT WITH VERIFIED LOT PROVENANCE
-- EPHEMERAL POSTGRESQL 16 ONLY. DO NOT RUN ON LIVE SUPABASE.
--
-- OUT: a justified physical deficit/expired/waste allocated to known lot IDs.
-- IN: physical recovered, resale-safe stock from exactly ONE previously
-- recorded OUT operation, with EXACT prior lot allocations. Cannot add
-- untraceable new inventory, sold/consumed goods, or fictional recipe HPP.
-- Verified *surplus of unknown source* requires a separate approved intake
-- with cost provenance and (possibly) quarantine, not this routine.
--
-- No financial posting and no cash event. Outbound losses might require
-- a journal later; financial report remains blocked until reconciled.

alter table public.product_stock_movements
  drop constraint if exists product_stock_movements_movement_type_check;
alter table public.product_stock_movements
  add constraint product_stock_movements_movement_type_check
  check (movement_type in
    ('FINISHED_IN','FROZEN_IN','FROZEN_OUT','CAFE_OUT','CAFE_IN',
     'OPENING_BALANCE','ADJUSTMENT_IN','ADJUSTMENT_OUT'));

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

-- Extend existing default-OFF writer gate ONLY in disposable PG fixture.
-- Legacy stock and sale writers remain blocked when tracking is ON.
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

-- Deferred integrity: exact movement qty/lot balance after every
-- tracked writer, including *subsequent* cafe shipments from adjusted lots.
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
