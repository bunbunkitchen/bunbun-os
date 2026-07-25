-- BUNBUN OS
-- Migration: link purchases to inventory and expenses

alter table public.inventory_transactions
add column if not exists purchase_id bigint
references public.purchases(id);

alter table public.expenses
add column if not exists purchase_id bigint
references public.purchases(id);


-- Satu pembelian hanya boleh mempunyai
-- satu transaksi inventory PURCHASE aktif
create unique index if not exists
inventory_purchase_unique_active
on public.inventory_transactions (purchase_id)
where
  purchase_id is not null
  and transaction_type = 'PURCHASE'
  and is_deleted = false;


-- Satu pembelian hanya boleh mempunyai
-- satu expense aktif
create unique index if not exists
expense_purchase_unique_active
on public.expenses (purchase_id)
where
  purchase_id is not null
  and is_deleted = false;


create index if not exists
inventory_transactions_purchase_id_idx
on public.inventory_transactions (purchase_id);

create index if not exists
expenses_purchase_id_idx
on public.expenses (purchase_id);