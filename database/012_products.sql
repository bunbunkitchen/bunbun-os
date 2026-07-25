-- BUNBUN OS
-- Migration: products

create table if not exists public.products (
  id bigint generated always as identity primary key,

  sku text not null,
  nama text not null,

  category_id bigint
    references public.categories(id),

  harga numeric(14,2)
    not null default 0
    check (harga >= 0),

  is_active boolean
    not null default true,

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

create unique index if not exists
products_sku_unique_active
on public.products (lower(sku))
where is_deleted = false;

create index if not exists
products_category_id_idx
on public.products (category_id);

create index if not exists
products_is_deleted_idx
on public.products (is_deleted);

alter table public.products
enable row level security;


drop policy if exists
"Authenticated users can read products"
on public.products;

create policy
"Authenticated users can read products"
on public.products
for select
to authenticated
using (
  is_deleted = false
);


drop policy if exists
"Owner can create products"
on public.products;

create policy
"Owner can create products"
on public.products
for insert
to authenticated
with check (
  public.is_owner()
  and created_by = auth.uid()
);


drop policy if exists
"Owner can update products"
on public.products;

create policy
"Owner can update products"
on public.products
for update
to authenticated
using (
  public.is_owner()
)
with check (
  public.is_owner()
);


drop trigger if exists
set_products_updated_at
on public.products;

create trigger set_products_updated_at
before update on public.products
for each row
execute function public.set_updated_at();