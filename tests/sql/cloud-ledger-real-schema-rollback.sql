-- ISOLATED STAGING pkgrqalpazhwdcxmthvb ONLY. Core must be installed.
-- SQL Owner fixture is synthetic; real login is verified separately.
BEGIN;
SET LOCAL statement_timeout='60s';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM bunbun_accounting.journals) OR EXISTS(SELECT 1 FROM bunbun_accounting.periods) THEN RAISE EXCEPTION 'Requires empty isolated staging ledger'; END IF; END $$;
SAVEPOINT fixture_start;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('11111111-1111-4111-8111-111111111111','rollback-owner@example.invalid','{"full_name":"Synthetic rollback owner"}'),
('22222222-2222-4222-8222-222222222222','rollback-baker@example.invalid','{"full_name":"Synthetic rollback baker"}'),
('33333333-3333-4333-8333-333333333333','rollback-inactive@example.invalid','{"full_name":"Synthetic rollback inactive"}');
UPDATE public.profiles SET role=CASE WHEN id='22222222-2222-4222-8222-222222222222' THEN 'baker'::public.user_role ELSE 'owner'::public.user_role END,
is_active=(id<>'33333333-3333-4333-8333-333333333333') WHERE id IN ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333');
-- Ephemeral PostgreSQL integration tests. Never run on Supabase production.
-- Auth/role bootstrap + schema proposal + posting guard must already be loaded.

insert into bunbun_accounting.periods
 (id, month_start, cutover_on, status, approved_by, approved_at)
values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '2026-11-01','2026-11-10','OPEN',
  '11111111-1111-4111-8111-111111111111',now());

insert into bunbun_accounting.opening_snapshots
 (id, period_id, cutover_on, opening_payload,
  evidence_summary, status, approved_by, approved_at)
values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '2026-11-10','{"physical_count_verified":true,"bank_evidence":"reviewed"}',
 'SIGNED INVENTORY/BANK COUNT (TEST ONLY)','APPROVED',
 '11111111-1111-4111-8111-111111111111',now());

insert into bunbun_accounting.journals
 (id, period_id, posting_date, source_type, source_key,
  operation_key, status, narrative)
values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '2026-11-10','OPENING','opening:2026-11-10',
 'bbbbbbbb-0000-4000-8000-000000000000','DRAFT','Validated opening');

insert into bunbun_accounting.journal_lines
 (journal_id,line_number,account_code,debit,credit)
values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,'1020',500000,0),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',2,'1210',200000,0),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',3,'3000',0,700000);

-- A noncash purchase draft cannot post before the opening journal.
insert into bunbun_accounting.journals
 (id,period_id,posting_date,source_type,source_key,operation_key,status)
values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '2026-11-11','NORMAL','purchase:9001',
 'cccccccc-0000-4000-8000-000000000000','DRAFT');
insert into bunbun_accounting.journal_lines
 (journal_id,line_number,account_code,debit,credit)
values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',1,'1210',10000,0),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',2,'2010',0,10000);

-- Salary cash disbursement and exact reversal.
insert into bunbun_accounting.journals
 (id,period_id,posting_date,source_type,source_key,
  operation_key,status,cash_flow_category)
values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '2026-11-15','NORMAL','salary:2026-11',
 'dddddddd-0000-4000-8000-000000000000','DRAFT','OPERATING'),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '2026-11-16','REVERSAL','reversal:salary:2026-11',
 'ffffffff-0000-4000-8000-000000000000','DRAFT','OPERATING');
update bunbun_accounting.journals
set reversal_of = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
where id='ffffffff-ffff-4fff-8fff-ffffffffffff';

insert into bunbun_accounting.journal_lines
 (journal_id,line_number,account_code,debit,credit)
values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',1,'6010',10000,0),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',2,'1020',0,10000),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff',1,'6010',0,10000),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff',2,'1020',10000,0);

-- A malformed cash journal to verify it cannot post or mutate data.
insert into bunbun_accounting.journals
 (id,period_id,posting_date,source_type,source_key,operation_key,status)
values
 ('99999999-9999-4999-8999-999999999999',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '2026-11-13','NORMAL','deposit:no-category',
 '99999999-0000-4000-8000-000000000000','DRAFT');
insert into bunbun_accounting.journal_lines
 (journal_id,line_number,account_code,debit,credit)
values
 ('99999999-9999-4999-8999-999999999999',1,'1020',20000,0),
 ('99999999-9999-4999-8999-999999999999',2,'1120',0,20000);


-- Additional negative fixtures: unbalanced money, forged reversal and mixed cash.
insert into bunbun_accounting.journals
 (id,period_id,posting_date,source_type,source_key,
  operation_key,status,cash_flow_category,reversal_of)
