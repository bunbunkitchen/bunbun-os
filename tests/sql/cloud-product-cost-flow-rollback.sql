-- Synthetic source-backed lifecycle only; every row rolled back.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM bunbun_accounting.journals) THEN RAISE EXCEPTION 'Empty test ledger required'; END IF; END $$;
INSERT INTO public.products(id,sku,nama) OVERRIDING SYSTEM VALUE VALUES(920001,'LOCAL-FLOW','Synthetic flow product');
INSERT INTO public.recipes(id,kode,nama,yield_qty,product_id) OVERRIDING SYSTEM VALUE VALUES(920001,'LOCAL-FLOW','Synthetic recipe',10,920001);
INSERT INTO public.production_orders(id,kode,tanggal,recipe_id,target_produksi) OVERRIDING SYSTEM VALUE VALUES(920001,'LOCAL-FLOW','2026-11-01',920001,20);
INSERT INTO public.production_batches(id,kode,production_order_id,target,status,inventory_consumed,created_at) OVERRIDING SYSTEM VALUE
 VALUES(920001,'LOCAL-FLOW-1',920001,10,'Finished',true,'2026-11-01'),(920002,'LOCAL-FLOW-2',920001,10,'Finished',true,'2026-11-01');
INSERT INTO public.inventory_transactions(id,transaction_date,transaction_type,ingredient_id,production_batch_id,qty,unit) OVERRIDING SYSTEM VALUE
 SELECT 920001,'2026-11-01','PRODUCTION_OUT',min(id),920001,10,'g' FROM public.ingredients;
INSERT INTO public.inventory_transactions(id,transaction_date,transaction_type,ingredient_id,production_batch_id,qty,unit) OVERRIDING SYSTEM VALUE
 SELECT 920002,'2026-11-01','PRODUCTION_OUT',min(id),920002,10,'g' FROM public.ingredients;
INSERT INTO public.production_batch_splits(id,production_batch_id,product_id,route,qty,status,baked_good_qty) OVERRIDING SYSTEM VALUE
 VALUES(920001,920001,920001,'FROZEN',10,'FROZEN',0),(920002,920002,920001,'DIRECT',10,'BAKED',10);
INSERT INTO public.production_batch_splits(id,production_batch_id,product_id,source_split_id,route,qty,status,baked_good_qty,baked_reject_qty) OVERRIDING SYSTEM VALUE
 VALUES(920003,920001,920001,920001,'DIRECT',6,'BAKED',5,1),(920004,920001,920001,920001,'DIRECT',2,'BAKED',0,2);
INSERT INTO public.sales(id,sale_date,sales_channel,total_amount) VALUES(920001,'2026-11-07','PUBLIC_HUB',80),(920002,'2026-11-08','DIRECT',40);
INSERT INTO public.sale_items(sale_id,product_id,product_name,quantity,selling_price,subtotal,order_type)
 VALUES(920001,920001,'Synthetic product',4,20,80,'TAKE_AWAY'),(920002,920001,'Synthetic product',2,20,40,'TAKE_AWAY');
INSERT INTO public.incomes(id,tanggal,total_penjualan,persentase_bunbun,pemasukan_bunbun,asal_setoran) OVERRIDING SYSTEM VALUE
 VALUES(920001,'2026-11-15',120,70,120,'LOCAL-NET-RECEIPT');
INSERT INTO public.product_stock_movements(id,movement_date,movement_type,product_id,batch_split_id,qty,operation_key,sale_id) OVERRIDING SYSTEM VALUE
 VALUES(920001,'2026-11-02','FROZEN_IN',920001,920001,10,gen_random_uuid(),null),
 (920002,'2026-11-02','FINISHED_IN',920001,920002,10,gen_random_uuid(),null),
 (920003,'2026-11-04','FROZEN_OUT',920001,920001,6,gen_random_uuid(),null),
 (920004,'2026-11-05','FINISHED_IN',920001,920003,5,gen_random_uuid(),null),
 (920005,'2026-11-06','CAFE_OUT',920001,null,6,gen_random_uuid(),null),
 (920006,'2026-11-08','CAFE_OUT',920001,null,2,gen_random_uuid(),920002),
 (920007,'2026-11-09','CAFE_IN',920001,null,1,gen_random_uuid(),null),
 (920008,'2026-11-10','ADJUSTMENT_OUT',920001,null,1,gen_random_uuid(),null),
 (920009,'2026-11-11','FROZEN_OUT',920001,920001,2,gen_random_uuid(),null);
