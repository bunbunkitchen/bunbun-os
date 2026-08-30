-- ============================================================
-- BUNBUN OS
-- Migration 029: automatic finished-product stock deduction from sales
--
-- New sales reduce finished-product stock automatically through the
-- existing product_stock_movements ledger using CAFE_OUT.
--
-- Existing / legacy sales remain untouched. Only sales created through
-- the new RPC receive automatic stock movements.
-- ============================================================

-- Keep a request key on sales so a retried create request cannot create
-- a duplicate sale.
alter table public.sales
  add column if not exists operation_key uuid;

create unique index if not exists sales_operation_key_unique
on public.sales (operation_key)
where operation_key is not null;

-- CAFE_IN is the reversal side of CAFE_OUT. It is used only when a
-- stock-managed sale is edited or deleted, so the product ledger remains
-- auditable instead of directly changing stock balances.
alter table public.product_stock_movements
  drop constraint if exists product_stock_movements_movement_type_check;

alter table public.product_stock_movements
  add constraint product_stock_movements_movement_type_check
  check (
    movement_type in (
      'FROZEN_IN',
      'FROZEN_OUT',
      'FINISHED_IN',
      'CAFE_OUT',
      'CAFE_IN',
      'OPENING_BALANCE'
    )
  );

alter table public.product_stock_movements
  add column if not exists sale_id bigint references public.sales(id);

create index if not exists product_stock_movements_sale_id_idx
on public.product_stock_movements (sale_id)
where sale_id is not null and is_deleted = false;


-- ------------------------------------------------------------
-- CREATE SALE + STOCK OUT ATOMICALLY
-- ------------------------------------------------------------
create or replace function public.record_sale_transaction(
  p_sale_date date,
  p_sales_channel text,
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
  v_sale_id bigint;
  v_total numeric := 0;
  v_item jsonb;
  v_product_id bigint;
  v_qty integer;
  v_price numeric;
  v_subtotal numeric;
  v_order_type text;
  v_product public.products%rowtype;
  v_stock integer;
begin
  v_user_id := public.assert_frozen_flow_operator();

  if p_sale_date is null then
    raise exception 'Tanggal penjualan wajib diisi.';
  end if;

  if nullif(btrim(p_sales_channel), '') is null then
    raise exception 'Sumber penjualan wajib diisi.';
  end if;

  if p_operation_key is null then
    raise exception 'operation_key wajib diisi untuk penjualan.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Minimal harus ada satu item dalam penjualan.';
  end if;

  -- Idempotent create: the same form submission cannot create two sales.
  select s.id into v_sale_id
  from public.sales s
  where s.operation_key = p_operation_key;

  if v_sale_id is not null then
    return jsonb_build_object(
      'sale_id', v_sale_id,
      'already_exists', true
    );
  end if;

  insert into public.sales (
    sale_date,
    sales_channel,
    total_amount,
    notes,
    is_deleted,
    operation_key,
    created_by,
    updated_by
  ) values (
    p_sale_date,
    p_sales_channel,
    0,
    nullif(btrim(p_notes), ''),
    false,
    p_operation_key,
    v_user_id,
    v_user_id
  ) returning id into v_sale_id;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'productId', '')::bigint;
    v_qty := (v_item->>'quantity')::numeric::integer;
    v_price := coalesce((v_item->>'sellingPrice')::numeric, 0);
    v_order_type := v_item->>'orderType';

    if v_product_id is null then
      raise exception 'Produk penjualan tidak valid.';
    end if;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Qty penjualan harus lebih dari 0.';
    end if;

    if v_price < 0 then
      raise exception 'Harga jual tidak boleh negatif.';
    end if;

    if v_order_type not in ('DINE_IN', 'TAKE_AWAY') then
      raise exception 'Jenis pesanan harus Dine In atau Take Away.';
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

    -- Serialize stock changes for this product. The balance is calculated
    -- after all earlier movements in this same transaction have been posted.
    select coalesce(sum(
      case
        when m.movement_type in ('FINISHED_IN', 'OPENING_BALANCE', 'CAFE_IN')
          then m.qty
        when m.movement_type = 'CAFE_OUT'
          then -m.qty
        else 0
      end
    ), 0)::integer
    into v_stock
    from public.product_stock_movements m
    where m.product_id = v_product_id
      and m.is_deleted = false;

    if v_qty > v_stock then
      raise exception 'Stok produk jadi tidak cukup untuk %. Saldo tersedia: % pcs.',
        v_product.nama, v_stock;
    end if;

    v_subtotal := v_qty * v_price;
    v_total := v_total + v_subtotal;

    insert into public.sale_items (
      sale_id,
      product_id,
      product_sku,
      product_name,
      quantity,
      selling_price,
      subtotal,
      order_type
    ) values (
      v_sale_id,
      v_product.id,
      v_product.sku,
      v_product.nama,
      v_qty,
      v_price,
      v_subtotal,
      v_order_type
    );

    insert into public.product_stock_movements (
      movement_date,
      movement_type,
      product_id,
      qty,
      unit,
      operation_key,
      sale_id,
      notes,
      created_by,
      updated_by
    ) values (
      p_sale_date,
      'CAFE_OUT',
      v_product.id,
      v_qty,
      'pcs',
      gen_random_uuid(),
      v_sale_id,
      'Penjualan - ' || p_sales_channel,
      v_user_id,
      v_user_id
    );
  end loop;

  update public.sales
  set total_amount = v_total,
      updated_by = v_user_id
  where id = v_sale_id;

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'already_exists', false,
    'total_amount', v_total
  );
