#!/usr/bin/env bash
set -euo pipefail
if [[ "${BUNBUN_SOURCE_ACCOUNTING_CI:-}" != "isolated-local" || "${PGDATABASE:-}" != "bunbun_material_ci" || ! "${PGHOST:-}" =~ ^(localhost|127\.0\.0\.1)$ ]]; then
  echo 'Refusing nonlocal or unconfirmed material CI target' >&2
  exit 1
fi
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -f tests/sql/source-material-race-seed.sql
cat > "$task_tmp/worker.sql" <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.accounting_material_service('review',jsonb_build_object('transactionId',:'usage_id'),
 '2375b60c-c418-47c2-b157-af80b262fadf')->>'sourceSnapshot' AS snapshot \gset
SELECT public.accounting_material_service('post',jsonb_build_object('transactionId',:'usage_id','sourceSnapshot',:'snapshot',
 'usageConfirmed',true,'evidenceRef','LOCAL-CI-MATERIAL-RACE','operationKey',gen_random_uuid()),'2375b60c-c418-47c2-b157-af80b262fadf');
SELECT pg_sleep(0.5);
COMMIT;
SQL
psql -X -q -v ON_ERROR_STOP=1 -v usage_id=909001 -f "$task_tmp/worker.sql" > "$task_tmp/a.log" 2>&1 &
first_pid=$!
psql -X -q -v ON_ERROR_STOP=1 -v usage_id=909002 -f "$task_tmp/worker.sql" > "$task_tmp/b.log" 2>&1 &
second_pid=$!
first_result=0; second_result=0
wait "$first_pid" || first_result=$?
wait "$second_pid" || second_result=$?
if [[ "$first_result" -ne 0 || "$second_result" -eq 0 ]] || ! grep -q 'Material source/order/opening requires reconciliation' "$task_tmp/b.log"; then
  cat "$task_tmp/a.log" "$task_tmp/b.log"
  echo 'Expected ordered first usage only; insufficient or unvalued second usage must fail' >&2
  exit 1
fi
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM bunbun_accounting.material_postings)<>1
 OR (SELECT count(*) FROM bunbun_accounting.journals)<>2
 OR (SELECT sum(quantity_base) FROM bunbun_accounting.stock_cost_movements WHERE valuation_class='RAW')<>1
 OR (SELECT sum(value_delta) FROM bunbun_accounting.stock_cost_movements WHERE valuation_class='RAW')<>0.34
 OR (SELECT sum(value_delta) FROM bunbun_accounting.stock_cost_movements WHERE valuation_class='WIP')<>0.66
 THEN RAISE EXCEPTION 'Concurrent material usage double-spent cost pool or left partial journals'; END IF;
END $$;
SQL
echo 'PASS: two concurrent 2g usages cannot spend the same 3g/1.00 pool twice; raw 1g/0.34 and WIP 0.66 conserved'
