-- BUNBUN OS
-- Migration: expenses

create table if not exists public.expenses (
  id bigint generated always as identity primary key,

  tanggal date not null,

  kategori text not null
    check (
      kategori in (
        'Gaji',
        'Bahan Baku',
        'Maintenance'
      )
    ),

  nominal numeric(14,2) not null
    check (nominal > 0),

  keterangan text,

  created_by uuid
    references auth.users(id),

  updated_by uuid
    references auth.users(id),

  created_at timestamptz
    not null default now(),

  updated_at timestamptz
    not null default now(),

  is_deleted boolean
    not null default false
);

alter table public.expenses
  enable row level security;


-- OWNER: membaca pengeluaran aktif
drop policy if exists "Owner can read expenses"
on public.expenses;

create policy "Owner can read expenses"
on public.expenses
for select
to authenticated
using (
  public.is_owner()
  and is_deleted = false
);


-- OWNER: menambah pengeluaran
drop policy if exists "Owner can create expenses"
on public.expenses;

create policy "Owner can create expenses"
on public.expenses
for insert
to authenticated
with check (
  public.is_owner()
  and created_by = auth.uid()
);


-- OWNER: memperbarui pengeluaran
drop policy if exists "Owner can update expenses"
on public.expenses;

create policy "Owner can update expenses"
on public.expenses
for update
to authenticated
using (
  public.is_owner()
)
with check (
  public.is_owner()
);


-- Otomatis memperbarui updated_at
drop trigger if exists set_expenses_updated_at
on public.expenses;

create trigger set_expenses_updated_at
before update on public.expenses
for each row
execute function public.set_updated_at();