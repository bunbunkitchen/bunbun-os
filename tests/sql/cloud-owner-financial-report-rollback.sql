\ir source-cafe-exceptions-fixture.sql
SET LOCAL ROLE service_role;
DO $$ DECLARE actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; r jsonb;
BEGIN
 r:=public.accounting_owner_financial_report('2026-12',actor);
 IF r IS NULL OR (r->>'net_profit')::numeric<>0 OR (r->>'closing_cash')::numeric<>1140 OR (r->>'trial_balance_difference')::numeric<>0
 OR (r->>'liabilities')::numeric<>0 OR r->>'opening_approved'<>'true' THEN RAISE EXCEPTION 'Owner monthly report did not use reconciled posted advance/waste/COGS sources: %',r; END IF;
 r:=public.accounting_owner_financial_report('2026-11',actor);
 IF r IS NULL OR (r->>'net_profit')::numeric<>80 OR (r->>'closing_cash')::numeric<>1120 THEN RAISE EXCEPTION 'Prior month report changed after later money/waste'; END IF;
 IF public.accounting_owner_financial_report('2026-10',actor) IS NOT NULL THEN RAISE EXCEPTION 'Missing opening became zero report'; END IF;
 BEGIN
  INSERT INTO public.expenses(id,tanggal,kategori,nominal,keterangan) OVERRIDING SYSTEM VALUE VALUES(960001,'2026-12-03','Utilitas',7,'SYNTHETIC-UNPOSTED-EXPENSE');
  IF public.accounting_owner_financial_report('2026-12',actor) IS NOT NULL THEN RAISE EXCEPTION 'Unposted source expense ignored in profit report'; END IF;
  IF public.accounting_owner_financial_report('2026-11',actor) IS NULL THEN RAISE EXCEPTION 'Later pending expense blocked earlier reconciled month'; END IF;
  RAISE EXCEPTION 'ROLLBACK_PENDING_SOURCE';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'ROLLBACK_PENDING_SOURCE' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.accounting_owner_financial_report('2026-12','2375b60c-c418-47c2-b157-af80b262fadf');RAISE EXCEPTION 'Browser read financial RPC directly';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: posted monthly P&L/cash/position reconcile after net advance/actual COGS/waste; missing opening and pending sources remain unavailable, browser RPC denied' result;
