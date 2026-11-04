-- Disposable CI only; actual sold import race, no business posting.
DO $$ BEGIN IF current_database()<>'bunbun_cafe_ledger_ci' OR EXISTS(SELECT 1 FROM bunbun_accounting.journals) OR EXISTS(SELECT 1 FROM bunbun_accounting.cafe_reports)
 THEN RAISE EXCEPTION 'Requires empty isolated cafe-ledger CI database'; END IF; END $$;
INSERT INTO public.products(id,sku,nama) OVERRIDING SYSTEM VALUE VALUES(945001,'LOCAL-CAFE-IMPORT-RACE','Synthetic actual sold item');
INSERT INTO bunbun_accounting.periods(month_start,cutover_on,status,approved_by,approved_at) VALUES('2026-11-01','2026-11-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET ROLE service_role;
DO $$ DECLARE actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; j uuid:=gen_random_uuid(); pid uuid; inp jsonb; src jsonb;
BEGIN
 SELECT id INTO pid FROM bunbun_accounting.periods WHERE month_start='2026-11-01';
 INSERT INTO bunbun_accounting.opening_snapshots(period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at) VALUES(pid,'2026-11-01','{"synthetic_only":true}','SYNTHETIC-CAFE-RACE-OPENING','APPROVED',actor,now());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key) VALUES(j,pid,'2026-11-01','OPENING','LOCAL-CAFE-IMPORT-RACE',gen_random_uuid());
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit) VALUES(j,1,'1020',1000,0),(j,2,'3000',0,1000);
 PERFORM bunbun_accounting.post_reviewed_journal(j,actor);
 inp:='{"month":"2026-11","cafeKey":"PUBLIC_HUB","asOfDate":"2026-11-30","expectedReportId":null,"openingEvidenceRef":"SYNTHETIC-OPENING-COUNT","evidenceRef":"SYNTHETIC-ACTUAL-SOLD","factsConfirmed":true,"confirmedUnpaid":"80","confirmedCredit":"0","shipmentIds":[],"returnIds":[],"receipts":[],"rows":[{"productId":"945001","openingQty":"3","receivedQty":"0","regularQty":"3","bundleQty":"0","discountQty":"0","wasteQty":"0","returnedQty":"0","closingQty":"0","regularNet":"80","bundleNet":"0","discountNet":"0"}]}';
 src:=public.accounting_cafe_report_service('review',inp,actor);
 PERFORM public.accounting_cafe_report_service('record',jsonb_build_object('input',inp,'fingerprint',src->>'fingerprint','operationKey',gen_random_uuid(),'summary','{"factsMatch":true,"readyToClose":false,"accountingStatus":"REQUIRES_LEDGER_RECONCILIATION"}'::jsonb),actor);
END $$;
RESET ROLE;
