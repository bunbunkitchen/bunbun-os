#!/usr/bin/env bash
set -euo pipefail
: "$PGDATABASE"
log_a="$(mktemp)"
log_b="$(mktemp)"
trap 'rm -f "$log_a" "$log_b"' EXIT
psql -X -v ON_ERROR_STOP=1 -f tests/sql/accounting-frozen-race-a.sql >"$log_a" 2>&1 &
pid_a=$!
ready=0
for _ in $(seq 1 100); do
  if grep -q 'FROZEN_FIRST_LOCK_ACQUIRED' "$log_a"; then ready=1; break; fi
  if ! kill -0 "$pid_a" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$ready" != 1 ]]; then
  cat "$log_a"
  wait "$pid_a" || true
  echo 'FAIL: first freezer session did not obtain the lock' >&2
  exit 1
fi
set +e
psql -X -v ON_ERROR_STOP=1 -f tests/sql/accounting-frozen-race-b.sql >"$log_b" 2>&1
result_b=$?
wait "$pid_a"
result_a=$?
set -e
if [[ "$result_a" -ne 0 || "$result_b" -eq 0 ]]; then
  cat "$log_a"
  cat "$log_b"
  echo 'FAIL: freezer concurrency did not allow exactly one transaction' >&2
  exit 1
fi
if ! grep -q 'Frozen lot is missing or insufficient' "$log_b"; then
  cat "$log_b"
  echo 'FAIL: second freezer release denied for unexpected reason' >&2
  exit 1
fi
state="$(psql -X -t -A -v ON_ERROR_STOP=1 -c "
 select
   (select available_qty from bunbun_accounting.frozen_lot_positions
     where source_split_id=200),
   (select count(*) from bunbun_accounting.frozen_conversion_operations),
   (select count(*) from public.product_stock_movements
     where movement_type='FROZEN_OUT'),
   (select count(*) from public.production_batch_splits
     where source_split_id=200 and route='DIRECT' and status='PROOFING'),
   (select count(*) from bunbun_accounting.frozen_conversion_operations
     where operation_key='22222222-2222-4222-8222-555555555555')
")"
if [[ "$state" != "2|1|1|1|0" ]]; then
  echo "FAIL: freezer balance/provenance mismatch after race: $state" >&2
  exit 1
fi
echo 'PASS: two concurrent frozen releases serialize; second overdraw fails without orphan split or source movement.'
