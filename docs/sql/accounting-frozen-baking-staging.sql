-- BUNBUN OS: FROZEN -> DIRECT -> FINISHED ATOMIC LOT PROTOTYPE
-- RUN ONLY IN EPHEMERAL PG16 AFTER ACCOUNTING LOT RELEASE + GATE + FROZEN TEST BOOTSTRAP.
-- NOT a Supabase production migration. NO actual HPP/cash/revenue recognition.
-- Cannot activate while shaping/FROZEN_IN, sale, returns and adjustments still
-- bypass this isolated lot model. Trusted backend must verify Owner JWT.
--
-- In the old Bunbun app:
--  release_frozen_stock: FROZEN_OUT + insert derived DIRECT split
--  record_baking_result: update DIRECT split + FINISHED_IN if successful
-- Here both updates become atomic with cost-lot positions, while
-- retaining existing source split IDs/lineage and product stock movements.

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

-- Write-once provenance. A correction requires a reviewed compensating event
-- in a future staging milestone; never edit historical event ID/quantities.
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

-- Extend the existing private writer gate in THIS disposable DB to authorize
-- only tightly checked stock INSERTs associated with the correct operation.
-- Every other legacy writer still fails closed while mode ON.
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

-- Extend commit-time checks to frozen processing and baked-goods source
-- integrity. CAFE_OUT delegates to the earlier exact-lot audit logic.
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
     or v_derived.route<>'DIRECT' or v_derived.status<>'PROOFING'
     or v_derived.product_id<>new.product_id
     or v_derived.qty<>new.qty then
     raise exception 'Derived split does not reflect frozen conversion';
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

-- Initial FROZEN_IN is verified source stock for CI only. The real shaping
-- operation will need a new audited atomic writer before production cutover.

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

 -- Canonical product lock before any split or lot locks. All stock writers
 -- must obey this ordering in staging to avoid deadlocks.
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
