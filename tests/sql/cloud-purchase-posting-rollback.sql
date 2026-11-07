-- Staging pkgrqalpazhwdcxmthvb only. All financial amounts are synthetic.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM bunbun_accounting.journals) OR EXISTS(SELECT 1 FROM bunbun_accounting.periods)
 THEN RAISE EXCEPTION 'Requires empty staging ledger'; END IF; END $$;
INSERT INTO public.purchases(id,tanggal,ingredient_id,jumlah,satuan,harga_satuan,total,keterangan)
OVERRIDING SYSTEM VALUE SELECT -904001,'2026-11-04',min(id),2,'kg',10000,20000,'SYNTHETIC ROLLBACK' FROM public.ingredients WHERE NOT is_deleted;
INSERT INTO public.expenses(id,tanggal,kategori,nominal,purchase_id)
OVERRIDING SYSTEM VALUE VALUES(-904001,'2026-11-04','Bahan Baku',20000,-904001);
INSERT INTO public.inventory_transactions(id,transaction_date,transaction_type,ingredient_id,qty,unit,purchase_id)
OVERRIDING SYSTEM VALUE SELECT -904001,'2026-11-04','PURCHASE',ingredient_id,2,'kg',id FROM public.purchases WHERE id=-904001;
INSERT INTO bunbun_accounting.periods(id,month_start,cutover_on,status,approved_by,approved_at)
VALUES('90400000-0000-4000-8000-000000000001','2026-11-01','2026-11-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET LOCAL ROLE service_role;
DO $$
DECLARE p jsonb; e jsonb; result jsonb; retry jsonb; op uuid:=gen_random_uuid(); actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf';
BEGIN
 SELECT to_jsonb(x) INTO p FROM public.purchases x WHERE id=-904001;
 SELECT to_jsonb(x) INTO e FROM public.expenses x WHERE id=-904001;
 BEGIN
   PERFORM bunbun_accounting.post_paid_ingredient_purchase(-904001,p,e,'1020','TEST-INVOICE-904001',gen_random_uuid());
   RAISE EXCEPTION 'Unexpected unverified actor success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Active Owner approval required' THEN RAISE; END IF; END;
 BEGIN
   PERFORM bunbun_accounting.post_paid_ingredient_purchase(-904001,p,e,'1020','TEST-INVOICE-904001',actor);
   RAISE EXCEPTION 'Unexpected missing opening success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Posted opening journal required before normal posting' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM bunbun_accounting.journals) OR EXISTS(SELECT 1 FROM bunbun_accounting.stock_cost_movements)
 THEN RAISE EXCEPTION 'Failed posting left financial rows'; END IF;
 INSERT INTO bunbun_accounting.opening_snapshots(period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at)
 VALUES('90400000-0000-4000-8000-000000000001','2026-11-01','{"test_only":true}','SYNTHETIC OPENING ONLY','APPROVED',actor,now());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(op,'90400000-0000-4000-8000-000000000001','2026-11-01','OPENING','TEST-OPENING-904001',gen_random_uuid());
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
 VALUES(op,1,'1020',100000,0),(op,2,'3000',0,100000);
 PERFORM bunbun_accounting.post_reviewed_journal(op,actor);
 BEGIN
   PERFORM bunbun_accounting.post_paid_ingredient_purchase(-904001,p||'{"total":1}',e,'1020','TEST-INVOICE-904001',actor);
   RAISE EXCEPTION 'Unexpected stale review success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Purchase changed since review' THEN RAISE; END IF; END;
 BEGIN
   PERFORM bunbun_accounting.post_paid_ingredient_purchase(-904001,p,e,'4010','TEST-INVOICE-904001',actor);
   RAISE EXCEPTION 'Unexpected invalid account success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Cash account and evidence required' THEN RAISE; END IF; END;
 UPDATE public.inventory_transactions SET qty=3 WHERE id=-904001;
 BEGIN
   PERFORM bunbun_accounting.post_paid_ingredient_purchase(-904001,p,e,'1020','TEST-INVOICE-904001',actor);
   RAISE EXCEPTION 'Unexpected receipt mismatch success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Purchase receipt mismatch' THEN RAISE; END IF; END;
 UPDATE public.inventory_transactions SET qty=2 WHERE id=-904001;
 BEGIN
   UPDATE bunbun_accounting.periods SET status='CLOSED' WHERE id='90400000-0000-4000-8000-000000000001';
   PERFORM bunbun_accounting.post_paid_ingredient_purchase(-904001,p,e,'1020','TEST-INVOICE-904001',actor);
   RAISE EXCEPTION 'Unexpected closed period success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Accounting period is not OPEN' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM bunbun_accounting.journals)<>1 OR EXISTS(SELECT 1 FROM bunbun_accounting.stock_cost_movements)
 THEN RAISE EXCEPTION 'Closed period attempt left financial rows'; END IF;
 result:=bunbun_accounting.post_paid_ingredient_purchase(-904001,p,e,'1020','TEST-INVOICE-904001',actor);
 retry:=bunbun_accounting.post_paid_ingredient_purchase(-904001,p,e,'1020','TEST-INVOICE-904001',actor);
 IF result->>'invoice_journal_id' IS DISTINCT FROM retry->>'invoice_journal_id' OR retry->>'already_posted'<>'true'
 OR (SELECT count(*) FROM bunbun_accounting.journals)<>3 THEN RAISE EXCEPTION 'Duplicate posting'; END IF;
 IF NOT EXISTS(SELECT 1 FROM bunbun_accounting.stock_cost_movements WHERE source_key='purchase:-904001' AND quantity_base=2000 AND base_unit='g' AND value_delta=20000)
 THEN RAISE EXCEPTION 'Stock cost mismatch'; END IF;
 IF (SELECT net_profit FROM bunbun_accounting.v_monthly_profit_loss WHERE month='2026-11-01')<>0
 OR (SELECT closing_cash FROM bunbun_accounting.v_monthly_cash_flow WHERE month='2026-11-01')<>80000
 THEN RAISE EXCEPTION 'Purchase wrongly treated as expense or cash counted twice'; END IF;
 BEGIN
   UPDATE public.purchases SET total=1 WHERE id=-904001;
   RAISE EXCEPTION 'Unexpected posted source edit';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
   UPDATE public.expenses SET nominal=1 WHERE id=-904001;
   RAISE EXCEPTION 'Unexpected posted payment edit';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
   DELETE FROM public.inventory_transactions WHERE id=-904001;
   RAISE EXCEPTION 'Unexpected posted receipt delete';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
   PERFORM bunbun_accounting.post_paid_ingredient_purchase(-904001,'{}','{}','1020','TEST-INVOICE-904001','2375b60c-c418-47c2-b157-af80b262fadf');
   RAISE EXCEPTION 'Unexpected browser posting permission';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'PASS: real source -> posted invoice/payment, no double expense, retry, stale review, receipt mismatch, opening gate, source locks, browser denial; rolled back' result;
