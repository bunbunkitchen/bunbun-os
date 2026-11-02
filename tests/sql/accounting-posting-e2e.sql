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
