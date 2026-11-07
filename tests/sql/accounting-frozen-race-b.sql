\set ON_ERROR_STOP on
set role service_role;
select bunbun_accounting.record_frozen_to_direct_staging(
  200,6,'2026-11-08','CONCURRENT-FROZEN-CHECK-B',
  '22222222-2222-4222-8222-555555555555',
  '11111111-1111-4111-8111-111111111111');
