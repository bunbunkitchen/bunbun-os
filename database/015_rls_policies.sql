-- ============================================================
-- BUNBUN OS
-- Migration 015
-- Final RLS Policies
-- ============================================================

-- ------------------------------------------------------------
-- Helper function: cek apakah user yang login adalah owner
-- ------------------------------------------------------------

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'owner'
      and is_active = true
  );
$$;

grant execute
on function public.is_owner()
to authenticated;


-- ============================================================
-- ENABLE RLS
-- ============================================================

alter table public.categories
enable row level security;

alter table public.products
enable row level security;

alter table public.purchases
enable row level security;

alter table public.application_settings
enable row level security;


-- ============================================================
-- CATEGORIES
-- Semua user login boleh membaca.
-- Hanya owner boleh membuat dan mengubah.
-- ============================================================

drop policy if exists
"Categories Select"
on public.categories;

drop policy if exists
"Categories Insert"
on public.categories;

drop policy if exists
"Categories Update"
on public.categories;

drop policy if exists
"Categories Delete"
on public.categories;

drop policy if exists
"Authenticated users can read categories"
on public.categories;

drop policy if exists
"Owner can create categories"
on public.categories;

drop policy if exists
"Owner can update categories"
on public.categories;

drop policy if exists
"Owner can delete categories"
on public.categories;


create policy
"Authenticated users can read categories"
on public.categories
for select
to authenticated
using (
  is_deleted = false
);


create policy
"Owner can create categories"
on public.categories
for insert
to authenticated
with check (
  public.is_owner()
  and created_by = auth.uid()
);


create policy
"Owner can update categories"
on public.categories
for update
to authenticated
using (
  public.is_owner()
)
with check (
  public.is_owner()
  and updated_by = auth.uid()
);


-- Aplikasi memakai soft delete melalui UPDATE.
-- Physical DELETE sengaja tidak diberi policy.


-- ============================================================
-- PRODUCTS
-- Semua user login boleh membaca.
-- Hanya owner boleh membuat dan mengubah.
-- ============================================================

drop policy if exists
"Products Select"
on public.products;

drop policy if exists
"Products Insert"
on public.products;

drop policy if exists
"Products Update"
on public.products;

drop policy if exists
"Products Delete"
on public.products;

drop policy if exists
"Authenticated users can read products"
on public.products;

drop policy if exists
"Owner can create products"
on public.products;

drop policy if exists
"Owner can update products"
on public.products;

drop policy if exists
"Owner can delete products"
on public.products;


create policy
"Authenticated users can read products"
on public.products
for select
to authenticated
using (
  is_deleted = false
);


create policy
"Owner can create products"
on public.products
for insert
to authenticated
with check (
  public.is_owner()
  and created_by = auth.uid()
);


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
  and updated_by = auth.uid()
);


-- Physical DELETE tidak dibuka.
-- Soft delete dilakukan melalui UPDATE.


-- ============================================================
-- PURCHASES
-- Purchasing hanya boleh dibaca dan dikelola owner.
-- ============================================================

drop policy if exists
"Purchases Select"
on public.purchases;

drop policy if exists
"Purchases Insert"
on public.purchases;

drop policy if exists
"Purchases Update"
on public.purchases;

drop policy if exists
"Purchases Delete"
on public.purchases;

drop policy if exists
"Owner can read purchases"
on public.purchases;

drop policy if exists
"Owner can create purchases"
on public.purchases;

drop policy if exists
"Owner can update purchases"
on public.purchases;

drop policy if exists
"Owner can delete purchases"
on public.purchases;


create policy
"Owner can read purchases"
on public.purchases
for select
to authenticated
using (
  public.is_owner()
  and is_deleted = false
);


create policy
"Owner can create purchases"
on public.purchases
for insert
to authenticated
with check (
  public.is_owner()
  and created_by = auth.uid()
);


create policy
"Owner can update purchases"
on public.purchases
for update
to authenticated
using (
  public.is_owner()
)
with check (
  public.is_owner()
  and updated_by = auth.uid()
);


-- Physical DELETE tidak dibuka.


-- ============================================================
-- APPLICATION SETTINGS
-- Semua user login boleh membaca settings.
-- Hanya owner boleh mengubah.
-- ============================================================

drop policy if exists
"Settings Select"
on public.application_settings;

drop policy if exists
"Settings Insert"
on public.application_settings;

drop policy if exists
"Settings Update"
on public.application_settings;

drop policy if exists
"Settings Delete"
on public.application_settings;

drop policy if exists
"Authenticated users can read settings"
on public.application_settings;

drop policy if exists
"Owner can create settings"
on public.application_settings;

drop policy if exists
"Owner can update settings"
on public.application_settings;

drop policy if exists
"Owner can delete settings"
on public.application_settings;


create policy
"Authenticated users can read settings"
on public.application_settings
for select
to authenticated
using (
  is_deleted = false
);


create policy
"Owner can create settings"
on public.application_settings
for insert
to authenticated
with check (
  public.is_owner()
  and created_by = auth.uid()
);


create policy
"Owner can update settings"
on public.application_settings
for update
to authenticated
using (
  public.is_owner()
)
with check (
  public.is_owner()
  and updated_by = auth.uid()
);


-- Physical DELETE tidak dibuka.