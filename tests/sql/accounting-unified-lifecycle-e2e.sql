-- FULL LIFECYCLE INTEGRATION E2E: ONE DATABASE, ONE GATE, NINE FAMILIES.
-- SYNTHETIC CI ONLY; this is NOT a real Bunbun stocktake, HPP calculation,
-- live JWT check or permitted production deployment.
--
-- Initial fixture: product1 10 finished across split101+102; product2 7.
-- Batch70: shaping frozen6/direct3/reject1; direct baking2+reject1;
-- frozen conversion6 -> baking5+reject1 => total +7 finished product1.
-- Single cafe delivery2; multi cafe delivery1 of p1 and1 of p2.
-- Sale p1 3 -> physical cancellation +3.
-- Second sale p1 2, p2 1 -> edit cancel and replace with p1 1,p2 2.
-- Adjustment OUT2 -> verified IN2 same lot. Final finished p1=13,p2=4.
update bunbun_accounting.lot_tracking_control
set mode='ON',cutover_on='2026-11-01',
 approved_by='11111111-1111-4111-8111-111111111111',
 approved_at=now()
where singleton and mode='OFF';

set role service_role;
do $all$
declare
 owner_id uuid:='11111111-1111-4111-8111-111111111111';
 baker_id uuid:='22222222-2222-4222-8222-222222222222';
 v_shaping uuid:='fa000001-1111-4111-8111-111111111111';
 v_bake_direct uuid:='fa000002-1111-4111-8111-111111111111';
 v_convert uuid:='fa000003-1111-4111-8111-111111111111';
 v_bake_frozen uuid:='fa000004-1111-4111-8111-111111111111';
 v_single uuid:='fa000005-1111-4111-8111-111111111111';
 v_multi uuid:='fa000006-1111-4111-8111-111111111111';
 v_sale_a uuid:='fa000007-1111-4111-8111-111111111111';
 v_cancel_a uuid:='fa000008-1111-4111-8111-111111111111';
 v_sale_b uuid:='fa000009-1111-4111-8111-111111111111';
 v_cancel_b uuid:='fa000010-1111-4111-8111-111111111111';
 v_new_b uuid:='fa000011-1111-4111-8111-111111111111';
 v_adj_out uuid:='fa000012-1111-4111-8111-111111111111';
 v_adj_in uuid:='fa000013-1111-4111-8111-111111111111';
 v_invalid uuid:='fa000014-1111-4111-8111-111111111111';
 v_frozen bigint;
 v_direct bigint;
 v_frozen_direct bigint;
 v_sale1 bigint;
 v_sale2 bigint;
 v_replacement bigint;
 v_result jsonb;
 v_new_key text;
 v_positions bigint;
 v_movements bigint;
 v_type_count integer;
 v_initial_sale_count integer;
