#!/usr/bin/env bash
set -euo pipefail
if [[ -z "$PGDATABASE" ]]; then
  echo 'Only a disposable PGDATABASE is authorized' >&2
  exit 2
fi
a="$(mktemp)"
b="$(mktemp)"
trap 'rm -f "$a" "$b"' EXIT

psql -X -v ON_ERROR_STOP=1 \
  -f tests/sql/accounting-unified-sale-adjustment-race-a.sql >"$a" 2>&1 &
pid_a=$!
ready=0
for _ in $(seq 1 100); do
  if grep -q 'UNIFIED_SALE_ACQUIRED_SOURCE_LOCK' "$a"; then
    ready=1
    break
  fi
  if ! kill -0 "$pid_a" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$ready" != 1 ]]; then
  cat "$a"
  wait "$pid_a" || true
  echo 'FAIL: sale never obtained canonical product lock' >&2
  exit 1
fi
set +e
psql -X -v ON_ERROR_STOP=1 \
  -f tests/sql/accounting-unified-sale-adjustment-race-b.sql >"$b" 2>&1
code_b=$?
wait "$pid_a"
code_a=$?
set -e
if [[ "$code_a" -ne 0 || "$code_b" -eq 0 ]]; then
  cat "$a"; cat "$b"
  echo 'FAIL: competing sale & adjustment were both recorded' >&2
  exit 1
fi
if ! grep -q 'Adjustment cannot consume this source lot' "$b"; then
  cat "$b"
  echo 'FAIL: refused concurrent OUT for an unexpected reason' >&2
  exit 1
fi

state="$(psql -X -t -A -v ON_ERROR_STOP=1 -c "
 select
  (select count(*) from public.sales where is_deleted=false),
  (select count(*) from public.sale_items),
  (select count(*) from public.product_stock_movements
    where movement_type='CAFE_OUT'),
  (select count(*) from public.product_stock_movements
    where movement_type in ('ADJUSTMENT_OUT','ADJUSTMENT_IN')),
  (select available_qty from bunbun_accounting.finished_lot_positions
    where lot_key='split:101'),
  (select coalesce(sum(available_qty),0)
    from bunbun_accounting.finished_lot_positions where product_id=1),
  (select count(*) from bunbun_accounting.product_lot_adjustments),
  (select count(*) from bunbun_accounting.lot_sale_transactions where status='RECORDED')
")"
if [[ "$state" != '1|1|1|0|1|5|0|1' ]]; then
  echo "FAIL: unified cross-writer lot state inconsistent: $state" >&2
  exit 1
fi
echo 'PASS: concurrent sale and stock adjustment serialize by product/lot; one succeeds, losing adjustment has no orphan row.'
