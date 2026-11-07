\set ON_ERROR_STOP on
begin;
set local role service_role;
-- Freeze product-level stock while another session tries to spend same lot.
select id from public.products where id=1 for update;
\echo LOT_LOCK_ACQUIRED
select pg_sleep(2);
select bunbun_accounting.record_lot_assigned_release(
  '2026-11-08','The Public Coffee','CAFE_CONSIGNMENT',
  'CONCURRENT-OWNER-DELIVERY-A',
  '[{"productId":1,"quantity":6,
     "allocations":[{"lotKey":"split:101","qty":6}]}]'::jsonb,
  '11111111-1111-4111-8111-333333333333',
  '11111111-1111-4111-8111-111111111111'
);
commit;