values
 ('88888888-8888-4888-8888-888888888888',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '2026-11-12','NORMAL','unbalanced:ci',
 '88888888-0000-4000-8000-000000000000','DRAFT',null,null),
 ('77777777-7777-4777-8777-777777777777',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '2026-11-16','REVERSAL','forged-reversal:ci',
 '77777777-0000-4000-8000-000000000000','DRAFT',null,
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
 ('66666666-6666-4666-8666-666666666666',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 '2026-11-17','NORMAL','mixed-cash:ci',
 '66666666-0000-4000-8000-000000000000','DRAFT','OPERATING',null);

insert into bunbun_accounting.journal_lines
 (journal_id,line_number,account_code,debit,credit)
values
 ('88888888-8888-4888-8888-888888888888',1,'1210',100,0),
 ('88888888-8888-4888-8888-888888888888',2,'2010',0,90),
 ('77777777-7777-4777-8777-777777777777',1,'1210',0,9999),
 ('77777777-7777-4777-8777-777777777777',2,'2010',9999,0),
 ('66666666-6666-4666-8666-666666666666',1,'1020',100,0),
 ('66666666-6666-4666-8666-666666666666',2,'1010',0,80),
 ('66666666-6666-4666-8666-666666666666',3,'4010',0,20);

-- Verify grants before using service_role.
do $checks$
begin
 if has_schema_privilege('authenticated','bunbun_accounting','USAGE') then
   raise exception 'Authenticated has unexpected schema USAGE';
 end if;
 if has_table_privilege('authenticated','bunbun_accounting.journals','INSERT') then
   raise exception 'Authenticated can write journals';
 end if;
 if has_function_privilege('authenticated',
     'bunbun_accounting.post_reviewed_journal(uuid,uuid)','EXECUTE') then
   raise exception 'Authenticated can execute posting';
 end if;
end
$checks$;

set role service_role;

do $tests$
declare
 v_active_owner uuid := '11111111-1111-4111-8111-111111111111';
 v_baker uuid := '22222222-2222-4222-8222-222222222222';
 v_inactive_owner uuid := '33333333-3333-4333-8333-333333333333';
 v_opening uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 v_purchase uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 v_salary uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 v_reversal uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
 v_bad_cash uuid := '99999999-9999-4999-8999-999999999999';
 v_count integer;
 v_debit numeric;
 v_credit numeric;
begin
  -- Rejection cases must fail; an unexpected success fails the CI run.
  begin
    perform bunbun_accounting.post_reviewed_journal(v_purchase, v_active_owner);
    raise exception 'UNEXPECTED SUCCESS: normal before opening';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%opening journal%' then raise; end if;
  end;

  begin
    perform bunbun_accounting.post_reviewed_journal(v_opening, v_baker);
    raise exception 'UNEXPECTED SUCCESS: Baker posting';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%Owner approval%' then raise; end if;
  end;

  begin
    perform bunbun_accounting.post_reviewed_journal(v_opening, v_inactive_owner);
    raise exception 'UNEXPECTED SUCCESS: inactive owner';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%Owner approval%' then raise; end if;
  end;

  perform bunbun_accounting.post_reviewed_journal(v_opening, v_active_owner);
  perform bunbun_accounting.post_reviewed_journal(v_opening, v_active_owner);
  select count(*) into v_count from bunbun_accounting.audit_events
  where action='POST_JOURNAL' and entity_id=v_opening::text;
  if v_count <> 1 then raise exception 'Idempotent opening generated duplicate audit events'; end if;

  perform bunbun_accounting.post_reviewed_journal(v_purchase, v_active_owner);
  perform bunbun_accounting.post_reviewed_journal(v_salary, v_active_owner);
  perform bunbun_accounting.post_reviewed_journal(v_reversal, v_active_owner);

  select coalesce(sum(l.debit),0),coalesce(sum(l.credit),0)
    into v_debit,v_credit
  from bunbun_accounting.journal_lines l
  join bunbun_accounting.journals j on j.id=l.journal_id
  where j.status='POSTED';
  if v_debit <> v_credit then raise exception 'Posted ledger is not balanced'; end if;

  begin
    perform bunbun_accounting.post_reviewed_journal(v_bad_cash, v_active_owner);
    raise exception 'UNEXPECTED SUCCESS: unclassified cash';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%classification required%' then raise; end if;
  end;
  if (select status from bunbun_accounting.journals where id=v_bad_cash) <> 'DRAFT' then
    raise exception 'Failed posting mutated draft status';
  end if;


  begin
    perform bunbun_accounting.post_reviewed_journal(
      '88888888-8888-4888-8888-888888888888', v_active_owner);
    raise exception 'UNEXPECTED SUCCESS: unbalanced journal';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%not balanced%' then raise; end if;
  end;
  begin
    perform bunbun_accounting.post_reviewed_journal(
      '77777777-7777-4777-8777-777777777777', v_active_owner);
    raise exception 'UNEXPECTED SUCCESS: fraudulent reversal';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%exactly cancel%' then raise; end if;
  end;
  begin
    perform bunbun_accounting.post_reviewed_journal(
      '66666666-6666-4666-8666-666666666666', v_active_owner);
    raise exception 'UNEXPECTED SUCCESS: mixed cash';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%Mixed cash%' then raise; end if;
  end;
  if (select count(*) from bunbun_accounting.journals
      where source_key in ('unbalanced:ci','forged-reversal:ci','mixed-cash:ci')
        and status <> 'DRAFT') <> 0 then
    raise exception 'Failed posting must not mutate any invalid draft';
  end if;
  -- POSTED header and lines are locked, even for service_role.
  begin
    update bunbun_accounting.journals
      set narrative='tampering' where id=v_purchase;
    raise exception 'UNEXPECTED SUCCESS: posted journal update';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%immutable%' then raise; end if;
  end;
  begin
    delete from bunbun_accounting.journal_lines
      where journal_id=v_purchase and line_number=1;
    raise exception 'UNEXPECTED SUCCESS: posted journal line delete';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%immutable%' then raise; end if;
  end;
  begin
    insert into bunbun_accounting.journal_lines
      (journal_id,line_number,account_code,debit,credit)
    values (v_purchase,3,'1210',100,0);
    raise exception 'UNEXPECTED SUCCESS: posted journal line append';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%immutable%' then raise; end if;
  end;
  begin
    update bunbun_accounting.opening_snapshots
      set evidence_summary='tampering';
    raise exception 'UNEXPECTED SUCCESS: approved snapshot modification';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%immutable%' then raise; end if;
  end;
  if (select count(*) from bunbun_accounting.journals where status='POSTED') <> 4 then
    raise exception 'Unexpected posted journal count';
  end if;
  raise notice 'PASS: private role, Owner, opening, double-entry, cash classification, reversal, immutability, idempotency';
end
$tests$;

reset role;

-- Closing is allowed but changing immutable approved period fields is not.
update bunbun_accounting.periods set status='CLOSED'
where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $closed$
begin
  begin
    update bunbun_accounting.periods set status='OPEN'
    where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    raise exception 'UNEXPECTED SUCCESS: reopened closed period';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%cannot be reopened%' then raise; end if;
  end;
end
$closed$;

-- Additional post-close test (must not post remaining draft).
set role service_role;
do $closedpost$
begin
  begin
    perform bunbun_accounting.post_reviewed_journal(
      '99999999-9999-4999-8999-999999999999',
      '11111111-1111-4111-8111-111111111111');
    raise exception 'UNEXPECTED SUCCESS: posting in CLOSED period';
  exception when others then
    if sqlerrm like 'UNEXPECTED SUCCESS%' then raise; end if;
    if sqlerrm not like '%not OPEN%' then raise; end if;
  end;
  raise notice 'PASS: closed periods reject posting and reopening';
end
$closedpost$;
reset role;

select 'PASS: isolated PostgreSQL accounting posting integration' as result;

ROLLBACK TO fixture_start;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('11111111-1111-4111-8111-111111111111','rollback-owner@example.invalid','{"full_name":"Synthetic rollback owner"}'),
('22222222-2222-4222-8222-222222222222','rollback-baker@example.invalid','{"full_name":"Synthetic rollback baker"}'),
('33333333-3333-4333-8333-333333333333','rollback-inactive@example.invalid','{"full_name":"Synthetic rollback inactive"}');
UPDATE public.profiles SET role=CASE WHEN id='22222222-2222-4222-8222-222222222222' THEN 'baker'::public.user_role ELSE 'owner'::public.user_role END,
is_active=(id<>'33333333-3333-4333-8333-333333333333') WHERE id IN ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333');
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
 (1,1,'1020',1000000::numeric,0::numeric),
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

SELECT jsonb_build_object('result','PASS: real staging posting guards and ledger lifecycle',
'profit_loss',(SELECT row_to_json(x) FROM bunbun_accounting.v_monthly_profit_loss x),
'cash_flow',(SELECT row_to_json(x) FROM bunbun_accounting.v_monthly_cash_flow x),
'financial_position',(SELECT row_to_json(x) FROM bunbun_accounting.v_monthly_financial_position x)) AS verification;

ROLLBACK;
