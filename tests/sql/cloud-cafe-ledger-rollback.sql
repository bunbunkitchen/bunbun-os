\ir source-cafe-ledger-fixture.sql
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.accounting_cafe_ledger_service('inspect','{}','2375b60c-c418-47c2-b157-af80b262fadf');RAISE EXCEPTION 'Browser reached ledger bridge';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: actual sold report -> exact net revenue, existing sale link without duplicate, full 80+40 net receipt despite 70% metadata, source/revision locks, retries, no physical/cashbook duplicate, pending COGS blocks close; actual cafe lot COGS 40 leaves inventory20/profit80' result;
