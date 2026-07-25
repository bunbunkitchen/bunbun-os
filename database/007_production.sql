-- BUNBUN OS
-- Migration: production_orders dan production_batches

create or replace function public.is_owner_baker_or_helper()
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
      and role in ('owner', 'baker', 'helper')
      and is_active = true
  );
$$;


create table if not exists public.production_orders (
  id bigint generated always as identity primary key,

  kode text not null unique,

  tanggal date not null,

  recipe_id bigint not null
    references public.recipes(id),

  target_produksi numeric(14,2) not null
    check (target_produksi > 0),

  satuan text not null default 'pcs',

  estimasi_biaya numeric(14,2) not null default 0,

  status text not null default 'Draft'
    check (
      status in (
        'Draft',
        'Generated',
        'Cancelled'
      )
    ),

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  is_deleted boolean not null default false
);


create table if not exists public.production_batches (
  id bigint generated always as identity primary key,

  kode text not null unique,

  production_order_id bigint not null
    references public.production_orders(id),

  target numeric(14,2) not null
    check (target > 0),

  selesai numeric(14,2) not null default 0
    check (selesai >= 0),

  reject numeric(14,2) not null default 0
    check (reject >= 0),

  status text not null default 'Waiting'
    check (
      status in (
        'Waiting',
        'Mixing',
        'Proofing',
        'Baking',
        'Cooling',
        'Packing',
        'Finished'
      )
    ),

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  is_deleted boolean not null default false
);


alter table public.production_orders
  enable row level security;

alter table public.production_batches
  enable row level security;


-- PRODUCTION ORDER: Owner dan Baker boleh membaca
drop policy if exists "Owner and Baker can read production orders"
on public.production_orders;

create policy "Owner and Baker can read production orders"
on public.production_orders
for select
to authenticated
using (
  public.is_owner_or_baker()
  and is_deleted = false
);


-- PRODUCTION ORDER: Owner dan Baker boleh menambah
drop policy if exists "Owner and Baker can create production orders"
on public.production_orders;

create policy "Owner and Baker can create production orders"
on public.production_orders
for insert
to authenticated
with check (
  public.is_owner_or_baker()
  and created_by = auth.uid()
);


-- PRODUCTION ORDER: Owner dan Baker boleh memperbarui
drop policy if exists "Owner and Baker can update production orders"
on public.production_orders;

create policy "Owner and Baker can update production orders"
on public.production_orders
for update
to authenticated
using (
  public.is_owner_or_baker()
)
with check (
  public.is_owner_or_baker()
);


-- PRODUCTION BATCH: semua role boleh membaca
drop policy if exists "All roles can read production batches"
on public.production_batches;

create policy "All roles can read production batches"
on public.production_batches
for select
to authenticated
using (
  public.is_owner_baker_or_helper()
  and is_deleted = false
);


-- PRODUCTION BATCH: Owner dan Baker boleh menambah
drop policy if exists "Owner and Baker can create production batches"
on public.production_batches;

create policy "Owner and Baker can create production batches"
on public.production_batches
for insert
to authenticated
with check (
  public.is_owner_or_baker()
  and created_by = auth.uid()
);


-- PRODUCTION BATCH: semua role boleh update progres dan hasil
drop policy if exists "All roles can update production batches"
on public.production_batches;

create policy "All roles can update production batches"
on public.production_batches
for update
to authenticated
using (
  public.is_owner_baker_or_helper()
)
with check (
  public.is_owner_baker_or_helper()
);


drop trigger if exists set_production_orders_updated_at
on public.production_orders;

create trigger set_production_orders_updated_at
before update on public.production_orders
for each row
execute function public.set_updated_at();


drop trigger if exists set_production_batches_updated_at
on public.production_batches;

create trigger set_production_batches_updated_at
before update on public.production_batches
for each row
execute function public.set_updated_at();