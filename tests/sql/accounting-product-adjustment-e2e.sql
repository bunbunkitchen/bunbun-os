-- EPHEMERAL PG16: finished product adjustment by source lot, no cash/HPP.
-- Uses synthetic initial FINISHED_IN 10 units for product 1, and 7 of product 2.
update bunbun_accounting.lot_tracking_control
set mode='ON',cutover_on='2026-11-01',
    approved_by='11111111-1111-4111-8111-111111111111',approved_at=now()
where singleton and mode='OFF';
set role service_role;

do $adjust$
declare
  v_owner uuid:='11111111-1111-4111-8111-111111111111';
  v_baker uuid:='22222222-2222-4222-8222-222222222222';
  v_out uuid:='a1111111-1111-4111-8111-999999999999';
  v_in uuid:='a2222222-2222-4222-8222-999999999999';
  v_release uuid:='a3333333-3333-4333-8333-999999999999';
  v_release_two uuid:='a4444444-4444-4444-8444-999999999999';
  v_bad uuid:='a5555555-5555-4555-8555-999999999999';
  v_result jsonb;
  v_movement bigint;
begin
 if has_function_privilege('authenticated',
   'bunbun_accounting.record_product_lot_adjustment_staging(bigint,text,integer,date,text,text,text,jsonb,uuid,uuid,uuid)',
   'EXECUTE') then
   raise exception 'Browser authenticated can directly modify tracked adjustments';
 end if;

 -- No arbitrary fabricated +5 to stock: source of positive adjustment
 -- must be one prior, traceable, fully reversed OUT event.
 begin
   perform bunbun_accounting.record_product_lot_adjustment_staging(
     1,'IN',5,'2026-11-07','Selisih stok','Ditemukan lebih',
     'CI-IN-WITHOUT-SOURCE',null,null,v_bad,v_owner);
   raise exception 'UNEXPECTED SUCCESS unknown-source inventory';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%original OUT key%' then raise; end if;
 end;
 begin
   perform bunbun_accounting.record_product_lot_adjustment_staging(
     1,'OUT',1,'2026-11-07','Rusak kemasan','Inspeksi rutin',
     'CI-DENIED-BAKER',
     '[{"lotKey":"split:101","qty":1}]'::jsonb,null,v_bad,v_baker);
   raise exception 'UNEXPECTED SUCCESS non-Owner adjustment';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%Active Owner%' then raise; end if;
 end;
 begin
   perform bunbun_accounting.record_product_lot_adjustment_staging(
     1,'OUT',2,'2026-11-07','Barang rusak','Catatan rusak',
     'CI-MISMATCHED-LOT-TOTAL',
     '[{"lotKey":"split:101","qty":1}]'::jsonb,null,v_bad,v_owner);
   raise exception 'UNEXPECTED SUCCESS partial allocation';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%do not equal%' then raise; end if;
 end;
 if exists(select 1 from public.product_stock_movements
   where operation_key=v_bad) then
   raise exception 'Rejected adjustment left a stock movement';
 end if;

 -- OUT 4 across two genuine finished lots: split101 = 3, split102 = 1.
 v_result:=bunbun_accounting.record_product_lot_adjustment_staging(
   1,'OUT',4,'2026-11-07','Kemasan rusak','Pemeriksaan rak harian',
   'SIGNED-WASTE-INSPECTION-A',
   '[{"lotKey":"split:101","qty":3},{"lotKey":"split:102","qty":1}]'::jsonb,
   null,v_out,v_owner);
 v_movement:=(v_result->>'movement_id')::bigint;
 if v_result->>'already_exists'<>'false'
   or v_result->>'remaining_balance'<>'6'
   or v_result->>'cash_posted'<>'false'
   or v_result->>'recipe_hpp_changed'<>'false'
   or v_result->>'accounting_posted'<>'false'
   or v_result->>'source_cost_review_pending'<>'true' then
   raise exception 'Unexpected OUT adjustment result %',v_result;
 end if;
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit DEFERRED';
 if (select count(*) from public.product_stock_movements
   where id=v_movement and movement_type='ADJUSTMENT_OUT'
     and product_id=1 and batch_split_id is null and sale_id is null
     and notes like '%Alasan:%' and notes like '%Catatan:%')<>1 or
    (select count(*) from bunbun_accounting.product_lot_adjustment_lines
     where operation_key=v_out and direction='OUT')<>2 or
    (select available_qty from bunbun_accounting.finished_lot_positions
     where lot_key='split:101')<>3 or
    (select available_qty from bunbun_accounting.finished_lot_positions
     where lot_key='split:102')<>3 then
    raise exception 'OUT adjustment lost source lot provenance';
 end if;

 -- Duplicate submit must not create a second adjustment or reduce stock.
 v_result:=bunbun_accounting.record_product_lot_adjustment_staging(
   1,'OUT',4,'2026-11-07','Kemasan rusak','Pemeriksaan rak harian',
   'SIGNED-WASTE-INSPECTION-A',
   '[{"lotKey":"split:101","qty":3},{"lotKey":"split:102","qty":1}]'::jsonb,
   null,v_out,v_owner);
 if v_result->>'already_exists'<>'true'
   or (v_result->>'movement_id')::bigint<>v_movement then
   raise exception 'Idempotent OUT changed stock twice'; end if;
 begin
   perform bunbun_accounting.record_product_lot_adjustment_staging(
     1,'OUT',4,'2026-11-07','Kemasan rusak','Pemeriksaan rak berbeda',
     'SIGNED-WASTE-INSPECTION-A',
     '[{"lotKey":"split:101","qty":3},{"lotKey":"split:102","qty":1}]'::jsonb,
     null,v_out,v_owner);
   raise exception 'UNEXPECTED SUCCESS changed adjustment evidence';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%reused with different%' then raise; end if;
 end;

 -- Shipping from another lot AFTER adjustment must still reconcile to
 -- correct source lot, with consignment not counted as revenue.
 v_result:=bunbun_accounting.record_lot_assigned_release(
   '2026-11-08','The Public Coffee','CAFE_CONSIGNMENT',
   'CI-DELIVERY-AFTER-ADJUSTMENT',
   '[{"productId":1,"quantity":2,
      "allocations":[{"lotKey":"split:102","qty":2}]}]'::jsonb,
   v_release,v_owner);
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit DEFERRED';
 if (select sum(available_qty) from bunbun_accounting.finished_lot_positions
   where product_id=1)<>4 then
    raise exception 'CAFE_OUT after adjustment overcounted finished stock';
 end if;

 -- IN can ONLY restore the same 4 units from same original OUT lot refs,
 -- after real physical return and approved evidence. Cannot create a new
 -- pseudo-stock lot or touch recipe HPP.
 v_result:=bunbun_accounting.record_product_lot_adjustment_staging(
   1,'IN',4,'2026-11-09','Barang ditemukan kembali',
   'Hasil inspeksi ditemukan layak jual',
   'SIGNED-REVERSED-WASTE-INSPECTION-A',
   null,v_out,v_in,v_owner);
 if v_result->>'already_exists'<>'false'
    or v_result->>'remaining_balance'<>'8'
    or v_result->>'cash_posted'<>'false'
    or v_result->>'recipe_hpp_changed'<>'false' then
    raise exception 'IN reversal did not correctly restore stock %',v_result;
 end if;
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit DEFERRED';
 if (select count(*) from bunbun_accounting.product_lot_adjustment_lines
    where operation_key=v_in and direction='IN'
      and reverses_line_id is not null)<>2 or
    (select available_qty from bunbun_accounting.finished_lot_positions
     where lot_key='split:101')<>6 or
    (select available_qty from bunbun_accounting.finished_lot_positions
     where lot_key='split:102')<>2 then
    raise exception 'IN reversal did not return exact original stock lots';
 end if;

 v_result:=bunbun_accounting.record_product_lot_adjustment_staging(
   1,'IN',4,'2026-11-09','Barang ditemukan kembali',
   'Hasil inspeksi ditemukan layak jual',
   'SIGNED-REVERSED-WASTE-INSPECTION-A',
   null,v_out,v_in,v_owner);
 if v_result->>'already_exists'<>'true' then
   raise exception 'IN duplicate request was not idempotent'; end if;
 begin
   perform bunbun_accounting.record_product_lot_adjustment_staging(
     1,'IN',4,'2026-11-10','Barang ditemukan kembali',
     'Konfirmasi ulang hasil inspeksi',
     'SIGNED-SECOND-RETURN-ATTEMPT',null,v_out,v_bad,v_owner);
   raise exception 'UNEXPECTED SUCCESS double-restored adjustment';
 exception when others then
   if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
   if sqlerrm not like '%already restored%' then raise; end if;
 end;

 -- A second cafe delivery from the restored source confirms finished stock
 -- may remain usable after a documented adjustment reversal.
 v_result:=bunbun_accounting.record_lot_assigned_release(
   '2026-11-10','The Public Coffee','CAFE_CONSIGNMENT',
   'CI-DELIVERY-AFTER-RETURNED-ADJUSTMENT',
   '[{"productId":1,"quantity":2,
     "allocations":[{"lotKey":"split:101","qty":2}]}]'::jsonb,
   v_release_two,v_owner);
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
 execute 'SET CONSTRAINTS verify_lot_allocation_before_commit DEFERRED';
 if (select sum(available_qty) from bunbun_accounting.finished_lot_positions
      where product_id=1)<>6 or
    (select coalesce(sum(case
      when movement_type in ('FINISHED_IN','OPENING_BALANCE',
        'CAFE_IN','ADJUSTMENT_IN') then qty
      when movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -qty
      else 0 end),0) from public.product_stock_movements
        where product_id=1 and is_deleted=false)<>6 then
   raise exception 'Final product stock != finished lot stock after adjustments and cafe';
 end if;

 -- No fabricated sale or financial events from stock adjustment alone.
 if exists(select 1 from public.product_stock_movements
   where operation_key in (v_out,v_in) and movement_type='CAFE_OUT')
    or (select count(*) from bunbun_accounting.product_lot_adjustments
        where status='RECORDED')<>2 then
   raise exception 'Adjustment generated unexpected sale/stock activity';
 end if;
 raise notice 'PASS: Owner adjustment OUT and traceable IN reversal conserve lots, keep cash and recipe HPP unchanged, block duplicate/phantom inventory';
end $adjust$;
reset role;
