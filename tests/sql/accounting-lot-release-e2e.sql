-- BUNBUN OS / EPHEMERAL PG16 LOT-TRACKED RELEASE CONTRACT.
-- Never run on real Supabase project; requires demo bootstrap and SQL review.
insert into bunbun_accounting.finished_lot_positions
(lot_key,product_id,source_type,source_split_id,first_available_on,
 source_evidence,approved_by,approved_at,original_qty,available_qty)
values
('split:101',1,'DIRECT_RELEASE',101,'2026-11-03',
 'ROOT-FINISHED-001','11111111-1111-4111-8111-111111111111',now(),6,6),
('split:102',1,'FROZEN_CONVERSION',102,'2026-11-05',
 'FROZEN-BAKED-002','11111111-1111-4111-8111-111111111111',now(),4,4),
('split:103',2,'DIRECT_RELEASE',103,'2026-11-04',
 'ROOT-FINISHED-003','11111111-1111-4111-8111-111111111111',now(),7,7);

do $security$
begin
  if has_schema_privilege('authenticated','bunbun_accounting','USAGE') then
    raise exception 'Unexpected authenticated access to private lot schema';
  end if;
  if has_table_privilege('authenticated',
    'bunbun_accounting.lot_release_allocations','INSERT') then
    raise exception 'Untrusted authenticated role can write private allocations';
  end if;
  if has_function_privilege('authenticated',
    'bunbun_accounting.record_lot_assigned_release(date,text,text,text,jsonb,uuid,uuid)',
    'EXECUTE') then
    raise exception 'Untrusted authenticated role can call atomic lot release';
  end if;
  if not (select relrowsecurity from pg_class
    where oid='bunbun_accounting.lot_release_allocations'::regclass) then
    raise exception 'Lot allocations missing RLS';
  end if;
end
$security$;

set role service_role;

do $release$
declare
  v_owner uuid := '11111111-1111-4111-8111-111111111111';
  v_baker uuid := '22222222-2222-4222-8222-222222222222';
  v_inactive uuid := '33333333-3333-4333-8333-333333333333';
  v_key uuid := '11111111-1111-4111-8111-222222222222';
  v_bad_key uuid := '22222222-2222-4222-8222-222222222222';
  v_items jsonb := '[
    {"productId":1,"quantity":8,"allocations":[
      {"lotKey":"split:101","qty":5},
      {"lotKey":"split:102","qty":3}
    ]},
    {"productId":2,"quantity":4,"allocations":[
      {"lotKey":"split:103","qty":4}
    ]}
  ]'::jsonb;
  v_result jsonb;
  v_count bigint;
