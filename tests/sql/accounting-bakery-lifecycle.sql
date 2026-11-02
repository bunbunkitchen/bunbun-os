-- Synthetic bakery lifecycle in disposable PostgreSQL CI ONLY.
-- Never run against Bunbun production or import test amounts into actual HPP.
-- This tests accounting events, not real inventory quantities, batch yields,
-- customer settlement approvals or MWA pricing.
--
-- Initial assets: bank 1,000,000; flour inventory 200,000.
-- Purchase 150,000 on credit; pay 100,000.
-- Use 120,000 flour in a batch, finish inventory, ship 100,000 at cost to cafe.
-- Sell 60,000 of that stock for NET Bunbun entitlement 150,000.
-- Receive 90,000 of that receivable; pay 20,000 period salary;
-- transfer 10,000 bank -> cash without creating external cashflow.
--
-- Expected: Net profit = 150,000 - 60,000 - 20,000 = 70,000.
-- Cash 1,000,000 - 100,000 + 90,000 - 20,000 = 970,000.
-- Closing assets = 970,000 cash + 230,000 raw + 20,000 finished +
-- 40,000 consignment + 60,000 receivables = 1,320,000.
-- Liabilities = 50,000; equity incl. current profit = 1,270,000.

insert into bunbun_accounting.periods
 (id,month_start,cutover_on,status,approved_by,approved_at)
values
 ('aaaaaaaa-1111-4111-8111-111111111111',
 '2026-11-01','2026-11-01','OPEN',
 '11111111-1111-4111-8111-111111111111',now());

insert into bunbun_accounting.opening_snapshots
 (period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at)
values
 ('aaaaaaaa-1111-4111-8111-111111111111',
 '2026-11-01',
 '{"verified_bank":1000000,"verified_raw_materials":200000,"test_fixture":true}',
 'CI synthetic opening approval (NOT REAL BUNBUN DATA)','APPROVED',
 '11111111-1111-4111-8111-111111111111',now());

with fixtures(seq,posting_date,source_type,source_key,category) as (
 values
 (1,'2026-11-01'::date,'OPENING','opening:ci-nov',null::text),
 (2,'2026-11-02'::date,'NORMAL','purchase:ci-01',null),
 (3,'2026-11-03'::date,'NORMAL','payment:ci-01','OPERATING'),
 (4,'2026-11-04'::date,'NORMAL','consume:ci-batch-1',null),
 (5,'2026-11-05'::date,'NORMAL','finish:ci-batch-1',null),
 (6,'2026-11-06'::date,'NORMAL','cafe-shipment:ci-1',null),
 (7,'2026-11-07'::date,'NORMAL','sold:ci-1',null),
 (8,'2026-11-07'::date,'NORMAL','sold-cogs:ci-1',null),
 (9,'2026-11-08'::date,'NORMAL','deposit:ci-1','OPERATING'),
 (10,'2026-11-09'::date,'NORMAL','salary:ci-1','OPERATING'),
 (11,'2026-11-10'::date,'NORMAL','transfer:ci-bank-cash','TRANSFER'),
 (12,'2026-11-11'::date,'NORMAL','unposted-fake-sale:ci',null)
)
insert into bunbun_accounting.journals
 (id,period_id,posting_date,source_type,source_key,
  operation_key,status,cash_flow_category,narrative)
select
 ('11111111-1111-4111-8111-' || lpad(seq::text,12,'0'))::uuid,
 'aaaaaaaa-1111-4111-8111-111111111111'::uuid,
 posting_date,source_type,source_key,
 ('22222222-2222-4222-8222-' || lpad(seq::text,12,'0'))::uuid,
 'DRAFT',category,'Synthetic transaction'
from fixtures;

