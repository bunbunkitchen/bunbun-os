-- Isolated staging only. Synthetic opening/documents; all data rolled back.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM bunbun_accounting.journals) OR EXISTS(SELECT 1 FROM bunbun_accounting.periods)
 THEN RAISE EXCEPTION 'Requires empty staging ledger'; END IF; END $$;
INSERT INTO public.expenses(id,tanggal,kategori,nominal,keterangan) OVERRIDING SYSTEM VALUE
VALUES(-905001,'2026-11-04','Sewa',20000,'SYNTHETIC NONPRODUCTION TEST');
INSERT INTO public.purchases(id,tanggal,ingredient_id,jumlah,satuan,harga_satuan,total) OVERRIDING SYSTEM VALUE
SELECT -905002,'2026-11-04',min(id),1,'kg',10000,10000 FROM public.ingredients WHERE NOT is_deleted;
INSERT INTO public.expenses(id,tanggal,kategori,nominal,purchase_id) OVERRIDING SYSTEM VALUE
VALUES(-905002,'2026-11-04','Bahan Baku',10000,-905002);
INSERT INTO bunbun_accounting.periods(id,month_start,cutover_on,status,approved_by,approved_at)
VALUES('90500000-0000-4000-8000-000000000001','2026-11-01','2026-11-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET LOCAL ROLE service_role;
DO $$
DECLARE actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; opening uuid:=gen_random_uuid(); conflict uuid:=gen_random_uuid();
 snapshot jsonb; payload jsonb; correction jsonb; result jsonb; retry jsonb; original_id uuid;
BEGIN
 SELECT to_jsonb(e) INTO snapshot FROM public.expenses e WHERE id=-905001;
 payload:=jsonb_build_object('expenseId','-905001','sourceSnapshot',snapshot::text,'expenseAccount','6050',
   'cashAccount','1020','evidenceRef','TEST-EXPENSE-905001','costScope','PERIOD_NONPRODUCTION','operationKey',gen_random_uuid());
 result:=public.accounting_expense_service('review','{"expenseId":"-905001"}',actor);
 IF (result->>'sourceComplete')::boolean IS DISTINCT FROM true OR (result->>'periodReady')::boolean IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'Expense inspection missing opening guard'; END IF;
 BEGIN
   PERFORM public.accounting_expense_service('post',payload,actor);
   RAISE EXCEPTION 'Unexpected missing opening success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Posted opening journal required before normal posting' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM bunbun_accounting.journals) THEN RAISE EXCEPTION 'Failed post left journal'; END IF;
 INSERT INTO bunbun_accounting.opening_snapshots(period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at)
 VALUES('90500000-0000-4000-8000-000000000001','2026-11-01','{"test_only":true}','SYNTHETIC OPENING ONLY','APPROVED',actor,now());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(opening,'90500000-0000-4000-8000-000000000001','2026-11-01','OPENING','TEST-EXPENSE-OPENING',gen_random_uuid());
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
 VALUES(opening,1,'1020',100000,0),(opening,2,'3000',0,100000);
 PERFORM bunbun_accounting.post_reviewed_journal(opening,actor);
 BEGIN
   PERFORM public.accounting_expense_service('post',payload,gen_random_uuid());
   RAISE EXCEPTION 'Unexpected actor success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Active Owner approval required' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.accounting_expense_service('post',payload||'{"costScope":"PRODUCTION"}',actor);
   RAISE EXCEPTION 'Unexpected production expense success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Nonproduction period expense review required' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.accounting_expense_service('post',payload||'{"expenseAccount":"6040"}',actor);
   RAISE EXCEPTION 'Unexpected cash depreciation success';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Valid accounts, evidence and operation required' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.accounting_expense_service('post',payload||'{"expenseId":"-905002"}',actor);
   RAISE EXCEPTION 'Unexpected purchasing double expense';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Purchase-linked expense must use purchasing workflow' THEN RAISE; END IF; END;
 result:=public.accounting_expense_service('post',payload,actor);
 retry:=public.accounting_expense_service('post',payload,actor);
 original_id:=(result->>'journalId')::uuid;
 IF result->>'journalId' IS DISTINCT FROM retry->>'journalId' OR (retry->>'alreadyProcessed')::boolean IS DISTINCT FROM true
 OR (SELECT count(*) FROM bunbun_accounting.journals)<>2 THEN RAISE EXCEPTION 'Expense double posting'; END IF;
 IF (SELECT net_profit FROM bunbun_accounting.v_monthly_profit_loss WHERE month='2026-11-01')<>-20000
 OR (SELECT closing_cash FROM bunbun_accounting.v_monthly_cash_flow WHERE month='2026-11-01')<>80000
 THEN RAISE EXCEPTION 'Expense not reflected in posted reports'; END IF;
 correction:=payload||jsonb_build_object('newAmount','25000.00','evidenceRef','TEST-CORRECTION-905001','operationKey',gen_random_uuid());
 BEGIN
   PERFORM public.accounting_expense_service('correct',correction||'{"newAmount":"NaN"}',actor);
   RAISE EXCEPTION 'Unexpected NaN correction';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Valid positive expense amount required' THEN RAISE; END IF; END;
 BEGIN
   UPDATE bunbun_accounting.periods SET status='CLOSED' WHERE id='90500000-0000-4000-8000-000000000001';
   PERFORM public.accounting_expense_service('correct',correction,actor);
   RAISE EXCEPTION 'Unexpected closed period correction';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Accounting period is not OPEN' THEN RAISE; END IF; END;
 result:=public.accounting_expense_service('correct',correction,actor);
 retry:=public.accounting_expense_service('correct',correction,actor);
 IF (result->>'revision')::integer<>2 OR (retry->>'alreadyProcessed')::boolean IS DISTINCT FROM true
 OR (SELECT count(*) FROM bunbun_accounting.journals)<>4 OR (SELECT count(*) FROM bunbun_accounting.expense_posting_operations)<>2
 THEN RAISE EXCEPTION 'Correction history/retry mismatch'; END IF;
 IF (SELECT nominal FROM public.expenses WHERE id=-905001)<>25000
 OR (SELECT net_profit FROM bunbun_accounting.v_monthly_profit_loss WHERE month='2026-11-01')<>-25000
 OR (SELECT closing_cash FROM bunbun_accounting.v_monthly_cash_flow WHERE month='2026-11-01')<>75000
 OR NOT EXISTS(SELECT 1 FROM bunbun_accounting.journal_lines WHERE journal_id=original_id AND debit=20000)
 THEN RAISE EXCEPTION 'Corrected source/reports or original history wrong'; END IF;
 BEGIN
   PERFORM public.accounting_expense_service('correct',correction||'{"newAmount":"26000"}',actor);
   RAISE EXCEPTION 'Unexpected mismatched operation replay';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Operation reused with different expense request' THEN RAISE; END IF; END;
 SELECT to_jsonb(e) INTO snapshot FROM public.expenses e WHERE id=-905001;
 correction:=correction||jsonb_build_object('sourceSnapshot',snapshot::text,'newAmount','26000','operationKey',gen_random_uuid());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(conflict,'90500000-0000-4000-8000-000000000001','2026-11-04','NORMAL','expense:-905001:revision:3',gen_random_uuid());
 BEGIN
   PERFORM public.accounting_expense_service('correct',correction,actor);
   RAISE EXCEPTION 'Unexpected late conflict success';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF (SELECT nominal FROM public.expenses WHERE id=-905001)<>25000 OR (SELECT count(*) FROM bunbun_accounting.journals)<>5
 OR coalesce(current_setting('bunbun_accounting.correcting_expense',true),'')<>'' THEN RAISE EXCEPTION 'Expense late failure not atomic'; END IF;
 DELETE FROM bunbun_accounting.journals WHERE id=conflict;
 BEGIN
   DELETE FROM public.expenses WHERE id=-905001;
   RAISE EXCEPTION 'Posted expense delete accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','2375b60c-c418-47c2-b157-af80b262fadf',true);
SELECT set_config('bunbun_accounting.correcting_expense','-905001',true);
DO $$ BEGIN
 BEGIN
   UPDATE public.expenses SET nominal=1,updated_by='2375b60c-c418-47c2-b157-af80b262fadf' WHERE id=-905001;
   RAISE EXCEPTION 'Browser spoofed expense correction';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
   PERFORM public.accounting_expense_service('review','{"expenseId":"-905001"}','2375b60c-c418-47c2-b157-af80b262fadf');
   RAISE EXCEPTION 'Browser called expense backend transport';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'PASS: source-backed period expense and exact correction reflected in reports, no purchase double count, retries, authorization, scope, opening, closed-period and atomic failure guards; all synthetic rows rolled back' result;
