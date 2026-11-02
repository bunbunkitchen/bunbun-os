\set ON_ERROR_STOP on
begin;
set local role service_role;
select id from public.products where id=1 for update;
\echo FROZEN_FIRST_LOCK_ACQUIRED
select pg_sleep(2);
select bunbun_accounting.record_frozen_to_direct_staging(
  200,6,'2026-11-08','CONCURRENT-FROZEN-CHECK-A',
  '11111111-1111-4111-8111-555555555555',
  '11111111-1111-4111-8111-111111111111');
commit;
