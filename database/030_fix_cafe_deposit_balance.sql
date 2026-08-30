-- BUNBUN OS
-- Migration 030: keep manual product release balance aware of CAFE_IN reversals

create or replace function public.record_cafe_deposit(
  p_product_id bigint,
  p_qty integer,
  p_movement_date date,
  p_operation_key uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_finished_balance integer;
  v_movement_id bigint;
begin
  v_user_id := public.assert_frozen_flow_operator();

  if p_qty is null or p_qty <= 0 then
    raise exception 'Jumlah setoran ke kafe harus lebih dari 0.';
  end if;

  if p_movement_date is null or p_operation_key is null then
    raise exception 'Tanggal dan operation_key wajib diisi.';
  end if;

  if not exists (
    select 1
    from public.products p
    where p.id = p_product_id
      and p.is_deleted = false
      and p.is_active = true
  ) then
    raise exception 'Produk aktif tidak ditemukan.';
  end if;

  if exists (
    select 1
    from public.product_stock_movements m
    where m.operation_key = p_operation_key
  ) then
    raise exception 'Permintaan ini sudah pernah dicatat.' using errcode = '23505';
  end if;

  perform 1
  from public.products p
  where p.id = p_product_id
  for update;

  select coalesce(sum(
    case
      when m.movement_type in ('FINISHED_IN', 'OPENING_BALANCE', 'CAFE_IN') then m.qty
      when m.movement_type = 'CAFE_OUT' then -m.qty
      else 0
    end
  ), 0)::integer
  into v_finished_balance
  from public.product_stock_movements m
  where m.product_id = p_product_id
    and m.is_deleted = false;

  if p_qty > v_finished_balance then
    raise exception 'Stok produk jadi tidak cukup. Saldo tersedia: % pcs.', v_finished_balance;
  end if;

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
    p_product_id,
    p_qty,
    'pcs',
    p_operation_key,
    nullif(btrim(p_notes), ''),
    v_user_id,
    v_user_id
  ) returning id into v_movement_id;

  return jsonb_build_object(
    'movement_id', v_movement_id,
    'product_id', p_product_id,
    'deposited_qty', p_qty,
    'remaining_finished_qty', v_finished_balance - p_qty
  );
end;
$$;

revoke all on function public.record_cafe_deposit(bigint, integer, date, uuid, text) from public;
revoke all on function public.record_cafe_deposit(bigint, integer, date, uuid, text) from anon;
grant execute on function public.record_cafe_deposit(bigint, integer, date, uuid, text) to authenticated;
