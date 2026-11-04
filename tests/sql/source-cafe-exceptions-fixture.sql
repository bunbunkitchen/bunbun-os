\ir source-cafe-ledger-fixture.sql
-- November has net revenue120, COGS40 and closing consignment stock20/2 units.
INSERT INTO public.incomes(id,tanggal,total_penjualan,persentase_bunbun,pemasukan_bunbun,keterangan) OVERRIDING SYSTEM VALUE VALUES(950001,'2026-12-10',20,70,20,'Synthetic early full net cafe deposit');
INSERT INTO bunbun_accounting.periods(month_start,cutover_on,status,approved_by,approved_at) VALUES('2026-12-01','2026-12-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET LOCAL ROLE service_role;
DO $$ DECLARE actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; inp jsonb; source jsonb; p jsonb; q jsonb; result jsonb; retry jsonb; report uuid; invoice bigint;
BEGIN
 inp:='{"month":"2026-12","cafeKey":"PUBLIC_HUB","asOfDate":"2026-12-31","expectedReportId":null,"openingEvidenceRef":"SYNTHETIC-PRIOR-CLOSING","evidenceRef":"SYNTHETIC-DECEMBER-SOLD-WASTE","factsConfirmed":true,"confirmedUnpaid":"0","confirmedCredit":"0","shipmentIds":[],"returnIds":[],"receipts":[{"incomeId":"950001","amount":"20"}],"rows":[{"productId":"940001","openingQty":"2","receivedQty":"0","regularQty":"1","bundleQty":"0","discountQty":"0","wasteQty":"1","returnedQty":"0","closingQty":"0","regularNet":"20","bundleNet":"0","discountNet":"0"}]}';
 source:=public.accounting_cafe_report_service('review',inp,actor);
 result:=public.accounting_cafe_report_service('record',jsonb_build_object('input',inp,'fingerprint',source->>'fingerprint','operationKey',gen_random_uuid(),'summary','{"factsMatch":true,"readyToClose":false,"accountingStatus":"REQUIRES_LEDGER_RECONCILIATION"}'::jsonb),actor);report:=(result->>'id')::uuid;
 p:=jsonb_build_object('reportId',report,'incomeId','950001','cashAccount','1020','evidenceRef','SYNTHETIC-REAL-RECEIPT-DATE','allocationConfirmed',true);
 source:=public.accounting_cafe_exception_service('review_advance',p,actor);IF source->>'amount'<>'20.00' OR source->>'date'<>'2026-12-10' THEN RAISE EXCEPTION 'Advance amount/date changed or deducted twice'; END IF;
 q:=p||jsonb_build_object('sourceSnapshot',source->>'sourceSnapshot','operationKey',gen_random_uuid());
 result:=public.accounting_cafe_exception_service('post_advance',q,actor);retry:=public.accounting_cafe_exception_service('post_advance',q,actor);
 IF result->>'journalId' IS DISTINCT FROM retry->>'journalId' OR (SELECT sum(credit-debit) FROM bunbun_accounting.v_posted_lines WHERE account_code='2130')<>20
 OR (SELECT net_profit FROM bunbun_accounting.v_monthly_profit_loss WHERE month='2026-12-01')<>0 THEN RAISE EXCEPTION 'Advance recognized revenue or duplicated cash'; END IF;
 source:=public.accounting_cafe_exception_service('inspect',jsonb_build_object('reportId',report),actor);
 IF source->'advances'->0->>'posted'<>'true' OR source->'advances'->0->>'reserved'<>'20.00' THEN RAISE EXCEPTION 'Advance inspection lost source reservation'; END IF;
 -- A factual revision must retain the already posted advance reservation.
 BEGIN
  PERFORM public.accounting_cafe_report_service('record',jsonb_build_object('input',inp||jsonb_build_object('expectedReportId',report,'receipts','[]'::jsonb),'fingerprint',bunbun_accounting.cafe_report_sources(inp||'{"receipts":[]}')->>'fingerprint','operationKey',gen_random_uuid(),'summary','{"factsMatch":true,"readyToClose":false,"accountingStatus":"REQUIRES_LEDGER_RECONCILIATION"}'::jsonb),actor);
  RAISE EXCEPTION 'Posted advance source scope released';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Advance receipt reservations cannot change through factual revision' THEN RAISE;END IF;END;
 p:=jsonb_build_object('reportId',report,'mode','CREATE','saleDate','2026-12-31','existingSaleIds','[]'::jsonb,'actualSoldConfirmed',true,'evidenceRef','SYNTHETIC-MONTH-END-SOLD');
 source:=public.accounting_cafe_ledger_service('review_import',p,actor);result:=public.accounting_cafe_ledger_service('post_import',p||jsonb_build_object('sourceSnapshot',source->>'sourceSnapshot','operationKey',gen_random_uuid()),actor);invoice:=(result->'saleIds'->>0)::bigint;
 p:=jsonb_build_object('reportId',report,'incomeId','950001','applicationDate','2026-12-31','allocationConfirmed',true,'evidenceRef','SYNTHETIC-APPLY-AVAILABLE-ADVANCE','allocations',jsonb_build_array(jsonb_build_object('saleId',invoice::text,'amount','20')));
 BEGIN PERFORM public.accounting_cafe_exception_service('review_apply',p||'{"applicationDate":"2026-12-10"}',actor);RAISE EXCEPTION 'Applied before invoice existed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Advance invoice, date or amount requires reconciliation' THEN RAISE;END IF;END;
 BEGIN PERFORM public.accounting_cafe_exception_service('review_apply',p||jsonb_build_object('allocations',jsonb_build_array(jsonb_build_object('saleId',invoice::text,'amount','21'))),actor);RAISE EXCEPTION 'Over-applied advance';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Advance exceeds actual invoice balance' THEN RAISE;END IF;END;
 source:=public.accounting_cafe_exception_service('review_apply',p,actor);q:=p||jsonb_build_object('sourceSnapshot',source->>'sourceSnapshot','operationKey',gen_random_uuid());
 result:=public.accounting_cafe_exception_service('post_apply',q,actor);retry:=public.accounting_cafe_exception_service('post_apply',q,actor);
 IF result->>'journalId' IS DISTINCT FROM retry->>'journalId' OR (SELECT sum(credit-debit) FROM bunbun_accounting.v_posted_lines WHERE account_code='2130')<>0
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1120')<>0 THEN RAISE EXCEPTION 'Advance application did not clear liability/receivable exactly'; END IF;
 IF bunbun_accounting.cafe_ledger_month_ready('2026-12-01') THEN RAISE EXCEPTION 'Unvalued confirmed cafe waste allowed close'; END IF;
 p:=jsonb_build_object('reportId',report,'productId','940001','date','2026-12-31','lossConfirmed',true,'evidenceRef','SYNTHETIC-CAFE-WASTE-COUNT','allocations','[{"splitId":"940001","quantity":"1"}]'::jsonb);
 BEGIN PERFORM public.accounting_cafe_exception_service('review_waste',p||'{"allocations":[{"splitId":"940001","quantity":"2"}]}',actor);RAISE EXCEPTION 'Money variance replaced physical waste quantity';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Waste lot quantities must equal reported waste' THEN RAISE;END IF;END;
 source:=public.accounting_cafe_exception_service('review_waste',p,actor);IF (source->>'amount')::numeric<>10 THEN RAISE EXCEPTION 'Waste used master/recipe cost instead of actual lot'; END IF;
 q:=p||jsonb_build_object('sourceSnapshot',source->>'sourceSnapshot','operationKey',gen_random_uuid());
 BEGIN PERFORM public.accounting_cafe_exception_service('post_waste',q||'{"sourceSnapshot":"stale"}',actor);RAISE EXCEPTION 'Stale waste source posted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Advance or waste source changed since review' THEN RAISE;END IF;END;
 result:=public.accounting_cafe_exception_service('post_waste',q,actor);retry:=public.accounting_cafe_exception_service('post_waste',q,actor);
 IF result->>'journalId' IS DISTINCT FROM retry->>'journalId' THEN RAISE EXCEPTION 'Cafe waste journal duplicated'; END IF;
 p:=jsonb_build_object('kind','SALE','saleId',invoice::text,'date','2026-12-31','cafeKey','PUBLIC_HUB','lossPolicy','NONE','rejectCost','0','traceConfirmed',true,'noAdditionalBakingCostConfirmed',false,'evidenceRef','SYNTHETIC-DECEMBER-SOLD-LOT','allocations','[{"splitId":"940001","location":"CONSIGNMENT","cafeKey":"PUBLIC_HUB","quantity":"1"}]'::jsonb);
 source:=public.accounting_product_flow_service('review',p,actor);PERFORM public.accounting_product_flow_service('post',p||jsonb_build_object('sourceSnapshot',source->>'sourceSnapshot','operationKey',gen_random_uuid()),actor);
 source:=public.accounting_cafe_exception_service('inspect',jsonb_build_object('reportId',report),actor);
 IF source->'waste'->0->>'posted'<>'true' OR source->'advances'->0->>'applied'<>'20.00' THEN RAISE EXCEPTION 'Posted waste/application missing in Owner inspection'; END IF;
 IF (SELECT sum(actual_value) FROM bunbun_accounting.product_cost_positions)<>0 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1020')<>1140
 OR (SELECT net_profit FROM bunbun_accounting.v_monthly_profit_loss WHERE month='2026-12-01')<>0 OR (SELECT count(*) FROM public.incomes)<>2 OR EXISTS(SELECT 1 FROM public.product_stock_movements)
 OR NOT bunbun_accounting.cafe_ledger_month_ready('2026-12-01') THEN RAISE EXCEPTION 'Advance + actual sale/COGS + cafe waste failed conservation or readiness'; END IF;
END $$;
RESET ROLE;
