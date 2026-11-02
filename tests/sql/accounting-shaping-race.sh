#!/usr/bin/env bash
set -euo pipefail
if [[ -z "$PGDATABASE" ]]; then
  echo 'PGDATABASE must be an isolated disposable DB' >&2
  exit 1
fi
log_a="$(mktemp)"
log_b="$(mktemp)"
trap 'rm -f "$log_a" "$log_b"' EXIT

psql -X -v ON_ERROR_STOP=1 -f tests/sql/accounting-shaping-race-a.sql >"$log_a" 2>&1 &
pid_a=$!
ready=0
for _ in $(seq 1 100); do
  if grep -q 'SHAPING_FIRST_BATCH_LOCK_ACQUIRED' "$log_a"; then
    ready=1
    break
  fi
  if ! kill -0 "$pid_a" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$ready" -ne 1 ]]; then
  cat "$log_a"
  wait "$pid_a" || true
  echo 'FAIL: shaping transaction A never obtained parent lock' >&2
  exit 1
fi
set +e
psql -X -v ON_ERROR_STOP=1 -f tests/sql/accounting-shaping-race-b.sql >"$log_b" 2>&1
result_b=$?
wait "$pid_a"
result_a=$?
set -e
if [[ "$result_a" -ne 0 || "$result_b" -eq 0 ]]; then
  cat "$log_a"
  cat "$log_b"
  echo 'FAIL: expected one shaping success and one conflicting allocation rejection' >&2
  exit 1
fi
if ! grep -q 'Batch was shaped already with a different request' "$log_b"; then
  cat "$log_b"
  echo 'FAIL: competing shaping request failed for unexpected reason' >&2
  exit 1
fi

state="$(psql -X -A -t -v ON_ERROR_STOP=1 -c "
select
  (select count(*) from bunbun_accounting.shaping_operations where batch_id=77),
  (select count(*) from public.production_batch_splits where production_batch_id=77),
  (select coalesce(sum(qty),0) from public.production_batch_splits
     where production_batch_id=77 and source_split_id is null),
  (select count(*) from public.product_stock_movements
     where operation_key='c1111111-1111-4111-8111-777777777777'
     and movement_type='FROZEN_IN'),
  (select coalesce(sum(available_qty),0)
     from bunbun_accounting.frozen_lot_positions f
     join public.production_batch_splits s on s.id=f.source_split_id
     where s.production_batch_id=77),
  (select status from public.production_batches where id=77),
  (select count(*) from bunbun_accounting.shaping_operations
     where operation_key='d1111111-1111-4111-8111-777777777777')
")"
if [[ "$state" != "1|2|5|1|4|Split|0" ]]; then
  echo "FAIL: shaping concurrent result inconsistent: $state" >&2
  exit 1
fi
echo 'PASS: two simultaneous shaping attempts cannot duplicate batch roots or frozen lot stock.'
