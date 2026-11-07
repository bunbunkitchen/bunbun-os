-- BUNBUN OS — PRIVATE LOT POSITION PROTECTION, UNIFIED CI ONLY
-- Applied AFTER accounting-unified-stock-gate-staging.sql in an ephemeral DB.
-- Position tables are not an alternative direct API for changing stock.
-- This enforces source-lot immutability and rechecks the ledger when positions
-- change WITHOUT a product_stock_movements insert. No production deployment.
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
