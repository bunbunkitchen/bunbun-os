#!/usr/bin/env bash
set -euo pipefail
if [[ "${BUNBUN_SOURCE_ACCOUNTING_CI:-}" != "isolated-local" || "${PGDATABASE:-}" != "bunbun_product_flow_ci" || ! "${PGHOST:-}" =~ ^(localhost|127\.0\.0\.1)$ ]]; then
 echo 'Refusing nonlocal or unconfirmed product-flow CI target' >&2
 exit 1
fi
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -f tests/sql/source-product-flow-race-seed.sql
cat > "$task_tmp/worker.sql" <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
SELECT jsonb_build_object('kind','SALE','saleId',:'sale_id','date','2026-11-04','cafeKey','','lossPolicy','NONE','rejectCost','0',
 'traceConfirmed',true,'noAdditionalBakingCostConfirmed',false,'evidenceRef','LOCAL-FLOW-RACE-COGS',
 'allocations','[{"splitId":"925001","location":"FINISHED","cafeKey":"","quantity":"7"}]'::jsonb)::text AS payload \gset
SELECT public.accounting_product_flow_service('review',:'payload'::jsonb,'2375b60c-c418-47c2-b157-af80b262fadf')->>'sourceSnapshot' AS snapshot \gset
SELECT public.accounting_product_flow_service('post',:'payload'::jsonb||jsonb_build_object('sourceSnapshot',:'snapshot','operationKey',gen_random_uuid()),'2375b60c-c418-47c2-b157-af80b262fadf');
SELECT pg_sleep(0.5);
COMMIT;
SQL
psql -X -q -v ON_ERROR_STOP=1 -v sale_id=925001 -f "$task_tmp/worker.sql" > "$task_tmp/a.log" 2>&1 &
first_pid=$!
psql -X -q -v ON_ERROR_STOP=1 -v sale_id=925002 -f "$task_tmp/worker.sql" > "$task_tmp/b.log" 2>&1 &
second_pid=$!
first_result=0; second_result=0
wait "$first_pid" || first_result=$?
wait "$second_pid" || second_result=$?
if ! { [[ "$first_result" -eq 0 && "$second_result" -ne 0 ]] || [[ "$first_result" -ne 0 && "$second_result" -eq 0 ]]; } || ! grep -q 'Insufficient valued lot position' "$task_tmp/a.log" "$task_tmp/b.log"; then
 cat "$task_tmp/a.log" "$task_tmp/b.log"
 echo 'Expected exactly one racing COGS posting to succeed' >&2
 exit 1
fi
psql -X -q -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM bunbun_accounting.product_cost_events)<>1
 OR (SELECT count(*) FROM bunbun_accounting.journals)<>4
 OR (SELECT quantity FROM bunbun_accounting.product_cost_positions WHERE split_id=925001)<>3
 OR (SELECT actual_value FROM bunbun_accounting.product_cost_positions WHERE split_id=925001)<>30
 OR (SELECT sum(debit-credit) FROM bunbun_accounting.v_posted_lines WHERE account_code='5010')<>70
 OR (SELECT count(*) FROM bunbun_accounting.sale_postings WHERE cogs_status='POSTED')<>1
 THEN RAISE EXCEPTION 'Concurrent COGS double-spent the lot or left partial journals'; END IF;
END $$;
SQL
echo 'PASS: two 7-unit sold costs cannot spend a 10-unit/100 position twice; one COGS 70, inventory 3/30 remains'
