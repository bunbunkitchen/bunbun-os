\set ON_ERROR_STOP on
begin;
set local role service_role;
select id from public.products where id=1 for update;
\echo UNIFIED_SALE_ACQUIRED_SOURCE_LOCK
select pg_sleep(2);
select bunbun_accounting.record_sale_with_lots_staging(
 '2026-11-07','PUBLIC_HUB','CI-UNIFIED-CONCURRENT-SALE-A',
 '[{"productId":1,"quantity":5,"sellingPrice":"13000.00",
    "orderType":"TAKE_AWAY",
    "allocations":[{"lotKey":"split:101","qty":5}]}]'::jsonb,
 'c1111111-1111-4111-8111-333333333333',
 '11111111-1111-4111-8111-111111111111');
commit;
