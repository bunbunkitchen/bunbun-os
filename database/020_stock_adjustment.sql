-- ============================================================
-- BUNBUN OS
-- Migration 020: Stock Adjustment
-- ============================================================

-- Tambahkan tipe transaksi adjustment masuk/keluar.
-- ADJUSTMENT tetap dipertahankan untuk stok non-purchasing
-- yang sudah digunakan oleh migration 017.

alter table public.inventory_transactions
  drop constraint if exists inventory_transactions_transaction_type_check;

alter table public.inventory_transactions
  add constraint inventory_transactions_transaction_type_check
  check (
    transaction_type in (
      'PURCHASE',
      'PRODUCTION_OUT',
      'PRODUCTION_IN',
      'ADJUSTMENT',
      'ADJUSTMENT_IN',
      'ADJUSTMENT_OUT',
      'SALE'
    )
  );


-- ============================================================
-- RPC: record_inventory_adjustment
-- ============================================================

create or replace function public.record_inventory_adjustment(
  p_transaction_date date,
  p_ingredient_id bigint,
  p_adjustment_type text,
  p_qty numeric,
  p_unit text,
  p_reason text,
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
  v_transaction_type text;
begin

  -- Hanya Owner yang boleh melakukan stock adjustment.
  if not public.is_owner() then
    raise exception 'Hanya Owner yang dapat melakukan stock adjustment.';
  end if;


  -- Validasi tanggal.
  if p_transaction_date is null then
    raise exception 'Tanggal adjustment wajib diisi.';
  end if;


  -- Validasi item.
  if not exists (
    select 1
    from public.ingredients
    where id = p_ingredient_id
      and is_deleted = false
      and is_active = true
  ) then
    raise exception 'Bahan baku tidak ditemukan atau sudah tidak aktif.';
  end if;


  -- Validasi jenis adjustment.
  if p_adjustment_type not in (
    'IN',
    'OUT'
  ) then
    raise exception 'Jenis adjustment tidak valid.';
  end if;


  -- Validasi jumlah.
  if p_qty is null or p_qty <= 0 then
    raise exception 'Jumlah adjustment harus lebih dari 0.';
  end if;


  -- Validasi satuan.
  if nullif(btrim(p_unit), '') is null then
    raise exception 'Satuan wajib diisi.';
  end if;


  -- Validasi alasan.
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Alasan adjustment wajib diisi.';
  end if;


  -- Operation key wajib agar double submit tidak membuat
  -- dua transaksi adjustment.
  if nullif(btrim(p_operation_key), '') is null then
    raise exception 'Operation key wajib tersedia.';
  end if;


  -- Cegah transaksi ganda.
  select id
  into v_transaction_id
  from public.inventory_transactions
  where operation_key = p_operation_key
    and is_deleted = false;

  if v_transaction_id is not null then
    return v_transaction_id;
  end if;


  if p_adjustment_type = 'IN' then
    v_transaction_type := 'ADJUSTMENT_IN';
  else
    v_transaction_type := 'ADJUSTMENT_OUT';
  end if;


  insert into public.inventory_transactions (
    transaction_date,
    transaction_type,
    ingredient_id,
    qty,
    unit,
    operation_key,
    notes,
    created_by,
    updated_by
  )
  values (
    p_transaction_date,
    v_transaction_type,
    p_ingredient_id,
    p_qty,
    btrim(p_unit),
    btrim(p_operation_key),
    concat(
      'Stock Adjustment: ',
      btrim(p_reason),
      case
        when nullif(btrim(coalesce(p_notes, '')), '') is not null
          then concat(' — ', btrim(p_notes))
        else ''
      end
    ),
    auth.uid(),
    auth.uid()
  )
  on conflict (operation_key)
    where operation_key is not null
      and is_deleted = false
  do nothing
  returning id
  into v_transaction_id;


  -- Jika terjadi race condition / double submit,
  -- ambil transaksi yang sudah ada.
  if v_transaction_id is null then
    select id
    into v_transaction_id
    from public.inventory_transactions
    where operation_key = p_operation_key
      and is_deleted = false;

    return v_transaction_id;
  end if;


  return v_transaction_id;

end;
$$;


-- ============================================================
-- Permission RPC
-- ============================================================

revoke all on function public.record_inventory_adjustment(
  date,
  bigint,
  text,
  numeric,
  text,
  text,
  text,
  text
) from public, anon;

grant execute on function public.record_inventory_adjustment(
  date,
  bigint,
  text,
  numeric,
  text,
  text,
  text,
  text
) to authenticated;