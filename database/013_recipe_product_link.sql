-- BUNBUN OS
-- Migration: link recipes to products

alter table public.recipes
add column if not exists product_id bigint
references public.products(id);


-- Mempercepat pencarian recipe berdasarkan produk
create index if not exists
recipes_product_id_idx
on public.recipes (product_id);


-- Satu produk hanya mempunyai satu recipe aktif
create unique index if not exists
recipes_product_unique_active
on public.recipes (product_id)
where
  product_id is not null
  and is_deleted = false;


-- Satu ingredient hanya boleh muncul sekali
-- dalam satu recipe aktif
create unique index if not exists
recipe_items_recipe_ingredient_unique_active
on public.recipe_items (
  recipe_id,
  ingredient_id
)
where is_deleted = false;