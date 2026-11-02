-- ONLY EPHEMERAL PostgreSQL CI. NOT a production migration.
-- Stock Adjustment OUT reduces specific finished lots; Adjustment IN
-- reverses one complete previous OUT with proof of physical recovery.
-- Arbitrary unidentified surplus requires separate reviewed intake, not HPP
-- fabrication. No income, expense, bank, cash, or recipe pricing writes.
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

 -- The canonical product row lock serializes stock OUT/IN against cafe OUT.
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
