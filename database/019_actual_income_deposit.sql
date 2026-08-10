-- BUNBUN OS
-- Migration: pencatatan setoran aktual

alter table public.incomes
  add column if not exists asal_setoran text;

alter table public.incomes
  add column if not exists kode_lot text;

-- Data lama tetap terbaca dan dapat diedit.
update public.incomes
set asal_setoran = 'Setoran lama'
where asal_setoran is null
   or btrim(asal_setoran) = '';

alter table public.incomes
  alter column asal_setoran set not null;

alter table public.incomes
  alter column asal_setoran set default 'Setoran kafe';

-- Mulai sekarang nilai yang dicatat adalah setoran aktual (100%).
alter table public.incomes
  alter column persentase_bunbun set default 100;
