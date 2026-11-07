#!/usr/bin/env bash
set -euo pipefail
if [[ -z "$PGDATABASE" ]]; then exit 2; fi
log_a="$(mktemp)"
log_b="$(mktemp)"
trap 'rm -f "$log_a" "$log_b"' EXIT
psql -X -v ON_ERROR_STOP=1 -f tests/sql/accounting-sale-race-a.sql >"$log_a" 2>&1 &
pid=$!
ready=0
for _ in $(seq 1 100); do
  if grep -q SALE_LOT_A_LOCKED "$log_a"; then ready=1; break; fi
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$ready" != 1 ]]; then cat "$log_a"; wait "$pid" || true; exit 1; fi
set +e
psql -X -v ON_ERROR_STOP=1 -f tests/sql/accounting-sale-race-b.sql >"$log_b" 2>&1
b=$?
wait "$pid"
a=$?
set -e
if [[ "$a" -ne 0 || "$b" -eq 0 ]]; then cat "$log_a"; cat "$log_b"; exit 1; fi
if ! grep -q "Wrong or insufficient sale lot" "$log_b"; then cat "$log_b"; exit 1; fi
state="$(psql -X -t -A -v ON_ERROR_STOP=1 -c "
select (select count(*) from public.sales),
 (select count(*) from public.sale_items),
 (select count(*) from public.product_stock_movements where movement_type='CAFE_OUT'),
 (select available_qty from bunbun_accounting.finished_lot_positions where lot_key='split:101'),
 (select count(*) from bunbun_accounting.lot_sale_transactions where status='RECORDED'),
 (select count(*) from bunbun_accounting.lot_sale_transactions where operation_key='c2222222-2222-4222-8222-999999999999')
")"
if [[ "$state" != "1|1|1|1|1|0" ]]; then echo "Unbalanced source: $state" >&2; exit 1; fi
echo 'PASS: sale race leaves exactly one sale and correct remaining source lot.'
