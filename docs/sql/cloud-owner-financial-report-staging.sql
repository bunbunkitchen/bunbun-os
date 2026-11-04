-- Owner-only posted report transport, no DB URL/password or browser schema grants.
BEGIN;
CREATE FUNCTION public.accounting_owner_financial_report(p_month text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE cutoff date; ending date; costs jsonb; result jsonb;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Private backend required'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND role::text='owner' AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Owner required'; END IF;
 IF p_month IS NULL OR p_month!~'^20[0-9]{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Valid financial month required'; END IF;
 ending:=((p_month||'-01')::date+interval '1 month')::date;
 SELECT min(posting_date) INTO cutoff FROM bunbun_accounting.journals WHERE source_type='OPENING' AND status='POSTED';
 IF cutoff IS NULL OR cutoff>=ending OR NOT EXISTS(SELECT 1 FROM bunbun_accounting.periods WHERE month_start=(p_month||'-01')::date AND status IN('OPEN','CLOSED')) THEN RETURN NULL; END IF;
 costs:=public.accounting_revenue_service('cost_readiness',jsonb_build_object('month',p_month),p_actor_id);
 IF costs->>'soldCostsComplete' IS DISTINCT FROM 'true' OR NOT bunbun_accounting.cafe_ledger_month_ready((p_month||'-01')::date) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_transactions t WHERE NOT t.is_deleted AND t.transaction_type='PRODUCTION_OUT' AND t.transaction_date>=cutoff AND t.transaction_date<ending AND NOT EXISTS(SELECT 1 FROM bunbun_accounting.material_postings x WHERE x.transaction_id=t.id)) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.incomes i WHERE NOT i.is_deleted AND i.tanggal>=cutoff AND i.tanggal<ending AND NOT EXISTS(SELECT 1 FROM bunbun_accounting.income_postings x WHERE x.income_id=i.id))
 OR EXISTS(SELECT 1 FROM public.purchases p WHERE NOT p.is_deleted AND p.tanggal>=cutoff AND p.tanggal<ending AND NOT EXISTS(SELECT 1 FROM bunbun_accounting.purchase_postings x WHERE x.purchase_id=p.id))
 OR EXISTS(SELECT 1 FROM public.expenses e WHERE NOT e.is_deleted AND e.tanggal>=cutoff AND e.tanggal<ending
  AND NOT EXISTS(SELECT 1 FROM bunbun_accounting.expense_postings x WHERE x.expense_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM bunbun_accounting.purchase_postings x WHERE x.expense_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM bunbun_accounting.production_cost_sources x WHERE x.expense_id=e.id)) THEN RETURN NULL; END IF;
 SELECT to_jsonb(report_row) INTO result FROM (
select
  to_char(p.month_start,'YYYY-MM') as month,
  p.status as period_status,
  (select to_char(s.cutover_on, 'YYYY-MM-DD')
   from bunbun_accounting.opening_snapshots s
   join bunbun_accounting.journals j
     on j.period_id = s.period_id
    and j.source_type = 'OPENING' and j.status = 'POSTED'
    and j.posting_date = s.cutover_on
   where s.status = 'APPROVED'
     and s.approved_by is not null and s.approved_at is not null
     and s.cutover_on < (p.month_start + interval '1 month')::date
   order by s.cutover_on limit 1) as cutover_date,
  exists (
    select 1 from bunbun_accounting.opening_snapshots s
    join bunbun_accounting.journals op
      on op.period_id = s.period_id
     and op.source_type = 'OPENING'
     and op.status = 'POSTED'
     and op.posting_date = s.cutover_on
    where s.status = 'APPROVED'
      and s.approved_by is not null and s.approved_at is not null
      and op.posting_date < (p.month_start + interval '1 month')::date
  ) as opening_approved,
  pl.net_revenue::text as net_revenue,
  pl.cogs::text as cogs,
  pl.gross_profit::text as gross_profit,
  pl.operating_expenses::text as operating_expenses,
  pl.net_profit::text as net_profit,
  cf.opening_cash::text as opening_cash,
  cf.operating::text as cash_operating,
  cf.investing::text as cash_investing,
  cf.financing::text as cash_financing,
  cf.net_cash_change::text as net_cash_change,
  cf.closing_cash::text as closing_cash,
  fp.assets::text as assets,
  fp.liabilities::text as liabilities,
  fp.total_equity::text as total_equity,
  fp.trial_balance_difference::text as trial_balance_difference
from bunbun_accounting.periods p
join bunbun_accounting.v_monthly_profit_loss pl
  on pl.month = p.month_start
join bunbun_accounting.v_monthly_cash_flow cf
  on cf.month = p.month_start
join bunbun_accounting.v_monthly_financial_position fp
  on fp.month = p.month_start
where p.month_start = (p_month::text || '-01')::date
  and p.status in ('OPEN','CLOSED')
limit 1
 ) report_row;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.accounting_owner_financial_report(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_owner_financial_report(text,uuid) TO service_role;
COMMIT;
