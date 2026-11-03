-- Isolated staging only; every source/journal below is synthetic and rolled back.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM bunbun_accounting.journals) OR EXISTS(SELECT 1 FROM bunbun_accounting.periods)
 THEN RAISE EXCEPTION 'Requires empty staging ledger'; END IF; END $$;
INSERT INTO public.purchases(id,tanggal,ingredient_id,jumlah,satuan,harga_satuan,total,jumlah_sediaan,isi_per_sediaan,satuan_sediaan,keterangan)
OVERRIDING SYSTEM VALUE SELECT -904002,'2026-11-04',min(id),2,'kg',10000,20000,2,1,'kg','SYNTHETIC ROLLBACK' FROM public.ingredients WHERE NOT is_deleted;
INSERT INTO public.expenses(id,tanggal,kategori,nominal,purchase_id)
OVERRIDING SYSTEM VALUE VALUES(-904002,'2026-11-04','Bahan Baku',20000,-904002);
INSERT INTO public.inventory_transactions(id,transaction_date,transaction_type,ingredient_id,qty,unit,purchase_id)
OVERRIDING SYSTEM VALUE SELECT -904002,'2026-11-04','PURCHASE',ingredient_id,2,'kg',id FROM public.purchases WHERE id=-904002;
INSERT INTO bunbun_accounting.periods(id,month_start,cutover_on,status,approved_by,approved_at)
VALUES('90400000-0000-4000-8000-000000000002','2026-11-01','2026-11-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET LOCAL ROLE service_role;
DO $$
DECLARE p jsonb; e jsonb; current_p jsonb; current_e jsonb; result jsonb; retry jsonb;
 op uuid:=gen_random_uuid(); correction_key uuid:=gen_random_uuid(); conflict_id uuid:=gen_random_uuid();
 actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; ing bigint; n integer;
BEGIN
 INSERT INTO bunbun_accounting.opening_snapshots(period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at)
 VALUES('90400000-0000-4000-8000-000000000002','2026-11-01','{"test_only":true}','SYNTHETIC OPENING ONLY','APPROVED',actor,now());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(op,'90400000-0000-4000-8000-000000000002','2026-11-01','OPENING','TEST-OPENING-904002',gen_random_uuid());
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
 VALUES(op,1,'1020',100000,0),(op,2,'3000',0,100000);
 PERFORM bunbun_accounting.post_reviewed_journal(op,actor);
 SELECT to_jsonb(x),ingredient_id INTO p,ing FROM public.purchases x WHERE id=-904002;
 SELECT to_jsonb(x) INTO e FROM public.expenses x WHERE id=-904002;
 result:=public.accounting_purchase_service('review','{"purchaseId":"-904002"}',actor);
 IF (result->>'sourceComplete')::boolean IS DISTINCT FROM true OR (result->>'periodReady')::boolean IS DISTINCT FROM true
 OR (result->>'posted')::boolean IS DISTINCT FROM false OR (result->>'purchaseSnapshot')::jsonb IS DISTINCT FROM p
 THEN RAISE EXCEPTION 'Service source review mismatch'; END IF;
 result:=public.accounting_purchase_service('review-post',jsonb_build_object('purchaseId','-904002',
   'purchaseSnapshot',p::text,'expenseSnapshot',e::text,'cashAccount','1020','evidenceRef','TEST-INVOICE-904002'),actor);
 IF (result->>'alreadyProcessed')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Service initial posting mismatch'; END IF;
 BEGIN
   PERFORM bunbun_accounting.correct_paid_ingredient_purchase(-904002,p,e,12000,'1020','TEST-CORRECTION-904002',gen_random_uuid(),gen_random_uuid());
   RAISE EXCEPTION 'Unexpected actor success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Active Owner approval required' THEN RAISE; END IF; END;
 BEGIN
   PERFORM bunbun_accounting.correct_paid_ingredient_purchase(-904002,p,e,'NaN','1020','TEST-CORRECTION-904002',gen_random_uuid(),actor);
   RAISE EXCEPTION 'Unexpected NaN success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Valid correction price, cash account, evidence and operation required' THEN RAISE; END IF; END;
 BEGIN
   UPDATE bunbun_accounting.periods SET status='CLOSED' WHERE id='90400000-0000-4000-8000-000000000002';
   PERFORM bunbun_accounting.correct_paid_ingredient_purchase(-904002,p,e,12000,'1020','TEST-CORRECTION-904002',gen_random_uuid(),actor);
   RAISE EXCEPTION 'Unexpected closed period success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Correction requires original periods OPEN' THEN RAISE; END IF; END;
 result:=public.accounting_purchase_service('review-correction',jsonb_build_object('purchaseId','-904002',
   'purchaseSnapshot',p::text,'expenseSnapshot',e::text,'newUnitPrice','12000','cashAccount','1020',
   'evidenceRef','TEST-CORRECTION-904002','operationKey',correction_key),actor);
 result:=jsonb_build_object('invoice_journal_id',result->>'invoiceJournalId');
 retry:=bunbun_accounting.correct_paid_ingredient_purchase(-904002,p,e,12000,'1020','TEST-CORRECTION-904002',correction_key,actor);
 IF retry->>'already_corrected'<>'true' OR retry->>'invoice_journal_id' IS DISTINCT FROM result->>'invoice_journal_id'
 OR (SELECT count(*) FROM bunbun_accounting.journals)<>7 OR (SELECT count(*) FROM bunbun_accounting.purchase_corrections)<>1
 THEN RAISE EXCEPTION 'Correction retry/atomic journal count mismatch'; END IF;
 IF (SELECT closing_cash FROM bunbun_accounting.v_monthly_cash_flow WHERE month='2026-11-01')<>76000
 OR (SELECT net_profit FROM bunbun_accounting.v_monthly_profit_loss WHERE month='2026-11-01')<>0
 OR (SELECT sum(quantity_base) FROM bunbun_accounting.stock_cost_movements)<>2000
 OR (SELECT sum(value_delta) FROM bunbun_accounting.stock_cost_movements)<>24000
 OR (SELECT nominal FROM public.expenses WHERE id=-904002)<>24000
 THEN RAISE EXCEPTION 'Corrected cash, raw stock cost, physical quantity or profit wrong'; END IF;
 IF (SELECT previous_posting->'purchase_snapshot'->>'total' FROM bunbun_accounting.purchase_corrections WHERE operation_key=correction_key)::numeric<>20000
 OR (SELECT count(*) FROM public.inventory_transactions WHERE purchase_id=-904002 AND qty=2)<>1
 THEN RAISE EXCEPTION 'Original audit snapshot or physical receipt lost'; END IF;
 BEGIN
   PERFORM bunbun_accounting.correct_paid_ingredient_purchase(-904002,p,e,13000,'1020','TEST-CORRECTION-904002',correction_key,actor);
   RAISE EXCEPTION 'Unexpected replay mismatch success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Correction operation reused with different request' THEN RAISE; END IF; END;
 BEGIN
   PERFORM bunbun_accounting.correct_paid_ingredient_purchase(-904002,p,e,13000,'1020','TEST-CORRECTION-904002',gen_random_uuid(),actor);
   RAISE EXCEPTION 'Unexpected stale correction success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Correction source changed since review' THEN RAISE; END IF; END;
 SELECT to_jsonb(x) INTO current_p FROM public.purchases x WHERE id=-904002;
 SELECT to_jsonb(x) INTO current_e FROM public.expenses x WHERE id=-904002;
 -- A failure after reversals and source updates must undo ALL of them.
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(conflict_id,'90400000-0000-4000-8000-000000000002','2026-11-04','NORMAL','purchase:-904002:revision:3',gen_random_uuid());
 BEGIN
   PERFORM bunbun_accounting.correct_paid_ingredient_purchase(-904002,current_p,current_e,13000,'1020','TEST-FAILURE-904002',gen_random_uuid(),actor);
   RAISE EXCEPTION 'Unexpected conflict success';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF (SELECT total FROM public.purchases WHERE id=-904002)<>24000 OR (SELECT nominal FROM public.expenses WHERE id=-904002)<>24000
 OR (SELECT count(*) FROM bunbun_accounting.journals)<>8 OR (SELECT count(*) FROM bunbun_accounting.purchase_corrections)<>1
 OR coalesce(current_setting('bunbun_accounting.correcting_purchase',true),'')<>'' THEN RAISE EXCEPTION 'Late failure not atomic'; END IF;
 DELETE FROM bunbun_accounting.journals WHERE id=conflict_id;
 INSERT INTO public.inventory_transactions(transaction_date,transaction_type,ingredient_id,qty,unit)
 VALUES('2026-11-04','ADJUSTMENT_OUT',ing,0.1,'kg');
 BEGIN
   PERFORM bunbun_accounting.correct_paid_ingredient_purchase(-904002,current_p,current_e,13000,'1020','TEST-CONSUMED-904002',gen_random_uuid(),actor);
   RAISE EXCEPTION 'Unexpected consumed price success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Consumed ingredient requires downstream cost revaluation' THEN RAISE; END IF; END;
 -- Moving the same payment from bank to cash does not reprice consumed stock.
 result:=bunbun_accounting.correct_paid_ingredient_purchase(-904002,current_p,current_e,12000,'1010','TEST-CASH-ACCOUNT-904002',gen_random_uuid(),actor);
 IF (result->>'revision')::integer<>3 OR (SELECT sum(value_delta) FROM bunbun_accounting.stock_cost_movements)<>24000
 OR (SELECT closing_cash FROM bunbun_accounting.v_monthly_cash_flow WHERE month='2026-11-01')<>76000
 THEN RAISE EXCEPTION 'Cash-account correction changed total money or stock'; END IF;
 BEGIN
   UPDATE public.purchases SET total=1 WHERE id=-904002;
   RAISE EXCEPTION 'Source unlocked after correction';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','2375b60c-c418-47c2-b157-af80b262fadf',true);
SELECT set_config('bunbun_accounting.correcting_purchase','-904002',true);
DO $$ BEGIN
 BEGIN
   UPDATE public.purchases SET total=1,updated_by='2375b60c-c418-47c2-b157-af80b262fadf' WHERE id=-904002;
   RAISE EXCEPTION 'Browser spoofed correction context';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
   PERFORM public.accounting_purchase_service('review','{"purchaseId":"-904002"}','2375b60c-c418-47c2-b157-af80b262fadf');
   RAISE EXCEPTION 'Browser called service-only transport';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
   PERFORM bunbun_accounting.correct_paid_ingredient_purchase(-904002,'{}','{}',1,'1020','TEST-ACCESS-904002',gen_random_uuid(),'2375b60c-c418-47c2-b157-af80b262fadf');
   RAISE EXCEPTION 'Browser called private correction';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'PASS: atomic reversal/replacement, source snapshots, retries, changed replay, stale review, closed period, NaN, downstream use, late failure rollback, browser denial; all rows rolled back' result;
