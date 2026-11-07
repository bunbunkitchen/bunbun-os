#!/usr/bin/env bash
set -euo pipefail
if [[ "${BUNBUN_SOURCE_ACCOUNTING_CI:-}" != "isolated-local" || "${PGDATABASE:-}" != "bunbun_cafe_report_ci" || ! "${PGHOST:-}" =~ ^(localhost|127\.0\.0\.1)$ ]]; then
 echo 'Refusing nonlocal or unconfirmed cafe-report CI target' >&2
 exit 1
fi
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -f tests/sql/source-cafe-report-race-seed.sql
cat > "$task_tmp/worker.sql" <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
SELECT jsonb_build_object('month','2026-11','cafeKey',:'cafe','asOfDate','2026-12-05','expectedReportId',null,'openingEvidenceRef','SYNTHETIC-ZERO-OPENING','evidenceRef','SYNTHETIC-RACE-REPORT','factsConfirmed',true,'confirmedUnpaid','0','confirmedCredit','80','shipmentIds','[]'::jsonb,'returnIds','[]'::jsonb,'receipts','[{"incomeId":"935001","amount":"80"}]'::jsonb,'rows','[{"productId":"935001","openingQty":"0","receivedQty":"0","regularQty":"0","bundleQty":"0","discountQty":"0","wasteQty":"0","returnedQty":"0","closingQty":"0","regularNet":"0","bundleNet":"0","discountNet":"0"}]'::jsonb)::text payload \gset
SELECT public.accounting_cafe_report_service('review',:'payload'::jsonb,'2375b60c-c418-47c2-b157-af80b262fadf')->>'fingerprint' fingerprint \gset
SELECT public.accounting_cafe_report_service('record',jsonb_build_object('input',:'payload'::jsonb,'fingerprint',:'fingerprint','operationKey',gen_random_uuid(),'summary','{"readyToClose":false,"accountingStatus":"REQUIRES_LEDGER_RECONCILIATION"}'::jsonb),'2375b60c-c418-47c2-b157-af80b262fadf');
SELECT pg_sleep(0.5);
COMMIT;
SQL
psql -X -q -v ON_ERROR_STOP=1 -v cafe=PUBLIC_HUB -f "$task_tmp/worker.sql" > "$task_tmp/a.log" 2>&1 &
first_pid=$!
psql -X -q -v ON_ERROR_STOP=1 -v cafe=PUBLIC_COFFEE -f "$task_tmp/worker.sql" > "$task_tmp/b.log" 2>&1 &
second_pid=$!
first_result=0; second_result=0
wait "$first_pid" || first_result=$?
wait "$second_pid" || second_result=$?
if ! { [[ "$first_result" -eq 0 && "$second_result" -ne 0 ]] || [[ "$first_result" -ne 0 && "$second_result" -eq 0 ]]; } || ! grep -q 'Receipt allocation exceeds net source' "$task_tmp/a.log" "$task_tmp/b.log"; then
 cat "$task_tmp/a.log" "$task_tmp/b.log"
 echo 'Expected exactly one competing 80-of-120 cafe allocation to succeed' >&2
 exit 1
fi
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM bunbun_accounting.cafe_reports)<>1 OR (SELECT sum(amount) FROM bunbun_accounting.cafe_report_receipts)<>80 OR EXISTS(SELECT 1 FROM bunbun_accounting.journals)
 THEN RAISE EXCEPTION 'Concurrent reports spent a deposit twice or left a partial report'; END IF;
END $$;
SQL
echo 'PASS: two cafe reports cannot allocate 80 each from one net deposit of 120; one succeeds, 40 remains'
