-- Synthetic, source-backed report -> revenue and deposit; no physical stock duplication.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM bunbun_accounting.journals) OR EXISTS(SELECT 1 FROM bunbun_accounting.cafe_reports) THEN RAISE EXCEPTION 'Empty isolated fixture required'; END IF; END $$;
INSERT INTO public.products(id,sku,nama) OVERRIDING SYSTEM VALUE VALUES(940001,'LOCAL-CAFE-LEDGER','Synthetic actual sold product');
-- Trusted known opening lot for integration with the separately tested actual
-- cost provenance pipeline; this fixture never backfills a business opening.
INSERT INTO public.recipes(id,kode,nama,yield_qty,product_id) OVERRIDING SYSTEM VALUE VALUES(940001,'LOCAL-CAFE-LOT','Synthetic opening lot',6,940001);
INSERT INTO public.production_orders(id,kode,tanggal,recipe_id,target_produksi) OVERRIDING SYSTEM VALUE VALUES(940001,'LOCAL-CAFE-LOT','2026-11-01',940001,6);
INSERT INTO public.production_batches(id,kode,production_order_id,target,status,inventory_consumed,created_at) OVERRIDING SYSTEM VALUE VALUES(940001,'LOCAL-CAFE-LOT',940001,6,'Finished',true,'2026-11-01');
INSERT INTO public.production_batch_splits(id,production_batch_id,product_id,route,qty,status,baked_good_qty) OVERRIDING SYSTEM VALUE VALUES(940001,940001,940001,'DIRECT',6,'BAKED',6);
INSERT INTO public.incomes(id,tanggal,total_penjualan,persentase_bunbun,pemasukan_bunbun,keterangan) OVERRIDING SYSTEM VALUE VALUES(940001,'2026-11-30',120,70,120,'Synthetic full net deposit');
INSERT INTO bunbun_accounting.periods(id,month_start,cutover_on,status,approved_by,approved_at)
 VALUES('94000000-0000-4000-8000-000000000001','2026-11-01','2026-11-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET LOCAL ROLE service_role;
DO $$ DECLARE actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; j uuid:=gen_random_uuid(); base jsonb; inp jsonb; src jsonb; p jsonb; q jsonb; result jsonb; retry jsonb;
 hub uuid; coffee uuid; hub_sale bigint; coffee_sale bigint; n integer; r bunbun_accounting.cafe_reports%rowtype;
BEGIN
 INSERT INTO bunbun_accounting.opening_snapshots(period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at)
 VALUES('94000000-0000-4000-8000-000000000001','2026-11-01','{"synthetic_only":true}','SYNTHETIC-CAFE-OPENING','APPROVED',actor,now());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(j,'94000000-0000-4000-8000-000000000001','2026-11-01','OPENING','LOCAL-CAFE-LEDGER',gen_random_uuid());
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit) VALUES(j,1,'1020',1000,0),(j,2,'1240',60,0),(j,3,'3000',0,1060);
 PERFORM bunbun_accounting.post_reviewed_journal(j,actor);
 INSERT INTO bunbun_accounting.product_cost_positions(split_id,location,cafe_key,product_id,quantity,actual_value,source_date,posting_date)
 VALUES(940001,'CONSIGNMENT','PUBLIC_HUB',940001,5,50,'2026-11-01','2026-11-01'),(940001,'CONSIGNMENT','PUBLIC_COFFEE',940001,1,10,'2026-11-01','2026-11-01');
 base:='{"month":"2026-11","cafeKey":"PUBLIC_HUB","asOfDate":"2026-11-30","expectedReportId":null,"openingEvidenceRef":"SYNTHETIC-COUNT-OPENING","evidenceRef":"SYNTHETIC-CAFE-ACTUAL-SOLD","factsConfirmed":true,"confirmedUnpaid":"0","confirmedCredit":"0","shipmentIds":[],"returnIds":[],"receipts":[{"incomeId":"940001","amount":"80"}],"rows":[{"productId":"940001","openingQty":"5","receivedQty":"0","regularQty":"3","bundleQty":"0","discountQty":"0","wasteQty":"0","returnedQty":"0","closingQty":"2","regularNet":"80","bundleNet":"0","discountNet":"0"}]}';
 FOR n IN 1..2 LOOP
  inp:=CASE WHEN n=1 THEN base ELSE base||'{"cafeKey":"PUBLIC_COFFEE","receipts":[{"incomeId":"940001","amount":"40"}],"rows":[{"productId":"940001","openingQty":"1","receivedQty":"0","regularQty":"1","bundleQty":"0","discountQty":"0","wasteQty":"0","returnedQty":"0","closingQty":"0","regularNet":"40","bundleNet":"0","discountNet":"0"}]}'::jsonb END;
  src:=public.accounting_cafe_report_service('review',inp,actor);
  result:=public.accounting_cafe_report_service('record',jsonb_build_object('input',inp,'fingerprint',src->>'fingerprint','operationKey',gen_random_uuid(),'summary','{"factsMatch":true,"readyToClose":false,"accountingStatus":"REQUIRES_LEDGER_RECONCILIATION","status":"FACTS_RECONCILED"}'::jsonb),actor);
  IF n=1 THEN hub:=(result->>'id')::uuid; ELSE coffee:=(result->>'id')::uuid; END IF;
 END LOOP;
 -- Other report's receipt portion changed the first report source snapshot.
 p:=jsonb_build_object('reportId',hub,'mode','CREATE','saleDate','2026-11-30','existingSaleIds','[]'::jsonb,'actualSoldConfirmed',true,'evidenceRef','SYNTHETIC-LEDGER-SOLD');
 BEGIN PERFORM public.accounting_cafe_ledger_service('review_import',p,actor);RAISE EXCEPTION 'Stale factual report imported';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Cafe facts changed or still differ; review and save factual report first' THEN RAISE;END IF;END;
 inp:=base||jsonb_build_object('expectedReportId',hub);src:=public.accounting_cafe_report_service('review',inp,actor);
 result:=public.accounting_cafe_report_service('record',jsonb_build_object('input',inp,'fingerprint',src->>'fingerprint','operationKey',gen_random_uuid(),'summary','{"factsMatch":true,"readyToClose":false,"accountingStatus":"REQUIRES_LEDGER_RECONCILIATION","status":"FACTS_RECONCILED"}'::jsonb),actor);hub:=(result->>'id')::uuid;
 IF bunbun_accounting.cafe_ledger_month_ready('2026-11-01') THEN RAISE EXCEPTION 'Unimported cafe reports marked complete'; END IF;
 p:=p||jsonb_build_object('reportId',hub);src:=public.accounting_cafe_ledger_service('review_import',p,actor);
 q:=p||jsonb_build_object('sourceSnapshot',src->>'sourceSnapshot','operationKey',gen_random_uuid());
 BEGIN PERFORM public.accounting_cafe_ledger_service('post_import',q||'{"sourceSnapshot":"stale"}',actor);RAISE EXCEPTION 'Stale ledger snapshot accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Cafe ledger sources changed since review' THEN RAISE;END IF;END;
 result:=public.accounting_cafe_ledger_service('post_import',q,actor);retry:=public.accounting_cafe_ledger_service('post_import',q,actor);hub_sale:=(result->'saleIds'->>0)::bigint;
 IF retry->>'alreadyProcessed'<>'true' OR result->'saleIds' IS DISTINCT FROM retry->'saleIds' OR (SELECT count(*) FROM public.sales)<>1
 OR (SELECT sum(quantity) FROM public.sale_items WHERE sale_id=hub_sale)<>3 OR (SELECT sum(subtotal) FROM public.sale_items WHERE sale_id=hub_sale)<>80
 OR EXISTS(SELECT 1 FROM public.sale_items WHERE sale_id=hub_sale AND quantity*selling_price<>subtotal) THEN RAISE EXCEPTION 'Actual sales or exact-cent pricing/retry wrong'; END IF;
 BEGIN UPDATE bunbun_accounting.current_cafe_reports SET report_id=report_id WHERE cafe_key='PUBLIC_HUB';RAISE EXCEPTION 'Imported facts revised without correction';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Imported cafe report needs a financial correction; direct revision is blocked' THEN RAISE;END IF;END;
 BEGIN INSERT INTO public.sales(sale_date,sales_channel,total_amount) VALUES('2026-11-30','PUBLIC_HUB',80);RAISE EXCEPTION 'Monthly revenue double counted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Imported monthly cafe sales require a financial correction' THEN RAISE;END IF;END;
 -- Deposit cannot post while one of its report portions has no invoice.
 p:=jsonb_build_object('reportId',hub,'incomeId','940001','cashAccount','1020','evidenceRef','SYNTHETIC-FULL-NET-DEPOSIT');
 BEGIN PERFORM public.accounting_cafe_ledger_service('review_receipt',p,actor);RAISE EXCEPTION 'Unlinked 40 treated as zero';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Every linked report needs one imported invoice; multiple existing invoices need explicit settlement allocation' THEN RAISE;END IF;END;
 -- Existing actual Coffee sale is linked, not inserted a second time.
 INSERT INTO public.sales(sale_date,sales_channel,total_amount,created_by) VALUES('2026-11-30','PUBLIC_COFFEE',40,actor) RETURNING id INTO coffee_sale;
 INSERT INTO public.sale_items(sale_id,product_id,product_name,quantity,selling_price,subtotal,order_type) VALUES(coffee_sale,940001,'Synthetic actual sold product',1,40,40,'TAKE_AWAY');
 src:=public.accounting_revenue_service('review_sale',jsonb_build_object('saleId',coffee_sale::text),actor);
 PERFORM public.accounting_revenue_service('post_sale',jsonb_build_object('saleId',coffee_sale::text,'sourceSnapshot',src->>'sourceSnapshot','recordedBasis','NET_BUNBUN','netEntitlement','40','soldConfirmed',true,'evidenceRef','SYNTHETIC-EXISTING-SOLD','operationKey',gen_random_uuid()),actor);
 p:=jsonb_build_object('reportId',coffee,'mode','CREATE','saleDate','2026-11-30','existingSaleIds','[]'::jsonb,'actualSoldConfirmed',true,'evidenceRef','SYNTHETIC-EXISTING-SOLD');
 BEGIN PERFORM public.accounting_cafe_ledger_service('review_import',p,actor);RAISE EXCEPTION 'Existing cafe sales duplicated';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Existing cafe sales must be reconciled; shipment-shaped sales cannot be imported twice' THEN RAISE;END IF;END;
 p:=p||jsonb_build_object('mode','LINK','existingSaleIds',jsonb_build_array(coffee_sale::text));src:=public.accounting_cafe_ledger_service('review_import',p,actor);
 PERFORM public.accounting_cafe_ledger_service('post_import',p||jsonb_build_object('sourceSnapshot',src->>'sourceSnapshot','operationKey',gen_random_uuid()),actor);
 p:=jsonb_build_object('reportId',hub,'incomeId','940001','cashAccount','1020','evidenceRef','SYNTHETIC-FULL-NET-DEPOSIT');src:=public.accounting_cafe_ledger_service('review_receipt',p,actor);
 IF src->>'netEntitlement'<>'120.00' THEN RAISE EXCEPTION 'Net deposit had another 30 percent deducted'; END IF;
 q:=p||jsonb_build_object('sourceSnapshot',src->>'sourceSnapshot','operationKey',gen_random_uuid());result:=public.accounting_cafe_ledger_service('post_receipt',q,actor);retry:=public.accounting_cafe_ledger_service('post_receipt',q,actor);
 -- Earlier real deposits must wait for advances, never get redated to month end.
 BEGIN
  INSERT INTO public.incomes(id,tanggal,total_penjualan,persentase_bunbun,pemasukan_bunbun) OVERRIDING SYSTEM VALUE VALUES(940002,'2026-12-15',10,70,10);
  INSERT INTO bunbun_accounting.periods(month_start,cutover_on,status,approved_by,approved_at) VALUES('2026-12-01','2026-12-01','OPEN',actor,now());
  inp:=base||'{"month":"2026-12","asOfDate":"2026-12-31","receipts":[{"incomeId":"940002","amount":"10"}],"rows":[{"productId":"940001","openingQty":"2","receivedQty":"0","regularQty":"1","bundleQty":"0","discountQty":"0","wasteQty":"0","returnedQty":"0","closingQty":"1","regularNet":"10","bundleNet":"0","discountNet":"0"}]}'::jsonb;
  src:=public.accounting_cafe_report_service('review',inp,actor);
  retry:=public.accounting_cafe_report_service('record',jsonb_build_object('input',inp,'fingerprint',src->>'fingerprint','operationKey',gen_random_uuid(),'summary','{"factsMatch":true,"readyToClose":false,"accountingStatus":"REQUIRES_LEDGER_RECONCILIATION"}'::jsonb),actor);
  p:=jsonb_build_object('reportId',retry->>'id','mode','CREATE','saleDate','2026-12-15','existingSaleIds','[]'::jsonb,'actualSoldConfirmed',true,'evidenceRef','SYNTHETIC-DECEMBER-SOLD');
  BEGIN PERFORM public.accounting_cafe_ledger_service('review_import',p,actor);RAISE EXCEPTION 'Monthly sold summary shifted earlier to fit deposit';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Monthly sold summaries require month-end recognition; earlier deposits need advance accounting' THEN RAISE;END IF;END;
  p:=p||'{"saleDate":"2026-12-31"}'::jsonb;src:=public.accounting_cafe_ledger_service('review_import',p,actor);
  PERFORM public.accounting_cafe_ledger_service('post_import',p||jsonb_build_object('sourceSnapshot',src->>'sourceSnapshot','operationKey',gen_random_uuid()),actor);
  BEGIN PERFORM public.accounting_cafe_ledger_service('review_receipt',jsonb_build_object('reportId',retry->>'id','incomeId','940002','cashAccount','1020','evidenceRef','SYNTHETIC-EARLY-NET-DEPOSIT'),actor);RAISE EXCEPTION 'Deposit before invoice silently settled';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Deposit precedes monthly invoice; advance accounting is required' THEN RAISE;END IF;END;
  RAISE EXCEPTION 'ROLLBACK_EARLY_DEPOSIT_FIXTURE';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ROLLBACK_EARLY_DEPOSIT_FIXTURE' THEN RAISE;END IF;
 END;
 retry:=public.accounting_cafe_ledger_service('post_receipt',q,actor);
 IF result->>'journalId' IS DISTINCT FROM retry->>'journalId' OR (SELECT count(*) FROM bunbun_accounting.income_postings)<>1
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1020')<>1120
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1120')<>0
 OR (SELECT sum(credit-debit) FROM bunbun_accounting.v_posted_lines WHERE account_code='4010')<>120
 OR (SELECT count(*) FROM public.sales)<>2 OR (SELECT count(*) FROM public.incomes)<>1 OR EXISTS(SELECT 1 FROM public.product_stock_movements)
 OR EXISTS(SELECT 1 FROM bunbun_accounting.sale_postings WHERE cogs_status<>'PENDING_VALUATION') THEN RAISE EXCEPTION 'Net revenue/receipt or physical/source count/COGS boundary wrong'; END IF;
 BEGIN UPDATE bunbun_accounting.periods SET status='CLOSED' WHERE month_start='2026-11-01';RAISE EXCEPTION 'Pending actual COGS closed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Actual sold COGS is incomplete; accounting period cannot close' THEN RAISE;END IF;END;
 -- Even a zero-revenue report cannot hide confirmed cafe waste at close.
 BEGIN
  inp:=base||'{"month":"2027-01","asOfDate":"2027-01-31","receipts":[],"rows":[{"productId":"940001","openingQty":"1","receivedQty":"0","regularQty":"0","bundleQty":"0","discountQty":"0","wasteQty":"1","returnedQty":"0","closingQty":"0","regularNet":"0","bundleNet":"0","discountNet":"0"}]}'::jsonb;
  src:=public.accounting_cafe_report_service('review',inp,actor);
  PERFORM public.accounting_cafe_report_service('record',jsonb_build_object('input',inp,'fingerprint',src->>'fingerprint','operationKey',gen_random_uuid(),'summary','{"factsMatch":true,"readyToClose":false,"accountingStatus":"REQUIRES_LEDGER_RECONCILIATION"}'::jsonb),actor);
  IF bunbun_accounting.cafe_ledger_month_ready('2027-01-01') THEN RAISE EXCEPTION 'Cafe waste ignored when report has no revenue'; END IF;
  RAISE EXCEPTION 'ROLLBACK_CAFE_WASTE_FIXTURE';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ROLLBACK_CAFE_WASTE_FIXTURE' THEN RAISE;END IF;
 END;
 IF NOT bunbun_accounting.cafe_ledger_month_ready('2026-11-01') THEN RAISE EXCEPTION 'Posted cafe revenue and receipts did not reconcile'; END IF;
 -- Imported invoice feeds the same actual lot-COGS path, without another stock-out.
 FOR n IN 1..2 LOOP
  p:=jsonb_build_object('kind','SALE','saleId',CASE WHEN n=1 THEN hub_sale::text ELSE coffee_sale::text END,'date','2026-11-30','cafeKey',CASE WHEN n=1 THEN 'PUBLIC_HUB' ELSE 'PUBLIC_COFFEE' END,
   'lossPolicy','NONE','rejectCost','0','traceConfirmed',true,'noAdditionalBakingCostConfirmed',false,'evidenceRef','SYNTHETIC-REPORT-SOLD-LOT',
   'allocations',jsonb_build_array(jsonb_build_object('splitId','940001','location','CONSIGNMENT','cafeKey',CASE WHEN n=1 THEN 'PUBLIC_HUB' ELSE 'PUBLIC_COFFEE' END,'quantity',CASE WHEN n=1 THEN '3' ELSE '1' END)));
  src:=public.accounting_product_flow_service('review',p,actor);
  PERFORM public.accounting_product_flow_service('post',p||jsonb_build_object('sourceSnapshot',src->>'sourceSnapshot','operationKey',gen_random_uuid()),actor);
 END LOOP;
 IF (SELECT sum(actual_value) FROM bunbun_accounting.product_cost_positions)<>20
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='5010')<>40
 OR (SELECT net_profit FROM bunbun_accounting.v_monthly_profit_loss WHERE month='2026-11-01')<>80
 OR EXISTS(SELECT 1 FROM public.product_stock_movements) OR EXISTS(SELECT 1 FROM bunbun_accounting.sale_postings WHERE cogs_status<>'POSTED')
 THEN RAISE EXCEPTION 'Imported actual sale did not reconcile exact cafe lot COGS'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.accounting_cafe_ledger_service('inspect','{}','2375b60c-c418-47c2-b157-af80b262fadf');RAISE EXCEPTION 'Browser reached ledger bridge';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: actual sold report -> exact net revenue, existing sale link without duplicate, full 80+40 net receipt despite 70% metadata, source/revision locks, retries, no physical/cashbook duplicate, pending COGS blocks close; actual cafe lot COGS 40 leaves inventory20/profit80' result;
