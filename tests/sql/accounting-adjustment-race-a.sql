\set ON_ERROR_STOP on
begin;
set local role service_role;
select id from public.products where id=1 for update;
\echo ADJUSTMENT_FIRST_PRODUCT_LOCK
select pg_sleep(2);
select bunbun_accounting.record_product_lot_adjustment_staging(
 1,'OUT',4,'2026-11-08','Barang rusak','Inspeksi tim pertama',
 'SIGNED-CONCURRENT-INSPECTION-A',
 '[{"lotKey":"split:101","qty":4}]'::jsonb,
 null,'a1111111-1111-4111-8111-777777777777',
 '11111111-1111-4111-8111-111111111111');
commit;
