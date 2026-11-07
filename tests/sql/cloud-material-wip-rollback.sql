-- Actual source schema, SYNTHETIC financial amounts, disposable/local or EMPTY staging only.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM bunbun_accounting.journals) OR EXISTS(SELECT 1 FROM public.production_batches)
 THEN RAISE EXCEPTION 'Requires empty test ledger/batches'; END IF; END $$;
INSERT INTO public.recipes(id,kode,nama,yield_qty) OVERRIDING SYSTEM VALUE VALUES(908001,'LOCAL-MATERIAL','Synthetic recipe',1);
INSERT INTO public.production_orders(id,kode,tanggal,recipe_id,target_produksi) OVERRIDING SYSTEM VALUE
 VALUES(908001,'LOCAL-MATERIAL','2026-11-01',908001,3);
INSERT INTO public.production_batches(id,kode,production_order_id,target,status,inventory_consumed,created_at) OVERRIDING SYSTEM VALUE
 VALUES(908001,'LOCAL-MATERIAL-1',908001,1,'Finished',true,'2026-11-01'),
 (908002,'LOCAL-MATERIAL-2',908001,1,'Finished',true,'2026-11-01'),(908003,'LOCAL-MATERIAL-3',908001,1,'Finished',true,'2026-11-01');
INSERT INTO public.inventory_transactions(id,transaction_date,transaction_type,ingredient_id,production_batch_id,qty,unit)
 OVERRIDING SYSTEM VALUE SELECT 908001,'2026-11-02','PRODUCTION_OUT',min(id),908001,1,'g' FROM public.ingredients;
INSERT INTO public.purchases(id,tanggal,ingredient_id,jumlah,satuan,harga_satuan,total) OVERRIDING SYSTEM VALUE
 SELECT 908002,'2026-11-03',min(id),1,'g',2,2 FROM public.ingredients;
INSERT INTO public.expenses(id,tanggal,kategori,nominal,purchase_id) OVERRIDING SYSTEM VALUE
 VALUES(908002,'2026-11-03','Bahan Baku',2,908002);
INSERT INTO public.inventory_transactions(id,transaction_date,transaction_type,ingredient_id,qty,unit,purchase_id)
 OVERRIDING SYSTEM VALUE SELECT 908002,'2026-11-03','PURCHASE',ingredient_id,1,'g',908002 FROM public.purchases WHERE id=908002;
INSERT INTO public.inventory_transactions(id,transaction_date,transaction_type,ingredient_id,production_batch_id,qty,unit)
 OVERRIDING SYSTEM VALUE SELECT 908003,'2026-11-04','PRODUCTION_OUT',min(id),908002,1,'g' FROM public.ingredients;
INSERT INTO public.inventory_transactions(id,transaction_date,transaction_type,ingredient_id,production_batch_id,qty,unit)
 OVERRIDING SYSTEM VALUE SELECT 908004,'2026-11-04','PRODUCTION_OUT',min(id),908003,2,'g' FROM public.ingredients;
INSERT INTO public.ingredients(kode,nama,kategori,satuan,harga) VALUES('LOCAL-MATERIAL-EXTRA','Synthetic second material','TEST','g',999);
INSERT INTO public.inventory_transactions(id,transaction_date,transaction_type,ingredient_id,production_batch_id,qty,unit)
 OVERRIDING SYSTEM VALUE SELECT 908005,'2026-11-05','PRODUCTION_OUT',id,908001,1,'g' FROM public.ingredients WHERE kode='LOCAL-MATERIAL-EXTRA';
