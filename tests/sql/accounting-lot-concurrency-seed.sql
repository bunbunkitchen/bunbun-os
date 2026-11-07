-- EPHEMERAL CI ONLY: create approved-looking test lots for two concurrent
-- transaction sessions. This is synthetic data, NOT real Bunbun approvals.
insert into bunbun_accounting.finished_lot_positions
(lot_key, product_id, source_type, source_split_id, first_available_on,
 source_evidence, approved_by, approved_at, original_qty, available_qty)
values
('split:101',1,'DIRECT_RELEASE',101,'2026-11-03',
 'CONCURRENCY-ROOT-101','11111111-1111-4111-8111-111111111111',now(),6,6),
('split:102',1,'FROZEN_CONVERSION',102,'2026-11-05',
 'CONCURRENCY-ROOT-102','11111111-1111-4111-8111-111111111111',now(),4,4),
('split:103',2,'DIRECT_RELEASE',103,'2026-11-04',
 'CONCURRENCY-ROOT-103','11111111-1111-4111-8111-111111111111',now(),7,7);
