-- EPHEMERAL PG16 ONLY. Isolated single-product cafe stock release.
-- No sale rows, HPP posting, cash posting or artificial 30% deduction.
update bunbun_accounting.lot_tracking_control
set mode='ON',cutover_on='2026-11-01',
  approved_by='11111111-1111-4111-8111-111111111111',
  approved_at=now()
where singleton and mode='OFF';

set role service_role;
do $test$
declare
  v_owner uuid:='11111111-1111-4111-8111-111111111111';
  v_baker uuid:='22222222-2222-4222-8222-222222222222';
  v_main uuid:='d1111111-1111-4111-8111-111111111111';
  v_bad uuid:='d2222222-2222-4222-8222-222222222222';
  v_result jsonb;
  v_movement bigint;
  v_balance bigint;
begin
  if has_function_privilege('authenticated',
    'bunbun_accounting.record_single_cafe_release_staging(bigint,integer,date,text,text,jsonb,uuid,uuid)',
    'EXECUTE') then
    raise exception 'Authenticated user can invoke private cafe release';
  end if;

  begin
    perform bunbun_accounting.record_single_cafe_release_staging(
      1,2,'2026-11-07','The Public Coffee',
      'SIGNED-CI-CAFE-RECEIPT',
      '[{"lotKey":"split:101","qty":2}]'::jsonb,
      v_bad,v_baker);
    raise exception 'UNEXPECTED SUCCESS baker issued release';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%Owner approval%' then raise; end if;
  end;
  if exists(select 1 from public.product_stock_movements
    where operation_key=v_bad) then
    raise exception 'Denied role left a ghost movement';
  end if;

  -- Original 10 pcs; ship 6 pcs split across direct and frozen-derived lots.
  v_result:=bunbun_accounting.record_single_cafe_release_staging(
    1,6,'2026-11-07','The Public Coffee',
    'SIGNED-CI-CAFE-RECEIPT',
    '[{"lotKey":"split:101","qty":4},{"lotKey":"split:102","qty":2}]'::jsonb,
    v_main,v_owner);
  v_movement:=(v_result->>'movement_id')::bigint;
  if v_result->>'already_exists'<>'false'
    or v_result->>'remaining_finished_qty'<>'4'
    or v_result->>'recognized_sale'<>'false'
    or v_result->>'cogs_posted'<>'false'
    or v_result->>'cash_posted'<>'false' then
    raise exception 'Single cafe release response invalid %',v_result;
  end if;
  execute 'SET CONSTRAINTS verify_lot_allocation_before_commit IMMEDIATE';
  execute 'SET CONSTRAINTS verify_lot_allocation_before_commit DEFERRED';
  if (select count(*) from public.product_stock_movements
     where id=v_movement and movement_type='CAFE_OUT'
       and product_id=1 and qty=6 and sale_id is null)<>1
    or (select count(*) from bunbun_accounting.lot_release_allocations
     where stock_movement_id=v_movement)<>2
    or (select available_qty from bunbun_accounting.finished_lot_positions
     where lot_key='split:101')<>2
    or (select available_qty from bunbun_accounting.finished_lot_positions
     where lot_key='split:102')<>2 then
    raise exception 'Single cafe release failed exact lot stock accounting';
  end if;

  -- Idempotent re-submit must point at the same movement.
  v_result:=bunbun_accounting.record_single_cafe_release_staging(
    1,6,'2026-11-07','The Public Coffee',
    'SIGNED-CI-CAFE-RECEIPT',
    '[{"lotKey":"split:101","qty":4},{"lotKey":"split:102","qty":2}]'::jsonb,
    v_main,v_owner);
  if v_result->>'already_exists'<>'true'
   or (v_result->>'movement_id')::bigint<>v_movement then
    raise exception 'Retry duplicated cafe shipment';
  end if;
  begin
    perform bunbun_accounting.record_single_cafe_release_staging(
      1,5,'2026-11-07','The Public Coffee',
      'SIGNED-CI-CAFE-RECEIPT',
      '[{"lotKey":"split:101","qty":3},{"lotKey":"split:102","qty":2}]'::jsonb,
      v_main,v_owner);
    raise exception 'UNEXPECTED SUCCESS altered replay';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%reused with different%' then raise; end if;
  end;

  -- An exact-total error and overdraw must not create any stock movement.
  begin
    perform bunbun_accounting.record_single_cafe_release_staging(
      1,3,'2026-11-08','The Public Coffee',
      'SIGNED-CI-FAILED-CAFE',
      '[{"lotKey":"split:101","qty":1}]'::jsonb,
      v_bad,v_owner);
    raise exception 'UNEXPECTED SUCCESS partial lot assignment';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%do not equal%' then raise; end if;
  end;
  begin
    perform bunbun_accounting.record_single_cafe_release_staging(
      1,5,'2026-11-08','The Public Coffee',
      'SIGNED-CI-FAILED-CAFE',
      '[{"lotKey":"split:101","qty":3},{"lotKey":"split:102","qty":2}]'::jsonb,
      v_bad,v_owner);
    raise exception 'UNEXPECTED SUCCESS oversold cafe stock';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%insufficient%' then raise; end if;
  end;
  if exists(select 1 from public.product_stock_movements
    where operation_key=v_bad) then
    raise exception 'Failed cafe release left an orphan stock movement';
  end if;
  select coalesce(sum(available_qty),0) into v_balance
  from bunbun_accounting.finished_lot_positions
  where product_id=1;
  if v_balance<>4 then
    raise exception 'Cafe shipment changed stock twice'; end if;

  raise notice 'PASS: one cafe product uses multi-lot atomic source, is idempotent, no sale/cash/COGS';
end $test$;
reset role;
