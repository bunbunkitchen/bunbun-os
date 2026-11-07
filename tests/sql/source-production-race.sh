#!/usr/bin/env bash
set -euo pipefail
if [[ "${BUNBUN_SOURCE_ACCOUNTING_CI:-}" != "isolated-local" || "${PGDATABASE:-}" != "bunbun_production_ci" || ! "${PGHOST:-}" =~ ^(localhost|127\.0\.0\.1)$ ]]; then
  echo 'Refusing nonlocal or unconfirmed production CI target' >&2
  exit 1
fi
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -f tests/sql/source-production-race-seed.sql
cat > "$task_tmp/worker.sql" <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
SELECT jsonb_build_object('expenseId','911001','batchId',:'batch_id','amount','20','date','2026-11-03',
 'costKind','LABOR','cashAccount','1020','productionConfirmed',true,'evidenceRef','LOCAL-CI-PROD-RACE')::text AS payload \gset
SELECT public.accounting_production_service('review_cost',:'payload'::jsonb,'2375b60c-c418-47c2-b157-af80b262fadf')->>'sourceSnapshot' AS snapshot \gset
SELECT public.accounting_production_service('post_cost',:'payload'::jsonb||jsonb_build_object('sourceSnapshot',:'snapshot','operationKey',gen_random_uuid()),'2375b60c-c418-47c2-b157-af80b262fadf');
SELECT pg_sleep(0.5);
COMMIT;
SQL
psql -X -q -v ON_ERROR_STOP=1 -v batch_id=911001 -f "$task_tmp/worker.sql" > "$task_tmp/a.log" 2>&1 &
first_pid=$!
psql -X -q -v ON_ERROR_STOP=1 -v batch_id=911002 -f "$task_tmp/worker.sql" > "$task_tmp/b.log" 2>&1 &
second_pid=$!
first_result=0; second_result=0
wait "$first_pid" || first_result=$?
wait "$second_pid" || second_result=$?
if ! { [[ "$first_result" -eq 0 && "$second_result" -ne 0 ]] || [[ "$first_result" -ne 0 && "$second_result" -eq 0 ]]; } || ! grep -q 'Production source/cost/period requires reconciliation' "$task_tmp/a.log" "$task_tmp/b.log"; then
  cat "$task_tmp/a.log" "$task_tmp/b.log"
  echo 'Expected exactly one of two 20 allocations from a 30 expense to post' >&2
  exit 1
fi
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM bunbun_accounting.production_cost_sources)<>1
 OR (SELECT count(*) FROM bunbun_accounting.production_cost_allocations)<>1
 OR (SELECT count(*) FROM bunbun_accounting.journals)<>3
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='1290')<>10
 OR (SELECT closing_cash FROM bunbun_accounting.v_monthly_cash_flow WHERE month='2026-11-01')<>970
 THEN RAISE EXCEPTION 'Concurrent production allocations duplicated cash or overspent source'; END IF;
END $$;
SQL
echo 'PASS: concurrent 20+20 allocations cannot spend a 30 expense twice; one payment, one allocation, 10 remains'
