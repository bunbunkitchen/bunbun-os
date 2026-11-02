-- ISOLATED PG16 E2E: shaping root, frozen, direct, reject, parent batch
-- progress, source lineage, atomic idempotency. NOT a migration.
set role service_role;
do $shape$
declare
 v_owner uuid:='11111111-1111-4111-8111-111111111111';
 v_baker uuid:='22222222-2222-4222-8222-222222222222';
 v_op70 uuid:='a1111111-1111-4111-8111-111111111111';
 v_op71 uuid:='a2222222-2222-4222-8222-222222222222';
 v_op72 uuid:='a3333333-3333-4333-8333-333333333333';
 v_op73 uuid:='a4444444-4444-4444-8444-444444444444';
 v_bad uuid:='a5555555-5555-4555-8555-555555555555';
 v_frozen_id bigint;
 v_direct_id bigint;
 v_derived_id bigint;
 v_movement_id bigint;
 v_json jsonb;
 v_count integer;
 v_finished_stock bigint;
 v_finished_lots bigint;
 v_parent public.production_batches%rowtype;
begin
 -- The private shaping writer is not directly callable by browser roles.
 if has_function_privilege('authenticated',
   'bunbun_accounting.record_tracked_shaping_staging(bigint,bigint,integer,integer,integer,text,date,text,uuid,uuid)',
   'EXECUTE') then
   raise exception 'Authenticated can use private shaping writer';
 end if;

 begin
   perform bunbun_accounting.record_tracked_shaping_staging(
     70,1,6,3,1,'CI-FRZ-70','2026-11-07',
     'SHAPING-OWNER-CHECK',v_bad,v_baker);
   raise exception 'UNEXPECTED SUCCESS baker bypassed Owner';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%Active Owner required%' then raise; end if;
 end;

 -- The target batch is 10, and only ROOT splits count towards that target.
 begin
   perform bunbun_accounting.record_tracked_shaping_staging(
     70,1,6,4,1,'CI-FRZ-70','2026-11-07',
     'SHAPING-WRONG-TOTAL',v_bad,v_owner);
   raise exception 'UNEXPECTED SUCCESS incorrect root total';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%must total batch target%' then raise; end if;
 end;
 if exists(select 1 from public.production_batch_splits
   where production_batch_id=70) then
   raise exception 'Invalid shaping wrote root splits before validation';
 end if;

 -- Wrong product cannot allocate ingredients or any source stock.
 begin
   perform bunbun_accounting.record_tracked_shaping_staging(
     70,2,6,3,1,'CI-FRZ-70','2026-11-07',
     'WRONG-RECIPE-CHECK',v_bad,v_owner);
   raise exception 'UNEXPECTED SUCCESS wrong recipe';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%differs from active production recipe%' then raise; end if;
 end;

 -- Root product split with frozen, direct and reject.
 v_json:=bunbun_accounting.record_tracked_shaping_staging(
   70,1,6,3,1,'CI-FRZ-70','2026-11-07',
   'SHAPING-ROOT-EVIDENCE-70',v_op70,v_owner);
 if v_json->>'already_exists'<>'false' or
   v_json->>'accounting_posted'<>'false' or
   v_json->>'cogs_created'<>'false' then
   raise exception 'Incorrect shaping response %',v_json;
 end if;
 v_frozen_id:=(v_json->>'frozen_split_id')::bigint;
 v_direct_id:=(v_json->>'direct_split_id')::bigint;
 v_movement_id:=(v_json->>'frozen_movement_id')::bigint;
 if v_frozen_id is null or v_direct_id is null or
    (v_json->>'reject_split_id') is null then
   raise exception 'Mixed shaping should create three distinct root splits';
 end if;
 select * into v_parent from public.production_batches where id=70;
 if v_parent.status<>'Split' or v_parent.selesai<>0
   or v_parent.reject<>1 then
   raise exception 'Mixed shaping progress incorrect';
 end if;
 if (select count(*) from public.production_batch_splits
     where production_batch_id=70 and source_split_id is null)<>3 or
    (select sum(qty) from public.production_batch_splits
     where production_batch_id=70 and source_split_id is null)<>10 then
   raise exception 'Root splits do not equal target 10';
 end if;
 if not exists(select 1 from bunbun_accounting.frozen_lot_positions
   where source_split_id=v_frozen_id
     and source_movement_id=v_movement_id
     and original_qty=6 and available_qty=6) then
   raise exception 'Root frozen lot did not link to exact FROZEN_IN';
 end if;
 execute 'SET CONSTRAINTS verify_shaping_frozen_in_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_shaping_frozen_in_commit DEFERRED';
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit DEFERRED';

 -- Exact replay never adds another root or second FROZEN_IN.
 v_json:=bunbun_accounting.record_tracked_shaping_staging(
   70,1,6,3,1,'CI-FRZ-70','2026-11-07',
   'SHAPING-ROOT-EVIDENCE-70',v_op70,v_owner);
 if v_json->>'already_exists'<>'true' or
   (select count(*) from bunbun_accounting.shaping_operations
      where batch_id=70)<>1 or
   (select count(*) from public.product_stock_movements
      where operation_key=v_op70)<>1 then
   raise exception 'Shaping replay created extra source stock';
 end if;
 begin
   perform bunbun_accounting.record_tracked_shaping_staging(
     70,1,5,4,1,'CI-FRZ-70','2026-11-07',
     'SHAPING-ROOT-EVIDENCE-70',v_op70,v_owner);
   raise exception 'UNEXPECTED SUCCESS changed shaping replay';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%different request%' then raise; end if;
 end;

 -- Bake root DIRECT 3 -> 2 good, 1 reject. Parent still has frozen 6.
 v_json:=bunbun_accounting.record_tracked_baking_staging(
   v_direct_id,2,1,'2026-11-08','ROOT-BAKE-RESULT-70',
   'a6666666-6666-4666-8666-666666666666',v_owner);
 select * into v_parent from public.production_batches where id=70;
 if v_parent.status<>'Split' or v_parent.selesai<>2
   or v_parent.reject<>2 then
   raise exception 'Parent progress after root direct baking incorrect';
 end if;

 -- Convert four frozen: source root remains 2 in freezer, newly derived
 -- split MUST NOT inflate original root allocation beyond target 10.
 v_json:=bunbun_accounting.record_frozen_to_direct_staging(
   v_frozen_id,4,'2026-11-09','FROZEN-DERIVED-70',
   'a7777777-7777-4777-8777-777777777777',v_owner);
 v_derived_id:=(v_json->>'direct_split_id')::bigint;
 if (select sum(qty) from public.production_batch_splits
    where production_batch_id=70 and source_split_id is null)<>10 then
   raise exception 'Derived split was double-counted as new material';
 end if;
 v_json:=bunbun_accounting.record_tracked_baking_staging(
   v_derived_id,3,1,'2026-11-10','FROZEN-BAKE-RESULT-70',
   'a8888888-8888-4888-8888-888888888888',v_owner);
 select * into v_parent from public.production_batches where id=70;
 if v_parent.status<>'Split' or v_parent.selesai<>5 or
   v_parent.reject<>3 then
   raise exception 'Parent progress after partial frozen consumption incorrect';
 end if;

 -- Consume last two frozen units, bake them both successfully.
 v_json:=bunbun_accounting.record_frozen_to_direct_staging(
   v_frozen_id,2,'2026-11-11','FROZEN-REMAINDER-70',
   'a9999999-9999-4999-8999-999999999999',v_owner);
 v_derived_id:=(v_json->>'direct_split_id')::bigint;
 select * into v_parent from public.production_batches where id=70;
 if v_parent.status<>'Split' then
   raise exception 'Parent marked Finished while derived split still PROOFING';
 end if;
 perform bunbun_accounting.record_tracked_baking_staging(
   v_derived_id,2,0,'2026-11-12','LAST-FROZEN-BAKE-70',
   'b1111111-1111-4111-8111-111111111111',v_owner);
 select * into v_parent from public.production_batches where id=70;
 if v_parent.status<>'Finished' or v_parent.selesai<>7
   or v_parent.reject<>3 or v_parent.selesai+v_parent.reject<>v_parent.target then
   raise exception 'Completed parent should reconcile 7 good + 3 reject = 10';
 end if;
 if (select available_qty from bunbun_accounting.frozen_lot_positions
    where source_split_id=v_frozen_id)<>0 then
   raise exception 'Parent finished with frozen position remaining';
 end if;

 -- DIRECT-only batch: no frozen source or position may be invented.
 v_json:=bunbun_accounting.record_tracked_shaping_staging(
   71,1,0,4,0,null,'2026-11-07','DIRECT-ONLY-SHAPING',
   v_op71,v_owner);
 if v_json->>'frozen_movement_id' is not null then
   raise exception 'DIRECT-only batch invented frozen stock';
 end if;
 v_direct_id:=(v_json->>'direct_split_id')::bigint;
 perform bunbun_accounting.record_tracked_baking_staging(
   v_direct_id,3,1,'2026-11-09','DIRECT-ONLY-BAKING',
   'b2222222-2222-4222-8222-222222222222',v_owner);
 select * into v_parent from public.production_batches where id=71;
 if v_parent.status<>'Finished' or v_parent.selesai<>3
    or v_parent.reject<>1 then
   raise exception 'DIRECT-only parent did not finish correctly';
 end if;

 -- REJECT-only batch: zero sellable output, no frozen movement, no bake.
 v_json:=bunbun_accounting.record_tracked_shaping_staging(
   72,2,0,0,3,null,'2026-11-07','REJECT-ONLY-SHAPING',
   v_op72,v_owner);
 select * into v_parent from public.production_batches where id=72;
 if v_parent.status<>'Finished' or v_parent.selesai<>0
   or v_parent.reject<>3 or
   v_json->>'frozen_movement_id' is not null then
   raise exception 'All reject shaping should finish with no sellable stock';
 end if;

 -- FROZEN-only: shaping leaves Split; conversion remains Split until
 -- derived split is baked. Reject is counted only when result is recorded.
 v_json:=bunbun_accounting.record_tracked_shaping_staging(
   73,1,4,0,0,'CI-FRZ-73','2026-11-08',
   'FROZEN-ONLY-SHAPING',v_op73,v_owner);
 v_frozen_id:=(v_json->>'frozen_split_id')::bigint;
 select * into v_parent from public.production_batches where id=73;
 if v_parent.status<>'Split' or v_parent.selesai<>0 then
   raise exception 'Frozen-only parent incorrectly finished at shaping';
 end if;
 v_json:=bunbun_accounting.record_frozen_to_direct_staging(
   v_frozen_id,4,'2026-11-09','FROZEN-ONLY-CONVERSION',
   'b3333333-3333-4333-8333-333333333333',v_owner);
 v_direct_id:=(v_json->>'direct_split_id')::bigint;
 perform bunbun_accounting.record_tracked_baking_staging(
   v_direct_id,2,2,'2026-11-10','FROZEN-ONLY-BAKING',
   'b4444444-4444-4444-8444-444444444444',v_owner);
 select * into v_parent from public.production_batches where id=73;
 if v_parent.status<>'Finished' or v_parent.selesai<>2
   or v_parent.reject<>2 then
   raise exception 'Frozen-only batch final report is wrong';
 end if;

 -- Unconsumed materials are NOT a valid source for new production accounting.
 begin
   perform bunbun_accounting.record_tracked_shaping_staging(
     74,2,1,1,1,'CI-FRZ-74','2026-11-08',
     'UNCONSUMED-RAW-MATERIAL',v_bad,v_owner);
   raise exception 'UNEXPECTED SUCCESS without inventory consumption';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%material consumption%' then raise; end if;
 end;
 if exists(select 1 from bunbun_accounting.shaping_operations
   where batch_id=74) then
   raise exception 'Failed source validation persisted shaping';
 end if;

 -- Do not turn a frozen/finished movement into profit or revenue.
 if (select count(*) from bunbun_accounting.shaping_operations
    where batch_id in (70,71,72,73))<>4 then
   raise exception 'Unexpected number of approved-looking CI shaping headers';
 end if;
 select coalesce(sum(case when m.movement_type='FINISHED_IN' then m.qty
                            when m.movement_type='CAFE_OUT' then -m.qty
                            else 0 end),0) into v_finished_stock
 from public.product_stock_movements m where m.product_id=1 and m.is_deleted=false;
 select coalesce(sum(available_qty),0) into v_finished_lots
 from bunbun_accounting.finished_lot_positions where product_id=1;
 if v_finished_stock<>v_finished_lots then
   raise exception 'Product finished stock diverges from per-lot ledger after shaping/baking';
 end if;
 raise notice 'PASS: shaping roots and parent progress survive frozen, baking, zero-yield and idempotency without double-counting';
end
$shape$;
reset role;
