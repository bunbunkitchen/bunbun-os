\ir source-cafe-exceptions-fixture.sql
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.accounting_cafe_exception_service('inspect','{}','2375b60c-c418-47c2-b157-af80b262fadf');RAISE EXCEPTION 'Browser reached advance/waste backend';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: real-date net advance -> liability -> month-end receivable application; actual cafe waste/COGS conservation, retries, stale/overdraw/date guards, no duplicated cash/stock, waste-aware close readiness' result;
