-- ISOLATED SUPABASE STAGING ONLY: pkgrqalpazhwdcxmthvb. Never production.
-- Reviewed private ledger core, derived from schema/posting/report proposals.
-- No business rows, opening approvals, operational writer changes or Edge posting.
-- Caller MUST verify the exact project ref before execution.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(hashtext('bunbun-staging-ledger-core'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='bunbun_accounting') THEN
  RAISE EXCEPTION 'Ledger already exists; review version before applying';
 END IF;
 IF to_regclass('public.profiles') IS NULL THEN RAISE EXCEPTION 'Missing baseline profiles'; END IF;
END $$;

create schema if not exists bunbun_accounting;
revoke all on schema bunbun_accounting from public, anon, authenticated;
grant usage on schema bunbun_accounting to service_role;

create table bunbun_accounting.accounts (
  code text primary key check (code ~ '^[0-9]{4}$'),
  name text not null,
  kind text not null check (kind in
    ('ASSET','LIABILITY','EQUITY','CONTRA_EQUITY',
     'REVENUE','CONTRA_REVENUE','COGS','EXPENSE')),
  is_cash boolean not null default false,
  active boolean not null default true
);

create table bunbun_accounting.periods (
  id uuid primary key default gen_random_uuid(),
  month_start date not null unique,
  cutover_on date,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','OPEN','CLOSED')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (month_start = date_trunc('month', month_start)::date),
  check (cutover_on is null or
    (cutover_on >= month_start and cutover_on < month_start + interval '1 month')),
  check (status = 'DRAFT' or
    (approved_by is not null and approved_at is not null))
);

create table bunbun_accounting.opening_snapshots (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null unique
    references bunbun_accounting.periods(id) on delete restrict,
  cutover_on date not null,
  opening_payload jsonb not null,
  evidence_summary text not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','APPROVED')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(opening_payload) = 'object'),
  check (status = 'DRAFT' or
    (approved_by is not null and approved_at is not null))
);

create table bunbun_accounting.journals (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null
    references bunbun_accounting.periods(id) on delete restrict,
  posting_date date not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','POSTED')),
  source_type text not null
    check (source_type in ('OPENING','NORMAL','REVERSAL')),
  source_key text not null unique,
  operation_key uuid not null unique,
  cash_flow_category text
    check (cash_flow_category in ('OPERATING','INVESTING','FINANCING','TRANSFER')),
  reversal_of uuid unique
    references bunbun_accounting.journals(id) on delete restrict,
  narrative text not null default '',
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  check (status = 'DRAFT' or
    (approved_by is not null and posted_at is not null)),
  check (source_type = 'REVERSAL' or reversal_of is null)
);

create unique index one_opening_journal_per_period
  on bunbun_accounting.journals(period_id)
  where source_type = 'OPENING';

create index journal_period_date
  on bunbun_accounting.journals(period_id, posting_date);

create table bunbun_accounting.journal_lines (
  id bigint generated always as identity primary key,
  journal_id uuid not null
    references bunbun_accounting.journals(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  account_code text not null
    references bunbun_accounting.accounts(code),
  debit numeric(18,2) not null default 0 check (debit >= 0),
  credit numeric(18,2) not null default 0 check (credit >= 0),
  product_id bigint,
  ingredient_id bigint,
  batch_id bigint,
  note text,
  unique (journal_id, line_number),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create index lines_by_account on bunbun_accounting.journal_lines(account_code);

create table bunbun_accounting.stock_cost_movements (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null
    references bunbun_accounting.journals(id) on delete restrict,
  source_key text not null unique,
  ingredient_id bigint,
  product_id bigint,
  batch_id bigint,
  valuation_class text not null check
    (valuation_class in ('RAW','WIP','FINISHED','FROZEN','CONSIGNMENT')),
  quantity_base numeric(20,6) not null,
  value_delta numeric(18,2) not null,
  base_unit text not null,
  created_at timestamptz not null default now(),
  check (ingredient_id is not null or product_id is not null)
);

create table bunbun_accounting.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table bunbun_accounting.accounts enable row level security;
alter table bunbun_accounting.periods enable row level security;
alter table bunbun_accounting.opening_snapshots enable row level security;
alter table bunbun_accounting.journals enable row level security;
alter table bunbun_accounting.journal_lines enable row level security;
alter table bunbun_accounting.stock_cost_movements enable row level security;
alter table bunbun_accounting.audit_events enable row level security;

revoke all on all tables in schema bunbun_accounting
  from public, anon, authenticated;
revoke all on all sequences in schema bunbun_accounting
  from public, anon, authenticated;
grant all on all tables in schema bunbun_accounting to service_role;
grant usage, select on all sequences in schema bunbun_accounting to service_role;

insert into bunbun_accounting.accounts (code,name,kind,is_cash) values
('1010','Kas Tunai','ASSET',true),
('1020','Bank','ASSET',true),
('1120','Piutang Usaha','ASSET',false),
('1210','Persediaan Bahan Baku','ASSET',false),
('1215','Produksi Dalam Proses','ASSET',false),
('1220','Persediaan Produk Jadi','ASSET',false),
('1230','Persediaan Produk Frozen','ASSET',false),
('1240','Produk Titipan Kafe Belum Terjual','ASSET',false),
('1590','Aset Usaha Lain','ASSET',false),
('2010','Utang Usaha','LIABILITY',false),
('2090','Kewajiban Usaha Lain','LIABILITY',false),
('3000','Ekuitas Awal Penyeimbang','EQUITY',false),
('3100','Setoran Modal Owner','EQUITY',false),
('3200','Prive Owner','CONTRA_EQUITY',false),
('4010','Pendapatan Penjualan Hak Bunbun','REVENUE',false),
('4020','Pendapatan Wholesale','REVENUE',false),
('4090','Retur dan Potongan Pendapatan','CONTRA_REVENUE',false),
('5010','HPP Produk Terjual','COGS',false),
('6010','Beban Gaji Nonproduksi','EXPENSE',false),
('6020','Beban Utilitas Nonproduksi','EXPENSE',false),
('6030','Beban Maintenance Periode','EXPENSE',false),
('6040','Beban Penyusutan Periode','EXPENSE',false),
('6050','Beban Sewa Periode','EXPENSE',false),
('6060','Beban Operasional Lain','EXPENSE',false),
('6070','Kerugian Stok Abnormal','EXPENSE',false)
on conflict (code) do nothing;


create unique index if not exists one_global_opening_journal
  on bunbun_accounting.journals (source_type)
  where source_type = 'OPENING';

create or replace function bunbun_accounting.protect_finalized()
returns trigger language plpgsql security invoker
set search_path = pg_catalog
as $fn$
declare v_status text;
begin
  if tg_table_name = 'journals' then
    if tg_op <> 'INSERT' and old.status = 'POSTED' then
      raise exception 'Posted journal is immutable; use a reversal';
    end if;
    if tg_op = 'UPDATE' and new.status = 'POSTED'
       and coalesce(current_setting('bunbun_accounting.posting', true), '') <> 'allowed' then
      raise exception 'Cannot mark posted outside controlled posting routine';
    end if;
  elsif tg_table_name = 'journal_lines' then
    select status into v_status
    from bunbun_accounting.journals
    where id = case when tg_op = 'DELETE' then old.journal_id else new.journal_id end;
    if v_status = 'POSTED' then
      raise exception 'Posted journal lines are immutable';
    end if;
    if tg_op = 'UPDATE' and new.journal_id <> old.journal_id then
      raise exception 'Journal lines cannot move between journals';
    end if;
  elsif tg_table_name = 'opening_snapshots' then
    if tg_op <> 'INSERT' and old.status = 'APPROVED' then
      raise exception 'Approved opening snapshot is immutable';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$fn$;

create trigger protect_journal_final
before update or delete on bunbun_accounting.journals
for each row execute function bunbun_accounting.protect_finalized();

create trigger protect_journal_lines_final
before insert or update or delete on bunbun_accounting.journal_lines
for each row execute function bunbun_accounting.protect_finalized();

create trigger protect_opening_snapshot_final
before update or delete on bunbun_accounting.opening_snapshots
for each row execute function bunbun_accounting.protect_finalized();

create or replace function bunbun_accounting.protect_period()
returns trigger language plpgsql security invoker
set search_path = pg_catalog
as $fn$
begin
  if tg_op = 'DELETE' and old.status <> 'DRAFT' then
    raise exception 'Approved period cannot be deleted';
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'CLOSED' then
      raise exception 'Closed accounting period cannot be reopened';
    end if;
    if old.status = 'OPEN' and (
      new.month_start is distinct from old.month_start
      or new.cutover_on is distinct from old.cutover_on
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
      or new.status = 'DRAFT'
    ) then
      raise exception 'Approved period fields cannot change';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$fn$;

create trigger protect_accounting_period
before update or delete on bunbun_accounting.periods
for each row execute function bunbun_accounting.protect_period();

create or replace function bunbun_accounting.post_reviewed_journal(
  p_journal_id uuid,
  p_actor_id uuid
) returns uuid
language plpgsql security invoker
set search_path = pg_catalog
as $fn$
declare
  v_period_id uuid;
  v_period bunbun_accounting.periods%rowtype;
  v_journal bunbun_accounting.journals%rowtype;
  v_opening bunbun_accounting.journals%rowtype;
  v_original bunbun_accounting.journals%rowtype;
  v_count integer;
  v_debit numeric(20,2);
  v_credit numeric(20,2);
  v_cash_debit numeric(20,2);
  v_cash_credit numeric(20,2);
  v_cash_count integer;
  v_noncash_count integer;
  v_unapproved integer;
  v_valid_reversed integer;
  v_original_count integer;
begin
  if current_user <> 'service_role' then
    raise exception 'Posting requires private service role';
  end if;
  if p_actor_id is null or not exists (
    select 1 from public.profiles
    where id = p_actor_id and role::text = 'owner' and is_active = true
  ) then
    raise exception 'Active Owner approval required';
  end if;

  select period_id into v_period_id from bunbun_accounting.journals
  where id = p_journal_id;
  if v_period_id is null then raise exception 'Journal not found'; end if;

  select * into v_period from bunbun_accounting.periods
  where id = v_period_id for update;
  if not found or v_period.status <> 'OPEN' then
    raise exception 'Accounting period is not OPEN';
  end if;

  select * into v_journal from bunbun_accounting.journals
  where id = p_journal_id for update;
  if not found or v_journal.period_id <> v_period_id then
    raise exception 'Journal changed during posting';
  end if;
  if v_journal.status = 'POSTED' then
    if v_journal.approved_by = p_actor_id then return v_journal.id; end if;
    raise exception 'Already posted by another actor';
  end if;
  if v_journal.status <> 'DRAFT' then raise exception 'Journal is not draft'; end if;

  if v_journal.posting_date < v_period.month_start
     or v_journal.posting_date >= (v_period.month_start + interval '1 month')::date then
    raise exception 'Journal date outside accounting period';
  end if;
  if v_period.cutover_on is not null
     and v_journal.posting_date < v_period.cutover_on then
    raise exception 'Journal date precedes approved cutover';
  end if;

  if v_journal.source_type = 'OPENING' then
    if v_period.cutover_on is null
       or v_journal.posting_date <> v_period.cutover_on
       or v_journal.cash_flow_category is not null then
      raise exception 'Opening must use the approved cutover date and no cash flow category';
    end if;
    if not exists (
      select 1 from bunbun_accounting.opening_snapshots s
      where s.period_id = v_period.id
        and s.status = 'APPROVED'
        and s.cutover_on = v_period.cutover_on
        and s.approved_by is not null
        and s.approved_at is not null
    ) then
      raise exception 'Approved physical opening snapshot required';
    end if;
  else
    select * into v_opening from bunbun_accounting.journals
    where source_type = 'OPENING' and status = 'POSTED'
    limit 1;
    if not found or v_opening.posting_date > v_journal.posting_date then
      raise exception 'Posted opening journal required before normal posting';
    end if;
  end if;

  select count(*)::integer,
         coalesce(sum(l.debit),0),
         coalesce(sum(l.credit),0),
         count(*) filter (where a.active is distinct from true)::integer
    into v_count, v_debit, v_credit, v_unapproved
  from bunbun_accounting.journal_lines l
  join bunbun_accounting.accounts a on a.code = l.account_code
  where l.journal_id = p_journal_id;

  if v_count < 2 or v_debit <= 0 or v_debit <> v_credit or v_unapproved > 0 then
    raise exception 'Journal lines not balanced, inactive or incomplete';
  end if;

  if v_journal.source_type = 'OPENING' and exists (
    select 1 from bunbun_accounting.journal_lines l
    join bunbun_accounting.accounts a on a.code = l.account_code
    where l.journal_id = p_journal_id
      and a.kind in ('REVENUE','CONTRA_REVENUE','COGS','EXPENSE')
  ) then
    raise exception 'Opening cannot contain income or period expenses';
  end if;

  select coalesce(sum(l.debit) filter(where a.is_cash),0),
         coalesce(sum(l.credit) filter(where a.is_cash),0),
         count(*) filter(where a.is_cash)::integer,
         count(*) filter(where not a.is_cash)::integer
    into v_cash_debit, v_cash_credit, v_cash_count, v_noncash_count
  from bunbun_accounting.journal_lines l
  join bunbun_accounting.accounts a on a.code = l.account_code
  where l.journal_id = p_journal_id;

  if v_journal.source_type <> 'OPENING' then
    if v_cash_count = 0 and v_journal.cash_flow_category is not null then
      raise exception 'Noncash event cannot claim cash flow';
    elsif v_cash_count > 0 and v_cash_debit = v_cash_credit then
      if v_noncash_count > 0
         or v_journal.cash_flow_category is distinct from 'TRANSFER'
         or v_cash_debit = 0 then
        raise exception 'Equal cash debit/credit must be pure internal transfer';
      end if;
    elsif v_cash_count > 0 then
      if v_cash_debit > 0 and v_cash_credit > 0 then
        raise exception 'Mixed cash inflows/outflows require separate journals';
      end if;
      if v_journal.cash_flow_category not in ('OPERATING','INVESTING','FINANCING')
         or v_journal.cash_flow_category is null then
        raise exception 'Cash flow classification required';
      end if;
    end if;
  end if;

  if v_journal.source_type = 'REVERSAL' then
    if v_journal.reversal_of is null then
      raise exception 'Reversal must identify original journal';
    end if;
    select * into v_original from bunbun_accounting.journals
    where id = v_journal.reversal_of;
    if not found or v_original.status <> 'POSTED'
       or v_original.source_type <> 'NORMAL'
       or v_original.cash_flow_category is distinct from v_journal.cash_flow_category then
      raise exception 'Reversal original must be posted normal entry with same cash category';
    end if;
    select count(*) into v_original_count from bunbun_accounting.journal_lines
    where journal_id = v_original.id;
    select count(*) into v_valid_reversed
    from bunbun_accounting.journal_lines l
    join bunbun_accounting.journal_lines r
      on r.journal_id = v_original.id and r.line_number = l.line_number
    where l.journal_id = v_journal.id
      and l.account_code = r.account_code
      and l.debit = r.credit
      and l.credit = r.debit;
    if v_valid_reversed <> v_count or v_valid_reversed <> v_original_count then
      raise exception 'Reversal lines must exactly cancel the original';
    end if;
  elsif v_journal.reversal_of is not null then
    raise exception 'Only reversal entries may reference an original journal';
  end if;

  perform set_config('bunbun_accounting.posting', 'allowed', true);
  update bunbun_accounting.journals
     set status = 'POSTED', approved_by = p_actor_id, posted_at = now()
   where id = p_journal_id;
  perform set_config('bunbun_accounting.posting', '', true);

  insert into bunbun_accounting.audit_events
    (actor_id, action, entity_type, entity_id, details)
  values (p_actor_id, 'POST_JOURNAL', 'journal', p_journal_id::text,
    jsonb_build_object('source_key', v_journal.source_key,
                       'debit', v_debit, 'credit', v_credit,
                       'category', v_journal.cash_flow_category));
  return p_journal_id;
end
$fn$;

revoke all on function bunbun_accounting.post_reviewed_journal(uuid,uuid)
  from public, anon, authenticated;
grant execute on function bunbun_accounting.post_reviewed_journal(uuid,uuid)
  to service_role;


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
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bunbun_accounting FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION bunbun_accounting.post_reviewed_journal(uuid,uuid) TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA bunbun_accounting REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA bunbun_accounting REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated;
COMMIT;
