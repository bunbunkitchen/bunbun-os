-- Finished product stock adjustment
-- Adds explicit IN/OUT adjustment movements without affecting cashflow or recipe HPP.

alter table public.product_stock_movements
  drop constraint if exists product_stock_movements_movement_type_check;

alter table public.product_stock_movements
  add constraint product_stock_movements_movement_type_check
  check (
    movement_type = any (
      array[
        'FROZEN_IN',
        'FROZEN_OUT',
        'FINISHED_IN',
        'CAFE_OUT',
        'CAFE_IN',
        'OPENING_BALANCE',
        'ADJUSTMENT_IN',
        'ADJUSTMENT_OUT'
      ]
    )
  );

alter table public.product_stock_movements
  drop constraint if exists product_stock_movements_split_required_check;

alter table public.product_stock_movements
  add constraint product_stock_movements_split_required_check
  check (
    (
      movement_type = any (array['FROZEN_IN','FROZEN_OUT','FINISHED_IN'])
      and batch_split_id is not null
    )
    or
    (
      movement_type = any (
        array['CAFE_OUT','CAFE_IN','OPENING_BALANCE','ADJUSTMENT_IN','ADJUSTMENT_OUT']
      )
      and batch_split_id is null
    )
  );

create or replace function public.get_finished_product_balances()
returns table(product_id bigint, product_sku text, product_nama text, masuk bigint, keluar bigint, saldo bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    p.id,
    p.sku,
    p.nama,
    coalesce(sum(case when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty else 0 end),0)::bigint,
    coalesce(sum(case when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then m.qty else 0 end),0)::bigint,
    (
      coalesce(sum(case when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty else 0 end),0)
      - coalesce(sum(case when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then m.qty else 0 end),0)
    )::bigint
  from public.products p
  join public.product_stock_movements m
    on m.product_id = p.id
   and m.is_deleted = false
   and m.movement_type in ('FINISHED_IN','CAFE_OUT','CAFE_IN','OPENING_BALANCE','ADJUSTMENT_IN','ADJUSTMENT_OUT')
  where p.is_active = true
  group by p.id,p.sku,p.nama
  having (
    coalesce(sum(case when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty else 0 end),0)
    - coalesce(sum(case when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then m.qty else 0 end),0)
  ) > 0
  order by p.nama;
$function$;

create or replace function public.record_product_stock_adjustment(
  p_product_id bigint,
  p_adjustment_type text,
  p_qty integer,
  p_movement_date date,
  p_reason text,
  p_notes text,
  p_operation_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid;
  v_product public.products%rowtype;
  v_balance integer;
  v_movement_type text;
  v_movement_id bigint;
  v_notes text;
begin
  v_user_id := auth.uid();

  if v_user_id is null or not public.is_owner() then
    raise exception 'Akses penyesuaian stok produk hanya untuk owner.' using errcode = '42501';
  end if;

  if p_product_id is null then raise exception 'Produk wajib dipilih.'; end if;
  if p_adjustment_type not in ('IN','OUT') then raise exception 'Jenis penyesuaian stok tidak valid.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah penyesuaian harus lebih dari 0.'; end if;
  if p_movement_date is null then raise exception 'Tanggal penyesuaian wajib diisi.'; end if;
  if nullif(btrim(coalesce(p_reason,'')), '') is null then raise exception 'Alasan penyesuaian wajib diisi.'; end if;
  if p_operation_key is null then raise exception 'operation_key wajib diisi.'; end if;

  if exists (
    select 1 from public.product_stock_movements m
    where m.operation_key = p_operation_key and m.is_deleted = false
  ) then
    raise exception 'Permintaan ini sudah pernah dicatat.' using errcode = '23505';
  end if;

  select p.* into v_product
  from public.products p
  where p.id = p_product_id and p.is_deleted = false and p.is_active = true
  for update;

  if not found then raise exception 'Produk aktif tidak ditemukan.'; end if;

  select coalesce(sum(case
    when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty
    when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -m.qty
    else 0
  end), 0)::integer
  into v_balance
  from public.product_stock_movements m
  where m.product_id = p_product_id and m.is_deleted = false;

  if p_adjustment_type = 'OUT' and p_qty > v_balance then
    raise exception 'Stok produk jadi tidak cukup. Saldo tersedia: % pcs.', v_balance;
  end if;

  v_movement_type := case when p_adjustment_type = 'IN' then 'ADJUSTMENT_IN' else 'ADJUSTMENT_OUT' end;

  v_notes := nullif(
    btrim('Alasan: ' || p_reason || coalesce(' · ' || nullif(btrim(p_notes), ''), '')),
    ''
  );

  insert into public.product_stock_movements (
    movement_date, movement_type, product_id, batch_split_id, qty, unit,
    operation_key, notes, created_by, updated_by
  ) values (
    p_movement_date, v_movement_type, p_product_id, null, p_qty, 'pcs',
    p_operation_key, v_notes, v_user_id, v_user_id
  )
  returning id into v_movement_id;

  return jsonb_build_object(
    'movement_id', v_movement_id,
    'product_id', p_product_id,
    'adjustment_type', p_adjustment_type,
    'qty', p_qty,
    'previous_balance', v_balance,
    'remaining_balance', case when p_adjustment_type = 'IN' then v_balance + p_qty else v_balance - p_qty end
  );
end;
$function$;

revoke all on function public.record_product_stock_adjustment(bigint,text,integer,date,text,text,uuid) from public;
grant execute on function public.record_product_stock_adjustment(bigint,text,integer,date,text,text,uuid) to authenticated;

create or replace function public.record_cafe_deposit(
  p_product_id bigint, p_qty integer, p_movement_date date,
  p_operation_key uuid, p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid; v_finished_balance integer; v_movement_id bigint;
begin
  v_user_id := public.assert_frozen_flow_operator();
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah setoran ke kafe harus lebih dari 0.'; end if;
  if p_movement_date is null or p_operation_key is null then raise exception 'Tanggal dan operation_key wajib diisi.'; end if;
  if not exists (select 1 from public.products p where p.id = p_product_id and p.is_deleted = false and p.is_active = true) then raise exception 'Produk aktif tidak ditemukan.'; end if;
  if exists (select 1 from public.product_stock_movements m where m.operation_key = p_operation_key) then raise exception 'Permintaan ini sudah pernah dicatat.' using errcode = '23505'; end if;
  perform 1 from public.products p where p.id = p_product_id for update;
  select coalesce(sum(case
    when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty
    when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -m.qty
    else 0 end), 0)::integer
  into v_finished_balance
  from public.product_stock_movements m
  where m.product_id = p_product_id and m.is_deleted = false;
  if p_qty > v_finished_balance then raise exception 'Stok produk jadi tidak cukup. Saldo tersedia: % pcs.', v_finished_balance; end if;
  insert into public.product_stock_movements (movement_date,movement_type,product_id,qty,unit,operation_key,notes,created_by,updated_by)
  values (p_movement_date,'CAFE_OUT',p_product_id,p_qty,'pcs',p_operation_key,nullif(btrim(p_notes),''),v_user_id,v_user_id)
  returning id into v_movement_id;
  return jsonb_build_object('movement_id',v_movement_id,'product_id',p_product_id,'deposited_qty',p_qty,'remaining_finished_qty',v_finished_balance-p_qty);
end;
$function$;

create or replace function public.record_multi_product_release(
  p_movement_date date, p_destination text, p_notes text, p_items jsonb, p_operation_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user_id uuid; v_item jsonb; v_product_id bigint; v_qty integer;
  v_balance integer; v_product public.products%rowtype; v_final_notes text; v_count integer := 0;
begin
  v_user_id := public.assert_frozen_flow_operator();
  if p_movement_date is null then raise exception 'Tanggal pengeluaran wajib diisi.'; end if;
  if nullif(btrim(p_destination), '') is null then raise exception 'Tujuan / keperluan wajib diisi.'; end if;
  if p_operation_key is null then raise exception 'operation_key wajib diisi.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Minimal harus ada satu produk yang dikeluarkan.'; end if;
  if exists (select 1 from public.product_stock_movements m where m.operation_key = p_operation_key and m.is_deleted = false) then raise exception 'Permintaan ini sudah pernah dicatat.' using errcode = '23505'; end if;

  v_final_notes := nullif(btrim('Tujuan: ' || p_destination || coalesce(' · ' || nullif(btrim(p_notes), ''), '')), '');

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(v_item->>'productId', '')::bigint;
    v_qty := (v_item->>'quantity')::numeric::integer;
    if v_product_id is null then raise exception 'Produk tidak valid.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Jumlah setiap produk harus lebih dari 0.'; end if;
    select p.* into v_product from public.products p
    where p.id = v_product_id and p.is_deleted = false and p.is_active = true for update;
    if not found then raise exception 'Produk aktif tidak ditemukan.'; end if;
    select coalesce(sum(case
      when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty
      when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -m.qty
      else 0 end), 0)::integer
    into v_balance
    from public.product_stock_movements m
    where m.product_id = v_product_id and m.is_deleted = false;
    if v_qty > v_balance then raise exception 'Stok produk jadi tidak cukup untuk %. Saldo tersedia: % pcs.', v_product.nama, v_balance; end if;
    v_count := v_count + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'productId')::bigint;
    v_qty := (v_item->>'quantity')::numeric::integer;
    insert into public.product_stock_movements (movement_date,movement_type,product_id,qty,unit,operation_key,notes,created_by,updated_by)
    values (p_movement_date,'CAFE_OUT',v_product_id,v_qty,'pcs',p_operation_key,v_final_notes,v_user_id,v_user_id);
  end loop;

  return jsonb_build_object('items_count',v_count,'movement_date',p_movement_date,'destination',p_destination);
end;
$function$;