INSERT INTO bunbun_accounting.periods(id,month_start,cutover_on,status,approved_by,approved_at)
 VALUES('90800000-0000-4000-8000-000000000001','2026-11-01','2026-11-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET LOCAL ROLE service_role;
DO $$
DECLARE actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; opening uuid:=gen_random_uuid(); p jsonb; s jsonb; result jsonb; retry jsonb;
 iid bigint; invoice jsonb; payment jsonb; before_count integer;
BEGIN
 SELECT min(id) INTO iid FROM public.ingredients;
 s:=public.accounting_material_service('review','{"transactionId":"908001"}',actor);
 IF (s->>'mayConfirm')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Missing opening accepted'; END IF;
 INSERT INTO bunbun_accounting.opening_snapshots(period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at)
 VALUES('90800000-0000-4000-8000-000000000001','2026-11-01','{"synthetic_only":true}','LOCAL-MATERIAL-OPENING','APPROVED',actor,now());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(opening,'90800000-0000-4000-8000-000000000001','2026-11-01','OPENING','LOCAL-MATERIAL-OPENING',gen_random_uuid());
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
 VALUES(opening,1,'1210',1,0),(opening,2,'3000',0,1);
 INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,ingredient_id,valuation_class,quantity_base,value_delta,base_unit)
 VALUES(opening,'LOCAL-MATERIAL-OPENING',iid,'RAW',3,1,'g');
 PERFORM bunbun_accounting.post_reviewed_journal(opening,actor);
 BEGIN
   INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,ingredient_id,valuation_class,quantity_base,value_delta,base_unit)
   VALUES(opening,'LOCAL-NONFINITE-COST',iid,'RAW',0,'NaN','g');
   s:=public.accounting_material_service('review','{"transactionId":"908001"}',actor);
   IF (s->>'mayConfirm')::boolean IS DISTINCT FROM false OR s->>'actualMaterialCost' IS NOT NULL
   THEN RAISE EXCEPTION 'Nonfinite material cost accepted'; END IF;
   RAISE EXCEPTION 'TEST_ROLLBACK';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'TEST_ROLLBACK' THEN RAISE; END IF; END;
 BEGIN
   UPDATE bunbun_accounting.periods SET status='CLOSED' WHERE id='90800000-0000-4000-8000-000000000001';
   s:=public.accounting_material_service('review','{"transactionId":"908001"}',actor);
   IF (s->>'mayConfirm')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Closed period accepted'; END IF;
   RAISE EXCEPTION 'TEST_ROLLBACK';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'TEST_ROLLBACK' THEN RAISE; END IF; END;
 UPDATE public.inventory_transactions SET qty=4 WHERE id=908001;
 s:=public.accounting_material_service('review','{"transactionId":"908001"}',actor);
 IF (s->>'mayConfirm')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Insufficient material quantity accepted'; END IF;
 UPDATE public.inventory_transactions SET qty=1,unit='ml' WHERE id=908001;
 s:=public.accounting_material_service('review','{"transactionId":"908001"}',actor);
 IF (s->>'mayConfirm')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Incompatible unit accepted'; END IF;
 UPDATE public.inventory_transactions SET unit='g' WHERE id=908001;
 s:=public.accounting_material_service('review','{"transactionId":"908003"}',actor);
 IF (s->>'mayConfirm')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Unvalued prior material/purchase accepted'; END IF;
 s:=public.accounting_material_service('review','{"transactionId":"908001"}',actor);
 IF (s->>'mayConfirm')::boolean IS DISTINCT FROM true OR (s->>'actualMaterialCost')::numeric<>0.33
 THEN RAISE EXCEPTION 'Weighted material preview wrong'; END IF;
 p:=jsonb_build_object('transactionId','908001','sourceSnapshot',s->>'sourceSnapshot','usageConfirmed',true,
   'evidenceRef','LOCAL-MATERIAL-USE-1','operationKey',gen_random_uuid());
 BEGIN
   PERFORM public.accounting_material_service('post',p,gen_random_uuid()); RAISE EXCEPTION 'Wrong Owner accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Active Owner approval required' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.accounting_material_service('post',p||'{"sourceSnapshot":"stale"}',actor); RAISE EXCEPTION 'Stale review accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Material source or cost pool changed since review' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.accounting_material_service('post',p||'{"usageConfirmed":false}',actor); RAISE EXCEPTION 'Unverified use accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Verified material usage, evidence and operation required' THEN RAISE; END IF; END;
 result:=public.accounting_material_service('post',p,actor);
 BEGIN
   UPDATE public.inventory_transactions SET production_batch_id=908002 WHERE id=908005;
   RAISE EXCEPTION 'Unvalued material moved out of frozen batch';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Batch with valued material usage is immutable' THEN RAISE; END IF; END;
 BEGIN
   -- A new pool cannot be silently inserted into a consumed historical day.
   INSERT INTO public.inventory_transactions(transaction_date,transaction_type,ingredient_id,qty,unit)
   VALUES('2026-11-01','ADJUSTMENT_IN',iid,100,'g');
   RAISE EXCEPTION 'Backdated adjustment accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Backdated material movement requires downstream revaluation' THEN RAISE; END IF; END;
 retry:=public.accounting_material_service('post',p,actor);
 IF result->>'journalId' IS DISTINCT FROM retry->>'journalId' OR retry->>'alreadyProcessed'<>'true'
 THEN RAISE EXCEPTION 'Material duplicated on retry'; END IF;
 BEGIN
   PERFORM public.accounting_material_service('post',p||'{"evidenceRef":"DIFFERENT-PROOF"}',actor); RAISE EXCEPTION 'Changed replay accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Material operation reused with different request' THEN RAISE; END IF; END;
 BEGIN
   UPDATE public.inventory_transactions SET qty=2 WHERE id=908001; RAISE EXCEPTION 'Valued source changed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Valued material history is immutable; downstream revaluation required' THEN RAISE; END IF; END;
 BEGIN
   UPDATE public.production_batches SET status='Waiting' WHERE id=908001; RAISE EXCEPTION 'Valued batch changed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Batch with valued material usage is immutable' THEN RAISE; END IF; END;
 BEGIN
   INSERT INTO public.inventory_transactions(transaction_date,transaction_type,ingredient_id,qty,unit)
   VALUES('2026-11-01','ADJUSTMENT_IN',iid,1,'g'); RAISE EXCEPTION 'Backdated source changed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Backdated material movement requires downstream revaluation' THEN RAISE; END IF; END;
 SELECT to_jsonb(x) INTO invoice FROM public.purchases x WHERE id=908002;
 SELECT to_jsonb(x) INTO payment FROM public.expenses x WHERE id=908002;
 PERFORM bunbun_accounting.post_paid_ingredient_purchase(908002,invoice,payment,'1020','LOCAL-MATERIAL-PURCHASE',actor);
 s:=public.accounting_material_service('review','{"transactionId":"908003"}',actor);
 IF (s->>'mayConfirm')::boolean IS DISTINCT FROM true OR (s->>'actualMaterialCost')::numeric<>0.89
 OR (s->>'poolQuantity')::numeric<>3 OR (s->>'poolValue')::numeric<>2.67
 THEN RAISE EXCEPTION 'Moving average did not reflect later purchase'; END IF;
 p:=p||jsonb_build_object('transactionId','908003','sourceSnapshot',s->>'sourceSnapshot','operationKey',gen_random_uuid());
 PERFORM public.accounting_material_service('post',p,actor);
 s:=public.accounting_material_service('review','{"transactionId":"908004"}',actor);
 p:=p||jsonb_build_object('transactionId','908004','sourceSnapshot',s->>'sourceSnapshot','operationKey',gen_random_uuid());
 result:=public.accounting_material_service('post',p,actor);
 IF (result->>'actualMaterialCost')::numeric<>1.78
 OR (SELECT sum(actual_cost) FROM bunbun_accounting.material_postings)<>3
 OR (SELECT sum(quantity_base) FROM bunbun_accounting.stock_cost_movements WHERE valuation_class='RAW')<>0
 OR (SELECT sum(value_delta) FROM bunbun_accounting.stock_cost_movements WHERE valuation_class='RAW')<>0
 OR (SELECT sum(value_delta) FROM bunbun_accounting.stock_cost_movements WHERE valuation_class='WIP')<>3
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1215')<>3
 OR (SELECT net_profit FROM bunbun_accounting.v_monthly_profit_loss WHERE month='2026-11-01')<>0
 OR (SELECT count(*) FROM public.inventory_transactions)<>5
 OR EXISTS(SELECT 1 FROM public.product_stock_movements)
 THEN RAISE EXCEPTION 'Material value/quantity conservation, profit or no-double-stock invariant failed'; END IF;
 BEGIN
   UPDATE bunbun_accounting.stock_cost_movements SET value_delta=999 WHERE source_key='material-wip:908001'; RAISE EXCEPTION 'Posted costs changed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Posted stock costs are immutable' THEN RAISE; END IF; END;
 SELECT count(*) INTO before_count FROM bunbun_accounting.journals;
 BEGIN
   INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,ingredient_id,valuation_class,quantity_base,value_delta,base_unit)
   VALUES(opening,'BACKDATED-RAW',iid,'RAW',1,999,'g'); RAISE EXCEPTION 'Backdated raw cost accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Raw material change requires downstream cost revaluation' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM bunbun_accounting.journals)<>before_count THEN RAISE EXCEPTION 'Failed attempt left journals'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
   PERFORM public.accounting_material_service('review','{"transactionId":"908001"}','2375b60c-c418-47c2-b157-af80b262fadf');
   RAISE EXCEPTION 'Browser reached private material valuation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS: actual-source moving average, exact remainder, WIP conservation, no cash/stock duplication, Owner/order/replay/history gates' result;
ROLLBACK;
