-- BUNBUN OS
-- Migration: suppliers

create table if not exists public.suppliers (
  id bigint generated always as identity primary key,

  kode text not null unique,
  nama text not null,
  kontak text,
  telepon text,
  email text,
  alamat text,

  is_active boolean not null default true,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  is_deleted boolean not null default false
);

alter table public.suppliers
  enable row level security;


drop policy if exists "Owner can read suppliers"
on public.suppliers;

create policy "Owner can read suppliers"
on public.suppliers
for select
to authenticated
using (
  public.is_owner()
  and is_deleted = false
);


drop policy if exists "Owner can create suppliers"
on public.suppliers;

create policy "Owner can create suppliers"
on public.suppliers
for insert
to authenticated
with check (
  public.is_owner()
  and created_by = auth.uid()
);


drop policy if exists "Owner can update suppliers"
on public.suppliers;

create policy "Owner can update suppliers"
on public.suppliers
for update
to authenticated
using (
  public.is_owner()
)
with check (
  public.is_owner()
);


drop trigger if exists set_suppliers_updated_at
on public.suppliers;

create trigger set_suppliers_updated_at
before update on public.suppliers
for each row
execute function public.set_updated_at();