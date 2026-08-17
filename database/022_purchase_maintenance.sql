-- 022_purchase_maintenance.sql
-- Menambahkan dukungan pembelian barang Maintenance

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS purchase_type text
    NOT NULL DEFAULT 'INGREDIENT';

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS maintenance_item_id bigint;

ALTER TABLE public.purchases
  ALTER COLUMN ingredient_id DROP NOT NULL;

ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_purchase_type_check
  CHECK (
    purchase_type IN ('INGREDIENT', 'MAINTENANCE')
  );

ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_maintenance_item_fk
  FOREIGN KEY (maintenance_item_id)
  REFERENCES public.maintenance_items(id);

ALTER TABLE public.purchases
  ADD CONSTRAINT purchases_item_reference_check
  CHECK (
    (
      purchase_type = 'INGREDIENT'
      AND ingredient_id IS NOT NULL
      AND maintenance_item_id IS NULL
    )
    OR
    (
      purchase_type = 'MAINTENANCE'
      AND ingredient_id IS NULL
      AND maintenance_item_id IS NOT NULL
    )
  );