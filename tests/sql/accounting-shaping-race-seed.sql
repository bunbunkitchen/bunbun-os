-- CI-ONLY: simulated approved cutover for concurrent shaping of batch 77.
update bunbun_accounting.lot_tracking_control
set mode='ON', cutover_on='2026-11-01',
 approved_by='11111111-1111-4111-8111-111111111111',
 approved_at=now()
where singleton and mode='OFF';