begin
  -- Authorization checks before opening lot ledger and moving product stock.
  begin
    perform bunbun_accounting.record_lot_assigned_release(
      '2026-11-07','The Public Coffee','CAFE_CONSIGNMENT',
      'DELIVERY-RECEIPT-20261107',v_items,v_bad_key,v_baker);
    raise exception 'UNEXPECTED SUCCESS: Baker authorized lot movement';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%Owner approval%' then raise; end if;
  end;
  begin
    perform bunbun_accounting.record_lot_assigned_release(
      '2026-11-07','The Public Coffee','CAFE_CONSIGNMENT',
      'DELIVERY-RECEIPT-20261107',v_items,v_bad_key,v_inactive);
    raise exception 'UNEXPECTED SUCCESS: inactive Owner authorized movement';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%Owner approval%' then raise; end if;
  end;
  if (select count(*) from bunbun_accounting.lot_release_operations) <> 0 then
    raise exception 'Failed authorization created a release operation';
  end if;

  -- Correct multi-product single-transaction release.
  v_result := bunbun_accounting.record_lot_assigned_release(
    '2026-11-07','The Public Coffee','CAFE_CONSIGNMENT',
    'DELIVERY-RECEIPT-20261107',v_items,v_key,v_owner);
  if v_result->>'already_exists' <> 'false'
     or v_result->>'product_count' <> '2'
     or v_result->>'allocation_count' <> '3'
     or v_result->>'accounting_posted' <> 'false'
     or v_result->>'cogs_created' <> 'false' then
    raise exception 'Unexpected result of atomic lot-assigned release %',v_result;
  end if;

  select count(*) into v_count from public.product_stock_movements
  where operation_key=v_key and movement_type='CAFE_OUT'
    and sale_id is null and is_deleted=false;
  if v_count <> 2 then raise exception 'Expected exactly 2 finished stock rows'; end if;
  select count(*) into v_count from bunbun_accounting.lot_release_allocations
  where operation_key=v_key;
  if v_count <> 3 then raise exception 'Expected 3 matching lot allocation rows'; end if;
  if exists (
    select 1 from bunbun_accounting.lot_release_allocations a
    join public.product_stock_movements m on m.id=a.stock_movement_id
    join bunbun_accounting.finished_lot_positions l on l.lot_key=a.lot_key
    where a.operation_key=v_key and (
      m.product_id<>a.product_id or l.product_id<>a.product_id or
      m.movement_type<>'CAFE_OUT' or m.sale_id is not null
    )
  ) then raise exception 'Stock source/allocation product mismatch'; end if;
  if (select sum(qty) from bunbun_accounting.lot_release_allocations
    where operation_key=v_key) <> 12 then
    raise exception 'Expected 8+4 allocated units';
  end if;
  if (select available_qty from bunbun_accounting.finished_lot_positions
    where lot_key='split:101') <> 1 or
     (select available_qty from bunbun_accounting.finished_lot_positions
    where lot_key='split:102') <> 1 or
     (select available_qty from bunbun_accounting.finished_lot_positions
    where lot_key='split:103') <> 3 then
    raise exception 'Lot positions are incorrect after first release';
  end if;

  -- Same request key is idempotent, no extra deductions, no second release.
  v_result := bunbun_accounting.record_lot_assigned_release(
    '2026-11-07','The Public Coffee','CAFE_CONSIGNMENT',
    'DELIVERY-RECEIPT-20261107',v_items,v_key,v_owner);
  if v_result->>'already_exists'<>'true' then raise exception 'Idempotent replay not detected'; end if;
  if (select count(*) from bunbun_accounting.lot_release_allocations
    where operation_key=v_key)<>3 then raise exception 'Retry double-decremented lot positions'; end if;

  -- Same operation key with changed qty or document must fail.
  begin
    perform bunbun_accounting.record_lot_assigned_release(
      '2026-11-07','The Public Coffee','CAFE_CONSIGNMENT',
      'DIFFERENT-DOCUMENT-20261107',v_items,v_key,v_owner);
    raise exception 'UNEXPECTED SUCCESS: fingerprint reuse';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%Operation key reused%' then raise; end if;
  end;

  -- Failure in SECOND product must roll back FIRST product's lot changes,
  -- stock movements and operation-key insert atomically.
  begin
    perform bunbun_accounting.record_lot_assigned_release(
      '2026-11-08','The Public Coffee','CAFE_CONSIGNMENT',
      'DELIVERY-FAIL-20261108',
      '[{"productId":1,"quantity":1,
         "allocations":[{"lotKey":"split:101","qty":1}]},
        {"productId":2,"quantity":5,
         "allocations":[{"lotKey":"split:103","qty":5}]}]'::jsonb,
      v_bad_key,v_owner);
    raise exception 'UNEXPECTED SUCCESS: second product overdrew lot';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%insufficient%' and
       sqlerrm not like '%exceeds available%' then raise; end if;
  end;
  if exists(select 1 from public.product_stock_movements
    where operation_key=v_bad_key) or
     exists(select 1 from bunbun_accounting.lot_release_allocations
    where operation_key=v_bad_key) or
     exists(select 1 from bunbun_accounting.lot_release_operations
    where operation_key=v_bad_key) then
    raise exception 'Atomic rollback leaked a partial release';
  end if;
  if (select available_qty from bunbun_accounting.finished_lot_positions
    where lot_key='split:101') <> 1 then
    raise exception 'Rollback failed to restore first-product lot';
  end if;

  -- One source lot may not be consumed in two lines of the same product.
  begin
    perform bunbun_accounting.record_lot_assigned_release(
      '2026-11-08','The Public Coffee','CAFE_CONSIGNMENT',
      'REPEATED-LOT-DOC-20261108',
      '[{"productId":1,"quantity":2,"allocations":[
        {"lotKey":"split:101","qty":1},{"lotKey":"split:101","qty":1}]}]'::jsonb,
      v_bad_key,v_owner);
    raise exception 'UNEXPECTED SUCCESS: repeated lot';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%Duplicate lot%' then raise; end if;
  end;

  -- Matching product but bad quantity cannot silently consume another lot.
  begin
    perform bunbun_accounting.record_lot_assigned_release(
      '2026-11-08','The Public Coffee','CAFE_CONSIGNMENT',
      'SHORT-ALLOCATION-DOC-20261108',
      '[{"productId":1,"quantity":2,"allocations":[
        {"lotKey":"split:101","qty":1}]}]'::jsonb,
      v_bad_key,v_owner);
    raise exception 'UNEXPECTED SUCCESS: partial lot allocation';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%allocations do not equal%' then raise; end if;
  end;

  -- No direct approval of SOLD or COGS from a physical product release.
  begin
    perform bunbun_accounting.record_lot_assigned_release(
      '2026-11-08','The Public Coffee','SOLD_AT_CAFE',
      'FAKE-SALE-20261108',
      '[{"productId":1,"quantity":1,
        "allocations":[{"lotKey":"split:101","qty":1}]}]'::jsonb,
      v_bad_key,v_owner);
    raise exception 'UNEXPECTED SUCCESS: sold event disguised as release';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%classification%' then raise; end if;
  end;

  -- A direct old stock write bypasses private lot ledger. New controlled
  -- release must fail closed, not double-deduct from a guessed lot.
  insert into public.product_stock_movements
    (movement_date,movement_type,product_id,qty,unit,sale_id)
  values ('2026-11-08','CAFE_OUT',1,1,'pcs',null);
  begin
    perform bunbun_accounting.record_lot_assigned_release(
      '2026-11-09','The Public Coffee','CAFE_CONSIGNMENT',
      'AFTER-LEGACY-WRITER-20261109',
      '[{"productId":1,"quantity":1,
        "allocations":[{"lotKey":"split:101","qty":1}]}]'::jsonb,
      v_bad_key,v_owner);
    raise exception 'UNEXPECTED SUCCESS: old writer ledger divergence';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%ledger diverged%' then raise; end if;
  end;

  -- Recorded sources cannot be silently overwritten by service_role.
  begin
    update bunbun_accounting.lot_release_allocations set qty=qty+1
    where operation_key=v_key;
    raise exception 'UNEXPECTED SUCCESS: allocation was changed';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%immutable%' then raise; end if;
  end;
  begin
    delete from bunbun_accounting.lot_release_operations
      where operation_key=v_key;
    raise exception 'UNEXPECTED SUCCESS: recorded operation deleted';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%cannot be edited%' then raise; end if;
  end;

  raise notice 'PASS: lot release operation is atomic, idempotent, stock-safe, private, and NOT accounting posting';
end
$release$;

reset role;
