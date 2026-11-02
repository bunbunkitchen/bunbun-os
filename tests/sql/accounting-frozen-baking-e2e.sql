-- BUNBUN OS: EPHEMERAL POSTGRES TEST OF FROZEN/BACKING LOT WRITERS.
-- Only synthetic rows. Run in a fresh, isolated DB after:
-- auth fixture -> basic stock fixture -> private lot release SQL ->
-- full frozen/baking fixture -> gate SQL -> frozen/baking SQL.
insert into bunbun_accounting.frozen_lot_positions
 (source_split_id,product_id,source_movement_id,original_qty,
  available_qty,first_available_on,evidence_ref,reviewed_by,reviewed_at)
select 200,1,id,8,8,'2026-11-03',
  'SIGNED-TEST-FROZEN-ROOT-200',
  '11111111-1111-4111-8111-111111111111',now()
from public.product_stock_movements
where batch_split_id=200 and movement_type='FROZEN_IN';

-- Synthetic date/actor for CI; does not represent owner approval in Bunbun.
update bunbun_accounting.lot_tracking_control
set mode='ON',cutover_on='2026-11-01',
approved_by='11111111-1111-4111-8111-111111111111',approved_at=now()
where singleton and mode='OFF';

set role service_role;
do $test$
declare
 v_owner uuid:='11111111-1111-4111-8111-111111111111';
 v_other uuid:='22222222-2222-4222-8222-222222222222';
 v_frozen_key uuid:='c1111111-1111-4111-8111-111111111111';
 v_baked_key uuid:='c2222222-2222-4222-8222-222222222222';
 v_direct_key uuid:='c3333333-3333-4333-8333-333333333333';
 v_sale_key uuid:='c4444444-4444-4444-8444-444444444444';
 v_all_reject_key uuid:='c5555555-5555-4555-8555-555555555555';
 v_bad_key uuid:='c6666666-6666-4666-8666-666666666666';
 v_json jsonb;
 v_direct_id bigint;
 v_source_movement bigint;
 v_count integer;
 v_stock bigint;
 v_positions bigint;
