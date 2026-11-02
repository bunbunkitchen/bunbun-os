-- Bunbun OS accounting reports — ONLY FOR EPHEMERAL PG CI.
-- This file is not a Supabase migration; it has not been applied to production.
-- SECURITY INVOKER views only include POSTED rows, inside a private schema
-- which is not exposed through the Data API.

create or replace view bunbun_accounting.v_posted_lines
with (security_invoker = true) as
select
  j.id as journal_id,
  j.period_id,
  j.posting_date,
  j.source_type,
  j.source_key,
  j.cash_flow_category,
  l.account_code,
  a.kind as account_kind,
  a.is_cash,
  l.debit,
  l.credit
from bunbun_accounting.journals j
join bunbun_accounting.journal_lines l on l.journal_id = j.id
join bunbun_accounting.accounts a on a.code = l.account_code
where j.status = 'POSTED';

create or replace view bunbun_accounting.v_monthly_profit_loss
with (security_invoker = true) as
select
  p.month_start as month,
  coalesce(sum(case when x.account_kind in ('REVENUE','CONTRA_REVENUE')
    then x.credit - x.debit else 0 end),0)::numeric(18,2) as net_revenue,
  coalesce(sum(case when x.account_kind = 'COGS'
    then x.debit - x.credit else 0 end),0)::numeric(18,2) as cogs,
  coalesce(sum(case when x.account_kind in ('REVENUE','CONTRA_REVENUE','COGS')
    then case when x.account_kind = 'COGS' then x.credit-x.debit
      else x.credit-x.debit end else 0 end),0)::numeric(18,2) as gross_profit,
  coalesce(sum(case when x.account_kind = 'EXPENSE'
    then x.debit - x.credit else 0 end),0)::numeric(18,2) as operating_expenses,
  coalesce(sum(case when x.account_kind in
    ('REVENUE','CONTRA_REVENUE','COGS','EXPENSE')
    then x.credit - x.debit else 0 end),0)::numeric(18,2) as net_profit
from bunbun_accounting.periods p
left join bunbun_accounting.v_posted_lines x
  on x.posting_date >= greatest(p.month_start,coalesce(p.cutover_on,p.month_start))
 and x.posting_date < (p.month_start + interval '1 month')::date
 and x.source_type <> 'OPENING'
where p.status in ('OPEN','CLOSED')
  and exists (select 1 from bunbun_accounting.journals op
    where op.source_type='OPENING' and op.status='POSTED'
      and op.posting_date <= (p.month_start + interval '1 month' - interval '1 day')::date)
group by p.month_start;

create or replace view bunbun_accounting.v_monthly_cash_flow
with (security_invoker = true) as
select
  p.month_start as month,
  coalesce(sum(case when x.is_cash and
    (x.source_type='OPENING' or x.posting_date < p.month_start)
    then x.debit-x.credit else 0 end),0)::numeric(18,2) as opening_cash,
  coalesce(sum(case when x.is_cash and x.source_type <> 'OPENING'
    and x.posting_date >= p.month_start
    and x.cash_flow_category = 'OPERATING'
    then x.debit-x.credit else 0 end),0)::numeric(18,2) as operating,
  coalesce(sum(case when x.is_cash and x.source_type <> 'OPENING'
    and x.posting_date >= p.month_start
    and x.cash_flow_category = 'INVESTING'
    then x.debit-x.credit else 0 end),0)::numeric(18,2) as investing,
  coalesce(sum(case when x.is_cash and x.source_type <> 'OPENING'
    and x.posting_date >= p.month_start
    and x.cash_flow_category = 'FINANCING'
    then x.debit-x.credit else 0 end),0)::numeric(18,2) as financing,
  coalesce(sum(case when x.is_cash and x.source_type <> 'OPENING'
    and x.posting_date >= p.month_start
    then x.debit-x.credit else 0 end),0)::numeric(18,2) as net_cash_change,
  coalesce(sum(case when x.is_cash
    then x.debit-x.credit else 0 end),0)::numeric(18,2) as closing_cash
from bunbun_accounting.periods p
left join bunbun_accounting.v_posted_lines x
  on x.posting_date < (p.month_start + interval '1 month')::date
where p.status in ('OPEN','CLOSED')
  and exists (select 1 from bunbun_accounting.journals op
    where op.source_type='OPENING' and op.status='POSTED'
      and op.posting_date <= (p.month_start + interval '1 month' - interval '1 day')::date)
group by p.month_start;

create or replace view bunbun_accounting.v_monthly_financial_position
with (security_invoker = true) as
select
  p.month_start as month,
  coalesce(sum(case when x.account_kind='ASSET'
    then x.debit-x.credit else 0 end),0)::numeric(18,2) as assets,
  coalesce(sum(case when x.account_kind='LIABILITY'
    then x.credit-x.debit else 0 end),0)::numeric(18,2) as liabilities,
  coalesce(sum(case when x.account_kind in
    ('EQUITY','CONTRA_EQUITY','REVENUE','CONTRA_REVENUE','COGS','EXPENSE')
    then x.credit-x.debit else 0 end),0)::numeric(18,2) as total_equity,
  coalesce(sum(x.debit-x.credit),0)::numeric(18,2) as trial_balance_difference
from bunbun_accounting.periods p
left join bunbun_accounting.v_posted_lines x
  on x.posting_date < (p.month_start + interval '1 month')::date
where p.status in ('OPEN','CLOSED')
  and exists (select 1 from bunbun_accounting.journals op
    where op.source_type='OPENING' and op.status='POSTED'
      and op.posting_date <= (p.month_start + interval '1 month' - interval '1 day')::date)
group by p.month_start;

revoke all on
  bunbun_accounting.v_posted_lines,
  bunbun_accounting.v_monthly_profit_loss,
  bunbun_accounting.v_monthly_cash_flow,
  bunbun_accounting.v_monthly_financial_position
from public, anon, authenticated;
grant select on
  bunbun_accounting.v_posted_lines,
  bunbun_accounting.v_monthly_profit_loss,
  bunbun_accounting.v_monthly_cash_flow,
  bunbun_accounting.v_monthly_financial_position
to service_role;
