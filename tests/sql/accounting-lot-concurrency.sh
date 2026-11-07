#!/usr/bin/env bash
set -euo pipefail

if [[ -z "$PGDATABASE" ]]; then
  echo 'PGDATABASE must point to an isolated disposable DB.' >&2
  exit 1
fi
log_a="$(mktemp)"
log_b="$(mktemp)"
trap 'rm -f "$log_a" "$log_b"' EXIT

psql -X -v ON_ERROR_STOP=1 \
  -f tests/sql/accounting-lot-concurrency-a.sql >"$log_a" 2>&1 &
pid_a=$!

# Explicit handshake: transaction A has acquired product row lock.
ready=0
for _ in $(seq 1 100); do
  if grep -q 'LOT_LOCK_ACQUIRED' "$log_a"; then
    ready=1
    break
  fi
  if ! kill -0 "$pid_a" 2>/dev/null; then
    break
  fi
  sleep 0.1
done
if [[ "$ready" -ne 1 ]]; then
  cat "$log_a"
  wait "$pid_a" || true
  echo 'FAIL: first session never acquired the product lock' >&2
  exit 1
fi

# Session B is guaranteed to contend with session A on the same product row.
set +e
psql -X -v ON_ERROR_STOP=1 \
  -f tests/sql/accounting-lot-concurrency-b.sql >"$log_b" 2>&1
result_b=$?
wait "$pid_a"
result_a=$?
set -e

if [[ "$result_a" -ne 0 || "$result_b" -eq 0 ]]; then
  cat "$log_a"
  cat "$log_b"
  echo 'FAIL: expected A success and B stock denial' >&2
  exit 1
fi
if ! grep -q 'Finished stock insufficient' "$log_b"; then
  cat "$log_b"
  echo 'FAIL: B was denied for an unexpected reason' >&2
  exit 1
fi

state="$(psql -X -A -t -v ON_ERROR_STOP=1 -c "
  select
    (select count(*) from public.product_stock_movements
       where movement_type='CAFE_OUT' and is_deleted=false),
    (select coalesce(sum(qty),0) from public.product_stock_movements
       where movement_type='CAFE_OUT' and is_deleted=false),
    (select available_qty from bunbun_accounting.finished_lot_positions
       where lot_key='split:101'),
    (select count(*) from bunbun_accounting.lot_release_operations
       where status='RECORDED'),
    (select count(*) from bunbun_accounting.lot_release_operations
       where operation_key='22222222-2222-4222-8222-444444444444')
")"
if [[ "$state" != "1|6|0|1|0" ]]; then
  echo "FAIL: wrong state after competing lot releases: $state" >&2
  exit 1
fi

echo 'PASS: concurrent release is serialized; only one 6-pc lot release, no overdraft or ghost operation.'
