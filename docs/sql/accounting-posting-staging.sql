-- REVIEW ONLY / EPHEMERAL POSTGRES CI. DO NOT APPLY IN BUNBUN PRODUCTION.
-- This is not a Supabase migration or a publicly callable RPC.
-- Invoker privileges are restricted to a PRIVATE schema and trusted service_role.
-- A verified backend must authenticate the real session BEFORE passing actor_id.
-- No frontend may receive service_role credentials.

-- Prevent accidental duplicate opening journals across multiple periods.
create unique index if not exists one_global_opening_journal
  on bunbun_accounting.journals (source_type)
  where source_type = 'OPENING';

-- Freeze a finalized journal and its lines.
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

-- A closed accounting period cannot be silently reopened/backdated.
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

-- Draft journals are inserted with their lines by the trusted backend.
-- This INVOKER routine locks the period then the journal, validates, and
-- transitions them atomically inside the caller's database transaction.
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
  -- A service role may ONLY be held by trusted backend, never in the web app.
  if current_user <> 'service_role' then
    raise exception 'Posting requires private service role';
  end if;
  -- The trusted backend MUST verify the live JWT/session and bind p_actor_id.
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

  -- This flag is an internal integrity guard, NOT an authorization secret.
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

-- Source events and valuations are still deliberately NOT auto-posted.
-- A future verified backend must create/validate drafts and inventory sources.
-- In particular, service_role is trusted; do not disclose its key to browsers.