begin
 if exists(
   select 1 from public.product_stock_movements m
   where m.movement_type='ADJUSTMENT_OUT' or m.movement_type='CAFE_OUT'
 ) then raise exception 'Fixture stock is not clean at unified start'; end if;
 if (select count(*) from pg_trigger
     where tgrelid='public.product_stock_movements'::regclass and
       not tgisinternal and tgenabled='O' and
       tgname like 'verify_%lot%')<>1 then
   raise exception 'Unified cutover must install one exact deferred lot checker';
 end if;
 if has_function_privilege('authenticated',
   'bunbun_accounting.record_product_lot_adjustment_staging(bigint,text,integer,date,text,text,text,jsonb,uuid,uuid,uuid)',
   'EXECUTE') or has_function_privilege('authenticated',
   'bunbun_accounting.record_sale_with_lots_staging(date,text,text,jsonb,uuid,uuid)',
   'EXECUTE') then
   raise exception 'Browser role must not call private stock writers';
 end if;

 -- First generate a NEW physical lot through shaping and baking.
 v_result:=bunbun_accounting.record_tracked_shaping_staging(
   70,1,6,3,1,'CI-COMBINED-FROZEN-70','2026-11-07',
   'SIGNED-INTEGRATED-SHAPING-70',v_shaping,owner_id);
 v_frozen:=(v_result->>'frozen_split_id')::bigint;
 v_direct:=(v_result->>'direct_split_id')::bigint;
 if (select status from public.production_batches where id=70)<>'Split' then
   raise exception 'Parent batch status incorrect after shaping';
 end if;
 perform bunbun_accounting.record_tracked_baking_staging(
   v_direct,2,1,'2026-11-08','SIGNED-BAKE-DIRECT-70',
   v_bake_direct,owner_id);
 v_result:=bunbun_accounting.record_frozen_to_direct_staging(
   v_frozen,6,'2026-11-09','SIGNED-CONVERSION-FROZEN-70',
   v_convert,owner_id);
 v_frozen_direct:=(v_result->>'direct_split_id')::bigint;
 perform bunbun_accounting.record_tracked_baking_staging(
   v_frozen_direct,5,1,'2026-11-10',
   'SIGNED-BAKE-FROZEN-DERIVED-70',v_bake_frozen,owner_id);
 v_new_key:='split:'||v_frozen_direct::text;
 if (select status from public.production_batches where id=70)<>'Finished'
  or (select selesai from public.production_batches where id=70)<>7
  or (select reject from public.production_batches where id=70)<>3
  or (select sum(available_qty) from bunbun_accounting.finished_lot_positions
      where product_id=1)<>17 then
   raise exception 'Production and baking totals do not reconcile 7+3=10';
 end if;
 execute 'SET CONSTRAINTS verify_unified_lot_movement_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_unified_lot_movement_commit DEFERRED';

 -- Single-product cafe shipment sources two distinct direct/frozen-derived
 -- lots; no sale, cash or COGS posting.
 v_result:=bunbun_accounting.record_single_cafe_release_staging(
   1,2,'2026-11-11','The Public Coffee',
   'SIGNED-INTEGRATED-SINGLE-CAFE-RECEIPT',
   jsonb_build_array(
     jsonb_build_object('lotKey','split:'||v_direct::text,'qty',1),
     jsonb_build_object('lotKey',v_new_key,'qty',1)),
   v_single,owner_id);
 if v_result->>'recognized_sale'<>'false' or
   v_result->>'remaining_finished_qty'<>'15' or
   (select count(*) from public.sales)<>0 then
    raise exception 'Single cafe consignment was wrongly considered sale';
 end if;
 -- Multi-product shipment deducts a different source lot and product2.
 v_result:=bunbun_accounting.record_lot_assigned_release(
   '2026-11-12','The Public Coffee','CAFE_CONSIGNMENT',
   'SIGNED-INTEGRATED-MULTI-CAFE-RECEIPT',
   jsonb_build_array(
     jsonb_build_object('productId',1,'quantity',1,'allocations',
       jsonb_build_array(jsonb_build_object('lotKey',v_new_key,'qty',1))),
     jsonb_build_object('productId',2,'quantity',1,'allocations',
       jsonb_build_array(jsonb_build_object('lotKey','split:103','qty',1)))),
   v_multi,owner_id);
 execute 'SET CONSTRAINTS verify_unified_lot_movement_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_unified_lot_movement_commit DEFERRED';
 if (select sum(available_qty) from bunbun_accounting.finished_lot_positions
   where product_id=1)<>14 or
   (select sum(available_qty) from bunbun_accounting.finished_lot_positions
   where product_id=2)<>6 then
   raise exception 'Single and multi cafe release double-counted stock';
 end if;

 -- Sale is a DIFFERENT event from cafe consignments. Move exact finished
 -- lot units from inventory, preserve source and selling price, do not post
 -- accounting revenue/HPP while source costs and receivables are not proven.
 v_result:=bunbun_accounting.record_sale_with_lots_staging(
   '2026-11-13','PUBLIC_HUB','SIGNED-INTEGRATED-SALE-FIRST',
   jsonb_build_array(jsonb_build_object(
      'productId',1,'quantity',3,'sellingPrice','14000.00',
      'orderType','TAKE_AWAY','allocations',
      jsonb_build_array(
        jsonb_build_object('lotKey',v_new_key,'qty',2),
        jsonb_build_object('lotKey','split:101','qty',1)))),
   v_sale_a,owner_id);
 v_sale1:=(v_result->>'sale_id')::bigint;
 if v_result->>'financial_posted'<>'false' or
   (select sum(available_qty) from bunbun_accounting.finished_lot_positions
    where product_id=1)<>11 then
   raise exception 'Actual sale source stock not traced correctly';
 end if;
 -- Return physically inspected sold goods to exactly original lots.
 v_result:=bunbun_accounting.cancel_lot_sale_staging(
   v_sale1,'2026-11-14','SIGNED-INTEGRATED-PHYSICAL-RETURN',
   true,v_cancel_a,owner_id);
 if v_result->>'financial_reversal_pending'<>'true'
  or (select sum(available_qty) from bunbun_accounting.finished_lot_positions
     where product_id=1)<>14 then
   raise exception 'Sale cancellation did not return physical source lots';
 end if;
 begin
   perform bunbun_accounting.cancel_lot_sale_staging(
     v_sale1,'2026-11-14','CASH-REFUND-NO-SECOND-RETURN',
     false,v_invalid,owner_id);
   raise exception 'UNEXPECTED SUCCESS: cash-only refund restocked goods';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%Physical return%' then raise; end if;
 end;
 execute 'SET CONSTRAINTS verify_unified_lot_movement_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_unified_lot_movement_commit DEFERRED';

 -- Second sale later edited; immutable original remains but inventory is
 -- restored only if full original sold goods are physically resellable.
 v_result:=bunbun_accounting.record_sale_with_lots_staging(
   '2026-11-15','PUBLIC_HUB','SIGNED-INTEGRATED-SALE-SECOND',
   '[{"productId":1,"quantity":2,"sellingPrice":"13000.00",
       "orderType":"DINE_IN","allocations":[{"lotKey":"split:101","qty":2}]},
      {"productId":2,"quantity":1,"sellingPrice":"19000.00",
       "orderType":"TAKE_AWAY","allocations":[{"lotKey":"split:103","qty":1}]}]'::jsonb,
   v_sale_b,owner_id);
 v_sale2:=(v_result->>'sale_id')::bigint;
 v_result:=bunbun_accounting.replace_lot_sale_staging(
   v_sale2,'2026-11-16','PUBLIC_HUB',
   'SIGNED-INTEGRATED-EDIT-PHYSICAL-RETURN',
   'SIGNED-INTEGRATED-EDIT-NEW-SALE',
   true,
   '[{"productId":1,"quantity":1,"sellingPrice":"15000.00",
       "orderType":"TAKE_AWAY","allocations":[{"lotKey":"split:101","qty":1}]},
      {"productId":2,"quantity":2,"sellingPrice":"19000.00",
       "orderType":"DINE_IN","allocations":[{"lotKey":"split:103","qty":2}]}]'::jsonb,
   v_cancel_b,v_new_b,owner_id);
 v_replacement:=(v_result->>'new_sale_id')::bigint;
 if not(select is_deleted from public.sales where id=v_sale2) or
   (select is_deleted from public.sales where id=v_replacement) or
   (select total_amount from public.sales where id=v_replacement)<>53000
    then raise exception 'Edited sale did not preserve original/updated prices';
 end if;
 execute 'SET CONSTRAINTS verify_unified_lot_movement_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_unified_lot_movement_commit DEFERRED';

 -- Owner stock adjustment OUT 2 damaged items from new frozen-derived
 -- lot, followed by physically recovered/verified IN 2 to same source.
 v_result:=bunbun_accounting.record_product_lot_adjustment_staging(
   1,'OUT',2,'2026-11-17','Kemasan rusak','Diperiksa saat stok opname',
   'SIGNED-INTEGRATED-ADJUSTMENT-WASTE',
   jsonb_build_array(jsonb_build_object('lotKey',v_new_key,'qty',2)),
   null,v_adj_out,owner_id);
 if v_result->>'cash_posted'<>'false' or
   v_result->>'recipe_hpp_changed'<>'false' or
   v_result->>'remaining_balance'<>'11' then
   raise exception 'OUT stock adjustment posted cash/HPP or wrong stock';
 end if;
 v_result:=bunbun_accounting.record_product_lot_adjustment_staging(
   1,'IN',2,'2026-11-18','Barang ditemukan kembali',
   'Bukti pemeriksaan barang layak jual',
   'SIGNED-INTEGRATED-ADJUSTMENT-RETURN',null,
   v_adj_out,v_adj_in,owner_id);
 if v_result->>'remaining_balance'<>'13' or
   v_result->>'cash_posted'<>'false' or
   v_result->>'recipe_hpp_changed'<>'false' then
   raise exception 'IN adjustment did not restore exact lot safely';
 end if;
 begin
  perform bunbun_accounting.record_product_lot_adjustment_staging(
   1,'IN',1,'2026-11-19','Stok berlebih','Tidak jelas asal barang',
   'UNVERIFIED-INVENTORY-SURPLUS',null,null,v_invalid,owner_id);
  raise exception 'UNEXPECTED SUCCESS: unverified surplus created phantom inventory';
 exception when others then
  if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
  if sqlerrm not like '%original OUT key%' then raise; end if;
 end;

 -- Independent checks at each checkpoint AND for the whole history.
 execute 'SET CONSTRAINTS verify_unified_lot_movement_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_unified_lot_movement_commit DEFERRED';
 select coalesce(sum(available_qty),0) into v_positions
 from bunbun_accounting.finished_lot_positions where product_id=1;
 select coalesce(sum(case
    when movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN')
    then qty
    when movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -qty
    else 0 end),0) into v_movements
 from public.product_stock_movements where product_id=1 and not is_deleted;
 if v_positions<>13 or v_movements<>13 or
    (select sum(available_qty) from bunbun_accounting.finished_lot_positions
     where product_id=2)<>4 or
    (select status from public.production_batches where id=70)<>'Finished'
    or (select sum(qty) from public.production_batch_splits
     where production_batch_id=70 and source_split_id is null)<>10 then
   raise exception 'UNIFIED FINISHED STOCK NOT CONSERVED: lot %, movement %',
     v_positions,v_movements;
 end if;

 select count(distinct movement_type) into v_type_count
 from public.product_stock_movements
 where operation_key in (v_shaping,v_bake_direct,v_convert,
   v_bake_frozen,v_single,v_multi,v_sale_a,v_cancel_a,
   v_sale_b,v_cancel_b,v_new_b,v_adj_out,v_adj_in);
 if v_type_count<>7 then
   raise exception 'Unified test did not traverse all 7 movement types: %',
     v_type_count;
 end if;
 if (select count(*) from bunbun_accounting.lot_sale_replacements
     where old_sale_id=v_sale2 and new_sale_id=v_replacement)<>1
   or (select count(*) from bunbun_accounting.product_lot_adjustments
       where status='RECORDED')<>2
   or (select count(*) from bunbun_accounting.frozen_conversion_operations
       where source_split_id=v_frozen and status='RECORDED')<>1
   or exists(select 1 from public.product_stock_movements
      where operation_key=v_invalid) then
   raise exception 'Unified immutable operation/line provenance missing';
 end if;

 -- Security: even with real-looking operation UUID, direct movement must
 -- not bypass recorded operations. Rollback of the failed operation must
 -- leave no historical movement or fake COGS.
 begin
   perform set_config('bunbun_accounting.lot_write_operation',
     v_invalid::text,true);
   insert into public.product_stock_movements(
     movement_date,movement_type,product_id,qty,operation_key,
     unit,notes,created_by,updated_by)
   values('2026-11-19','ADJUSTMENT_OUT',1,1,v_invalid,'pcs',
     'FORGED-OUT','11111111-1111-4111-8111-111111111111',
     '11111111-1111-4111-8111-111111111111');
   execute 'SET CONSTRAINTS verify_unified_lot_movement_commit IMMEDIATE';
   raise exception 'UNEXPECTED SUCCESS: forged lot movement escaped unified gate';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%Unified adjustment lacks%' then raise; end if;
 end;
 if exists(select 1 from public.product_stock_movements
   where operation_key=v_invalid) then
   raise exception 'Failed forgery left orphan movement';
 end if;


 -- Protect position tables themselves: a privileged client cannot forge
 -- stocks by editing available_qty without creating evidence-backed movement.
 begin
   update bunbun_accounting.finished_lot_positions
   set available_qty=available_qty-1 where lot_key=v_new_key;
   execute 'SET CONSTRAINTS bunbun_accounting.verify_unified_finished_position_commit IMMEDIATE';
   raise exception 'UNEXPECTED SUCCESS direct finished lot stock forgery';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%cannot change without matching lot allocations%' then raise; end if;
 end;
 begin
   update bunbun_accounting.finished_lot_positions
   set original_qty=original_qty+1 where lot_key=v_new_key;
   raise exception 'UNEXPECTED SUCCESS edited source lot original cost/qty';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%provenance and original quantity are immutable%' then raise; end if;
 end;
 begin
   delete from bunbun_accounting.finished_lot_positions
   where lot_key=v_new_key;
   raise exception 'UNEXPECTED SUCCESS deleted source lot';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%cannot be deleted%' then raise; end if;
 end;
 begin
   update bunbun_accounting.frozen_lot_positions
   set available_qty=1 where source_split_id=v_frozen;
   execute 'SET CONSTRAINTS bunbun_accounting.verify_unified_frozen_position_commit IMMEDIATE';
   raise exception 'UNEXPECTED SUCCESS direct frozen lot stock forgery';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%cannot change without recorded conversion%' then raise; end if;
 end;
 -- Both lot positions and public movement ledgers must still reconcile.
 if (select sum(available_qty) from bunbun_accounting.finished_lot_positions
     where product_id=1)<>13 or
    (select available_qty from bunbun_accounting.frozen_lot_positions
     where source_split_id=v_frozen)<>0 then
   raise exception 'Failed lot position forgery leaked quantity changes';
 end if;

 raise notice 'PASS: 9 unified stock writer families, 7 movement types, batch shaping→frozen→baking→single/multi cafe→sale→return→edit→adjustment IN/OUT; exact positions=movement, reject excluded, no HPP/cash posted';
end $all$;
reset role;
