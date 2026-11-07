-- LOCAL/ISOLATED STAGING ONLY. Tests financial source documents; not physical
-- production/lot valuation. All synthetic documents and journals rolled back.
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM bunbun_accounting.journals) OR EXISTS(SELECT 1 FROM bunbun_accounting.periods)
 THEN RAISE EXCEPTION 'Requires empty isolated ledger'; END IF; END $$;
INSERT INTO public.products(id,sku,nama) OVERRIDING SYSTEM VALUE VALUES(-906001,'FINANCE-SMOKE','Synthetic finance product');
INSERT INTO public.sales(id,sale_date,sales_channel,total_amount) OVERRIDING SYSTEM VALUE VALUES
 (-906001,'2026-11-04','PUBLIC_HUB',100000),(-906002,'2026-11-04','PUBLIC_COFFEE',50000);
INSERT INTO public.sale_items(sale_id,product_id,product_name,quantity,selling_price,subtotal,order_type) VALUES
 (-906001,-906001,'Synthetic finance product',10,10000,100000,'TAKE_AWAY'),
 (-906002,-906001,'Synthetic finance product',5,10000,50000,'TAKE_AWAY');
INSERT INTO public.incomes(id,tanggal,total_penjualan,persentase_bunbun,pemasukan_bunbun,asal_setoran) OVERRIDING SYSTEM VALUE VALUES
 (-906001,'2026-11-05',100000,70,30000,'Synthetic partial payment'),
 (-906002,'2026-11-06',150000,70,75000,'Synthetic combined payment'),
 (-906003,'2026-11-07',100000,70,10000,'Synthetic overpayment');
