-- BUNBUN OS — STRICT INVENTORY WRITER GATE (REVIEW / EPHEMERAL PG CI ONLY).
-- Never run in live Bunbun Supabase. Not a production migration.
--
-- All stock-writing APIs remain UNCHANGED until an explicitly signed,
-- independently verified cutover. Gate defaults to OFF, preserving behavior.
-- When ON in isolated tests, only private lot release transactions may write
-- a CAFE_OUT and must contain matching line-level lot allocations by commit.
--
-- This is intentionally fail-closed. Baking, frozen conversion, sale create/
-- edit/delete, adjustment, opening and returns are BLOCKED while ON until
-- each has its own verified, atomic lot-aware implementation. Do not enable
-- on a functioning live kitchen before those writers have been integrated.
--
-- GUC is NOT a standalone authorization control: service_role is held by the
-- trusted backend only. The deferred relational check additionally rejects
-- any CAFE_OUT lacking all matching allocations and RECORDED operation header.

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
-- No UPDATE permission for service_role: a verified database migration/cutover
-- operator must enable this control after all stock writers are converted.
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
 -- The live suite must verify active Owner session before trusted backend
 -- holds service_role. Historical public SECURITY DEFINER writers do not
 -- execute as service_role and therefore cannot bypass this gate.
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
 return null;
end
$fn$;

-- Deferred until transaction commit: stock row is written before its lot
-- allocations, but MUST never commit without their exact quantities.
create constraint trigger verify_lot_allocation_before_commit
after insert on public.product_stock_movements
deferrable initially deferred
for each row execute function bunbun_accounting.assert_tracked_movement_allocated();

revoke all on function bunbun_accounting.enforce_lot_stock_writer()
 from public,anon,authenticated;
revoke all on function bunbun_accounting.assert_tracked_movement_allocated()
 from public,anon,authenticated;

-- STATUS: ON is exercised only in ephemeral tests. Do NOT enable on live OS.
-- Production design must replace/extend this narrow gate with atomic finished
-- stock IN (baking, frozen conversion, approved opening), OUT (sales, release,
-- adjustment), and IN (returns, reversal) before switch-on.
