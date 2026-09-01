-- BUNBUN OS
-- Migration 020: koreksi stok Double Choco Crunchy Salt Bread
--
-- Produk SB-DCC sudah tidak memiliki stok fisik dan tidak diproduksi lagi,
-- tetapi ledger produk jadi menunjukkan saldo -15 pcs.
-- Koreksi ini menambahkan 15 pcs sebagai OPENING_BALANCE agar saldo ledger
-- menjadi tepat 0 pcs tanpa menghapus atau mengubah histori transaksi lama.

DO $$
DECLARE
  v_product_id bigint;
BEGIN
  SELECT id
    INTO v_product_id
  FROM public.products
  WHERE lower(sku) = lower('SB-DCC')
    AND is_deleted = false
  LIMIT 1;

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Produk SB-DCC tidak ditemukan.';
  END IF;

  INSERT INTO public.product_stock_movements (
    movement_date,
    movement_type,
    product_id,
    batch_split_id,
    qty,
    unit,
    operation_key,
    notes,
    created_by,
    updated_by
  )
  SELECT
    current_date,
    'OPENING_BALANCE',
    v_product_id,
    NULL,
    15,
    'pcs',
    '00000000-0000-4020-8000-000000000020'::uuid,
    'Koreksi stok: SB-DCC sudah tidak memiliki stok fisik; saldo sistem -15 pcs dikoreksi menjadi 0 pcs.',
    NULL,
    NULL
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.product_stock_movements
    WHERE operation_key = '00000000-0000-4020-8000-000000000020'::uuid
  );
END;
$$;
