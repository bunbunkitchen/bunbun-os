\set ON_ERROR_STOP on
begin;
set local role service_role;
select id from public.production_batches where id=77 for update;
\echo SHAPING_FIRST_BATCH_LOCK_ACQUIRED
select pg_sleep(2);
select bunbun_accounting.record_tracked_shaping_staging(
  77,1,4,1,0,'CI-RACE-ROOT-77','2026-11-07',
  'CI-SHAPING-RECEIPT-A',
  'c1111111-1111-4111-8111-777777777777',
  '11111111-1111-4111-8111-111111111111');
commit;
