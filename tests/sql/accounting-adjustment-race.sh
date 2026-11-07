#!/usr/bin/env bash
set -euo pipefail
if [[ -z "$PGDATABASE" ]]; then echo "Disposable PGDATABASE required" >&2; exit 2; fi
log_a="$(mktemp)"
log_b="$(mktemp)"
trap 'rm -f "$log_a" "$log_b"' EXIT
psql -X -v ON_ERROR_STOP=1 -f tests/sql/accounting-adjustment-race-a.sql >"$log_a" 2>&1 &
pid_a=$!
ready=0
for _ in $(seq 1 100); do
  if grep -q ADJUSTMENT_FIRST_PRODUCT_LOCK "$log_a"; then ready=1; break; fi
  if ! kill -0 "$pid_a" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$ready" != 1 ]]; then
  cat "$log_a"
  wait "$pid_a" || true
  echo 'FAIL: adjustment writer never acquired lock' >&2
  exit 1
fi
set +e
psql -X -v ON_ERROR_STOP=1 -f tests/sql/accounting-adjustment-race-b.sql >"$log_b" 2>&1
result_b=$?
wait "$pid_a"
result_a=$?
set -e
if [[ "$result_a" -ne 0 || "$result_b" -eq 0 ]]; then
  cat "$log_a"; cat "$log_b"
  echo 'FAIL: both adjustments succeeded or first failed' >&2
  exit 1
fi
if ! grep -q 'Adjustment cannot consume this source lot' "$log_b"; then
  cat "$log_b"
  echo 'FAIL: competing adjustment rejected for unexpected reason' >&2
  exit 1
fi
state="$(psql -X -A -t -v ON_ERROR_STOP=1 -c "
select
  (select available_qty from bunbun_accounting.finished_lot_positions where lot_key='split:101'),
  (select count(*) from bunbun_accounting.product_lot_adjustments where status='RECORDED'),
  (select count(*) from public.product_stock_movements where movement_type='ADJUSTMENT_OUT'),
  (select count(*) from bunbun_accounting.product_lot_adjustment_lines),
  (select count(*) from bunbun_accounting.product_lot_adjustments where operation_key='a2222222-2222-4222-8222-777777777777')
")"
if [[ "$state" != "2|1|1|1|0" ]]; then
  echo "FAIL: wrong stock/lot state after concurrent adjustment: $state" >&2
  exit 1
fi
echo 'PASS: competing adjustment OUT serializes on product/lot; one wins, second leaves no ghost movement.'
