-- EPHEMERAL PG16: synthetic sale and physical return. NO real sales/COGS.
set role service_role;
do $test$
declare
 owner_id uuid:='11111111-1111-4111-8111-111111111111';
 baker_id uuid:='22222222-2222-4222-8222-222222222222';
 key1 uuid:='f1111111-1111-4111-8111-111111111111';
 key2 uuid:='f2222222-2222-4222-8222-222222222222';
 cancel_key uuid:='f3333333-3333-4333-8333-333333333333';
 bad uuid:='f6666666-6666-4666-8666-666666666666';
 item1 jsonb:='[
 {"productId":1,"quantity":4,"sellingPrice":"13000.00",
  "orderType":"TAKE_AWAY","allocations":[
    {"lotKey":"split:101","qty":3},{"lotKey":"split:102","qty":1}]},
 {"productId":2,"quantity":2,"sellingPrice":"19000.00",
  "orderType":"DINE_IN","allocations":[{"lotKey":"split:103","qty":2}]}
 ]'::jsonb;
 item2 jsonb:='[
 {"productId":1,"quantity":3,"sellingPrice":"13000.00",
  "orderType":"TAKE_AWAY","allocations":[
   {"lotKey":"split:101","qty":2},{"lotKey":"split:102","qty":1}]}
 ]'::jsonb;
 sale1 bigint;
 result jsonb;
begin
 if has_function_privilege('authenticated',
    'bunbun_accounting.record_sale_with_lots_staging(date,text,text,jsonb,uuid,uuid)','EXECUTE') or
    has_function_privilege('authenticated',
    'bunbun_accounting.cancel_lot_sale_staging(bigint,date,text,boolean,uuid,uuid)','EXECUTE') then
   raise exception 'Browser role must not invoke private sale writers'; end if;
 begin
   perform bunbun_accounting.record_sale_with_lots_staging(
     '2026-11-07','PUBLIC_HUB','CI-SALE-EVIDENCE',item1,bad,baker_id);
   raise exception 'UNEXPECTED SUCCESS baker sale';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%Active Owner%' then raise; end if;
 end;

 result:=bunbun_accounting.record_sale_with_lots_staging(
   '2026-11-07','PUBLIC_HUB','CI-SALE-EVIDENCE',item1,key1,owner_id);
 sale1:=(result->>'sale_id')::bigint;
 if result->>'already_exists'<>'false' or
    (result->>'total_amount')::numeric<>90000 or
    result->>'financial_posted'<>'false' then
   raise exception 'Wrong sale response %',result; end if;
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit DEFERRED';
 if (select count(*) from public.sale_items where sale_id=sale1)<>2 or
    (select count(*) from bunbun_accounting.lot_sale_out_allocations
     where sale_id=sale1)<>3 or
    (select count(*) from public.product_stock_movements
     where sale_id=sale1 and movement_type='CAFE_OUT')<>2 then
   raise exception 'Wrong sale items or CAFE_OUT source allocations'; end if;
 result:=bunbun_accounting.record_sale_with_lots_staging(
   '2026-11-07','PUBLIC_HUB','CI-SALE-EVIDENCE',item1,key1,owner_id);
 if result->>'already_exists'<>'true' or
    (result->>'sale_id')::bigint<>sale1 then
   raise exception 'Sale create retry duplicated stock'; end if;
 begin
   perform bunbun_accounting.record_sale_with_lots_staging(
     '2026-11-07','PUBLIC_HUB','CHANGED-SALE-EVIDENCE',item1,key1,owner_id);
   raise exception 'UNEXPECTED SUCCESS changed sale retry';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%reused with different%' then raise; end if;
 end;

 -- An invalid second product must roll back the first product and header.
 begin
   perform bunbun_accounting.record_sale_with_lots_staging(
     '2026-11-08','PUBLIC_HUB','OVERDRAWN-STOCK-EVIDENCE',
     '[{"productId":1,"quantity":1,"sellingPrice":"13000.00",
       "orderType":"TAKE_AWAY","allocations":[{"lotKey":"split:101","qty":1}]},
       {"productId":2,"quantity":6,"sellingPrice":"19000.00",
       "orderType":"TAKE_AWAY","allocations":[{"lotKey":"split:103","qty":6}]}]'::jsonb,
     bad,owner_id);
   raise exception 'UNEXPECTED SUCCESS oversold second product';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%insufficient%' then raise; end if;
 end;
 if exists(select 1 from public.sales where operation_key=bad) or
    exists(select 1 from bunbun_accounting.lot_sale_transactions
      where operation_key=bad) or
    exists(select 1 from public.product_stock_movements
      where operation_key=bad) then
   raise exception 'Failed sale leaked partial stock or source operation'; end if;

 -- Keep this second sale ACTIVE for the separate editing E2E file.
 result:=bunbun_accounting.record_sale_with_lots_staging(
   '2026-11-08','PUBLIC_HUB','CI-SECOND-SALE',item2,key2,owner_id);

 begin
   perform bunbun_accounting.cancel_lot_sale_staging(
     sale1,'2026-11-09','SIGNED-REFUND-NO-PHYSICAL-RETURN',
     false,cancel_key,owner_id);
   raise exception 'UNEXPECTED SUCCESS refund restocked consumed goods';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%Physical return evidence required%' then raise; end if;
 end;
 result:=bunbun_accounting.cancel_lot_sale_staging(
   sale1,'2026-11-09','SIGNED-RESELLABLE-PHYSICAL-RETURN',
   true,cancel_key,owner_id);
 if result->>'already_exists'<>'false' or
    result->>'financial_reversal_pending'<>'true' then
   raise exception 'Sale cancel result omitted financial reversal blocker'; end if;
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit DEFERRED';
 if not (select is_deleted from public.sales where id=sale1) or
    (select count(*) from public.sale_items where sale_id=sale1)<>2 or
    (select count(*) from bunbun_accounting.lot_sale_return_allocations
      where sale_id=sale1)<>3 or
    (select sum(available_qty) from bunbun_accounting.finished_lot_positions
      where product_id=1)<>7 or
    (select sum(available_qty) from bunbun_accounting.finished_lot_positions
      where product_id=2)<>7 then
   raise exception 'Physical restock failed to restore original lots'; end if;
 result:=bunbun_accounting.cancel_lot_sale_staging(
   sale1,'2026-11-09','SIGNED-RESELLABLE-PHYSICAL-RETURN',
   true,cancel_key,owner_id);
 if result->>'already_exists'<>'true' then
   raise exception 'Cancellation retry was not idempotent'; end if;
 begin
   perform bunbun_accounting.cancel_lot_sale_staging(
     sale1,'2026-11-09','SIGNED-OTHER-RETURN',true,bad,owner_id);
   raise exception 'UNEXPECTED SUCCESS second cancellation';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%already canceled%' then raise; end if;
 end;
 raise notice 'PASS: sale create, exact lot stock, insufficient second product rollback, physical reversal, no fake revenue posting';
end $test$;
reset role;