INSERT INTO bunbun_accounting.periods(id,month_start,cutover_on,status,approved_by,approved_at) VALUES
 ('90600000-0000-4000-8000-000000000001','2026-11-01','2026-11-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET LOCAL ROLE service_role;
DO $$ DECLARE actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; opening uuid:=gen_random_uuid();
 first_sale jsonb; second_sale jsonb; first_income jsonb; second_income jsonb; third_income jsonb;
 p jsonb; q jsonb; result jsonb; retry jsonb; balances jsonb;
BEGIN
 first_sale:=public.accounting_revenue_service('review_sale','{"saleId":"-906001"}',actor);
 IF (first_sale->>'sourceComplete')::boolean IS DISTINCT FROM true OR (first_sale->>'periodReady')::boolean IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'Sale review readiness incorrect'; END IF;
 p:=jsonb_build_object('saleId','-906001','sourceSnapshot',first_sale->>'sourceSnapshot','recordedBasis','GROSS_CAFE',
   'netEntitlement','70000','soldConfirmed',true,'evidenceRef','SYNTHETIC-SOLD-906001','operationKey',gen_random_uuid());
 BEGIN
   PERFORM public.accounting_revenue_service('post_sale',p,actor); RAISE EXCEPTION 'Unexpected missing opening';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Posted opening journal required before normal posting' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM bunbun_accounting.journals) THEN RAISE EXCEPTION 'Failed sale left journal'; END IF;
 INSERT INTO bunbun_accounting.opening_snapshots(period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at)
 VALUES('90600000-0000-4000-8000-000000000001','2026-11-01','{"test_only":true}','SYNTHETIC OPENING ONLY','APPROVED',actor,now());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(opening,'90600000-0000-4000-8000-000000000001','2026-11-01','OPENING','SYNTHETIC-REVENUE-OPENING',gen_random_uuid());
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
 VALUES(opening,1,'1020',100000,0),(opening,2,'3000',0,100000);
 PERFORM bunbun_accounting.post_reviewed_journal(opening,actor);
 BEGIN
   PERFORM public.accounting_revenue_service('post_sale',p,gen_random_uuid()); RAISE EXCEPTION 'Unexpected actor';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Active Owner approval required' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.accounting_revenue_service('post_sale',p||'{"soldConfirmed":false}',actor); RAISE EXCEPTION 'Delivery treated as sale';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Confirmed sold goods required' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.accounting_revenue_service('post_sale',p||'{"recordedBasis":"NET_BUNBUN"}',actor); RAISE EXCEPTION 'Net basis mismatch';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Sale entitlement does not match recorded basis' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.accounting_revenue_service('post_sale',p||'{"netEntitlement":"110000"}',actor); RAISE EXCEPTION 'Entitlement over gross';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Sale entitlement does not match recorded basis' THEN RAISE; END IF; END;
 result:=public.accounting_revenue_service('post_sale',p,actor);
 retry:=public.accounting_revenue_service('post_sale',p,actor);
 IF result->>'journalId' IS DISTINCT FROM retry->>'journalId' OR (retry->>'alreadyProcessed')::boolean IS DISTINCT FROM true
 OR result->>'cogsStatus'<>'PENDING_VALUATION' OR (result->>'actualProfitAvailable')::boolean IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'Sale retry/COGS guard incorrect'; END IF;
 second_sale:=public.accounting_revenue_service('review_sale','{"saleId":"-906002"}',actor);
 q:=p||jsonb_build_object('saleId','-906002','sourceSnapshot',second_sale->>'sourceSnapshot','netEntitlement','35000','operationKey',gen_random_uuid());
 PERFORM public.accounting_revenue_service('post_sale',q,actor);
 first_income:=public.accounting_revenue_service('review_income','{"incomeId":"-906001"}',actor);
 p:=jsonb_build_object('incomeId','-906001','sourceSnapshot',first_income->>'sourceSnapshot','cashAccount','1020',
   'allocationConfirmed',true,'evidenceRef','SYNTHETIC-PAYMENT-906001','operationKey',gen_random_uuid(),
   'allocations','[{"saleId":"-906001","amount":"30000"}]'::jsonb);
 result:=public.accounting_revenue_service('post_income',p,actor);
 retry:=public.accounting_revenue_service('post_income',p,actor);
 IF result->>'journalId' IS DISTINCT FROM retry->>'journalId' OR (retry->>'alreadyProcessed')::boolean IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'Receipt duplicated'; END IF;
 balances:=public.accounting_revenue_service('receivables','{}',actor);
 IF (SELECT (x->>'outstanding')::numeric FROM jsonb_array_elements(balances->'receivables') x WHERE x->>'saleId'='-906001')<>40000
 THEN RAISE EXCEPTION 'Partial payment wrong'; END IF;
 second_income:=public.accounting_revenue_service('review_income','{"incomeId":"-906002"}',actor);
 q:=p||jsonb_build_object('incomeId','-906002','sourceSnapshot',second_income->>'sourceSnapshot','operationKey',gen_random_uuid(),
   'allocations','[{"saleId":"-906001","amount":"40000"},{"saleId":"-906002","amount":"35000"}]'::jsonb);
 BEGIN
   PERFORM public.accounting_revenue_service('post_income',q||'{"allocations":[{"saleId":"-906001","amount":"75000"}]}',actor);
   RAISE EXCEPTION 'Overallocated receivable';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Receipt allocation exceeds outstanding receivable' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.accounting_revenue_service('post_income',q||'{"allocations":[{"saleId":"-906001","amount":"1"},{"saleId":"-906001","amount":"1"}]}',actor);
   RAISE EXCEPTION 'Duplicate allocation accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Unique receipt sale allocations required' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.accounting_revenue_service('post_income',q||'{"allocations":[{"saleId":"-906001","amount":"1"}]}',actor);
   RAISE EXCEPTION 'Allocation/actual receipt mismatch';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Allocations must equal actual net receipt' THEN RAISE; END IF; END;
 PERFORM public.accounting_revenue_service('post_income',q,actor);
 third_income:=public.accounting_revenue_service('review_income','{"incomeId":"-906003"}',actor);
 q:=p||jsonb_build_object('incomeId','-906003','sourceSnapshot',third_income->>'sourceSnapshot','operationKey',gen_random_uuid(),
   'allocations','[{"saleId":"-906001","amount":"10000"}]'::jsonb);
 BEGIN
   PERFORM public.accounting_revenue_service('post_income',q,actor); RAISE EXCEPTION 'Paid invoice paid again';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Receipt allocation exceeds outstanding receivable' THEN RAISE; END IF; END;
 IF (SELECT net_revenue FROM bunbun_accounting.v_monthly_profit_loss WHERE month='2026-11-01')<>105000
 OR (SELECT closing_cash FROM bunbun_accounting.v_monthly_cash_flow WHERE month='2026-11-01')<>205000
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1120')<>0
 OR (SELECT count(*) FROM bunbun_accounting.journals)<>5 OR (SELECT count(*) FROM public.product_stock_movements)<>0
 THEN RAISE EXCEPTION 'Revenue counted twice, net receipt discounted, AR/cash wrong or stock moved twice'; END IF;
 balances:=public.accounting_revenue_service('cost_readiness','{"month":"2026-11"}',actor);
 IF (balances->>'soldCostsComplete')::boolean IS DISTINCT FROM false OR (balances->>'pendingSalesCogs')::integer<>2
 THEN RAISE EXCEPTION 'Incomplete sold costs incorrectly allowed financial report'; END IF;
 BEGIN
   UPDATE bunbun_accounting.periods SET status='CLOSED' WHERE id='90600000-0000-4000-8000-000000000001';
   RAISE EXCEPTION 'Period closed with unknown COGS';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Actual sold COGS is incomplete; accounting period cannot close' THEN RAISE; END IF; END;
 BEGIN UPDATE public.sales SET total_amount=1 WHERE id=-906001; RAISE EXCEPTION 'Sale source edit accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN DELETE FROM public.sale_items WHERE sale_id=-906001; RAISE EXCEPTION 'Posted sale items deleted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN UPDATE public.incomes SET pemasukan_bunbun=1 WHERE id=-906001; RAISE EXCEPTION 'Posted receipt edit accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.accounting_revenue_service('receivables','{}','2375b60c-c418-47c2-b157-af80b262fadf'); RAISE EXCEPTION 'Browser ledger access';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
SELECT 'PASS: net entitlement, partial/combined settlements, no double revenue or second discount, overpayment/retry/source guards and pending-COGS close block; all synthetic data rolled back' result;
