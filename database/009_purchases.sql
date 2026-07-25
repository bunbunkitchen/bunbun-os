-- BUNBUN OS
-- Migration: purchases

create table if not exists public.purchases (
  id bigint generated always as identity primary key,

  tanggal date not null,

  supplier_id bigint
    references public.suppliers(id),

  ingredient_id bigint not null
    references public.ingredients(id),

  jumlah numeric(14,3) not null
    check (jumlah > 0),

  satuan text not null,

  harga_satuan numeric(14,2) not null
    check (harga_satuan >= 0),

  total numeric(14,2) not null
    check (total >= 0),

  keterangan text,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  is_deleted boolean not null default false
);

alter table public.purchases
  enable row level security;


drop policy if exists "Owner can read purchases"
on public.purchases;

create policy "Owner can read purchases"
on public.purchases
for select
to authenticated
using (
  public.is_owner()
  and is_deleted = false
);


drop policy if exists "Owner can create purchases"
on public.purchases;

create policy "Owner can create purchases"
on public.purchases
for insert
to authenticated
with check (
  public.is_owner()
  and created_by = auth.uid()
);


drop policy if exists "Owner can update purchases"
on public.purchases;

create policy "Owner can update purchases"
on public.purchases
for update
to authenticated
using (
  public.is_owner()
)
with check (
  public.is_owner()
);


drop trigger if exists set_purchases_updated_at
on public.purchases;

create trigger set_purchases_updated_at
before update on public.purchases
for each row
execute function public.set_updated_at();