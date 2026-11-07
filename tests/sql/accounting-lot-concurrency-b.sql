\set ON_ERROR_STOP on
set role service_role;
-- This session starts WHILE the first session still holds product 1 FOR UPDATE.
-- It must wait, then reject a second six-unit release of the exhausted lot.
select bunbun_accounting.record_lot_assigned_release(
  '2026-11-08','The Public Coffee','CAFE_CONSIGNMENT',
  'CONCURRENT-OWNER-DELIVERY-B',
  '[{"productId":1,"quantity":6,
     "allocations":[{"lotKey":"split:101","qty":6}]}]'::jsonb,
  '22222222-2222-4222-8222-444444444444',
  '11111111-1111-4111-8111-111111111111'
);