end;
$$;


-- ------------------------------------------------------------
-- UPDATE SALE + REVERSE OLD STOCK + APPLY NEW STOCK
-- ------------------------------------------------------------
create or replace function public.update_sale_transaction(
  p_sale_id bigint,
  p_sale_date date,
  p_sales_channel text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_product_id bigint;
  v_qty integer;
  v_price numeric;
  v_subtotal numeric;
  v_order_type text;
  v_product public.products%rowtype;
  v_stock integer;
  v_total numeric := 0;
begin
  v_user_id := public.assert_frozen_flow_operator();

  if p_sale_date is null then
    raise exception 'Tanggal penjualan wajib diisi.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Minimal harus ada satu item dalam penjualan.';
  end if;

  select s.* into v_sale
  from public.sales s
  where s.id = p_sale_id
    and s.is_deleted = false
  for update;

  if not found then
    raise exception 'Transaksi penjualan tidak ditemukan.';
  end if;

  -- Legacy sales have no operation_key and therefore never had automatic
  -- product-stock deduction. Editing them must not invent a stock movement.
  if v_sale.operation_key is not null then
    for v_item in
      select value from jsonb_array_elements(
        coalesce(
          (select jsonb_agg(
            jsonb_build_object(
              'productId', si.product_id,
              'quantity', si.quantity
            )
          ) from public.sale_items si where si.sale_id = v_sale.id),
          '[]'::jsonb
        )
      )
    loop
      v_product_id := (v_item->>'productId')::bigint;
      v_qty := (v_item->>'quantity')::numeric::integer;

      if v_qty > 0 then
        insert into public.product_stock_movements (
          movement_date,
          movement_type,
          product_id,
          qty,
          unit,
          operation_key,
          sale_id,
          notes,
          created_by,
          updated_by
        ) values (
          p_sale_date,
          'CAFE_IN',
          v_product_id,
          v_qty,
          'pcs',
          gen_random_uuid(),
          v_sale.id,
          'Pembalikan stok dari edit penjualan',
          v_user_id,
          v_user_id
        );
      end if;
    end loop;
  end if;

  delete from public.sale_items
  where sale_id = v_sale.id;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'productId', '')::bigint;
    v_qty := (v_item->>'quantity')::numeric::integer;
    v_price := coalesce((v_item->>'sellingPrice')::numeric, 0);
    v_order_type := v_item->>'orderType';

    if v_product_id is null then
      raise exception 'Produk penjualan tidak valid.';
    end if;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Qty penjualan harus lebih dari 0.';
    end if;

    if v_price < 0 then
      raise exception 'Harga jual tidak boleh negatif.';
    end if;

    if v_order_type not in ('DINE_IN', 'TAKE_AWAY') then
      raise exception 'Jenis pesanan harus Dine In atau Take Away.';
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
        when m.movement_type in ('FINISHED_IN', 'OPENING_BALANCE', 'CAFE_IN')
          then m.qty
        when m.movement_type = 'CAFE_OUT'
          then -m.qty
        else 0
      end
    ), 0)::integer
    into v_stock
    from public.product_stock_movements m
    where m.product_id = v_product_id
      and m.is_deleted = false;

    if v_qty > v_stock then
      raise exception 'Stok produk jadi tidak cukup untuk %. Saldo tersedia: % pcs.',
        v_product.nama, v_stock;
    end if;

    v_subtotal := v_qty * v_price;
    v_total := v_total + v_subtotal;

    insert into public.sale_items (
      sale_id,
      product_id,
      product_sku,
      product_name,
      quantity,
      selling_price,
      subtotal,
      order_type
    ) values (
      v_sale.id,
      v_product.id,
      v_product.sku,
      v_product.nama,
      v_qty,
      v_price,
      v_subtotal,
      v_order_type
    );

    if v_sale.operation_key is not null then
      insert into public.product_stock_movements (
        movement_date,
        movement_type,
        product_id,
        qty,
        unit,
        operation_key,
        sale_id,
        notes,
        created_by,
        updated_by
      ) values (
        p_sale_date,
        'CAFE_OUT',
        v_product.id,
        v_qty,
        'pcs',
        gen_random_uuid(),
        v_sale.id,
        'Penjualan hasil edit - ' || p_sales_channel,
        v_user_id,
        v_user_id
      );
    end if;
  end loop;

  update public.sales
  set sale_date = p_sale_date,
      sales_channel = p_sales_channel,
      total_amount = v_total,
      notes = nullif(btrim(p_notes), ''),
      updated_by = v_user_id
  where id = v_sale.id;

  return jsonb_build_object(
    'sale_id', v_sale.id,
    'total_amount', v_total
  );
