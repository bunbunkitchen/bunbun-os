-- EPHEMERAL POSTGRES CI ONLY, NOT REAL BUNBUN DATA.
-- Bootstrap role, products, stock and lot SQL before this file.
-- Writer gate is initially OFF: existing operational behavior preserved.
do $off$
declare
 v_id bigint;
begin
 if (select mode from bunbun_accounting.lot_tracking_control where singleton) <> 'OFF' then
   raise exception 'Gate must start OFF';
 end if;
 insert into public.product_stock_movements
   (movement_date,movement_type,product_id,qty)
 values ('2026-11-06','CAFE_OUT',1,1)
 returning id into v_id;
 delete from public.product_stock_movements where id=v_id;
 if exists(select 1 from public.product_stock_movements where id=v_id) then
   raise exception 'OFF gate altered legacy stock operation semantics';
 end if;
end
$off$;

-- CI-only simulation of explicit approved cutover; NEVER reuse this
-- synthetic actor/date as actual Bunbun approval.
update bunbun_accounting.lot_tracking_control
 set mode='ON',cutover_on='2026-11-01',
     approved_by='11111111-1111-4111-8111-111111111111',
     approved_at=now()
 where singleton and mode='OFF';

set role service_role;

do $strict$
declare
 v_owner uuid := '11111111-1111-4111-8111-111111111111';
 v_key uuid := 'c1111111-1111-4111-8111-111111111111';
 v_forged uuid := 'e1111111-1111-4111-8111-111111111111';
 v_movement_id bigint;
 v_count integer;
