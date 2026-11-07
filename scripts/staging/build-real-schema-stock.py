#!/usr/bin/env python3
"""Generate the reviewed isolated staging stock adapter. Does not execute SQL."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
parts=['accounting-lot-release-staging', 'accounting-lot-writer-gate-staging', 'accounting-frozen-baking-staging', 'accounting-shaping-batch-staging', 'accounting-sales-lot-staging', 'accounting-sales-create-staging', 'accounting-sales-cancel-staging', 'accounting-sales-edit-staging', 'accounting-single-cafe-lot-staging', 'accounting-product-adjustment-staging', 'accounting-product-adjustment-operations-staging', 'accounting-unified-stock-gate-staging', 'accounting-unified-position-protection-staging']
sql="BEGIN;\nSET LOCAL statement_timeout='60s';\nSET LOCAL lock_timeout='5s';\n"+'\n'.join('\n'.join(l for l in (ROOT/'docs/sql'/f'{p}.sql').read_text().splitlines() if not l.lstrip().startswith('--')) for p in parts)
a=sql.index('alter table public.product_stock_movements\n  add column if not exists batch_split_id bigint;')
b=sql.index('create table bunbun_accounting.product_lot_adjustments',a)
sql=sql[:a]+sql[b:]
sql=sql.replace("create unique index staging_frozen_lot_code\non public.production_batch_splits(lower(lot_code))\nwhere route='FROZEN' and lot_code is not null;",'')
needle="if not found then raise exception 'Production batch not found'; end if;"
assert sql.count(needle)==1
sql=sql.replace(needle,needle+"\n if p_frozen_qty>0 and btrim(p_frozen_lot_code) IS DISTINCT FROM\n   (CASE WHEN v_batch.kode LIKE 'PB-%' THEN 'LOT-'||substring(v_batch.kode from 4)\n        ELSE 'LOT-'||v_batch.kode END) THEN\n   RAISE EXCEPTION 'Frozen lot code must match automatic batch lot code';\n end if;\n")
(ROOT/'docs/sql/cloud-stock-writers-staging.sql').write_text('-- ISOLATED STAGING pkgrqalpazhwdcxmthvb ONLY. Caller must verify ref.\n-- Real operational schema adapter; no synthetic tables or relaxed constraints.\n-- No UI activation, public RPC replacement, cost posting or opening approval.\n'+sql+'\nCOMMIT;\n')