end;
$$;


-- ------------------------------------------------------------
-- SOFT DELETE SALE + RETURN STOCK FOR STOCK-MANAGED SALES
-- ------------------------------------------------------------
create or replace function public.delete_sale_transaction(
  p_sale_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_sale public.sales%rowtype;
  v_item record;
begin
  v_user_id := public.assert_frozen_flow_operator();

  select s.* into v_sale
  from public.sales s
  where s.id = p_sale_id
    and s.is_deleted = false
  for update;

  if not found then
    raise exception 'Transaksi penjualan tidak ditemukan.';
  end if;

  if v_sale.operation_key is not null then
    for v_item in
      select product_id, quantity
      from public.sale_items
      where sale_id = v_sale.id
    loop
      insert into public.product_stock_movements (
        movement_date,
        movement_type,
        product_id,
        qty,
        unit,
        operation_key,
        sale_id,
        notes,
        created_by,
        updated_by
      ) values (
        v_sale.sale_date,
        'CAFE_IN',
        v_item.product_id,
        v_item.quantity,
        'pcs',
        gen_random_uuid(),
        v_sale.id,
        'Pembalikan stok karena penjualan dihapus',
        v_user_id,
        v_user_id
      );
    end loop;
  end if;

  update public.sales
  set is_deleted = true,
      updated_by = v_user_id
  where id = v_sale.id;

  return jsonb_build_object(
    'sale_id', v_sale.id,
    'stock_reversed', v_sale.operation_key is not null
  );
end;
$$;


revoke all on function public.record_sale_transaction(date, text, text, jsonb, uuid) from public;
revoke all on function public.update_sale_transaction(bigint, date, text, text, jsonb) from public;
revoke all on function public.delete_sale_transaction(bigint) from public;

revoke all on function public.record_sale_transaction(date, text, text, jsonb, uuid) from anon;
revoke all on function public.update_sale_transaction(bigint, date, text, text, jsonb) from anon;
revoke all on function public.delete_sale_transaction(bigint) from anon;

grant execute on function public.record_sale_transaction(date, text, text, jsonb, uuid) to authenticated;
grant execute on function public.update_sale_transaction(bigint, date, text, text, jsonb) to authenticated;
grant execute on function public.delete_sale_transaction(bigint) to authenticated;