begin
 if has_function_privilege('authenticated',
 'bunbun_accounting.record_frozen_to_direct_staging(bigint,integer,date,text,uuid,uuid)',
 'EXECUTE') then
   raise exception 'Authenticated can invoke private frozen writer';
 end if;
 if has_function_privilege('authenticated',
 'bunbun_accounting.record_tracked_baking_staging(bigint,integer,integer,date,text,uuid,uuid)',
 'EXECUTE') then
   raise exception 'Authenticated can invoke private baking writer';
 end if;

 -- Non-Owner denied before stock changes.
 begin
   perform bunbun_accounting.record_frozen_to_direct_staging(
     200,1,'2026-11-07','CI-DENIED-FROZEN',v_bad_key,v_other);
   raise exception 'UNEXPECTED SUCCESS not Owner';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%Active Owner required%' then raise; end if;
 end;

 -- A forged stock movement with valid type but no operation fails deferred
 -- checks. The sample marker alone must not create any frozen stock loss.
 begin
   perform set_config('bunbun_accounting.lot_write_operation',
     v_bad_key::text,true);
   insert into public.product_stock_movements
     (movement_date,movement_type,product_id,batch_split_id,qty,
      operation_key)
   values ('2026-11-07','FROZEN_OUT',1,200,1,v_bad_key);
   execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit DEFERRED';
   raise exception 'UNEXPECTED SUCCESS untracked frozen movement';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%Frozen OUT is not backed%' then raise; end if;
 end;

 -- Frozen quantity cannot be negative or exceed the real source lot.
 begin
   perform bunbun_accounting.record_frozen_to_direct_staging(
     200,9,'2026-11-07','CI-EXCESS-FROZEN-LOT',v_bad_key,v_owner);
   raise exception 'UNEXPECTED SUCCESS overspend frozen';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%insufficient%' then raise; end if;
 end;

 -- Reject a forged frozen position pointing to a FINISHED_IN movement rather
 -- than its original FROZEN_IN. Exception subtransaction restores the test row.
 begin
   update bunbun_accounting.frozen_lot_positions
   set source_movement_id=(
     select id from public.product_stock_movements
     where movement_type='FINISHED_IN' and product_id=1 limit 1)
   where source_split_id=200;
   perform bunbun_accounting.record_frozen_to_direct_staging(
     200,1,'2026-11-07','CI-FORGED-FROZEN-SOURCE',
     v_bad_key,v_owner);
   raise exception 'UNEXPECTED SUCCESS forged frozen source link';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%original matching FROZEN_IN%' then raise; end if;
 end;

 -- Convert four units from root FROZEN to a derived DIRECT split.
 v_json:=bunbun_accounting.record_frozen_to_direct_staging(
   200,4,'2026-11-07','SIGNED-FROZEN-CONVERSION-20261107',
   v_frozen_key,v_owner);
 if v_json->>'already_exists'<>'false' or
   v_json->>'accounting_posted'<>'false' or
   v_json->>'remaining_frozen_qty'<>'4' then
   raise exception 'Unexpected conversion response %',v_json;
 end if;
 v_direct_id:=(v_json->>'direct_split_id')::bigint;
 v_source_movement:=(v_json->>'stock_movement_id')::bigint;
 if (select source_split_id from public.production_batch_splits
     where id=v_direct_id)<>200 or
   (select qty from public.production_batch_splits
     where id=v_direct_id)<>4 or
   (select status from public.production_batch_splits
     where id=v_direct_id)<>'PROOFING' then
   raise exception 'Derived split did not preserve frozen source';
 end if;
 if (select available_qty from bunbun_accounting.frozen_lot_positions
     where source_split_id=200)<>4 then
   raise exception 'Frozen lot not decremented exactly';
 end if;
 if (select count(*) from public.product_stock_movements
     where id=v_source_movement and movement_type='FROZEN_OUT'
       and batch_split_id=200 and qty=4)<>1 then
   raise exception 'Incorrect frozen source movement';
 end if;
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit DEFERRED';

 -- Replay cannot make a second split or decrement frozen twice.
 v_json:=bunbun_accounting.record_frozen_to_direct_staging(
   200,4,'2026-11-07','SIGNED-FROZEN-CONVERSION-20261107',
   v_frozen_key,v_owner);
 if v_json->>'already_exists'<>'true' or
    (v_json->>'direct_split_id')::bigint<>v_direct_id then
   raise exception 'Frozen conversion not idempotent';
 end if;
 if (select count(*) from bunbun_accounting.frozen_conversion_operations
     where source_split_id=200)<>1 then
   raise exception 'Replay duplicated conversion';
 end if;
 begin
   perform bunbun_accounting.record_frozen_to_direct_staging(
     200,3,'2026-11-07','SIGNED-FROZEN-CONVERSION-20261107',
     v_frozen_key,v_owner);
   raise exception 'UNEXPECTED SUCCESS reused frozen key with changed qty';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%reused with different%' then raise; end if;
 end;

 -- Reject counts must reconcile original direct split qty: 3+1=4.
 begin
   perform bunbun_accounting.record_tracked_baking_staging(
     v_direct_id,2,1,'2026-11-08','CI-INVALID-BAKE-RESULT',
     v_bad_key,v_owner);
   raise exception 'UNEXPECTED SUCCESS underspecified baking';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%must equal original split%' then raise; end if;
 end;
 if (select status from public.production_batch_splits
     where id=v_direct_id)<>'PROOFING' then
   raise exception 'Failed baking changed source split';
 end if;

 -- Bake the derived frozen 4 units: three good and one reject.
 v_json:=bunbun_accounting.record_tracked_baking_staging(
   v_direct_id,3,1,'2026-11-08',
   'SIGNED-FROZEN-BAKE-20261108',v_baked_key,v_owner);
 if v_json->>'already_exists'<>'false' or
   v_json->>'finished_qty'<>'3' or
   v_json->>'reject_qty'<>'1' or
   v_json->>'accounting_posted'<>'false' then
   raise exception 'Unexpected derived baking response %',v_json;
 end if;
 if (select original_qty from bunbun_accounting.finished_lot_positions
     where lot_key='split:'||v_direct_id::text)<>3 or
   (select source_type from bunbun_accounting.finished_lot_positions
     where lot_key='split:'||v_direct_id::text)<>'FROZEN_CONVERSION' then
   raise exception 'Frozen-derived finished position missing';
 end if;
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit DEFERRED';

 -- No double-production: the frozen parent was reduced 4, and only the
 -- three successfully baked units exist in the NEW finished split.
 if (select available_qty from bunbun_accounting.frozen_lot_positions
     where source_split_id=200)<>4 then
   raise exception 'Baking touched frozen root twice';
 end if;
 v_json:=bunbun_accounting.record_tracked_baking_staging(
   v_direct_id,3,1,'2026-11-08',
   'SIGNED-FROZEN-BAKE-20261108',v_baked_key,v_owner);
 if v_json->>'already_exists'<>'true' then
   raise exception 'Baking replay not idempotent';
 end if;
 begin
   perform bunbun_accounting.record_tracked_baking_staging(
     v_direct_id,4,0,'2026-11-08',
     'SIGNED-FROZEN-BAKE-20261108',v_baked_key,v_owner);
   raise exception 'UNEXPECTED SUCCESS changed outcome on retry';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%different event%' then raise; end if;
 end;

 -- Independently bake a root DIRECT split, two good, one reject.
 v_json:=bunbun_accounting.record_tracked_baking_staging(
   104,2,1,'2026-11-08',
   'SIGNED-DIRECT-BAKE-20261108',v_direct_key,v_owner);
 if v_json->>'finished_qty'<>'2'
  or (select source_type from bunbun_accounting.finished_lot_positions
      where lot_key='split:104')<>'DIRECT_RELEASE' then
   raise exception 'Direct root baking did not preserve its own lot';
 end if;

 -- Send out two from newly baked frozen-derived finished lot; the stock
 -- movement and its lot allocation must be exactly reconciled.
 v_json:=bunbun_accounting.record_lot_assigned_release(
   '2026-11-09','The Public Coffee','CAFE_CONSIGNMENT',
   'CI-DELIVERY-FROM-FROZEN-DERIVED-LOT',
   jsonb_build_array(jsonb_build_object(
     'productId',1,'quantity',2,'allocations',
     jsonb_build_array(jsonb_build_object(
       'lotKey','split:'||v_direct_id::text,'qty',2)))),
   v_sale_key,v_owner);
 if v_json->>'already_exists'<>'false' or
   v_json->>'accounting_posted'<>'false' then
   raise exception 'Release from newly baked lot failed %',v_json;
 end if;
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit DEFERRED';

 select coalesce(sum(case
   when movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN') then qty
   when movement_type='CAFE_OUT' then -qty
   else 0 end),0) into v_stock
 from public.product_stock_movements where product_id=1 and is_deleted=false;
 select coalesce(sum(available_qty),0) into v_positions
 from bunbun_accounting.finished_lot_positions where product_id=1;
 if v_stock<>v_positions or v_stock<>13 then
   raise exception 'Finished stock and lot positions diverged: % vs %',
     v_stock,v_positions;
 end if;
 if (select available_qty from bunbun_accounting.finished_lot_positions
    where lot_key='split:'||v_direct_id::text)<>1 then
   raise exception 'Newly baked lot was not decreased by delivery';
 end if;

 -- All rejected baking: no FINISHED_IN, no finished lot, no fake revenue.
 insert into public.production_batch_splits
   (id,production_batch_id,product_id,route,qty,status)
 values (106,12,2,'DIRECT',2,'PROOFING');
 v_json:=bunbun_accounting.record_tracked_baking_staging(
   106,0,2,'2026-11-09','ALL-REJECT-BATCH-EVIDENCE',
   v_all_reject_key,v_owner);
 if v_json->>'finished_qty'<>'0' or
   v_json->>'stock_movement_id' is not null then
   raise exception 'All rejected bake incorrectly created finished stock';
 end if;
 if exists(select 1 from bunbun_accounting.finished_lot_positions
     where source_split_id=106) then
   raise exception 'Rejected-only split received sellable lot';
 end if;

 select count(*) into v_count from public.product_stock_movements
 where operation_key in (v_frozen_key,v_baked_key,v_direct_key,v_sale_key,v_all_reject_key);
 if v_count<>4 then
   raise exception 'Expected frozen OUT, two finished IN and one cafe OUT; found %',v_count;
 end if;
 raise notice 'PASS: root frozen -> derived direct -> baked/reject -> finished/cafe is lot-balanced with no double production, no COGS';
end
$test$;
reset role;
