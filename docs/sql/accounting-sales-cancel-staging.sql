-- ONLY disposable PG16. Cancellation returns goods to the SAME original
-- lot after separately verified physical restock evidence. A refunded/consumed
-- item MUST NOT create stock. No financial journal posting or revenue reversal.
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
