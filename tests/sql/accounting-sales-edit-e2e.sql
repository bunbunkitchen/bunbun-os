-- Continuation of accounting-sales-lot-e2e.sql on SAME disposable PG.
-- Edit is one SQL transaction: old sale is physically restocked, new sale
-- uses explicit lots. Failure in replacement MUST restore the old sale.
set role service_role;
do $test$
declare
 owner_id uuid:='11111111-1111-4111-8111-111111111111';
 old_id bigint;
 new_id bigint;
 cancel_key uuid:='f4444444-4444-4444-8444-444444444444';
 create_key uuid:='f5555555-5555-4555-8555-555555555555';
 bad uuid:='f6666666-6666-4666-8666-666666666666';
 edited jsonb:='[{"productId":1,"quantity":2,
 "sellingPrice":"15000.00","orderType":"DINE_IN",
 "allocations":[{"lotKey":"split:101","qty":1},{"lotKey":"split:102","qty":1}]}]'::jsonb;
 result jsonb;
begin
 select id into old_id from public.sales
 where operation_key='f2222222-2222-4222-8222-222222222222';
 if old_id is null or (select is_deleted from public.sales where id=old_id) then
   raise exception 'No active second sale to edit'; end if;
 begin
   perform bunbun_accounting.replace_lot_sale_staging(
     old_id,'2026-11-10','PUBLIC_HUB',
     'SIGNED-EDIT-PHYSICAL-RETURN','SIGNED-EDIT-SALE-EVIDENCE',
     true,
     '[{"productId":1,"quantity":9,"sellingPrice":"15000.00",
       "orderType":"TAKE_AWAY","allocations":[{"lotKey":"split:101","qty":9}]}]'::jsonb,
     cancel_key,bad,owner_id);
   raise exception 'UNEXPECTED SUCCESS edit oversold lot';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%insufficient%' then raise; end if;
 end;
 if (select is_deleted from public.sales where id=old_id) or
    exists(select 1 from bunbun_accounting.lot_sale_transactions
      where operation_key=cancel_key) or
    exists(select 1 from public.sales where operation_key=bad) then
   raise exception 'Failed replacement did not roll back original sale'; end if;

 result:=bunbun_accounting.replace_lot_sale_staging(
   old_id,'2026-11-10','PUBLIC_HUB',
   'SIGNED-EDIT-PHYSICAL-RETURN','SIGNED-EDIT-SALE-EVIDENCE',
   true,edited,cancel_key,create_key,owner_id);
 new_id:=(result->>'new_sale_id')::bigint;
 if result->>'already_exists'<>'false' or
   result->>'financial_posted'<>'false' or
   new_id=old_id then raise exception 'Sale replacement failed'; end if;
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit DEFERRED';
 if not (select is_deleted from public.sales where id=old_id) or
    (select is_deleted from public.sales where id=new_id) or
    (select total_amount from public.sales where id=new_id)<>30000 then
   raise exception 'Original must be archived and new sale active'; end if;
 if (select count(*) from bunbun_accounting.lot_sale_replacements
    where old_sale_id=old_id and new_sale_id=new_id)<>1 then
   raise exception 'Immutable old-to-new sale revision link missing'; end if;
 result:=bunbun_accounting.replace_lot_sale_staging(
   old_id,'2026-11-10','PUBLIC_HUB',
   'SIGNED-EDIT-PHYSICAL-RETURN','SIGNED-EDIT-SALE-EVIDENCE',
   true,edited,cancel_key,create_key,owner_id);
 if result->>'already_exists'<>'true'
   or (result->>'new_sale_id')::bigint<>new_id then
   raise exception 'Sale edit retry duplicated records'; end if;
 if (select count(*) from public.sales where is_deleted=false)<>1 or
    (select sum(available_qty) from bunbun_accounting.finished_lot_positions
      where product_id=1)<>8 or
    (select available_qty from bunbun_accounting.finished_lot_positions
      where lot_key='split:101')<>5 or
    (select available_qty from bunbun_accounting.finished_lot_positions
      where lot_key='split:102')<>3 then
   raise exception 'Sale replacement stock lot conservation failed'; end if;
 if (select count(*) from bunbun_accounting.lot_sale_transactions
    where action='SALE_CREATE' and status='RECORDED')<>3 or
    (select count(*) from bunbun_accounting.lot_sale_transactions
    where action='SALE_CANCEL' and status='RECORDED')<>2 then
   raise exception 'Immutable history missing sale creates or reversals'; end if;
 if exists(select 1 from bunbun_accounting.lot_sale_return_allocations r
   left join bunbun_accounting.lot_sale_out_allocations o
   on o.id=r.original_allocation_id
   where o.id is null or r.lot_key<>o.lot_key or
     r.product_id<>o.product_id or r.qty<>o.qty) then
   raise exception 'Return was not tied to exactly the original source lot'; end if;
 raise notice 'PASS: edit sale atomic, old/new ID linked, invalid edits fully roll back, lots and sale count reconcile';
end $test$;
reset role;
