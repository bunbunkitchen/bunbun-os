DO $$ BEGIN IF current_database()<>'bunbun_cafe_exceptions_ci' OR EXISTS(SELECT 1 FROM bunbun_accounting.journals) THEN RAISE EXCEPTION 'Requires empty disposable cafe-exceptions CI database'; END IF; END $$;
\ir source-cafe-ledger-fixture.sql
INSERT INTO public.incomes(id,tanggal,total_penjualan,persentase_bunbun,pemasukan_bunbun) OVERRIDING SYSTEM VALUE VALUES(950001,'2026-12-10',20,70,20);
INSERT INTO bunbun_accounting.periods(month_start,cutover_on,status,approved_by,approved_at) VALUES('2026-12-01','2026-12-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET LOCAL ROLE service_role;
DO $$ DECLARE actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; inp jsonb; s jsonb; p jsonb; r jsonb; report uuid;
BEGIN
 inp:='{"month":"2026-12","cafeKey":"PUBLIC_HUB","asOfDate":"2026-12-31","expectedReportId":null,"openingEvidenceRef":"SYNTHETIC-PRIOR-CLOSING","evidenceRef":"SYNTHETIC-DECEMBER-REPORT","factsConfirmed":true,"confirmedUnpaid":"0","confirmedCredit":"0","shipmentIds":[],"returnIds":[],"receipts":[{"incomeId":"950001","amount":"20"}],"rows":[{"productId":"940001","openingQty":"2","receivedQty":"0","regularQty":"1","bundleQty":"0","discountQty":"0","wasteQty":"1","returnedQty":"0","closingQty":"0","regularNet":"20","bundleNet":"0","discountNet":"0"}]}';
 s:=public.accounting_cafe_report_service('review',inp,actor);
 r:=public.accounting_cafe_report_service('record',jsonb_build_object('input',inp,'fingerprint',s->>'fingerprint','operationKey',gen_random_uuid(),'summary','{"factsMatch":true,"readyToClose":false,"accountingStatus":"REQUIRES_LEDGER_RECONCILIATION"}'::jsonb),actor);report:=(r->>'id')::uuid;
 p:=jsonb_build_object('reportId',report,'incomeId','950001','cashAccount','1020','allocationConfirmed',true,'evidenceRef','SYNTHETIC-ACTUAL-ADVANCE');s:=public.accounting_cafe_exception_service('review_advance',p,actor);
 PERFORM public.accounting_cafe_exception_service('post_advance',p||jsonb_build_object('sourceSnapshot',s->>'sourceSnapshot','operationKey',gen_random_uuid()),actor);
 p:=jsonb_build_object('reportId',report,'mode','CREATE','saleDate','2026-12-31','existingSaleIds','[]'::jsonb,'actualSoldConfirmed',true,'evidenceRef','SYNTHETIC-ACTUAL-SOLD');s:=public.accounting_cafe_ledger_service('review_import',p,actor);
 PERFORM public.accounting_cafe_ledger_service('post_import',p||jsonb_build_object('sourceSnapshot',s->>'sourceSnapshot','operationKey',gen_random_uuid()),actor);
END $$;
RESET ROLE;
COMMIT;
