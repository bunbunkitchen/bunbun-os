-- BUNBUN OS
-- Migration: incomes

create table if not exists public.incomes (
  id bigint generated always as identity primary key,

  tanggal date not null,
  total_penjualan numeric(14,2) not null check (total_penjualan > 0),
  persentase_bunbun numeric(5,2) not null default 70,
  pemasukan_bunbun numeric(14,2) not null,
  keterangan text,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  is_deleted boolean not null default false
);

alter table public.incomes
  add column if not exists updated_by uuid references auth.users(id);

alter table public.incomes
  add column if not exists updated_at timestamptz not null default now();

alter table public.incomes
  add column if not exists is_deleted boolean not null default false;

alter table public.incomes enable row level security;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'owner'
      and is_active = true
  );
$$;

drop policy if exists "Owner can read incomes"
on public.incomes;

create policy "Owner can read incomes"
on public.incomes
for select
to authenticated
using (
  public.is_owner()
  and is_deleted = false
);

drop policy if exists "Owner can create incomes"
on public.incomes;

create policy "Owner can create incomes"
on public.incomes
for insert
to authenticated
with check (
  public.is_owner()
  and created_by = auth.uid()
);

drop policy if exists "Owner can update incomes"
on public.incomes;

create policy "Owner can update incomes"
on public.incomes
for update
to authenticated
using (
  public.is_owner()
)
with check (
  public.is_owner()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_incomes_updated_at
on public.incomes;

create trigger set_incomes_updated_at
before update on public.incomes
for each row
execute function public.set_updated_at();