\set ON_ERROR_STOP on
set role service_role;
select bunbun_accounting.record_sale_with_lots_staging(
 '2026-11-07','PUBLIC_HUB','COMPETING-SALE-SOURCE-B',
 '[{"productId":1,"quantity":5,"sellingPrice":"13000.00","orderType":"TAKE_AWAY","allocations":[{"lotKey":"split:101","qty":5}]}]'::jsonb,
 'c2222222-2222-4222-8222-999999999999',
 '11111111-1111-4111-8111-111111111111');
