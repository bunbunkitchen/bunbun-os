-- Entirely synthetic; run on empty isolated ledger, all rows rolled back.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM bunbun_accounting.journals) THEN RAISE EXCEPTION 'Requires empty ledger'; END IF; END $$;
INSERT INTO public.products(id,sku,nama) OVERRIDING SYSTEM VALUE VALUES(910001,'LOCAL-PROD','Synthetic product');
INSERT INTO public.recipes(id,kode,nama,yield_qty,product_id) OVERRIDING SYSTEM VALUE VALUES(910001,'LOCAL-PROD','Synthetic recipe',5,910001);
INSERT INTO public.production_orders(id,kode,tanggal,recipe_id,target_produksi) OVERRIDING SYSTEM VALUE VALUES(910001,'LOCAL-PROD','2026-11-01',910001,10);
INSERT INTO public.production_batches(id,kode,production_order_id,target,status,inventory_consumed,created_at) OVERRIDING SYSTEM VALUE
 VALUES(910001,'LOCAL-PROD-1',910001,5,'Finished',true,'2026-11-01'),(910002,'LOCAL-PROD-2',910001,5,'Finished',true,'2026-11-01');
INSERT INTO public.inventory_transactions(id,transaction_date,transaction_type,ingredient_id,production_batch_id,qty,unit) OVERRIDING SYSTEM VALUE
 SELECT 910001,'2026-11-02','PRODUCTION_OUT',min(id),910001,5,'g' FROM public.ingredients;
INSERT INTO public.inventory_transactions(id,transaction_date,transaction_type,ingredient_id,production_batch_id,qty,unit) OVERRIDING SYSTEM VALUE
 SELECT 910002,'2026-11-03','PRODUCTION_OUT',min(id),910002,5,'g' FROM public.ingredients;
INSERT INTO public.production_batch_splits(id,production_batch_id,product_id,route,qty,status,baked_good_qty,baked_reject_qty) OVERRIDING SYSTEM VALUE
 VALUES(910001,910001,910001,'DIRECT',3,'BAKED',2,1),(910002,910001,910001,'FROZEN',2,'FROZEN',0,0),(910003,910002,910001,'DIRECT',5,'BAKED',5,0);
INSERT INTO public.product_stock_movements(id,movement_date,movement_type,product_id,batch_split_id,qty,operation_key) OVERRIDING SYSTEM VALUE
 VALUES(910001,'2026-11-03','FINISHED_IN',910001,910001,2,gen_random_uuid()),(910002,'2026-11-03','FROZEN_IN',910001,910002,2,gen_random_uuid()),(910003,'2026-11-03','FINISHED_IN',910001,910003,5,gen_random_uuid());
INSERT INTO public.expenses(id,tanggal,kategori,nominal) OVERRIDING SYSTEM VALUE
 VALUES(910001,'2026-11-01','Gaji',30),(910002,'2026-11-01','Utilitas',20);
