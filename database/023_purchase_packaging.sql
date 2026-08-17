-- BUNBUN OS
-- Migration: purchase packaging / sediaan

alter table public.purchases
  add column if not exists jumlah_sediaan numeric(14,3),
  add column if not exists isi_per_sediaan numeric(14,3),
  add column if not exists satuan_sediaan text;

alter table public.purchases
  drop constraint if exists purchases_jumlah_sediaan_check;

alter table public.purchases
  add constraint purchases_jumlah_sediaan_check
  check (
    jumlah_sediaan is null
    or jumlah_sediaan > 0
  );

alter table public.purchases
  drop constraint if exists purchases_isi_per_sediaan_check;

alter table public.purchases
  add constraint purchases_isi_per_sediaan_check
  check (
    isi_per_sediaan is null
    or isi_per_sediaan > 0
  );