INSERT INTO bunbun_accounting.periods(id,month_start,cutover_on,status,approved_by,approved_at)
 VALUES('92000000-0000-4000-8000-000000000001','2026-11-01','2026-11-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET LOCAL ROLE service_role;
DO $$
DECLARE actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; opening uuid:=gen_random_uuid(); p jsonb; q jsonb; s jsonb; r jsonb; retry jsonb; n bigint;
BEGIN
 INSERT INTO bunbun_accounting.opening_snapshots(period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at)
 VALUES('92000000-0000-4000-8000-000000000001','2026-11-01','{"synthetic_only":true}','LOCAL-FLOW-OPENING','APPROVED',actor,now());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(opening,'92000000-0000-4000-8000-000000000001','2026-11-01','OPENING','LOCAL-FLOW-OPENING',gen_random_uuid());
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit) VALUES(opening,1,'1210',200,0),(opening,2,'1020',1000,0),(opening,3,'3000',0,1200);
 INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,ingredient_id,valuation_class,quantity_base,value_delta,base_unit)
 SELECT opening,'LOCAL-FLOW-OPENING',min(id),'RAW',20,200,'g' FROM public.ingredients;
 PERFORM bunbun_accounting.post_reviewed_journal(opening,actor);
 FOREACH n IN ARRAY ARRAY[920001,920002]::bigint[] LOOP
   s:=public.accounting_material_service('review',jsonb_build_object('transactionId',n::text),actor);
   PERFORM public.accounting_material_service('post',jsonb_build_object('transactionId',n::text,'sourceSnapshot',s->>'sourceSnapshot','usageConfirmed',true,'evidenceRef','LOCAL-FLOW-MATERIAL','operationKey',gen_random_uuid()),actor);
   p:=jsonb_build_object('batchId',n::text,'date','2026-11-03','allCostsConfirmed',true,'zeroLaborConfirmed',true,'zeroOverheadConfirmed',true,
     'lossPolicy','ABSORB_NORMAL_LOSS','rejectCost','0','lotCosts',jsonb_build_array(jsonb_build_object('splitId',n::text,'amount','100')),'evidenceRef','SYNTHETIC-ZERO-LABOR-OH');
   s:=public.accounting_production_service('review_completion',p,actor);
   PERFORM public.accounting_production_service('post_completion',p||jsonb_build_object('sourceSnapshot',s->>'sourceSnapshot','operationKey',gen_random_uuid()),actor);
 END LOOP;
 FOREACH n IN ARRAY ARRAY[920001,920002]::bigint[] LOOP
   s:=public.accounting_revenue_service('review_sale',jsonb_build_object('saleId',n::text),actor);
   PERFORM public.accounting_revenue_service('post_sale',jsonb_build_object('saleId',n::text,'recordedBasis','NET_BUNBUN',
     'netEntitlement',CASE WHEN n=920001 THEN '80' ELSE '40' END,'soldConfirmed',true,'sourceSnapshot',s->>'sourceSnapshot','evidenceRef','LOCAL-ACTUAL-SOLD-PROOF','operationKey',gen_random_uuid()),actor);
 END LOOP;
 FOR p IN SELECT x FROM jsonb_array_elements('[
  {"kind":"THAW","movementId":"920003","derivedSplitId":"920003","date":"2026-11-04","cafeKey":"","lossPolicy":"NONE","rejectCost":"0","allocations":[{"splitId":"920001","location":"FROZEN","cafeKey":"","quantity":"6"}]},
  {"kind":"BAKE","movementId":"920004","derivedSplitId":"920003","date":"2026-11-05","cafeKey":"","lossPolicy":"SEPARATE_ABNORMAL_LOSS","rejectCost":"10","allocations":[{"splitId":"920003","location":"PROOFING","cafeKey":"","quantity":"6"}]},
  {"kind":"SHIP","movementId":"920005","date":"2026-11-06","cafeKey":"PUBLIC_HUB","lossPolicy":"NONE","rejectCost":"0","allocations":[{"splitId":"920002","location":"FINISHED","cafeKey":"","quantity":"6"}]},
  {"kind":"SALE","saleId":"920001","date":"2026-11-07","cafeKey":"PUBLIC_HUB","lossPolicy":"NONE","rejectCost":"0","allocations":[{"splitId":"920002","location":"CONSIGNMENT","cafeKey":"PUBLIC_HUB","quantity":"4"}]},
  {"kind":"SALE","saleId":"920002","date":"2026-11-08","cafeKey":"","lossPolicy":"NONE","rejectCost":"0","allocations":[{"splitId":"920003","location":"FINISHED","cafeKey":"","quantity":"2"}]},
  {"kind":"RETURN","movementId":"920007","date":"2026-11-09","cafeKey":"PUBLIC_HUB","lossPolicy":"NONE","rejectCost":"0","allocations":[{"splitId":"920002","location":"CONSIGNMENT","cafeKey":"PUBLIC_HUB","quantity":"1"}]},
  {"kind":"WASTE","movementId":"920008","date":"2026-11-10","cafeKey":"","lossPolicy":"NONE","rejectCost":"0","allocations":[{"splitId":"920003","location":"FINISHED","cafeKey":"","quantity":"1"}]},
  {"kind":"THAW","movementId":"920009","derivedSplitId":"920004","date":"2026-11-11","cafeKey":"","lossPolicy":"NONE","rejectCost":"0","allocations":[{"splitId":"920001","location":"FROZEN","cafeKey":"","quantity":"2"}]},
  {"kind":"BAKE","movementId":null,"derivedSplitId":"920004","sourceDate":"2026-11-12","date":"2026-11-12","cafeKey":"","lossPolicy":"SEPARATE_ABNORMAL_LOSS","rejectCost":"20","allocations":[{"splitId":"920004","location":"PROOFING","cafeKey":"","quantity":"2"}]}
 ]'::jsonb) x LOOP
   p:=p||'{"traceConfirmed":true,"evidenceRef":"LOCAL-FLOW-TRACE-PROOF"}';
   p:=p||jsonb_build_object('noAdditionalBakingCostConfirmed',p->>'kind'='BAKE');
   IF p->>'kind'='BAKE' THEN
     BEGIN PERFORM public.accounting_product_flow_service('review',p||'{"noAdditionalBakingCostConfirmed":false}',actor); RAISE EXCEPTION 'Unknown baking overhead treated as zero';
     EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Unknown additional baking labor/overhead must not be treated as zero' THEN RAISE; END IF; END;
   END IF;
   IF p->>'kind'='SHIP' THEN
     BEGIN PERFORM public.accounting_product_flow_service('review',p||'{"allocations":[{"splitId":"920002","location":"FINISHED","cafeKey":"","quantity":"7"}]}',actor); RAISE EXCEPTION 'Shipment quantities changed';
     EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Product lot quantities must equal source movement' THEN RAISE; END IF; END;
     IF to_regclass('bunbun_accounting.lot_release_operations') IS NOT NULL THEN
       BEGIN
         INSERT INTO bunbun_accounting.finished_lot_positions(lot_key,product_id,source_type,source_split_id,first_available_on,source_evidence,approved_by,approved_at,original_qty,available_qty)
           VALUES('split:920002',920001,'DIRECT_RELEASE',920002,'2026-11-02','LOCAL-TRACKED-PROOF',actor,now(),10,10);
         INSERT INTO bunbun_accounting.lot_release_operations(operation_key,payload_fingerprint,movement_date,destination,destination_type,evidence_ref,status,actor_id)
           SELECT operation_key,repeat('0',32),movement_date,'The Public Coffee','CAFE_CONSIGNMENT','LOCAL-TRACKED-PROOF','RECORDED',actor FROM public.product_stock_movements WHERE id=920005;
         INSERT INTO bunbun_accounting.lot_release_allocations(operation_key,stock_movement_id,lot_key,product_id,qty)
           SELECT operation_key,id,'split:920002',920001,6 FROM public.product_stock_movements WHERE id=920005;
         PERFORM public.accounting_product_flow_service('review',p,actor);
         RAISE EXCEPTION 'Owner overrode recorded operational cafe identity';
       EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Tracked shipment cafe identity differs' THEN RAISE; END IF; END;
     END IF;
   END IF;
   IF p->>'kind'='SALE' AND p->>'saleId'='920001' THEN
     BEGIN PERFORM public.accounting_product_flow_service('review',p||'{"cafeKey":"PUBLIC_COFFEE"}',actor); RAISE EXCEPTION 'Cafe receivable mixed';
     EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Sale cafe identity differs' THEN RAISE; END IF; END;
   END IF;
   s:=public.accounting_product_flow_service('review',p,actor);
   IF (s->>'mayConfirm')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Valid cost flow blocked: %',s; END IF;
   q:=p||jsonb_build_object('sourceSnapshot',s->>'sourceSnapshot','operationKey',gen_random_uuid());
   BEGIN
     PERFORM public.accounting_product_flow_service('post',q||'{"sourceSnapshot":"stale"}',actor); RAISE EXCEPTION 'Stale position posted';
   EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Product cost source or position changed since review' THEN RAISE; END IF; END;
   r:=public.accounting_product_flow_service('post',q,actor); retry:=public.accounting_product_flow_service('post',q,actor);
   IF r->>'journalId' IS DISTINCT FROM retry->>'journalId' OR retry->>'alreadyProcessed'<>'true' THEN RAISE EXCEPTION 'Product flow duplicated'; END IF;
   IF p->>'kind'='SHIP' AND (SELECT sum(debit) FROM bunbun_accounting.v_posted_lines WHERE account_code='5010') IS NOT NULL THEN RAISE EXCEPTION 'Shipment recognized COGS'; END IF;
 END LOOP;
 s:=public.accounting_revenue_service('review_income','{"incomeId":"920001"}',actor);
 PERFORM public.accounting_revenue_service('post_income',jsonb_build_object('incomeId','920001','sourceSnapshot',s->>'sourceSnapshot','cashAccount','1020','allocationConfirmed',true,
   'allocations','[{"saleId":"920001","amount":"80"},{"saleId":"920002","amount":"40"}]'::jsonb,'evidenceRef','LOCAL-NET-DEPOSIT','operationKey',gen_random_uuid()),actor);
 IF (SELECT sum(actual_value) FROM bunbun_accounting.product_cost_positions)<>100
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='5010')<>60
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='6070')<>40
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1215')<>0
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1120')<>0
 OR (SELECT net_profit FROM bunbun_accounting.v_monthly_profit_loss WHERE month='2026-11-01')<>20
 OR (SELECT closing_cash FROM bunbun_accounting.v_monthly_cash_flow WHERE month='2026-11-01')<>1120
 OR (SELECT count(*) FROM public.product_stock_movements)<>9
 OR (SELECT count(*) FROM public.inventory_transactions)<>2
 OR EXISTS(SELECT 1 FROM bunbun_accounting.sale_postings WHERE cogs_status<>'POSTED')
 THEN RAISE EXCEPTION 'Cost/cash/stock conservation, actual sold COGS or net deposit invariant failed'; END IF;
 BEGIN
   UPDATE public.product_stock_movements SET qty=7 WHERE id=920005; RAISE EXCEPTION 'Valued shipment source changed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Valued product stock source is immutable' THEN RAISE; END IF; END;
 BEGIN
   UPDATE public.production_batch_splits SET baked_good_qty=1 WHERE id=920004; RAISE EXCEPTION 'Costed all-reject bake changed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Costed frozen baking source is immutable' THEN RAISE; END IF; END;
 s:=public.accounting_revenue_service('cost_readiness','{"month":"2026-11"}',actor);
 IF (s->>'soldCostsComplete')::boolean IS DISTINCT FROM true OR (s->>'productCostsComplete')::boolean IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Reconciled cost readiness wrong: %',s; END IF;
 s:=public.accounting_product_flow_service('inspect','{}',actor);
 IF jsonb_array_length(s->'positions')<>4 OR jsonb_array_length(s->'sales')<>0 THEN RAISE EXCEPTION 'Owner inspection positions or pending sale list wrong'; END IF;
 UPDATE bunbun_accounting.periods SET status='CLOSED' WHERE id='92000000-0000-4000-8000-000000000001';
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.accounting_product_flow_service('inspect','{}','2375b60c-c418-47c2-b157-af80b262fadf'); RAISE EXCEPTION 'Browser reached private cost flow'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: actual frozen->proofing->baked, all rejects, cafe consignment/sold/unsold return, direct sold, finished waste, exact value/cash conservation and immutable sources' result;
