-- BUNBUN OS — PRODUCTION/STAGING COMPATIBILITY & SOURCE EVIDENCE AUDIT
-- READ ONLY. Returns ONLY aggregated metadata, counts and totals. No PII,
-- no individual transaction identifiers, emails, names or source rows.
-- Safe in SQL Editor as SELECT; never use its numbers as certified HPP.
--
-- IMPORTANT: source roles and stock balances are audited for discrepancies,
-- not modified. Run separately on production (read-only) and staging to
-- compare schema contracts. Confirm stage ref by Supabase project dashboard.

with
expected_columns(table_name,column_name) as (
  values
  ('profiles','role'),('profiles','is_active'),
  ('production_batches','inventory_consumed'),
  ('production_batches','target'),('production_batches','selesai'),
  ('production_batches','reject'),('production_batches','status'),
  ('production_batch_splits','production_batch_id'),
  ('production_batch_splits','source_split_id'),
  ('production_batch_splits','route'),('production_batch_splits','qty'),
  ('production_batch_splits','status'),
  ('production_batch_splits','lot_code'),
  ('product_stock_movements','batch_split_id'),
  ('product_stock_movements','operation_key'),
  ('product_stock_movements','movement_type'),
  ('product_stock_movements','sale_id'),
  ('product_stock_movements','product_id'),
  ('product_stock_movements','qty'),
  ('sales','operation_key'),('sales','is_deleted'),
  ('sale_items','product_id'),('sale_items','quantity'),
  ('incomes','pemasukan_bunbun'),('incomes','tanggal'),
  ('purchases','ingredient_id'),('purchases','total'),
  ('expenses','purchase_id'),('expenses','nominal'),
  ('inventory_transactions','unit_value'),
  ('inventory_transactions','transaction_type'),
  ('ingredients','harga'),
  ('finished_product_stock_balances','product_id'),
  ('finished_product_stock_balances','saldo')
),
missing_columns as (
  select e.table_name||'.'||e.column_name as missing
  from expected_columns e
  left join information_schema.columns c
    on c.table_schema='public'
    and c.table_name=e.table_name and c.column_name=e.column_name
  where c.column_name is null
),
required_functions(proname) as (
  values ('record_shaping_split'),('release_frozen_stock'),
  ('record_baking_result'),('record_cafe_deposit'),
  ('record_multi_product_release'),('record_sale_transaction'),
  ('update_sale_transaction'),('delete_sale_transaction'),
  ('record_product_stock_adjustment')
),
missing_functions as (
  select f.proname as missing from required_functions f
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=f.proname
  )
),
legacy_acl as (
  select p.proname, p.prosecdef as security_definer,
    has_function_privilege('anon',p.oid,'EXECUTE') as callable_by_anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as callable_by_authenticated
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname in (select proname from required_functions)
),
finished_book as (
  select product_id,
  sum(case when movement_type in
    ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN')
    then qty
    when movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -qty
    else 0 end)::bigint as calculated_balance
  from public.product_stock_movements
  where not is_deleted group by product_id
),
cache_gap as (
  select coalesce(b.product_id,c.product_id) product_id,
    coalesce(b.calculated_balance,0) as calculated,
    coalesce(c.saldo,0) as cached
  from finished_book b full outer join public.finished_product_stock_balances c
  on c.product_id=b.product_id
  where coalesce(b.calculated_balance,0)<>coalesce(c.saldo,0)
)
select jsonb_build_object(
  'pg_version',current_setting('server_version'),
  'accounting_private_schema_exists',exists(
    select 1 from pg_namespace where nspname='bunbun_accounting'),
  'missing_schema_columns',coalesce(
    (select jsonb_agg(missing order by missing) from missing_columns),'[]'::jsonb),
  'missing_legacy_rpcs',coalesce(
    (select jsonb_agg(missing order by missing) from missing_functions),'[]'::jsonb),
  'legacy_rpc_access',coalesce(
    (select jsonb_agg(to_jsonb(legacy_acl) order by proname) from legacy_acl),'[]'::jsonb),
  'cached_finished_balance_mismatch_count',(select count(*) from cache_gap),
  'cached_finished_balance_total_book',(select coalesce(sum(calculated_balance),0) from finished_book),
  'cached_finished_balance_total_cache',(
    select coalesce(sum(saldo),0) from public.finished_product_stock_balances),
  'production_out_unit_value_missing',(
    select count(*) from public.inventory_transactions
    where not is_deleted and transaction_type='PRODUCTION_OUT'
      and unit_value is null),
  'production_out_total',(
    select count(*) from public.inventory_transactions
    where not is_deleted and transaction_type='PRODUCTION_OUT'),
  'purchase_linked_expense_rows',(
    select count(*) from public.expenses
    where not is_deleted and purchase_id is not null),
  'unlinked_expense_rows',(
    select count(*) from public.expenses
    where not is_deleted and purchase_id is null),
  'sales_without_operation_key',(
    select count(*) from public.sales
    where not is_deleted and operation_key is null),
  'cafe_out_without_sale_link',(
    select count(*) from public.product_stock_movements
    where not is_deleted and movement_type='CAFE_OUT' and sale_id is null),
  'source_batch_finished_count',(
    select count(*) from public.production_batches
    where not is_deleted and status='Finished'),
  'unposted_ledger_assumptions_allowed',false,
  'can_certify_actual_hpp',false,
  'can_activate_stock_cutover',false
) as staging_source_readiness;
