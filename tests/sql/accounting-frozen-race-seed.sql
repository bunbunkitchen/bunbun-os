-- EPHEMERAL PG16: synthetic freezer opening for concurrent conversions.
insert into bunbun_accounting.frozen_lot_positions
(source_split_id,product_id,source_movement_id,original_qty,available_qty,
 first_available_on,evidence_ref,reviewed_by,reviewed_at)
select 200,1,id,8,8,'2026-11-03','CI-FROZEN-SOURCE-200',
 '11111111-1111-4111-8111-111111111111',now()
from public.product_stock_movements
where batch_split_id=200 and movement_type='FROZEN_IN';
update bunbun_accounting.lot_tracking_control
set mode='ON',cutover_on='2026-11-01',
 approved_by='11111111-1111-4111-8111-111111111111',approved_at=now()
where singleton and mode='OFF';
