-- BUNBUN OS
-- Migration: inventory_transactions

create table if not exists public.inventory_transactions (
  id bigint generated always as identity primary key,

  transaction_date date not null,

  transaction_type text not null
    check (
      transaction_type in (
        'PURCHASE',
        'PRODUCTION_OUT',
        'PRODUCTION_IN',
        'ADJUSTMENT',
        'SALE'
      )
    ),

  ingredient_id bigint
    references public.ingredients(id),

  recipe_id bigint
    references public.recipes(id),

  production_batch_id bigint
    references public.production_batches(id),

  qty numeric(14,3) not null,

  unit text not null,

  notes text,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),

  created_at timestamptz
    not null default now(),

  updated_at timestamptz
    not null default now(),

  is_deleted boolean
    not null default false
);

alter table public.inventory_transactions
enable row level security;

drop policy if exists "Owner and Baker read inventory"
on public.inventory_transactions;

create policy "Owner and Baker read inventory"
on public.inventory_transactions
for select
to authenticated
using (
  public.is_owner_or_baker()
  and is_deleted = false
);

drop policy if exists "Owner and Baker create inventory"
on public.inventory_transactions;

create policy "Owner and Baker create inventory"
on public.inventory_transactions
for insert
to authenticated
with check (
  public.is_owner_or_baker()
  and created_by = auth.uid()
);

drop policy if exists "Owner and Baker update inventory"
on public.inventory_transactions;

create policy "Owner and Baker update inventory"
on public.inventory_transactions
for update
to authenticated
using (
  public.is_owner_or_baker()
)
with check (
  public.is_owner_or_baker()
);

drop trigger if exists set_inventory_updated_at
on public.inventory_transactions;

create trigger set_inventory_updated_at
before update
on public.inventory_transactions
for each row
execute function public.set_updated_at();