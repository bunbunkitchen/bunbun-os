-- EPHEMERAL POSTGRES ONLY. Real Supabase stock/sales remain UNCHANGED.
-- Trusted backend must bind actor after verified Owner JWT/session.
-- No financial journal/COGS is posted by this function.
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
