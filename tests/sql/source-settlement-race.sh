#!/usr/bin/env bash
set -euo pipefail
if [[ "${BUNBUN_SOURCE_ACCOUNTING_CI:-}" != "isolated-local" || "${PGDATABASE:-}" != "bunbun_source_ci" || ! "${PGHOST:-}" =~ ^(localhost|127\.0\.0\.1)$ ]]; then
  echo 'Refusing nonlocal or unconfirmed CI target' >&2
  exit 1
fi
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -f tests/sql/source-settlement-race-seed.sql
cat > "$task_tmp/worker.sql" <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.accounting_revenue_service('post_income',jsonb_build_object('incomeId',id::text,
 'sourceSnapshot',to_jsonb(i)::text,'cashAccount','1020','allocationConfirmed',true,
 'evidenceRef','LOCAL-CONCURRENT-RECEIPT','operationKey',gen_random_uuid(),
 'allocations','[{"saleId":"-907001","amount":"50000"}]'::jsonb),'2375b60c-c418-47c2-b157-af80b262fadf')
FROM public.incomes i WHERE id=:'income_id'::bigint;
SELECT pg_sleep(0.5);
COMMIT;
SQL
psql -X -q -v ON_ERROR_STOP=1 -v income_id=-907001 -f "$task_tmp/worker.sql" > "$task_tmp/a.log" 2>&1 &
first_pid=$!
psql -X -q -v ON_ERROR_STOP=1 -v income_id=-907002 -f "$task_tmp/worker.sql" > "$task_tmp/b.log" 2>&1 &
second_pid=$!
first_result=0; second_result=0
wait "$first_pid" || first_result=$?
wait "$second_pid" || second_result=$?
if ! { [[ "$first_result" -eq 0 && "$second_result" -ne 0 ]] || [[ "$first_result" -ne 0 && "$second_result" -eq 0 ]]; }; then
  cat "$task_tmp/a.log" "$task_tmp/b.log"
  echo 'Expected exactly one racing payment to succeed' >&2
  exit 1
fi
if ! grep -q 'Receipt allocation exceeds outstanding receivable' "$task_tmp/a.log" "$task_tmp/b.log"; then
  cat "$task_tmp/a.log" "$task_tmp/b.log"
  echo 'Losing worker did not fail on the expected receivable guard' >&2
  exit 1
fi
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF (SELECT sum(amount) FROM bunbun_accounting.settlement_allocations WHERE sale_id=-907001)<>50000
 OR (SELECT count(*) FROM bunbun_accounting.income_postings)<>1
 OR (SELECT count(*) FROM bunbun_accounting.journals)<>3
 THEN RAISE EXCEPTION 'Concurrent payments over-settled or left partial journals'; END IF;
END $$;
SQL
echo 'PASS: two concurrent 50000 payments cannot over-settle a 70000 receivable; one committed, one rejected, 20000 remains'
