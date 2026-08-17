-- ============================================================
-- BUNBUN OS
-- Migration 024: support sub-recipe
-- ============================================================

-- recipe_items sebelumnya hanya bisa berisi ingredient.
-- Sekarang satu item boleh berupa:
-- 1. ingredient
-- 2. recipe lain (sub-recipe)

alter table public.recipe_items
  alter column ingredient_id drop not null;

alter table public.recipe_items
  add column if not exists sub_recipe_id bigint
    references public.recipes(id);

-- Setiap item HARUS berupa ingredient ATAU sub-recipe.
alter table public.recipe_items
  drop constraint if exists recipe_items_source_check;

alter table public.recipe_items
  add constraint recipe_items_source_check
  check (
    (ingredient_id is not null and sub_recipe_id is null)
    or
    (ingredient_id is null and sub_recipe_id is not null)
  );


-- Cegah recipe memasukkan dirinya sendiri.
alter table public.recipe_items
  drop constraint if exists recipe_items_no_self_reference;

alter table public.recipe_items
  add constraint recipe_items_no_self_reference
  check (
    sub_recipe_id is null
    or sub_recipe_id <> recipe_id
  );


-- Index untuk sub-recipe.
create index if not exists
recipe_items_sub_recipe_id_idx
on public.recipe_items (sub_recipe_id)
where sub_recipe_id is not null
  and is_deleted = false;


-- Satu ingredient hanya sekali dalam satu recipe.
drop index if exists recipe_items_recipe_ingredient_unique;

create unique index if not exists
recipe_items_recipe_ingredient_unique
on public.recipe_items (recipe_id, ingredient_id)
where ingredient_id is not null
  and is_deleted = false;


-- Satu sub-recipe hanya sekali dalam satu recipe.
create unique index if not exists
recipe_items_recipe_sub_recipe_unique
on public.recipe_items (recipe_id, sub_recipe_id)
where sub_recipe_id is not null
  and is_deleted = false;