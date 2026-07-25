-- BUNBUN OS
-- Migration: production batch inventory consumption

alter table public.production_batches
add column if not exists inventory_consumed boolean
not null default false;

create index if not exists
production_batches_inventory_consumed_idx
on public.production_batches (inventory_consumed);