-- BUNBUN OS: STAGING-ONLY SHAPING + PARENT BATCH PROGRESS.
-- CI fixture ONLY. NOT A SUPABASE MIGRATION; DO NOT APPLY TO LIVE BUNBUN OS.
-- Requires existing private lot release, writer gate and frozen/baking prototypes.
--
-- Root split allocation is ONCE per batch: FROZEN + DIRECT + REJECT = target.
-- A derived DIRECT split from frozen NEVER increases original target.
-- Aggregate progress counts baked good + baking reject for every DIRECT
-- (including frozen-derived), and shaping REJECT once. Batch is Finished only
-- when all direct splits baked and total frozen remaining = 0.
--
-- Trusted server must verify real Owner JWT, original ingredients and physical
-- opening/valuation separately. Strings claiming evidence are NOT approval.

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

create unique index staging_frozen_lot_code
on public.production_batch_splits(lower(lot_code))
where route='FROZEN' and lot_code is not null;

create trigger shaping_operation_immutable
before update or delete on bunbun_accounting.shaping_operations
for each row execute function bunbun_accounting.block_frozen_baking_event_edit();

-- Recalculate parent batch from durable split and source movements.
-- Called by AFTER INSERT on a verified shaping operation or baking operation;
-- any failure rolls back ALL changes in the same SQL transaction.
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

-- Existing atomic frozen conversion writes a derived DIRECT split, which
-- logically leaves the parent status Split. The parent refresh trigger
-- follows recorded shaping and baking; frozen conversion never marks Finished.
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

-- The already-running release_frozen_staging creates a derived split, but
-- parent status is already Split if frozen remains. When it reaches frozen
-- zero, there is a new unbaked DIRECT split, so still Split. Baking then
-- updates parent to Finished only once all DIRECT splits have baked.

-- Extend the test-only writer gate to permit FROZEN_IN for a recorded
-- shaping operation. All other stock paths remain blocked.
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

-- Original (existing) deferred trigger checks FROZEN_OUT/FINISHED_IN/CAFE_OUT.
-- We add an independent deferred check only for FROZEN_IN. This avoids
-- rewriting tests of the existing movements' provenance.
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
 -- This is a deferred trigger: by transaction commit the same new frozen
 -- stock may already have been converted into one or more DIRECT splits.
 -- It must still reconcile to the ORIGINAL entry, not require full stock
 -- to remain. This is safe for same-transaction shaping+baking.
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

-- Replace previous all-type check with FROZEN_IN bypass. Separate deferred
-- trigger above verifies shape. The existing provenance checks stay intact.
-- We avoid rewriting its large function by adding a dedicated wrapper that
-- invokes the pre-existing function only for the other movement types.
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
 -- A trigger function cannot be called as a regular SQL function. The
 -- previous trigger is reattached with WHEN rather than invoked manually.
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

-- Remove unused wrapper: keep one provenance function, do not mislead
-- future schema reviewers into believing it checks other movements.
drop function bunbun_accounting.assert_tracked_movement_allocated();

-- This migration is a CI prototype. There must be no real root frozen
-- position created without a signed physical quantity and independent
-- cost evidence at future cutover.

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

 -- Lock parent FIRST, serializing multiple simultaneous shaping requests.
 select * into v_batch from public.production_batches
 where id=p_batch_id and is_deleted=false for update;
 if not found then raise exception 'Production batch not found'; end if;
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

 -- Lock canonical product before touching stock, matching existing
 -- frozen-conversion and finished release lock ordering.
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
