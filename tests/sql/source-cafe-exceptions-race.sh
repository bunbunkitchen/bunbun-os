#!/usr/bin/env bash
set -euo pipefail
if [[ "${BUNBUN_SOURCE_ACCOUNTING_CI:-}" != "isolated-local" || "${PGDATABASE:-}" != "bunbun_cafe_exceptions_ci" || ! "${PGHOST:-}" =~ ^(localhost|127\.0\.0\.1)$ ]]; then
 echo 'Refusing nonlocal or unconfirmed cafe-exceptions CI target' >&2
 exit 1
fi
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -f tests/sql/source-cafe-exceptions-race-seed.sql
cat > "$task_tmp/apply.sql" <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
SELECT jsonb_build_object('reportId',c.report_id,'incomeId','950001','applicationDate','2026-12-31','allocationConfirmed',true,'evidenceRef','SYNTHETIC-ADVANCE-RACE','allocations',jsonb_build_array(jsonb_build_object('saleId',s.sale_id::text,'amount','20')))::text payload FROM bunbun_accounting.current_cafe_reports c JOIN bunbun_accounting.cafe_ledger_sales s ON s.report_id=c.report_id WHERE c.month='2026-12-01' \gset
SELECT public.accounting_cafe_exception_service('review_apply',:'payload'::jsonb,'2375b60c-c418-47c2-b157-af80b262fadf')->>'sourceSnapshot' snapshot \gset
SELECT public.accounting_cafe_exception_service('post_apply',:'payload'::jsonb||jsonb_build_object('sourceSnapshot',:'snapshot','operationKey',gen_random_uuid()),'2375b60c-c418-47c2-b157-af80b262fadf');
SELECT pg_sleep(0.5);
COMMIT;
SQL
cat > "$task_tmp/waste.sql" <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
SELECT jsonb_build_object('reportId',report_id,'productId','940001','date','2026-12-31','lossConfirmed',true,'evidenceRef','SYNTHETIC-WASTE-RACE','allocations','[{"splitId":"940001","quantity":"1"}]'::jsonb)::text payload FROM bunbun_accounting.current_cafe_reports WHERE month='2026-12-01' \gset
SELECT public.accounting_cafe_exception_service('review_waste',:'payload'::jsonb,'2375b60c-c418-47c2-b157-af80b262fadf')->>'sourceSnapshot' snapshot \gset
SELECT public.accounting_cafe_exception_service('post_waste',:'payload'::jsonb||jsonb_build_object('sourceSnapshot',:'snapshot','operationKey',gen_random_uuid()),'2375b60c-c418-47c2-b157-af80b262fadf');
SELECT pg_sleep(0.5);
COMMIT;
SQL
for task_case in apply waste; do
 psql -X -q -v ON_ERROR_STOP=1 -f "$task_tmp/$task_case.sql" > "$task_tmp/a.log" 2>&1 &
 first_pid=$!
 psql -X -q -v ON_ERROR_STOP=1 -f "$task_tmp/$task_case.sql" > "$task_tmp/b.log" 2>&1 &
 second_pid=$!
 first_result=0; second_result=0
 wait "$first_pid" || first_result=$?
 wait "$second_pid" || second_result=$?
 if ! { [[ "$first_result" -eq 0 && "$second_result" -ne 0 ]] || [[ "$first_result" -ne 0 && "$second_result" -eq 0 ]]; }; then
  cat "$task_tmp/a.log" "$task_tmp/b.log"
  echo 'Expected exactly one competing advance/waste write to succeed' >&2
  exit 1
 fi
 if [[ "$task_case" == apply ]]; then expected='Advance invoice, date or amount requires reconciliation'; else expected='Cafe waste already valued'; fi
 if ! grep -q "$expected" "$task_tmp/a.log" "$task_tmp/b.log"; then cat "$task_tmp/a.log" "$task_tmp/b.log"; exit 1; fi
done
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM bunbun_accounting.cafe_advance_applications)<>1 OR (SELECT sum(amount) FROM bunbun_accounting.cafe_advance_applications)<>20
 OR (SELECT count(*) FROM bunbun_accounting.cafe_waste_postings)<>1 OR (SELECT actual_value FROM bunbun_accounting.cafe_waste_postings)<>10
 OR (SELECT quantity FROM bunbun_accounting.product_cost_positions WHERE cafe_key='PUBLIC_HUB')<>1
 OR (SELECT sum(credit-debit) FROM bunbun_accounting.v_posted_lines WHERE account_code='2130')<>0
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1020')<>1140
 OR EXISTS(SELECT 1 FROM public.product_stock_movements) THEN RAISE EXCEPTION 'Advance or cafe waste spent twice or duplicated cash/stock'; END IF;
END $$;
SQL
echo 'PASS: concurrent requests apply a net20 advance once and value one waste unit at actual10 once; no duplicate cash or stock issue'
