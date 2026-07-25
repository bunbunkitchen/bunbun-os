-- BUNBUN OS
-- Migration: ingredients

create table if not exists public.ingredients (
  id bigint generated always as identity primary key,

  kode text not null unique,
  nama text not null,
  kategori text not null,
  satuan text not null,

  harga numeric(14,2) not null
    check (harga > 0),

  minimum_stok numeric(14,2) not null
    default 0
    check (minimum_stok >= 0),

  is_active boolean not null default true,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  is_deleted boolean not null default false
);

alter table public.ingredients
  enable row level security;


drop policy if exists "Owner can read ingredients"
on public.ingredients;

create policy "Owner can read ingredients"
on public.ingredients
for select
to authenticated
using (
  public.is_owner()
  and is_deleted = false
);


drop policy if exists "Owner can create ingredients"
on public.ingredients;

create policy "Owner can create ingredients"
on public.ingredients
for insert
to authenticated
with check (
  public.is_owner()
  and created_by = auth.uid()
);


drop policy if exists "Owner can update ingredients"
on public.ingredients;

create policy "Owner can update ingredients"
on public.ingredients
for update
to authenticated
using (
  public.is_owner()
)
with check (
  public.is_owner()
);


drop trigger if exists set_ingredients_updated_at
on public.ingredients;

create trigger set_ingredients_updated_at
before update on public.ingredients
for each row
execute function public.set_updated_at();