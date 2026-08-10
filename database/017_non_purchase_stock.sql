-- ============================================================
-- BUNBUN OS
-- Migration 017: Penambahan stok non-pembelian
-- ============================================================

alter table public.inventory_transactions
  add column if not exists stock_source text,
  add column if not exists unit_value numeric(14,2),
  add column if not exists operation_key text;

alter table public.inventory_transactions
  drop constraint if exists inventory_transactions_unit_value_check;

alter table public.inventory_transactions
  add constraint inventory_transactions_unit_value_check
  check (unit_value is null or unit_value >= 0);

create unique index if not exists inventory_transactions_operation_key_uidx
on public.inventory_transactions (operation_key)
where operation_key is not null and is_deleted = false;

create or replace function public.record_non_purchase_stock(
  p_transaction_date date,
  p_ingredient_id bigint,
  p_qty numeric,
  p_unit text,
  p_unit_value numeric,
  p_stock_source text,
  p_notes text,
  p_operation_key text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction_id bigint;
begin
  if not public.is_owner() then
    raise exception 'Hanya Owner yang dapat menambah stok non-pembelian.';
  end if;

  if p_transaction_date is null then
    raise exception 'Tanggal transaksi wajib diisi.';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'Jumlah stok harus lebih dari 0.';
  end if;

  if nullif(btrim(p_unit), '') is null then
    raise exception 'Satuan wajib diisi.';
  end if;

  if p_unit_value is null or p_unit_value <= 0 then
    raise exception 'Nilai HPP per satuan harus lebih dari 0.';
  end if;

  if nullif(btrim(p_stock_source), '') is null then
    raise exception 'Sumber stok wajib diisi.';
  end if;

  if nullif(btrim(p_operation_key), '') is null then
    raise exception 'Operation key wajib tersedia.';
  end if;

  if not exists (
    select 1
    from public.ingredients
    where id = p_ingredient_id
      and is_deleted = false
      and is_active = true
  ) then
    raise exception 'Bahan baku tidak ditemukan atau sudah tidak aktif.';
  end if;

  select id
  into v_transaction_id
  from public.inventory_transactions
  where operation_key = p_operation_key
    and is_deleted = false;

  if v_transaction_id is not null then
    return v_transaction_id;
  end if;

  insert into public.inventory_transactions (
    transaction_date,
    transaction_type,
    ingredient_id,
    qty,
    unit,
    stock_source,
    unit_value,
    operation_key,
    notes,
    created_by,
    updated_by
  ) values (
    p_transaction_date,
    'ADJUSTMENT',
    p_ingredient_id,
    p_qty,
    btrim(p_unit),
    btrim(p_stock_source),
    p_unit_value,
    btrim(p_operation_key),
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(),
    auth.uid()
  )
  on conflict (operation_key)
    where operation_key is not null and is_deleted = false
  do nothing
  returning id into v_transaction_id;

  if v_transaction_id is null then
    select id
    into v_transaction_id
    from public.inventory_transactions
    where operation_key = p_operation_key
      and is_deleted = false;

    return v_transaction_id;
  end if;

  -- Harga master menjadi nilai acuan HPP terbaru tanpa membuat pengeluaran kas.
  update public.ingredients
  set harga = p_unit_value,
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_ingredient_id;

  return v_transaction_id;
end;
$$;

revoke all on function public.record_non_purchase_stock(
  date, bigint, numeric, text, numeric, text, text, text
) from public, anon;

grant execute on function public.record_non_purchase_stock(
  date, bigint, numeric, text, numeric, text, text, text
) to authenticated;
