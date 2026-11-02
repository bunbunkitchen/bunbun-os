\set ON_ERROR_STOP on
set role service_role;
select bunbun_accounting.record_product_lot_adjustment_staging(
 1,'OUT',4,'2026-11-08','Barang rusak','Inspeksi tim kedua',
 'SIGNED-CONCURRENT-INSPECTION-B',
 '[{"lotKey":"split:101","qty":4}]'::jsonb,
 null,'a2222222-2222-4222-8222-777777777777',
 '11111111-1111-4111-8111-111111111111');