begin
 -- A client/legacy routine cannot add stock after switch-on.
 begin
   insert into public.product_stock_movements
     (movement_date,movement_type,product_id,qty)
   values ('2026-11-07','FINISHED_IN',1,1);
   raise exception 'UNEXPECTED SUCCESS untracked FINISHED_IN';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%untracked stock writer denied%' then raise; end if;
 end;
 begin
   insert into public.product_stock_movements
     (movement_date,movement_type,product_id,qty)
   values ('2026-11-07','CAFE_OUT',1,1);
   raise exception 'UNEXPECTED SUCCESS untracked CAFE_OUT';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%untracked stock writer denied%' then raise; end if;
 end;
 begin
   insert into public.product_stock_movements
     (movement_date,movement_type,product_id,qty)
   values ('2026-11-07','CAFE_IN',1,1);
   raise exception 'UNEXPECTED SUCCESS legacy reversal';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%untracked stock writer denied%' then raise; end if;
 end;
 begin
   insert into public.product_stock_movements
     (movement_date,movement_type,product_id,qty)
   values ('2026-11-07','FROZEN_OUT',1,1);
   raise exception 'UNEXPECTED SUCCESS frozen path';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%untracked stock writer denied%' then raise; end if;
 end;
 begin
   insert into public.product_stock_movements
     (movement_date,movement_type,product_id,qty)
   values ('2026-11-07','ADJUSTMENT_OUT',1,1);
   raise exception 'UNEXPECTED SUCCESS adjustment path';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%untracked stock writer denied%' then raise; end if;
 end;

 -- Ordinary service_role cannot turn the gate off.
 begin
   update bunbun_accounting.lot_tracking_control set mode='OFF' where singleton;
   raise exception 'UNEXPECTED SUCCESS service_role disabled lot gate';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%permission denied%' then raise; end if;
 end;

 -- A matching marker alone is insufficient for a valid stock movement;
 -- deferred verification at commit requires a RECORDED operation and exact
 -- allocated amount in bunbun_accounting.lot_release_allocations.
 begin
   perform set_config('bunbun_accounting.lot_write_operation',v_key::text,true);
   insert into public.product_stock_movements
     (movement_date,movement_type,product_id,qty,operation_key)
   values ('2026-11-07','CAFE_OUT',1,1,v_key)
   returning id into v_movement_id;
   execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
   raise exception 'UNEXPECTED SUCCESS marker-only CAFE_OUT';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%recorded lot release operation%' then raise; end if;
 end;

 -- Even if someone with elevated service credentials forges a matching
 -- operation header AND matching allocation row, it must not commit unless
 -- the real lot position is decremented by exactly that allocation total.
 begin
   insert into bunbun_accounting.lot_release_operations
     (operation_key,payload_fingerprint,movement_date,destination,
      destination_type,evidence_ref,status,actor_id)
   values
     (v_forged,repeat('a',32),'2026-11-07','The Public Coffee',
      'CAFE_CONSIGNMENT','FAKE-RELEASE-DOCUMENT','RECORDED',v_owner);
   perform set_config(
     'bunbun_accounting.lot_write_operation',v_forged::text,true);
   insert into public.product_stock_movements
     (movement_date,movement_type,product_id,qty,operation_key,sale_id)
   values ('2026-11-07','CAFE_OUT',1,1,v_forged,null)
   returning id into v_movement_id;
   insert into bunbun_accounting.lot_release_allocations
     (operation_key,stock_movement_id,lot_key,product_id,qty)
   values (v_forged,v_movement_id,'split:101',1,1);
   execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
   raise exception 'UNEXPECTED SUCCESS forged lot position';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%Lot position does not reconcile%' then raise; end if;
 end;

 -- A legitimate private function uses a transaction marker, locks products/
 -- lot positions and creates matching stock movement + line allocations.
 perform bunbun_accounting.record_lot_assigned_release(
   '2026-11-07','The Public Coffee','CAFE_CONSIGNMENT',
   'SIGNED-TEST-DELIVERY-NOTE-20261107',
   '[{"productId":1,"quantity":8,
       "allocations":[
         {"lotKey":"split:101","qty":5},
         {"lotKey":"split:102","qty":3}]},
      {"productId":2,"quantity":4,
       "allocations":[
         {"lotKey":"split:103","qty":4}]}]'::jsonb,
   v_key,v_owner
 );

 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
 select count(*) into v_count from public.product_stock_movements
 where operation_key=v_key and movement_type='CAFE_OUT';
 if v_count<>2 then raise exception 'Controlled release must create 2 movement rows'; end if;

 -- Existing rows cannot be updated/deleted/soft deleted after the gate is ON.
 begin
   update public.product_stock_movements
     set qty=qty+1 where operation_key=v_key;
   raise exception 'UNEXPECTED SUCCESS legacy update';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%append-only%' and
      sqlerrm not like '%permission denied%' then raise; end if;
 end;
 begin
   update public.product_stock_movements
     set is_deleted=true where operation_key=v_key;
   raise exception 'UNEXPECTED SUCCESS soft delete';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%append-only%' and
      sqlerrm not like '%permission denied%' then raise; end if;
 end;
 begin
   delete from public.product_stock_movements
    where operation_key=v_key;
   raise exception 'UNEXPECTED SUCCESS physical delete';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%append-only%' and
      sqlerrm not like '%permission denied%' then raise; end if;
 end;

 if exists (
   select m.id
   from public.product_stock_movements m
   left join bunbun_accounting.lot_release_allocations a
     on a.stock_movement_id=m.id
   where m.operation_key=v_key and m.movement_type='CAFE_OUT'
   group by m.id,m.qty
   having coalesce(sum(a.qty),0)<>m.qty
 ) then raise exception 'Recorded stock movements have incomplete allocations'; end if;

 if (select sum(available_qty) from bunbun_accounting.finished_lot_positions
    where product_id=1) <> 2 or
   (select sum(available_qty) from bunbun_accounting.finished_lot_positions
    where product_id=2) <> 3 then
   raise exception 'Tracked lot positions must equal remaining finished stock';
 end if;
 raise notice 'PASS: gate blocks legacy stock writers and commits only fully matched lot release';
end
$strict$;

reset role;
