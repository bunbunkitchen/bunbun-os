-- BUNBUN OS — UNIFIED ATOMIC STOCK GATE, ALL NINE LEGACY WRITER FAMILIES
-- EPHEMERAL PG16 INTEGRATION LAB ONLY. NOT A SUPABASE MIGRATION.
-- This file is applied AFTER all prototype schemas/functions are loaded
-- into ONE disposable database. It deliberately replaces their competing
-- writer-gate and deferred check implementations with ONE policy.
--
-- Important: "9/9" means source movement types are known & checked here.
-- Their UI/RPC adapters, real Owner identity, actual costs and approval
-- are still NOT production-ready. Never activate this on live Bunbun OS.
--
-- No use of SECURITY DEFINER. Only service_role executes trusted private
-- writers. Database RLS is enabled on private tables. Backend must verify
-- JWT / live session, physical evidence and Owner approval independently.

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

  -- Every writer family MUST have exactly matching immutable provenance.
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

  -- Check ALL source frozen balances, not just this movement. Existing root
  -- positions from the fixture are verified against their real FROZEN_IN
  -- movement; only new FROZEN_IN requires a shaping operation.
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

  -- Check EVERY finished product, regardless of which source just changed.
  -- Includes sales, cafe consignments, adjustment OUT/IN, physical returns.
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

  -- Check EVERY lot, including lots that were not directly involved in
  -- this operation: historical discrepancies must fail closed at cutover.
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

-- Remove all independent, incompatible deferred stock checks and retain
-- exactly ONE comprehensive commit-time constraint trigger.
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
