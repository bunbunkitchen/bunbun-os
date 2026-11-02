\set ON_ERROR_STOP on
set role service_role;
-- Competing request with a DIFFERENT allocation for exactly the same batch.
select bunbun_accounting.record_tracked_shaping_staging(
  77,1,0,5,0,null,'2026-11-07',
  'CI-SHAPING-RECEIPT-B',
  'd1111111-1111-4111-8111-777777777777',
  '11111111-1111-4111-8111-111111111111');
