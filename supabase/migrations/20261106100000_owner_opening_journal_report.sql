create schema if not exists bunbun_report_private;

create function bunbun_report_private.read_posted_opening_journal()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role::text = 'owner'
  ) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  if pg_catalog.to_regclass('bunbun_accounting.journals') is null then
    return null;
  end if;

  return (
    select jsonb_build_object(
      'posting_date', journal.posting_date,
      'lines', jsonb_agg(
        jsonb_build_object(
          'account_code', line.account_code,
          'label', coalesce(nullif(line.note, ''), account.name),
          'debit', line.debit,
          'credit', line.credit
        ) order by line.line_number
      ),
      'total_debit', sum(line.debit),
      'total_credit', sum(line.credit)
    )
    from bunbun_accounting.journals journal
    join bunbun_accounting.opening_snapshots snapshot
      on snapshot.period_id = journal.period_id
      and snapshot.cutover_on = journal.posting_date
      and snapshot.status = 'APPROVED'
    join bunbun_accounting.journal_lines line on line.journal_id = journal.id
    join bunbun_accounting.accounts account on account.code = line.account_code
    where journal.source_type = 'OPENING' and journal.status = 'POSTED'
    group by journal.id, journal.posting_date
    order by journal.posting_date desc, journal.id desc
    limit 1
  );
end;
$$;

revoke all on function bunbun_report_private.read_posted_opening_journal()
  from public, anon, authenticated;
grant usage on schema bunbun_report_private to authenticated;
grant execute on function bunbun_report_private.read_posted_opening_journal()
  to authenticated;

create function public.get_owner_opening_journal()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select bunbun_report_private.read_posted_opening_journal();
$$;

revoke all on function public.get_owner_opening_journal()
  from public, anon, authenticated;
grant execute on function public.get_owner_opening_journal()
  to authenticated;

notify pgrst, 'reload schema';
