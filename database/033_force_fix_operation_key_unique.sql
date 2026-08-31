-- BUNBUN OS
-- Migration 033: force-remove any remaining UNIQUE constraint/index on operation_key
-- A multi-product release intentionally writes multiple movement rows with the
-- same operation_key. The key identifies the logical release, not a row.

DO $$
DECLARE
  v_constraint_name text;
  v_index_name text;
BEGIN
  -- Remove the named UNIQUE constraint if it still exists.
  SELECT c.conname
    INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'product_stock_movements'
    AND c.conname = 'product_stock_movements_operation_key_unique';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.product_stock_movements DROP CONSTRAINT %I',
      v_constraint_name
    );
  END IF;

  -- Remove a standalone UNIQUE index with the same name, if one exists.
  SELECT i.relname
    INTO v_index_name
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_class t ON t.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'product_stock_movements'
    AND i.relname = 'product_stock_movements_operation_key_unique'
    AND x.indisunique;

  IF v_index_name IS NOT NULL THEN
    EXECUTE format('DROP INDEX public.%I', v_index_name);
  END IF;
END $$;

-- Keep operation_key indexed for idempotency checks, but not unique.
CREATE INDEX IF NOT EXISTS product_stock_movements_operation_key_idx
  ON public.product_stock_movements (operation_key)
  WHERE operation_key IS NOT NULL;