INSERT INTO bunbun_accounting.periods(id,month_start,cutover_on,status,approved_by,approved_at)
 VALUES('91000000-0000-4000-8000-000000000001','2026-11-01','2026-11-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET LOCAL ROLE service_role;
DO $$
DECLARE actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; opening uuid:=gen_random_uuid(); p jsonb; s jsonb; q jsonb;
 r jsonb; retry jsonb; src public.expenses%rowtype; tid bigint; i integer;
BEGIN
 INSERT INTO bunbun_accounting.opening_snapshots(period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at)
 VALUES('91000000-0000-4000-8000-000000000001','2026-11-01','{"test_only":true}','LOCAL-PROD-OPENING','APPROVED',actor,now());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(opening,'91000000-0000-4000-8000-000000000001','2026-11-01','OPENING','LOCAL-PROD-OPENING',gen_random_uuid());
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
 VALUES(opening,1,'1210',100,0),(opening,2,'1020',1000,0),(opening,3,'3000',0,1100);
 INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,ingredient_id,valuation_class,quantity_base,value_delta,base_unit)
 SELECT opening,'LOCAL-PROD-OPENING',min(id),'RAW',10,100,'g' FROM public.ingredients;
 PERFORM bunbun_accounting.post_reviewed_journal(opening,actor);
 FOREACH tid IN ARRAY ARRAY[910001,910002]::bigint[] LOOP
   s:=public.accounting_material_service('review',jsonb_build_object('transactionId',tid::text),actor);
   PERFORM public.accounting_material_service('post',jsonb_build_object('transactionId',tid::text,'sourceSnapshot',s->>'sourceSnapshot',
     'usageConfirmed',true,'evidenceRef','LOCAL-PROD-MATERIAL','operationKey',gen_random_uuid()),actor);
 END LOOP;
 s:=public.accounting_production_service('review_completion','{"batchId":"910001","date":"2026-11-04","allCostsConfirmed":true,"zeroLaborConfirmed":false,"zeroOverheadConfirmed":false,"lossPolicy":"ABSORB_NORMAL_LOSS","rejectCost":"0","lotCosts":[{"splitId":"910001","amount":"25"},{"splitId":"910002","amount":"25"}]}',actor);
 IF (s->>'mayConfirm')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Missing labor and overhead silently treated as zero'; END IF;
 p:='{"expenseId":"910001","batchId":"910001","amount":"20","date":"2026-11-03","cashAccount":"1020","costKind":"LABOR","productionConfirmed":true,"evidenceRef":"LOCAL-PROD-LABOR"}';
 BEGIN
   PERFORM public.accounting_production_service('review_cost',p,gen_random_uuid()); RAISE EXCEPTION 'Wrong actor';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Active Owner approval required' THEN RAISE; END IF; END;
 s:=public.accounting_production_service('review_cost',p,actor);
 IF (s->>'mayConfirm')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Valid source allocation blocked: %',s; END IF;
 q:=p||jsonb_build_object('sourceSnapshot',s->>'sourceSnapshot','operationKey',gen_random_uuid());
 BEGIN
   PERFORM public.accounting_production_service('post_cost',q||'{"sourceSnapshot":"stale"}',actor); RAISE EXCEPTION 'Stale allocation accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Production source or allocation balance changed since review' THEN RAISE; END IF; END;
 r:=public.accounting_production_service('post_cost',q,actor);
 retry:=public.accounting_production_service('post_cost',q,actor);
 IF r->>'journalId' IS DISTINCT FROM retry->>'journalId' OR retry->>'alreadyProcessed'<>'true' THEN RAISE EXCEPTION 'Duplicate cash/allocation'; END IF;
 s:=public.accounting_production_service('review_cost',p||'{"batchId":"910002","amount":"11"}',actor);
 IF (s->>'mayConfirm')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Production expense overallocated'; END IF;
 BEGIN
   UPDATE public.expenses SET nominal=31 WHERE id=910001; RAISE EXCEPTION 'Production source changed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Allocated production expense is immutable; reviewed correction required' THEN RAISE; END IF; END;
 SELECT * INTO src FROM public.expenses WHERE id=910001;
 BEGIN
   PERFORM public.accounting_expense_service('post',jsonb_build_object('expenseId','910001','sourceSnapshot',to_jsonb(src)::text,
     'costScope','PERIOD_NONPRODUCTION','expenseAccount','6010','cashAccount','1020','nonProductionConfirmed',true,'evidenceRef','LOCAL-DOUBLE-EXPENSE','operationKey',gen_random_uuid()),actor);
   RAISE EXCEPTION 'Production payment also expensed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Production expense cannot also become a period expense' THEN RAISE; END IF; END;
 BEGIN
   UPDATE bunbun_accounting.periods SET status='CLOSED' WHERE id='91000000-0000-4000-8000-000000000001';
   RAISE EXCEPTION 'Unallocated cost pool closed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Production costs or completed batch valuation require reconciliation before close' THEN RAISE; END IF; END;
 FOR i IN 1..3 LOOP
   p:=CASE i WHEN 1 THEN p||'{"batchId":"910002","amount":"10"}'
     WHEN 2 THEN p||'{"batchId":"910001","expenseId":"910002","amount":"10","costKind":"OVERHEAD"}'
     ELSE p||'{"batchId":"910002","expenseId":"910002","amount":"10","costKind":"OVERHEAD"}' END;
   s:=public.accounting_production_service('review_cost',p,actor);
   PERFORM public.accounting_production_service('post_cost',p||jsonb_build_object('sourceSnapshot',s->>'sourceSnapshot','operationKey',gen_random_uuid()),actor);
 END LOOP;
 p:='{"batchId":"910001","date":"2026-11-04","allCostsConfirmed":true,"zeroLaborConfirmed":false,"zeroOverheadConfirmed":false,"lossPolicy":"SEPARATE_ABNORMAL_LOSS","rejectCost":"5","lotCosts":[{"splitId":"910001","amount":"35"},{"splitId":"910002","amount":"40"}],"evidenceRef":"LOCAL-PROD-COMPLETE"}';
 s:=public.accounting_production_service('review_completion',p||'{"rejectCost":"0"}',actor);
 IF (s->>'mayConfirm')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Lost costs disappeared'; END IF;
 s:=public.accounting_production_service('review_completion',p,actor);
 IF (s->>'mayConfirm')::boolean IS DISTINCT FROM true OR (s->>'totalCost')::numeric<>80 THEN RAISE EXCEPTION 'Completion review wrong: %',s; END IF;
 q:=p||jsonb_build_object('sourceSnapshot',s->>'sourceSnapshot','operationKey',gen_random_uuid());
 r:=public.accounting_production_service('post_completion',q,actor);
 retry:=public.accounting_production_service('post_completion',q,actor);
 IF retry->>'alreadyProcessed'<>'true' OR r->>'journalId' IS DISTINCT FROM retry->>'journalId' THEN RAISE EXCEPTION 'Completion repeated'; END IF;
 BEGIN
   UPDATE public.production_batch_splits SET qty=4 WHERE id=910001; RAISE EXCEPTION 'Valued split changed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Valued root production split is immutable' THEN RAISE; END IF; END;
 BEGIN
   UPDATE public.product_stock_movements SET qty=3 WHERE id=910001; RAISE EXCEPTION 'Valued receipt changed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Valued production receipt is immutable' THEN RAISE; END IF; END;
 p:=p||'{"batchId":"910002","lossPolicy":"ABSORB_NORMAL_LOSS","rejectCost":"0","lotCosts":[{"splitId":"910003","amount":"70"}]}';
 s:=public.accounting_production_service('review_completion',p,actor);
 PERFORM public.accounting_production_service('post_completion',p||jsonb_build_object('sourceSnapshot',s->>'sourceSnapshot','operationKey',gen_random_uuid()),actor);
 IF (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1215')<>0
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1290')<>0
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1220')<>105
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1230')<>40
 OR (SELECT net_profit FROM bunbun_accounting.v_monthly_profit_loss WHERE month='2026-11-01')<>-5
 OR (SELECT closing_cash FROM bunbun_accounting.v_monthly_cash_flow WHERE month='2026-11-01')<>950
 OR (SELECT count(*) FROM public.product_stock_movements)<>3
 OR (SELECT count(*) FROM public.inventory_transactions)<>2
 OR (SELECT count(*) FROM bunbun_accounting.production_cost_sources)<>2
 OR (SELECT count(*) FROM bunbun_accounting.production_completions)<>2
 THEN RAISE EXCEPTION 'Production value, cash, loss or no-double-stock invariant failed'; END IF;
 s:=public.accounting_production_service('inspect_batch','{"batchId":"910001"}',actor);
 IF (s->>'completed')::boolean IS DISTINCT FROM true OR jsonb_array_length(s->'valuedLots')<>2
 THEN RAISE EXCEPTION 'Posted lot values not available for Owner inspection'; END IF;
 -- Later frozen conversion is a separate cost transfer, not new production.
 INSERT INTO public.production_batch_splits(id,production_batch_id,product_id,source_split_id,route,qty,status,baked_good_qty,baked_reject_qty) OVERRIDING SYSTEM VALUE
 VALUES(910004,910001,910001,910002,'DIRECT',1,'BAKED',1,0);
 INSERT INTO public.product_stock_movements(movement_date,movement_type,product_id,batch_split_id,qty,operation_key)
 VALUES('2026-11-05','FROZEN_OUT',910001,910002,1,gen_random_uuid()),('2026-11-05','FINISHED_IN',910001,910004,1,gen_random_uuid());
 IF (SELECT count(*) FROM bunbun_accounting.production_lot_values)<>3
 THEN RAISE EXCEPTION 'Derived frozen output duplicated root production cost'; END IF;
 BEGIN
   UPDATE bunbun_accounting.periods SET status='CLOSED' WHERE id='91000000-0000-4000-8000-000000000001';
   RAISE EXCEPTION 'Unvalued frozen conversion closed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Product cost movements require reconciliation before close' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.accounting_production_service('inspect_batch','{"batchId":"910001"}','2375b60c-c418-47c2-b157-af80b262fadf');
 RAISE EXCEPTION 'Browser reached private costs'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: source expense allocation, no duplicate cash/expense, exact root finished/frozen/reject valuation, WIP conservation, immutable sources and close gates' result;
