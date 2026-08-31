-- BUNBUN OS
-- Migration 031: multi-product manual finished-stock release
-- One manual release can contain multiple finished products and is atomic.

create or replace function public.record_multi_product_release(
  p_movement_date date,
  p_destination text,
  p_notes text,
  p_items jsonb,
  p_operation_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_item jsonb;
  v_product_id bigint;
  v_qty integer;
  v_balance integer;
  v_product public.products%rowtype;
  v_final_notes text;
  v_count integer := 0;
begin
  v_user_id := public.assert_frozen_flow_operator();

  if p_movement_date is null then
    raise exception 'Tanggal pengeluaran wajib diisi.';
  end if;

  if nullif(btrim(p_destination), '') is null then
    raise exception 'Tujuan / keperluan wajib diisi.';
  end if;

  if p_operation_key is null then
    raise exception 'operation_key wajib diisi.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Minimal harus ada satu produk yang dikeluarkan.';
  end if;

  if exists (
    select 1
    from public.product_stock_movements m
    where m.operation_key = p_operation_key
  ) then
    raise exception 'Permintaan ini sudah pernah dicatat.' using errcode = '23505';
  end if;

  v_final_notes := nullif(
    btrim('Tujuan: ' || p_destination || coalesce(' · ' || nullif(btrim(p_notes), ''), '')),
    ''
  );

  -- Lock all products first so the complete multi-item release is validated
  -- against a stable stock state before any movement is inserted.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'productId', '')::bigint;
    v_qty := (v_item->>'quantity')::numeric::integer;

    if v_product_id is null then
      raise exception 'Produk tidak valid.';
    end if;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Jumlah setiap produk harus lebih dari 0.';
    end if;

    select p.* into v_product
    from public.products p
    where p.id = v_product_id
      and p.is_deleted = false
      and p.is_active = true
    for update;

    if not found then
      raise exception 'Produk aktif tidak ditemukan.';
    end if;

    select coalesce(sum(
      case
        when m.movement_type in ('FINISHED_IN', 'OPENING_BALANCE', 'CAFE_IN') then m.qty
        when m.movement_type = 'CAFE_OUT' then -m.qty
        else 0
      end
    ), 0)::integer
    into v_balance
    from public.product_stock_movements m
    where m.product_id = v_product_id
      and m.is_deleted = false;

    if v_qty > v_balance then
      raise exception 'Stok produk jadi tidak cukup untuk %. Saldo tersedia: % pcs.',
        v_product.nama, v_balance;
    end if;

    v_count := v_count + 1;
  end loop;

  -- All validation succeeded; PostgreSQL transaction semantics make the
  -- complete release atomic.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::bigint;
    v_qty := (v_item->>'quantity')::numeric::integer;

    insert into public.product_stock_movements (
      movement_date,
      movement_type,
      product_id,
      qty,
      unit,
      operation_key,
      notes,
      created_by,
      updated_by
    ) values (
      p_movement_date,
      'CAFE_OUT',
      v_product_id,
      v_qty,
      'pcs',
      p_operation_key,
      v_final_notes,
      v_user_id,
      v_user_id
    );
  end loop;

  return jsonb_build_object(
    'items_count', v_count,
    'movement_date', p_movement_date,
    'destination', p_destination
  );
end;
$$;

revoke all on function public.record_multi_product_release(date, text, text, jsonb, uuid) from public;
revoke all on function public.record_multi_product_release(date, text, text, jsonb, uuid) from anon;
grant execute on function public.record_multi_product_release(date, text, text, jsonb, uuid) to authenticated;