with lines(seq,line_number,account_code,debit,credit) as (
 values
 (1,1,'1020',100000::numeric,0::numeric),
 (1,2,'1210',200000,0),
 (1,3,'3000',0,1200000),
 (2,1,'1210',150000,0),
 (2,2,'2010',0,150000),
 (3,1,'2010',100000,0),
 (3,2,'1020',0,100000),
 (4,1,'1215',120000,0),
 (4,2,'1210',0,120000),
 (5,1,'1220',120000,0),
 (5,2,'1215',0,120000),
 (6,1,'1240',100000,0),
 (6,2,'1220',0,100000),
 (7,1,'1120',150000,0),
 (7,2,'4010',0,150000),
 (8,1,'5010',60000,0),
 (8,2,'1240',0,60000),
 (9,1,'1020',90000,0),
 (9,2,'1120',0,90000),
 (10,1,'6010',20000,0),
 (10,2,'1020',0,20000),
 (11,1,'1010',10000,0),
 (11,2,'1020',0,10000),
 (12,1,'1120',999999,0),
 (12,2,'4010',0,999999)
)
insert into bunbun_accounting.journal_lines
 (journal_id,line_number,account_code,debit,credit)
select
 ('11111111-1111-4111-8111-' || lpad(seq::text,12,'0'))::uuid,
 line_number,account_code,debit,credit from lines;

-- Views cannot report results before the opening is posted.
do $before$
begin
  if (select count(*) from bunbun_accounting.v_monthly_profit_loss) <> 0 then
    raise exception 'Unposted opening leaked into financial report';
  end if;
end
$before$;

set role service_role;
do $post$
declare n integer;
begin
  for n in 1..11 loop
    perform bunbun_accounting.post_reviewed_journal(
      ('11111111-1111-4111-8111-' || lpad(n::text,12,'0'))::uuid,
      '11111111-1111-4111-8111-111111111111');
  end loop;
  -- Repeat a deposit with same operation key; must be idempotent (no second event).
  perform bunbun_accounting.post_reviewed_journal(
    '11111111-1111-4111-8111-000000000009',
    '11111111-1111-4111-8111-111111111111');
end
$post$;

do $verify$
declare p record; c record; b record; v_count integer;
begin
  select * into p from bunbun_accounting.v_monthly_profit_loss
  where month='2026-11-01';
  if not found then raise exception 'No November P&L'; end if;
  if (p.net_revenue,p.cogs,p.gross_profit,p.operating_expenses,p.net_profit)
     is distinct from (150000::numeric,60000::numeric,90000::numeric,
                       20000::numeric,70000::numeric) then
    raise exception 'P&L incorrect: %',row_to_json(p);
  end if;

  select * into c from bunbun_accounting.v_monthly_cash_flow
  where month='2026-11-01';
  if (c.opening_cash,c.operating,c.investing,c.financing,
      c.net_cash_change,c.closing_cash)
     is distinct from (1000000::numeric, -30000::numeric,0::numeric,
                       0::numeric,-30000::numeric,970000::numeric) then
    raise exception 'Cash flow incorrect: %',row_to_json(c);
  end if;
  if c.opening_cash+c.net_cash_change <> c.closing_cash then
    raise exception 'Cash did not reconcile';
  end if;

  select * into b from bunbun_accounting.v_monthly_financial_position
  where month='2026-11-01';
  if (b.assets,b.liabilities,b.total_equity,b.trial_balance_difference)
     is distinct from (1320000::numeric,50000::numeric,
                       1270000::numeric,0::numeric) then
    raise exception 'Balance sheet incorrect: %',row_to_json(b);
  end if;
  if b.assets <> b.liabilities+b.total_equity then
    raise exception 'Assets, liabilities, equity do not reconcile';
  end if;

  select count(*) into v_count from bunbun_accounting.journals
  where status='POSTED';
  if v_count <> 11 then raise exception 'Draft/duplicate was posted'; end if;
  select count(*) into v_count from bunbun_accounting.audit_events
  where entity_id='11111111-1111-4111-8111-000000000009';
  if v_count <> 1 then raise exception 'Partial cafe deposit recognized twice'; end if;

  -- Physical goods may remain on consignment despite partial sales.
  if (select coalesce(sum(l.debit-l.credit),0)
        from bunbun_accounting.v_posted_lines l
        where l.account_code='1240') <> 40000 then
    raise exception 'Unsold cafe consignment must remain an asset';
  end if;

  raise notice 'PASS: purchase -> WIP -> finished -> cafe stock -> partial sale -> partial deposit -> P&L + cashflow + balance';
end
$verify$;
reset role;

select 'PASS: bakery full transaction and reporting lifecycle (CI only)' as result;
