#!/usr/bin/env bash
set -euo pipefail
if [[ "${BUNBUN_SOURCE_ACCOUNTING_CI:-}" != "isolated-local" || "${PGDATABASE:-}" != "bunbun_cafe_ledger_ci" || ! "${PGHOST:-}" =~ ^(localhost|127\.0\.0\.1)$ ]]; then
 echo 'Refusing nonlocal or unconfirmed cafe-ledger CI target' >&2
 exit 1
fi
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -f tests/sql/source-cafe-ledger-race-seed.sql
cat > "$task_tmp/worker.sql" <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
SELECT jsonb_build_object('reportId',report_id,'mode','CREATE','saleDate','2026-11-30','existingSaleIds','[]'::jsonb,'actualSoldConfirmed',true,'evidenceRef','SYNTHETIC-ACTUAL-SOLD-RACE')::text payload FROM bunbun_accounting.current_cafe_reports \gset
SELECT public.accounting_cafe_ledger_service('review_import',:'payload'::jsonb,'2375b60c-c418-47c2-b157-af80b262fadf')->>'sourceSnapshot' snapshot \gset
SELECT public.accounting_cafe_ledger_service('post_import',:'payload'::jsonb||jsonb_build_object('sourceSnapshot',:'snapshot','operationKey',gen_random_uuid()),'2375b60c-c418-47c2-b157-af80b262fadf');
SELECT pg_sleep(0.5);
COMMIT;
SQL
psql -X -q -v ON_ERROR_STOP=1 -f "$task_tmp/worker.sql" > "$task_tmp/a.log" 2>&1 &
first_pid=$!
psql -X -q -v ON_ERROR_STOP=1 -f "$task_tmp/worker.sql" > "$task_tmp/b.log" 2>&1 &
second_pid=$!
first_result=0; second_result=0
wait "$first_pid" || first_result=$?
wait "$second_pid" || second_result=$?
if ! { [[ "$first_result" -eq 0 && "$second_result" -ne 0 ]] || [[ "$first_result" -ne 0 && "$second_result" -eq 0 ]]; } || ! grep -q 'Cafe report already imported' "$task_tmp/a.log" "$task_tmp/b.log"; then
 cat "$task_tmp/a.log" "$task_tmp/b.log"
 echo 'Expected exactly one simultaneous actual-sold import to succeed' >&2
 exit 1
fi
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM bunbun_accounting.cafe_ledger_imports)<>1 OR (SELECT count(*) FROM public.sales)<>1 OR (SELECT count(*) FROM bunbun_accounting.journals)<>2
 OR (SELECT sum(net_entitlement) FROM bunbun_accounting.sale_postings)<>80 OR (SELECT sum(quantity) FROM public.sale_items)<>3 OR EXISTS(SELECT 1 FROM public.product_stock_movements)
 THEN RAISE EXCEPTION 'Concurrent imports duplicated actual sold revenue or stock'; END IF;
END $$;
SQL
echo 'PASS: two simultaneous imports create one 3-unit/net80 invoice and one revenue journal; no duplicate stock issue'
