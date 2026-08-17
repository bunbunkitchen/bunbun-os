-- =========================================================
-- 021_baker_purchasing_maintenance.sql
-- Akses Baker untuk Purchasing & Maintenance
-- =========================================================

-- =========================================================
-- 1. HELPER FUNCTION: is_baker()
-- =========================================================

create or replace function public.is_baker()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'baker'
      and is_active = true
  );
$function$;


-- =========================================================
-- 2. MAINTENANCE
-- Baker boleh:
-- - melihat
-- - menambah
-- - mengubah
-- - soft delete
-- =========================================================

create policy "Baker can read maintenance items"
on public.maintenance_items
for select
using (
  is_baker()
  and is_deleted = false
);

create policy "Baker can create maintenance items"
on public.maintenance_items
for insert
with check (
  is_baker()
  and created_by = auth.uid()
);

create policy "Baker can update maintenance items"
on public.maintenance_items
for update
using (
  is_baker()
)
with check (
  is_baker()
  and updated_by = auth.uid()
);


-- =========================================================
-- 3. PURCHASING
-- Baker boleh:
-- - melihat
-- - menambah
-- - mengubah
-- - soft delete
-- =========================================================

create policy "Baker can read purchases"
on public.purchases
for select
using (
  is_baker()
  and is_deleted = false
);

create policy "Baker can create purchases"
on public.purchases
for insert
with check (
  is_baker()
  and created_by = auth.uid()
);

create policy "Baker can update purchases"
on public.purchases
for update
using (
  is_baker()
)
with check (
  is_baker()
  and updated_by = auth.uid()
);


-- =========================================================
-- 4. INVENTORY TRANSACTIONS
--
-- Baker hanya boleh mengubah transaksi PURCHASE
-- yang terkait dengan Purchasing.
--
-- Transaksi produksi / adjustment / stok lainnya
-- tetap tidak diberikan akses update kepada Baker.
-- =========================================================

create policy "Baker can update purchase inventory transactions"
on public.inventory_transactions
for update
using (
  is_baker()
  and transaction_type = 'PURCHASE'
  and purchase_id is not null
)
with check (
  is_baker()
  and updated_by = auth.uid()
);


-- =========================================================
-- 5. EXPENSES
--
-- Baker hanya boleh mengakses expense yang berasal
-- dari Purchasing (purchase_id tidak null).
--
-- Baker TIDAK mendapatkan akses ke expense manual lainnya.
-- =========================================================

create policy "Baker can read purchase expenses"
on public.expenses
for select
using (
  is_baker()
  and purchase_id is not null
  and is_deleted = false
);

create policy "Baker can create purchase expenses"
on public.expenses
for insert
with check (
  is_baker()
  and purchase_id is not null
  and created_by = auth.uid()
);

create policy "Baker can update purchase expenses"
on public.expenses
for update
using (
  is_baker()
  and purchase_id is not null
)
with check (
  is_baker()
  and purchase_id is not null
  and updated_by = auth.uid()
);