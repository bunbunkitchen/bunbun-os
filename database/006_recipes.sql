-- BUNBUN OS
-- Migration: recipes dan recipe_items

create or replace function public.is_owner_or_baker()
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
      and role in ('owner', 'baker')
      and is_active = true
  );
$$;


create table if not exists public.recipes (
  id bigint generated always as identity primary key,

  kode text not null unique,
  nama text not null,
  kategori text not null default 'Salt Bread',

  yield_qty numeric(14,2) not null
    check (yield_qty > 0),

  yield_unit text not null default 'pcs',

  is_active boolean not null default true,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  is_deleted boolean not null default false
);


create table if not exists public.recipe_items (
  id bigint generated always as identity primary key,

  recipe_id bigint not null
    references public.recipes(id)
    on delete cascade,

  ingredient_id bigint not null
    references public.ingredients(id),

  jumlah numeric(14,3) not null
    check (jumlah > 0),

  satuan text not null,

  urutan integer not null default 1,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  is_deleted boolean not null default false,

  unique (recipe_id, ingredient_id)
);


alter table public.recipes
  enable row level security;

alter table public.recipe_items
  enable row level security;


-- RECIPE: Owner dan Baker boleh membaca
drop policy if exists "Owner and Baker can read recipes"
on public.recipes;

create policy "Owner and Baker can read recipes"
on public.recipes
for select
to authenticated
using (
  public.is_owner_or_baker()
  and is_deleted = false
);


-- RECIPE: hanya Owner boleh menambah
drop policy if exists "Owner can create recipes"
on public.recipes;

create policy "Owner can create recipes"
on public.recipes
for insert
to authenticated
with check (
  public.is_owner()
  and created_by = auth.uid()
);


-- RECIPE: hanya Owner boleh memperbarui
drop policy if exists "Owner can update recipes"
on public.recipes;

create policy "Owner can update recipes"
on public.recipes
for update
to authenticated
using (public.is_owner())
with check (public.is_owner());


-- RECIPE ITEMS: Owner dan Baker boleh membaca
drop policy if exists "Owner and Baker can read recipe items"
on public.recipe_items;

create policy "Owner and Baker can read recipe items"
on public.recipe_items
for select
to authenticated
using (
  public.is_owner_or_baker()
  and is_deleted = false
);


-- RECIPE ITEMS: hanya Owner boleh menambah
drop policy if exists "Owner can create recipe items"
on public.recipe_items;

create policy "Owner can create recipe items"
on public.recipe_items
for insert
to authenticated
with check (
  public.is_owner()
  and created_by = auth.uid()
);


-- RECIPE ITEMS: hanya Owner boleh memperbarui
drop policy if exists "Owner can update recipe items"
on public.recipe_items;

create policy "Owner can update recipe items"
on public.recipe_items
for update
to authenticated
using (public.is_owner())
with check (public.is_owner());


drop trigger if exists set_recipes_updated_at
on public.recipes;

create trigger set_recipes_updated_at
before update on public.recipes
for each row
execute function public.set_updated_at();


drop trigger if exists set_recipe_items_updated_at
on public.recipe_items;

create trigger set_recipe_items_updated_at
before update on public.recipe_items
for each row
execute function public.set_updated_at();