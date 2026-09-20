-- Include finished-product stock adjustments in all balance checks.

CREATE OR REPLACE FUNCTION public.record_sale_transaction(p_sale_date date, p_sales_channel text, p_notes text, p_items jsonb, p_operation_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        when m.movement_type in ('FINISHED_IN', 'OPENING_BALANCE', 'CAFE_IN', 'ADJUSTMENT_IN')
          then m.qty
        when m.movement_type in ('CAFE_OUT', 'ADJUSTMENT_OUT')
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
$function$
;

CREATE OR REPLACE FUNCTION public.update_sale_transaction(p_sale_id bigint, p_sale_date date, p_sales_channel text, p_notes text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        when m.movement_type in ('FINISHED_IN', 'OPENING_BALANCE', 'CAFE_IN', 'ADJUSTMENT_IN')
          then m.qty
        when m.movement_type in ('CAFE_OUT', 'ADJUSTMENT_OUT')
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
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_finished_product_stock_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pid bigint;
begin
  for pid in
    select distinct x.product_id
    from (
      select new.product_id as product_id where tg_op <> 'DELETE'
      union
      select old.product_id as product_id where tg_op <> 'INSERT'
    ) x
    where x.product_id is not null
  loop
    delete from public.finished_product_stock_balances b
    where b.product_id = pid
      and not exists (
        select 1
        from public.products p
        join public.product_stock_movements m on m.product_id=p.id
        where p.id=pid
          and p.is_active=true
          and m.is_deleted=false
          and m.movement_type in ('FINISHED_IN','CAFE_OUT','CAFE_IN','OPENING_BALANCE','ADJUSTMENT_IN','ADJUSTMENT_OUT')
        group by p.id,p.sku,p.nama
        having (
          coalesce(sum(case when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty else 0 end),0)
          - coalesce(sum(case when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then m.qty else 0 end),0)
        ) > 0
      );

    insert into public.finished_product_stock_balances
      (product_id, product_sku, product_nama, masuk, keluar, saldo, updated_at)
    select
      p.id,p.sku,p.nama,
      coalesce(sum(case when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty else 0 end),0)::bigint,
      coalesce(sum(case when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then m.qty else 0 end),0)::bigint,
      (
        coalesce(sum(case when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty else 0 end),0)
        - coalesce(sum(case when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then m.qty else 0 end),0)
      )::bigint,
      now()
    from public.products p
    join public.product_stock_movements m on m.product_id=p.id
    where p.id=pid
      and p.is_active=true
      and m.is_deleted=false
      and m.movement_type in ('FINISHED_IN','CAFE_OUT','CAFE_IN','OPENING_BALANCE','ADJUSTMENT_IN','ADJUSTMENT_OUT')
    group by p.id,p.sku,p.nama
    having (
      coalesce(sum(case when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty else 0 end),0)
      - coalesce(sum(case when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then m.qty else 0 end),0)
    ) > 0
    on conflict (product_id) do update set
      product_sku=excluded.product_sku,
      product_nama=excluded.product_nama,
      masuk=excluded.masuk,
      keluar=excluded.keluar,
      saldo=excluded.saldo,
      updated_at=now();
  end loop;

  return coalesce(new,old);
end;
$function$
;
