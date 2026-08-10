-- ============================================================
-- BUNBUN OS
-- Migration 018: automatic lot code for shaping splits
--
-- One production batch has one automatic lot code:
-- PB-RSBORI-20260810-001 -> LOT-RSBORI-20260810-001
-- The same lot is attached to Frozen, Direct, and Reject splits.
-- ============================================================

alter table public.production_batch_splits
  drop constraint if exists production_batch_splits_lot_code_by_route_check;

update public.production_batch_splits s
set lot_code = case
  when b.kode like 'PB-%' then 'LOT-' || substring(b.kode from 4)
  else 'LOT-' || b.kode
end
from public.production_batches b
where b.id = s.production_batch_id
  and nullif(btrim(s.lot_code), '') is null;

alter table public.production_batch_splits
  add constraint production_batch_splits_lot_code_required_check
  check (nullif(btrim(lot_code), '') is not null);

create or replace function public.set_automatic_split_lot_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_code text;
begin
  select b.kode
  into v_batch_code
  from public.production_batches b
  where b.id = new.production_batch_id
    and b.is_deleted = false;

  if v_batch_code is null then
    raise exception 'Production batch untuk kode lot tidak ditemukan.';
  end if;

  new.lot_code := case
    when v_batch_code like 'PB-%'
      then 'LOT-' || substring(v_batch_code from 4)
    else 'LOT-' || v_batch_code
  end;

  return new;
end;
$$;

drop trigger if exists set_automatic_split_lot_code
on public.production_batch_splits;

create trigger set_automatic_split_lot_code
before insert on public.production_batch_splits
for each row
execute function public.set_automatic_split_lot_code();

-- The old index only covered Frozen rows. One lot is intentionally shared by
-- several splits from the same batch, so uniqueness is enforced per batch.
drop index if exists public.production_batch_splits_frozen_lot_code_unique;

create index if not exists production_batch_splits_lot_code_idx
on public.production_batch_splits (lower(lot_code))
where is_deleted = false;

revoke all on function public.set_automatic_split_lot_code() from public;
revoke all on function public.set_automatic_split_lot_code() from anon;
revoke all on function public.set_automatic_split_lot_code() from authenticated;
