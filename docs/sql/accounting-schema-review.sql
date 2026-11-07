-- BUNBUN OS: REVIEW-ONLY ACCOUNTING SCHEMA PROPOSAL
-- DO NOT EXECUTE IN PRODUCTION. NOT A SUPABASE MIGRATION.
-- Generated for design review; requires staging SQL validation,
-- security advisors, posting/backend tests and explicit Owner approval.
--
-- Private schema is deliberately NOT exposed through Supabase Data API.
-- Only a later trusted server-side posting service may use service_role.
-- No client-side service role key and NO direct authenticated write permission.

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

-- All tables use RLS and remain invisible to anon/authenticated.
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

-- SAMPLE account catalog. Identical codes/types to frontend reporting catalog.
-- This must be reconciled against the actual chart-of-accounts version before migration.
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

-- STILL REQUIRED before any deployment:
-- 1. SQL transaction-safe posting function or trusted Edge Function:
--    lock period, validate signed Owner approval/session, source references,
--    opening snapshot, exactly balanced lines, cash-flow classification and
--    reversal authenticity; write all lines then transition DRAFT -> POSTED.
-- 2. Immutable-on-POSTED triggers for journal headers, journal lines,
--    stock valuation and approved opening snapshots. Use reversal to correct.
-- 3. Validation that there are no multi-event cash flows hidden in one journal.
-- 4. Staging test of RLS, grants, row locking, replay/idempotency, concurrency,
--    time zone, non-negative inventory policy and rollback.
-- 5. Never infer revenue from CAFE_OUT or deposit twice, and never infer
--    cost from historical inventory_transactions.unit_value when missing.
