-- SCHEMA ONLY, derived from production catalogs 2026-11-02. No rows, users, passwords or sequence values.
-- Target: independent empty staging pkgrqalpazhwdcxmthvb ONLY.
BEGIN;
SET LOCAL check_function_bodies = false;
SET LOCAL search_path = public, extensions;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.profiles) THEN RAISE EXCEPTION 'requires empty staging'; END IF; EXCEPTION WHEN undefined_table THEN NULL; END $$;
CREATE TYPE public."user_role" AS ENUM ('owner','baker','helper');
CREATE TABLE public."profiles" (
  "id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "role" user_role DEFAULT 'helper'::user_role NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."categories" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "kode" text NOT NULL,
  "nama" text NOT NULL,
  "is_active" boolean DEFAULT true,
  "is_deleted" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_by" uuid,
  "updated_by" uuid
);
CREATE TABLE public."incomes" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "tanggal" date NOT NULL,
  "total_penjualan" numeric(14,2) NOT NULL,
  "persentase_bunbun" numeric(5,2) DEFAULT 100 NOT NULL,
  "pemasukan_bunbun" numeric(14,2) NOT NULL,
  "keterangan" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "asal_setoran" text DEFAULT 'Setoran kafe'::text NOT NULL,
  "kode_lot" text
);
CREATE TABLE public."expenses" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "tanggal" date NOT NULL,
  "kategori" text NOT NULL,
  "nominal" numeric(14,2) NOT NULL,
  "keterangan" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "purchase_id" bigint
);
CREATE TABLE public."suppliers" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "kode" text NOT NULL,
  "nama" text NOT NULL,
  "kontak" text,
  "telepon" text,
  "email" text,
  "alamat" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL
);
CREATE TABLE public."products" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "sku" text NOT NULL,
  "nama" text NOT NULL,
  "category_id" bigint,
  "harga" numeric(14,2) DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL
);
CREATE TABLE public."ingredients" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "kode" text NOT NULL,
  "nama" text NOT NULL,
  "kategori" text NOT NULL,
  "satuan" text NOT NULL,
  "harga" numeric(14,2) NOT NULL,
  "minimum_stok" numeric(14,2) DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL
);
CREATE TABLE public."recipe_items" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "recipe_id" bigint NOT NULL,
  "ingredient_id" bigint,
  "jumlah" numeric(14,3) NOT NULL,
  "satuan" text NOT NULL,
  "urutan" integer DEFAULT 1 NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "sub_recipe_id" bigint
);
CREATE TABLE public."recipes" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "kode" text NOT NULL,
  "nama" text NOT NULL,
  "kategori" text DEFAULT 'Salt Bread'::text NOT NULL,
  "yield_qty" numeric(14,2) NOT NULL,
  "yield_unit" text DEFAULT 'pcs'::text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "product_id" bigint,
  "output_ingredient_id" bigint,
  "output_ingredient_qty_per_unit" numeric(14,6) DEFAULT 1 NOT NULL
);
CREATE TABLE public."production_orders" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "kode" text NOT NULL,
  "tanggal" date NOT NULL,
  "recipe_id" bigint NOT NULL,
  "target_produksi" numeric(14,2) NOT NULL,
  "satuan" text DEFAULT 'pcs'::text NOT NULL,
  "estimasi_biaya" numeric(14,2) DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'Draft'::text NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL
);
CREATE TABLE public."maintenance_purchases" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "tanggal" date NOT NULL,
  "supplier_id" bigint,
  "maintenance_item_id" bigint NOT NULL,
  "jumlah" numeric(14,3) NOT NULL,
  "satuan" text NOT NULL,
  "harga_satuan" numeric(14,2) NOT NULL,
  "total" numeric(14,2) NOT NULL,
  "keterangan" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL
);
CREATE TABLE public."production_batches" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "kode" text NOT NULL,
  "production_order_id" bigint NOT NULL,
  "target" numeric(14,2) NOT NULL,
  "selesai" numeric(14,2) DEFAULT 0 NOT NULL,
  "reject" numeric(14,2) DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'Waiting'::text NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "inventory_consumed" boolean DEFAULT false NOT NULL
);
CREATE TABLE public."maintenance_items" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "kode" text NOT NULL,
  "nama" text NOT NULL,
  "satuan" text NOT NULL,
  "harga" numeric(14,2) NOT NULL,
  "minimum_stok" numeric(14,3) DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL
);
CREATE TABLE public."inventory_transactions" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "transaction_date" date NOT NULL,
  "transaction_type" text NOT NULL,
  "ingredient_id" bigint,
  "recipe_id" bigint,
  "production_batch_id" bigint,
  "qty" numeric(14,3) NOT NULL,
  "unit" text NOT NULL,
  "notes" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "purchase_id" bigint,
  "stock_source" text,
  "unit_value" numeric(14,2),
  "operation_key" text,
  "maintenance_item_id" bigint
);
CREATE TABLE public."finished_product_stock_balances" (
  "product_id" bigint NOT NULL,
  "product_sku" text NOT NULL,
  "product_nama" text NOT NULL,
  "masuk" bigint DEFAULT 0 NOT NULL,
  "keluar" bigint DEFAULT 0 NOT NULL,
  "saldo" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public."purchases" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "tanggal" date NOT NULL,
  "supplier_id" bigint,
  "ingredient_id" bigint,
  "jumlah" numeric(14,3) NOT NULL,
  "satuan" text NOT NULL,
  "harga_satuan" numeric(14,2) NOT NULL,
  "total" numeric(14,2) NOT NULL,
  "keterangan" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "maintenance_item_id" bigint,
  "jumlah_sediaan" numeric(14,3),
  "isi_per_sediaan" numeric(14,3),
  "satuan_sediaan" text
);
CREATE TABLE public."sale_items" (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "sale_id" bigint NOT NULL,
  "product_id" bigint NOT NULL,
  "product_sku" text,
  "product_name" text NOT NULL,
  "quantity" numeric(14,3) NOT NULL,
  "selling_price" numeric(14,2) NOT NULL,
  "subtotal" numeric(14,2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "order_type" text
);
CREATE TABLE public."application_settings" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "business_name" text DEFAULT 'Bunbun Kitchen'::text NOT NULL,
  "business_address" text,
  "business_phone" text,
  "business_email" text,
  "bunbun_percentage" numeric(5,2) DEFAULT 70 NOT NULL,
  "currency_code" text DEFAULT 'IDR'::text NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL
);
CREATE TABLE public."production_batch_splits" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "production_batch_id" bigint NOT NULL,
  "product_id" bigint NOT NULL,
  "source_split_id" bigint,
  "route" text NOT NULL,
  "lot_code" text,
  "qty" integer NOT NULL,
  "baked_good_qty" integer DEFAULT 0 NOT NULL,
  "baked_reject_qty" integer DEFAULT 0 NOT NULL,
  "status" text NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL
);
CREATE TABLE public."sales" (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "sale_date" date DEFAULT CURRENT_DATE NOT NULL,
  "sales_channel" text NOT NULL,
  "total_amount" numeric(14,2) DEFAULT 0 NOT NULL,
  "notes" text,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "operation_key" uuid
);
CREATE TABLE public."product_stock_movements" (
  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "movement_date" date NOT NULL,
  "movement_type" text NOT NULL,
  "product_id" bigint NOT NULL,
  "batch_split_id" bigint,
  "qty" integer NOT NULL,
  "unit" text DEFAULT 'pcs'::text NOT NULL,
  "operation_key" uuid NOT NULL,
  "notes" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "sale_id" bigint
);
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.profiles (
    id,
    full_name,
    role
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1)
    ),
    coalesce(
      (new.raw_user_meta_data ->> 'role')::public.user_role,
      'helper'::public.user_role
    )
  );

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.is_owner_or_baker()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('owner', 'baker')
      and is_active = true
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_owner_baker_or_helper()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('owner', 'baker', 'helper')
      and is_active = true
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'owner'
      and is_active = true
  );
$function$
;
CREATE OR REPLACE FUNCTION public.set_profiles_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.assert_frozen_flow_operator()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null or not public.is_owner_baker_or_helper() then
    raise exception 'Akses operasional produksi tidak diizinkan.' using errcode = '42501';
  end if;
  return v_user_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_shaping_split(p_production_batch_id bigint, p_product_id bigint, p_frozen_qty integer, p_direct_qty integer, p_reject_qty integer, p_frozen_lot_code text, p_movement_date date, p_operation_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid; v_batch public.production_batches%rowtype;
  v_recipe_product_id bigint; v_frozen_split_id bigint;
  v_direct_split_id bigint; v_reject_split_id bigint;
begin
  v_user_id := public.assert_frozen_flow_operator();
  if p_frozen_qty is null or p_direct_qty is null or p_reject_qty is null
    or p_frozen_qty < 0 or p_direct_qty < 0 or p_reject_qty < 0 then
    raise exception 'Jumlah shaping harus berupa bilangan bulat non-negatif.';
  end if;
  if p_operation_key is null then raise exception 'operation_key wajib diisi untuk pembagian shaping.'; end if;
  if p_movement_date is null then raise exception 'Tanggal pembagian shaping wajib diisi.'; end if;
  select b.* into v_batch from public.production_batches b
  where b.id = p_production_batch_id and b.is_deleted = false for update;
  if not found then raise exception 'Production batch tidak ditemukan.'; end if;
  if v_batch.status <> 'Shaping' then raise exception 'Batch harus berada pada status Shaping sebelum dibagi.'; end if;
  if v_batch.target <> trunc(v_batch.target)
    or p_frozen_qty + p_direct_qty + p_reject_qty <> v_batch.target::integer then
    raise exception 'Total frozen, direct, dan reject harus tepat sama dengan target batch.';
  end if;
  select r.product_id into v_recipe_product_id
  from public.production_orders o join public.recipes r on r.id = o.recipe_id
  join public.products p on p.id = r.product_id
  where o.id = v_batch.production_order_id and o.is_deleted = false
    and r.is_deleted = false and p.is_deleted = false and p.is_active = true;
  if v_recipe_product_id is null or v_recipe_product_id <> p_product_id then
    raise exception 'Produk harus sesuai dengan produk yang terhubung pada recipe batch.';
  end if;
  if exists (select 1 from public.production_batch_splits s
    where s.production_batch_id = v_batch.id and s.is_deleted = false) then
    raise exception 'Hasil shaping untuk batch ini sudah pernah dibagi.';
  end if;
  if p_frozen_qty > 0 and nullif(btrim(p_frozen_lot_code), '') is null then
    raise exception 'Kode lot wajib diisi ketika ada hasil frozen.';
  end if;
  if p_frozen_qty = 0 and p_frozen_lot_code is not null then
    raise exception 'Kode lot hanya boleh diisi ketika ada hasil frozen.';
  end if;
  if p_frozen_qty > 0 then
    insert into public.production_batch_splits (
      production_batch_id, product_id, route, lot_code, qty, status, created_by, updated_by
    ) values (
      v_batch.id, p_product_id, 'FROZEN', btrim(p_frozen_lot_code), p_frozen_qty, 'FROZEN', v_user_id, v_user_id
    ) returning id into v_frozen_split_id;
    insert into public.product_stock_movements (
      movement_date, movement_type, product_id, batch_split_id, qty, unit, operation_key, notes, created_by, updated_by
    ) values (
      p_movement_date, 'FROZEN_IN', p_product_id, v_frozen_split_id, p_frozen_qty, 'pcs', p_operation_key, 'Hasil shaping masuk freezer', v_user_id, v_user_id
    );
  end if;
  if p_direct_qty > 0 then
    insert into public.production_batch_splits (
      production_batch_id, product_id, route, qty, status, created_by, updated_by
    ) values (
      v_batch.id, p_product_id, 'DIRECT', p_direct_qty, 'PROOFING', v_user_id, v_user_id
    ) returning id into v_direct_split_id;
  end if;
  if p_reject_qty > 0 then
    insert into public.production_batch_splits (
      production_batch_id, product_id, route, qty, status, created_by, updated_by
    ) values (
      v_batch.id, p_product_id, 'REJECT', p_reject_qty, 'REJECTED', v_user_id, v_user_id
    ) returning id into v_reject_split_id;
  end if;
  update public.production_batches
  set status = 'Split', selesai = 0, reject = p_reject_qty, updated_by = v_user_id
  where id = v_batch.id;
  return jsonb_build_object(
    'production_batch_id', v_batch.id, 'frozen_split_id', v_frozen_split_id,
    'direct_split_id', v_direct_split_id, 'reject_split_id', v_reject_split_id
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.release_frozen_stock(p_frozen_split_id bigint, p_qty integer, p_movement_date date, p_operation_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid; v_frozen_split public.production_batch_splits%rowtype;
  v_frozen_balance integer; v_direct_split_id bigint;
begin
  v_user_id := public.assert_frozen_flow_operator();
  if p_qty is null or p_qty <= 0 then raise exception 'Jumlah frozen yang dikeluarkan harus lebih dari 0.'; end if;
  if p_movement_date is null or p_operation_key is null then raise exception 'Tanggal dan operation_key wajib diisi.'; end if;
  if exists (select 1 from public.product_stock_movements m where m.operation_key = p_operation_key) then
    raise exception 'Permintaan ini sudah pernah dicatat.' using errcode = '23505';
  end if;
  select s.* into v_frozen_split from public.production_batch_splits s
  where s.id = p_frozen_split_id and s.is_deleted = false for update;
  if not found or v_frozen_split.route <> 'FROZEN' or v_frozen_split.status <> 'FROZEN' then
    raise exception 'Lot frozen tidak ditemukan atau tidak dapat dikeluarkan.';
  end if;
  select coalesce(sum(case when m.movement_type = 'FROZEN_IN' then m.qty when m.movement_type = 'FROZEN_OUT' then -m.qty else 0 end), 0)::integer
  into v_frozen_balance from public.product_stock_movements m
  where m.batch_split_id = v_frozen_split.id and m.is_deleted = false;
  if p_qty > v_frozen_balance then raise exception 'Stok frozen lot tidak cukup. Saldo tersedia: % pcs.', v_frozen_balance; end if;
  insert into public.product_stock_movements (
    movement_date, movement_type, product_id, batch_split_id, qty, unit, operation_key, notes, created_by, updated_by
  ) values (
    p_movement_date, 'FROZEN_OUT', v_frozen_split.product_id, v_frozen_split.id, p_qty, 'pcs', p_operation_key, 'Frozen dikeluarkan untuk proofing', v_user_id, v_user_id
  );
  insert into public.production_batch_splits (
    production_batch_id, product_id, source_split_id, route, qty, status, created_by, updated_by
  ) values (
    v_frozen_split.production_batch_id, v_frozen_split.product_id, v_frozen_split.id, 'DIRECT', p_qty, 'PROOFING', v_user_id, v_user_id
  ) returning id into v_direct_split_id;
  return jsonb_build_object(
    'frozen_split_id', v_frozen_split.id, 'released_qty', p_qty,
    'remaining_frozen_qty', v_frozen_balance - p_qty, 'direct_split_id', v_direct_split_id
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_baking_result(p_direct_split_id bigint, p_baked_good_qty integer, p_baked_reject_qty integer, p_movement_date date, p_operation_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid;
  v_direct_split public.production_batch_splits%rowtype;
  v_total_good integer;
  v_total_reject integer;
  v_frozen_remaining integer;
  v_all_direct_baked boolean;
  v_recipe_id bigint;
  v_output_ingredient_id bigint;
  v_output_qty_per_unit numeric(14,6);
  v_output_unit text;
begin
  v_user_id := public.assert_frozen_flow_operator();

  if p_baked_good_qty is null or p_baked_reject_qty is null
    or p_baked_good_qty < 0 or p_baked_reject_qty < 0 then
    raise exception 'Hasil baking harus berupa bilangan bulat non-negatif.';
  end if;

  if p_movement_date is null or p_operation_key is null then
    raise exception 'Tanggal dan operation_key wajib diisi.';
  end if;

  if exists (
    select 1 from public.product_stock_movements m
    where m.operation_key = p_operation_key
  ) then
    raise exception 'Permintaan ini sudah pernah dicatat.' using errcode = '23505';
  end if;

  select s.* into v_direct_split
  from public.production_batch_splits s
  where s.id = p_direct_split_id
    and s.is_deleted = false
  for update;

  if not found or v_direct_split.route <> 'DIRECT'
    or v_direct_split.status not in ('PROOFING', 'BAKING') then
    raise exception 'Bagian direct tidak ditemukan atau hasil baking sudah dicatat.';
  end if;

  if p_baked_good_qty + p_baked_reject_qty <> v_direct_split.qty then
    raise exception 'Total berhasil dan reject baking harus tepat sama dengan jumlah bagian direct.';
  end if;

  perform 1
  from public.production_batches b
  where b.id = v_direct_split.production_batch_id
    and b.is_deleted = false
  for update;

  if not found then
    raise exception 'Production batch induk tidak ditemukan.';
  end if;

  update public.production_batch_splits
  set baked_good_qty = p_baked_good_qty,
      baked_reject_qty = p_baked_reject_qty,
      status = 'BAKED',
      updated_by = v_user_id
  where id = v_direct_split.id;

  if p_baked_good_qty > 0 then
    insert into public.product_stock_movements (
      movement_date, movement_type, product_id, batch_split_id, qty, unit,
      operation_key, notes, created_by, updated_by
    ) values (
      p_movement_date, 'FINISHED_IN', v_direct_split.product_id,
      v_direct_split.id, p_baked_good_qty, 'pcs', p_operation_key,
      'Hasil baking produk jadi', v_user_id, v_user_id
    );

    -- Find the recipe that produced this batch and its optional ingredient
    -- output mapping.
    select o.recipe_id,
           r.output_ingredient_id,
           r.output_ingredient_qty_per_unit,
           i.satuan
    into v_recipe_id,
         v_output_ingredient_id,
         v_output_qty_per_unit,
         v_output_unit
    from public.production_batches b
    join public.production_orders o
      on o.id = b.production_order_id
    join public.recipes r
      on r.id = o.recipe_id
    left join public.ingredients i
      on i.id = r.output_ingredient_id
    where b.id = v_direct_split.production_batch_id
      and b.is_deleted = false
      and o.is_deleted = false
      and r.is_deleted = false;

    if v_output_ingredient_id is not null then
      insert into public.inventory_transactions (
        transaction_date,
        transaction_type,
        ingredient_id,
        recipe_id,
        production_batch_id,
        purchase_id,
        qty,
        unit,
        notes,
        created_by,
        updated_by
      ) values (
        p_movement_date,
        'PRODUCTION_IN',
        v_output_ingredient_id,
        v_recipe_id,
        v_direct_split.production_batch_id,
        null,
        p_baked_good_qty * coalesce(v_output_qty_per_unit, 1),
        v_output_unit,
        'Hasil produksi sub-recipe masuk inventory',
        v_user_id,
        v_user_id
      );
    end if;
  end if;

  select coalesce(sum(s.baked_good_qty), 0)::integer,
         coalesce(sum(
           case when s.route = 'REJECT' then s.qty else s.baked_reject_qty end
         ), 0)::integer
  into v_total_good, v_total_reject
  from public.production_batch_splits s
  where s.production_batch_id = v_direct_split.production_batch_id
    and s.is_deleted = false;

  select coalesce(sum(
    case
      when m.movement_type = 'FROZEN_IN' then m.qty
      when m.movement_type = 'FROZEN_OUT' then -m.qty
      else 0
    end
  ), 0)::integer into v_frozen_remaining
  from public.product_stock_movements m
  join public.production_batch_splits s on s.id = m.batch_split_id
  where s.production_batch_id = v_direct_split.production_batch_id
    and m.is_deleted = false
    and s.is_deleted = false;

  select bool_and(s.status = 'BAKED') into v_all_direct_baked
  from public.production_batch_splits s
  where s.production_batch_id = v_direct_split.production_batch_id
    and s.route = 'DIRECT'
    and s.is_deleted = false;

  update public.production_batches
  set selesai = v_total_good,
      reject = v_total_reject,
      status = case
        when coalesce(v_all_direct_baked, true)
          and v_frozen_remaining = 0 then 'Finished'
        else 'Split'
      end,
      updated_by = v_user_id
  where id = v_direct_split.production_batch_id;

  return jsonb_build_object(
    'direct_split_id', v_direct_split.id,
    'baked_good_qty', p_baked_good_qty,
    'baked_reject_qty', p_baked_reject_qty,
    'production_batch_finished_qty', v_total_good,
    'production_batch_reject_qty', v_total_reject,
    'output_ingredient_id', v_output_ingredient_id,
    'output_ingredient_qty',
      case
        when v_output_ingredient_id is null then 0
        else p_baked_good_qty * coalesce(v_output_qty_per_unit, 1)
      end
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_non_purchase_stock(p_transaction_date date, p_ingredient_id bigint, p_qty numeric, p_unit text, p_unit_value numeric, p_stock_source text, p_notes text, p_operation_key text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.set_automatic_split_lot_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_batch_code text;
begin
  select b.kode
  into v_batch_code
  from public.production_batches b
  where b.id = new.production_batch_id
    and b.is_deleted = false;

  if v_batch_code is null then
    raise exception 'Production batch untuk kode lot tidak ditemukan.';
  end if;

  new.lot_code := case
    when v_batch_code like 'PB-%'
      then 'LOT-' || substring(v_batch_code from 4)
    else 'LOT-' || v_batch_code
  end;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_inventory_adjustment(p_transaction_date date, p_ingredient_id bigint, p_adjustment_type text, p_qty numeric, p_unit text, p_reason text, p_notes text, p_operation_key text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.is_baker()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'baker'
      and is_active = true
  );
$function$
;
CREATE OR REPLACE FUNCTION public.set_sales_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_recipe_output_ingredient()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_ingredient_id bigint;
begin
  if new.output_ingredient_id is not null then
    return new;
  end if;

  select i.id
  into v_ingredient_id
  from public.ingredients i
  where i.is_deleted = false
    and i.is_active = true
    and lower(btrim(i.nama)) = lower(btrim(new.nama))
  order by i.id
  limit 1;

  new.output_ingredient_id := v_ingredient_id;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_recipe_output_from_ingredient()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.is_deleted = false and new.is_active = true then
    update public.recipes
    set output_ingredient_id = new.id,
        updated_at = now()
    where output_ingredient_id is null
      and is_deleted = false
      and lower(btrim(nama)) = lower(btrim(new.nama));
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.prevent_sub_recipe_finished_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.movement_type = 'FINISHED_IN' then
    if exists (
      select 1
      from public.recipes r
      where r.product_id = new.product_id
        and r.output_ingredient_id is not null
        and r.is_deleted = false
    ) then
      return null;
    end if;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.delete_sale_transaction(p_sale_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.get_finished_product_balances()
 RETURNS TABLE(product_id bigint, product_sku text, product_nama text, masuk bigint, keluar bigint, saldo bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    p.id,
    p.sku,
    p.nama,
    coalesce(sum(case
      when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty
      else 0
    end),0)::bigint as masuk,
    coalesce(sum(case
      when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then m.qty
      else 0
    end),0)::bigint as keluar,
    (
      coalesce(sum(case
        when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty
        else 0
      end),0)
      - coalesce(sum(case
        when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then m.qty
        else 0
      end),0)
    )::bigint as saldo
  from public.products p
  join public.product_stock_movements m
    on m.product_id = p.id
   and m.is_deleted = false
   and m.movement_type in (
     'FINISHED_IN','CAFE_OUT','CAFE_IN','OPENING_BALANCE',
     'ADJUSTMENT_IN','ADJUSTMENT_OUT'
   )
  where p.is_active = true
  group by p.id,p.sku,p.nama
  having (
    coalesce(sum(case
      when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty
      else 0
    end),0)
    - coalesce(sum(case
      when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then m.qty
      else 0
    end),0)
  ) > 0
  order by p.nama;
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
CREATE OR REPLACE FUNCTION public.record_product_stock_adjustment(p_product_id bigint, p_adjustment_type text, p_qty integer, p_movement_date date, p_reason text, p_notes text, p_operation_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if p_product_id is null then
    raise exception 'Produk wajib dipilih.';
  end if;

  if p_adjustment_type not in ('IN','OUT') then
    raise exception 'Jenis penyesuaian stok tidak valid.';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'Jumlah penyesuaian harus lebih dari 0.';
  end if;

  if p_movement_date is null then
    raise exception 'Tanggal penyesuaian wajib diisi.';
  end if;

  if nullif(btrim(coalesce(p_reason,'')), '') is null then
    raise exception 'Alasan penyesuaian wajib diisi.';
  end if;

  if p_operation_key is null then
    raise exception 'operation_key wajib diisi.';
  end if;

  if exists (
    select 1
    from public.product_stock_movements m
    where m.operation_key = p_operation_key
      and m.is_deleted = false
  ) then
    raise exception 'Permintaan ini sudah pernah dicatat.' using errcode = '23505';
  end if;

  select p.*
    into v_product
  from public.products p
  where p.id = p_product_id
    and p.is_deleted = false
    and p.is_active = true
  for update;

  if not found then
    raise exception 'Produk aktif tidak ditemukan.';
  end if;

  select coalesce(sum(case
    when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty
    when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -m.qty
    else 0
  end), 0)::integer
    into v_balance
  from public.product_stock_movements m
  where m.product_id = p_product_id
    and m.is_deleted = false;

  if p_adjustment_type = 'OUT' and p_qty > v_balance then
    raise exception 'Stok produk jadi tidak cukup. Saldo tersedia: % pcs.', v_balance;
  end if;

  v_movement_type := case
    when p_adjustment_type = 'IN' then 'ADJUSTMENT_IN'
    else 'ADJUSTMENT_OUT'
  end;

  v_notes := nullif(
    btrim(
      'Alasan: ' || p_reason ||
      coalesce(' · ' || nullif(btrim(p_notes), ''), '')
    ),
    ''
  );

  insert into public.product_stock_movements (
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
  ) values (
    p_movement_date,
    v_movement_type,
    p_product_id,
    null,
    p_qty,
    'pcs',
    p_operation_key,
    v_notes,
    v_user_id,
    v_user_id
  )
  returning id into v_movement_id;

  return jsonb_build_object(
    'movement_id', v_movement_id,
    'product_id', p_product_id,
    'adjustment_type', p_adjustment_type,
    'qty', p_qty,
    'previous_balance', v_balance,
    'remaining_balance',
      case
        when p_adjustment_type = 'IN' then v_balance + p_qty
        else v_balance - p_qty
      end
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_cafe_deposit(p_product_id bigint, p_qty integer, p_movement_date date, p_operation_key uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  select coalesce(sum(case
    when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty
    when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -m.qty
    else 0
  end), 0)::integer
    into v_finished_balance
  from public.product_stock_movements m
  where m.product_id = p_product_id
    and m.is_deleted = false;

  if p_qty > v_finished_balance then
    raise exception 'Stok produk jadi tidak cukup. Saldo tersedia: % pcs.', v_finished_balance;
  end if;

  insert into public.product_stock_movements (
    movement_date, movement_type, product_id, qty, unit,
    operation_key, notes, created_by, updated_by
  ) values (
    p_movement_date, 'CAFE_OUT', p_product_id, p_qty, 'pcs',
    p_operation_key, nullif(btrim(p_notes), ''), v_user_id, v_user_id
  )
  returning id into v_movement_id;

  return jsonb_build_object(
    'movement_id', v_movement_id,
    'product_id', p_product_id,
    'deposited_qty', p_qty,
    'remaining_finished_qty', v_finished_balance - p_qty
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_multi_product_release(p_movement_date date, p_destination text, p_notes text, p_items jsonb, p_operation_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      and m.is_deleted = false
  ) then
    raise exception 'Permintaan ini sudah pernah dicatat.' using errcode = '23505';
  end if;

  v_final_notes := nullif(
    btrim(
      'Tujuan: ' || p_destination ||
      coalesce(' · ' || nullif(btrim(p_notes), ''), '')
    ),
    ''
  );

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

    select p.*
      into v_product
    from public.products p
    where p.id = v_product_id
      and p.is_deleted = false
      and p.is_active = true
    for update;

    if not found then
      raise exception 'Produk aktif tidak ditemukan.';
    end if;

    select coalesce(sum(case
      when m.movement_type in ('FINISHED_IN','OPENING_BALANCE','CAFE_IN','ADJUSTMENT_IN') then m.qty
      when m.movement_type in ('CAFE_OUT','ADJUSTMENT_OUT') then -m.qty
      else 0
    end), 0)::integer
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
$function$
;
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
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_role_check" CHECK (role = ANY (ARRAY['owner'::user_role, 'baker'::user_role, 'helper'::user_role]));
ALTER TABLE public."categories" ADD CONSTRAINT "categories_pkey" PRIMARY KEY (id);
ALTER TABLE public."incomes" ADD CONSTRAINT "incomes_pkey" PRIMARY KEY (id);
ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_kategori_check" CHECK (kategori = ANY (ARRAY['Gaji'::text, 'Bahan Baku'::text, 'Maintenance'::text]));
ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_nominal_check" CHECK (nominal > 0::numeric);
ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_pkey" PRIMARY KEY (id);
ALTER TABLE public."suppliers" ADD CONSTRAINT "suppliers_kode_key" UNIQUE (kode);
ALTER TABLE public."suppliers" ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY (id);
ALTER TABLE public."products" ADD CONSTRAINT "products_harga_check" CHECK (harga >= 0::numeric);
ALTER TABLE public."products" ADD CONSTRAINT "products_pkey" PRIMARY KEY (id);
ALTER TABLE public."ingredients" ADD CONSTRAINT "ingredients_harga_check" CHECK (harga > 0::numeric);
ALTER TABLE public."ingredients" ADD CONSTRAINT "ingredients_kode_key" UNIQUE (kode);
ALTER TABLE public."ingredients" ADD CONSTRAINT "ingredients_minimum_stok_check" CHECK (minimum_stok >= 0::numeric);
ALTER TABLE public."ingredients" ADD CONSTRAINT "ingredients_pkey" PRIMARY KEY (id);
ALTER TABLE public."recipe_items" ADD CONSTRAINT "recipe_items_jumlah_check" CHECK (jumlah > 0::numeric);
ALTER TABLE public."recipe_items" ADD CONSTRAINT "recipe_items_no_self_reference" CHECK (sub_recipe_id IS NULL OR sub_recipe_id <> recipe_id);
ALTER TABLE public."recipe_items" ADD CONSTRAINT "recipe_items_pkey" PRIMARY KEY (id);
ALTER TABLE public."recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_ingredient_id_key" UNIQUE (recipe_id, ingredient_id);
ALTER TABLE public."recipe_items" ADD CONSTRAINT "recipe_items_source_check" CHECK (ingredient_id IS NOT NULL AND sub_recipe_id IS NULL OR ingredient_id IS NULL AND sub_recipe_id IS NOT NULL);
ALTER TABLE public."recipes" ADD CONSTRAINT "recipes_kode_key" UNIQUE (kode);
ALTER TABLE public."recipes" ADD CONSTRAINT "recipes_output_ingredient_qty_per_unit_check" CHECK (output_ingredient_qty_per_unit > 0::numeric);
ALTER TABLE public."recipes" ADD CONSTRAINT "recipes_pkey" PRIMARY KEY (id);
ALTER TABLE public."recipes" ADD CONSTRAINT "recipes_yield_qty_check" CHECK (yield_qty > 0::numeric);
ALTER TABLE public."production_orders" ADD CONSTRAINT "production_orders_kode_key" UNIQUE (kode);
ALTER TABLE public."production_orders" ADD CONSTRAINT "production_orders_pkey" PRIMARY KEY (id);
ALTER TABLE public."production_orders" ADD CONSTRAINT "production_orders_status_check" CHECK (status = ANY (ARRAY['Draft'::text, 'Generated'::text, 'Cancelled'::text]));
ALTER TABLE public."production_orders" ADD CONSTRAINT "production_orders_target_produksi_check" CHECK (target_produksi > 0::numeric);
ALTER TABLE public."maintenance_purchases" ADD CONSTRAINT "maintenance_purchases_harga_satuan_check" CHECK (harga_satuan >= 0::numeric);
ALTER TABLE public."maintenance_purchases" ADD CONSTRAINT "maintenance_purchases_jumlah_check" CHECK (jumlah > 0::numeric);
ALTER TABLE public."maintenance_purchases" ADD CONSTRAINT "maintenance_purchases_pkey" PRIMARY KEY (id);
ALTER TABLE public."maintenance_purchases" ADD CONSTRAINT "maintenance_purchases_total_check" CHECK (total >= 0::numeric);
ALTER TABLE public."production_batches" ADD CONSTRAINT "production_batches_kode_key" UNIQUE (kode);
ALTER TABLE public."production_batches" ADD CONSTRAINT "production_batches_pkey" PRIMARY KEY (id);
ALTER TABLE public."production_batches" ADD CONSTRAINT "production_batches_reject_check" CHECK (reject >= 0::numeric);
ALTER TABLE public."production_batches" ADD CONSTRAINT "production_batches_selesai_check" CHECK (selesai >= 0::numeric);
ALTER TABLE public."production_batches" ADD CONSTRAINT "production_batches_status_check" CHECK (status = ANY (ARRAY['Waiting'::text, 'Mixing'::text, 'Proofing'::text, 'Baking'::text, 'Cooling'::text, 'Packing'::text, 'Finished'::text, 'Shaping'::text, 'Split'::text]));
ALTER TABLE public."production_batches" ADD CONSTRAINT "production_batches_target_check" CHECK (target > 0::numeric);
ALTER TABLE public."maintenance_items" ADD CONSTRAINT "maintenance_items_harga_check" CHECK (harga >= 0::numeric);
ALTER TABLE public."maintenance_items" ADD CONSTRAINT "maintenance_items_kode_key" UNIQUE (kode);
ALTER TABLE public."maintenance_items" ADD CONSTRAINT "maintenance_items_minimum_stok_check" CHECK (minimum_stok >= 0::numeric);
ALTER TABLE public."maintenance_items" ADD CONSTRAINT "maintenance_items_pkey" PRIMARY KEY (id);
ALTER TABLE public."inventory_transactions" ADD CONSTRAINT "inventory_transactions_item_reference_check" CHECK (NOT (ingredient_id IS NOT NULL AND maintenance_item_id IS NOT NULL));
ALTER TABLE public."inventory_transactions" ADD CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY (id);
ALTER TABLE public."inventory_transactions" ADD CONSTRAINT "inventory_transactions_transaction_type_check" CHECK (transaction_type = ANY (ARRAY['PURCHASE'::text, 'PRODUCTION_OUT'::text, 'PRODUCTION_IN'::text, 'ADJUSTMENT'::text, 'ADJUSTMENT_IN'::text, 'ADJUSTMENT_OUT'::text, 'SALE'::text]));
ALTER TABLE public."inventory_transactions" ADD CONSTRAINT "inventory_transactions_unit_value_check" CHECK (unit_value IS NULL OR unit_value >= 0::numeric);
ALTER TABLE public."finished_product_stock_balances" ADD CONSTRAINT "finished_product_stock_balances_pkey" PRIMARY KEY (product_id);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_harga_satuan_check" CHECK (harga_satuan >= 0::numeric);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_isi_per_sediaan_check" CHECK (isi_per_sediaan IS NULL OR isi_per_sediaan > 0::numeric);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_item_type_check" CHECK (ingredient_id IS NOT NULL AND maintenance_item_id IS NULL OR ingredient_id IS NULL AND maintenance_item_id IS NOT NULL);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_jumlah_check" CHECK (jumlah > 0::numeric);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_jumlah_sediaan_check" CHECK (jumlah_sediaan IS NULL OR jumlah_sediaan > 0::numeric);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_pkey" PRIMARY KEY (id);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_total_check" CHECK (total >= 0::numeric);
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_order_type_check" CHECK (order_type IS NULL OR (order_type = ANY (ARRAY['DINE_IN'::text, 'TAKE_AWAY'::text])));
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_pkey" PRIMARY KEY (id);
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_quantity_check" CHECK (quantity > 0::numeric);
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_selling_price_check" CHECK (selling_price >= 0::numeric);
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_subtotal_check" CHECK (subtotal >= 0::numeric);
ALTER TABLE public."application_settings" ADD CONSTRAINT "application_settings_bunbun_percentage_check" CHECK (bunbun_percentage >= 0::numeric AND bunbun_percentage <= 100::numeric);
ALTER TABLE public."application_settings" ADD CONSTRAINT "application_settings_pkey" PRIMARY KEY (id);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_baked_good_qty_check" CHECK (baked_good_qty >= 0);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_baked_reject_qty_check" CHECK (baked_reject_qty >= 0);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_baking_result_check" CHECK ((baked_good_qty + baked_reject_qty) <= qty);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_check" CHECK (route = 'FROZEN'::text AND status = 'FROZEN'::text OR route = 'DIRECT'::text AND (status = ANY (ARRAY['PROOFING'::text, 'BAKING'::text, 'BAKED'::text])) OR route = 'REJECT'::text AND status = 'REJECTED'::text);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_lot_code_required_check" CHECK (NULLIF(btrim(lot_code), ''::text) IS NOT NULL);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_non_direct_result_check" CHECK (route = 'DIRECT'::text OR baked_good_qty = 0 AND baked_reject_qty = 0);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_pkey" PRIMARY KEY (id);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_qty_check" CHECK (qty >= 0);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_route_check" CHECK (route = ANY (ARRAY['FROZEN'::text, 'DIRECT'::text, 'REJECT'::text]));
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_source_by_route_check" CHECK (source_split_id IS NULL OR route = 'DIRECT'::text);
ALTER TABLE public."sales" ADD CONSTRAINT "sales_pkey" PRIMARY KEY (id);
ALTER TABLE public."sales" ADD CONSTRAINT "sales_sales_channel_check" CHECK (sales_channel = ANY (ARRAY['PUBLIC_HUB'::text, 'PUBLIC_COFFEE'::text, 'DIRECT'::text, 'CAFE_OTHER'::text]));
ALTER TABLE public."sales" ADD CONSTRAINT "sales_total_amount_check" CHECK (total_amount >= 0::numeric);
ALTER TABLE public."product_stock_movements" ADD CONSTRAINT "product_stock_movements_movement_type_check" CHECK (movement_type = ANY (ARRAY['FROZEN_IN'::text, 'FROZEN_OUT'::text, 'FINISHED_IN'::text, 'CAFE_OUT'::text, 'CAFE_IN'::text, 'OPENING_BALANCE'::text, 'ADJUSTMENT_IN'::text, 'ADJUSTMENT_OUT'::text]));
ALTER TABLE public."product_stock_movements" ADD CONSTRAINT "product_stock_movements_pkey" PRIMARY KEY (id);
ALTER TABLE public."product_stock_movements" ADD CONSTRAINT "product_stock_movements_qty_check" CHECK (qty > 0);
ALTER TABLE public."product_stock_movements" ADD CONSTRAINT "product_stock_movements_split_required_check" CHECK (((movement_type IN ('FROZEN_IN','FROZEN_OUT','FINISHED_IN')) AND batch_split_id IS NOT NULL) OR ((movement_type IN ('CAFE_OUT','CAFE_IN','OPENING_BALANCE','ADJUSTMENT_IN','ADJUSTMENT_OUT')) AND batch_split_id IS NULL));
ALTER TABLE public."product_stock_movements" ADD CONSTRAINT "product_stock_movements_unit_check" CHECK (unit = 'pcs'::text);
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."incomes" ADD CONSTRAINT "incomes_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."incomes" ADD CONSTRAINT "incomes_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_purchase_id_fkey" FOREIGN KEY (purchase_id) REFERENCES purchases(id);
ALTER TABLE public."expenses" ADD CONSTRAINT "expenses_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."suppliers" ADD CONSTRAINT "suppliers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."suppliers" ADD CONSTRAINT "suppliers_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY (category_id) REFERENCES categories(id);
ALTER TABLE public."products" ADD CONSTRAINT "products_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."products" ADD CONSTRAINT "products_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."ingredients" ADD CONSTRAINT "ingredients_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."ingredients" ADD CONSTRAINT "ingredients_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."recipe_items" ADD CONSTRAINT "recipe_items_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."recipe_items" ADD CONSTRAINT "recipe_items_ingredient_id_fkey" FOREIGN KEY (ingredient_id) REFERENCES ingredients(id);
ALTER TABLE public."recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_fkey" FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE;
ALTER TABLE public."recipe_items" ADD CONSTRAINT "recipe_items_sub_recipe_id_fkey" FOREIGN KEY (sub_recipe_id) REFERENCES recipes(id);
ALTER TABLE public."recipe_items" ADD CONSTRAINT "recipe_items_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."recipes" ADD CONSTRAINT "recipes_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."recipes" ADD CONSTRAINT "recipes_output_ingredient_id_fkey" FOREIGN KEY (output_ingredient_id) REFERENCES ingredients(id);
ALTER TABLE public."recipes" ADD CONSTRAINT "recipes_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public."recipes" ADD CONSTRAINT "recipes_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."production_orders" ADD CONSTRAINT "production_orders_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."production_orders" ADD CONSTRAINT "production_orders_recipe_id_fkey" FOREIGN KEY (recipe_id) REFERENCES recipes(id);
ALTER TABLE public."production_orders" ADD CONSTRAINT "production_orders_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."maintenance_purchases" ADD CONSTRAINT "maintenance_purchases_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."maintenance_purchases" ADD CONSTRAINT "maintenance_purchases_maintenance_item_id_fkey" FOREIGN KEY (maintenance_item_id) REFERENCES maintenance_items(id);
ALTER TABLE public."maintenance_purchases" ADD CONSTRAINT "maintenance_purchases_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
ALTER TABLE public."maintenance_purchases" ADD CONSTRAINT "maintenance_purchases_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."production_batches" ADD CONSTRAINT "production_batches_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."production_batches" ADD CONSTRAINT "production_batches_production_order_id_fkey" FOREIGN KEY (production_order_id) REFERENCES production_orders(id);
ALTER TABLE public."production_batches" ADD CONSTRAINT "production_batches_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."maintenance_items" ADD CONSTRAINT "maintenance_items_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."maintenance_items" ADD CONSTRAINT "maintenance_items_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."inventory_transactions" ADD CONSTRAINT "inventory_transactions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."inventory_transactions" ADD CONSTRAINT "inventory_transactions_ingredient_id_fkey" FOREIGN KEY (ingredient_id) REFERENCES ingredients(id);
ALTER TABLE public."inventory_transactions" ADD CONSTRAINT "inventory_transactions_maintenance_item_id_fkey" FOREIGN KEY (maintenance_item_id) REFERENCES maintenance_items(id);
ALTER TABLE public."inventory_transactions" ADD CONSTRAINT "inventory_transactions_production_batch_id_fkey" FOREIGN KEY (production_batch_id) REFERENCES production_batches(id);
ALTER TABLE public."inventory_transactions" ADD CONSTRAINT "inventory_transactions_purchase_id_fkey" FOREIGN KEY (purchase_id) REFERENCES purchases(id);
ALTER TABLE public."inventory_transactions" ADD CONSTRAINT "inventory_transactions_recipe_id_fkey" FOREIGN KEY (recipe_id) REFERENCES recipes(id);
ALTER TABLE public."inventory_transactions" ADD CONSTRAINT "inventory_transactions_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."finished_product_stock_balances" ADD CONSTRAINT "finished_product_stock_balances_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_ingredient_id_fkey" FOREIGN KEY (ingredient_id) REFERENCES ingredients(id);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_maintenance_item_id_fkey" FOREIGN KEY (maintenance_item_id) REFERENCES maintenance_items(id);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
ALTER TABLE public."purchases" ADD CONSTRAINT "purchases_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE public."sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
ALTER TABLE public."application_settings" ADD CONSTRAINT "application_settings_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."application_settings" ADD CONSTRAINT "application_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_production_batch_id_fkey" FOREIGN KEY (production_batch_id) REFERENCES production_batches(id);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_source_split_id_fkey" FOREIGN KEY (source_split_id) REFERENCES production_batch_splits(id);
ALTER TABLE public."production_batch_splits" ADD CONSTRAINT "production_batch_splits_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."sales" ADD CONSTRAINT "sales_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."sales" ADD CONSTRAINT "sales_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
ALTER TABLE public."product_stock_movements" ADD CONSTRAINT "product_stock_movements_batch_split_id_fkey" FOREIGN KEY (batch_split_id) REFERENCES production_batch_splits(id);
ALTER TABLE public."product_stock_movements" ADD CONSTRAINT "product_stock_movements_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public."product_stock_movements" ADD CONSTRAINT "product_stock_movements_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id);
ALTER TABLE public."product_stock_movements" ADD CONSTRAINT "product_stock_movements_sale_id_fkey" FOREIGN KEY (sale_id) REFERENCES sales(id);
ALTER TABLE public."product_stock_movements" ADD CONSTRAINT "product_stock_movements_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);
CREATE INDEX expenses_purchase_id_idx ON public.expenses USING btree (purchase_id);
CREATE UNIQUE INDEX product_stock_movements_finished_in_once_per_split ON public.product_stock_movements USING btree (batch_split_id) WHERE ((movement_type = 'FINISHED_IN'::text) AND (is_deleted = false));
CREATE INDEX recipes_output_ingredient_id_idx ON public.recipes USING btree (output_ingredient_id) WHERE ((output_ingredient_id IS NOT NULL) AND (is_deleted = false));
CREATE INDEX production_batches_inventory_consumed_idx ON public.production_batches USING btree (inventory_consumed);
CREATE UNIQUE INDEX recipe_items_recipe_ingredient_unique_active ON public.recipe_items USING btree (recipe_id, ingredient_id) WHERE (is_deleted = false);
CREATE INDEX production_batch_splits_product_id_idx ON public.production_batch_splits USING btree (product_id) WHERE (is_deleted = false);
CREATE INDEX idx_sale_items_sale_id ON public.sale_items USING btree (sale_id);
CREATE INDEX products_category_id_idx ON public.products USING btree (category_id);
CREATE INDEX idx_categories_deleted ON public.categories USING btree (is_deleted);
CREATE UNIQUE INDEX expense_purchase_unique_active ON public.expenses USING btree (purchase_id) WHERE ((purchase_id IS NOT NULL) AND (is_deleted = false));
CREATE INDEX inventory_transactions_purchase_id_idx ON public.inventory_transactions USING btree (purchase_id);
CREATE UNIQUE INDEX inventory_purchase_unique_active ON public.inventory_transactions USING btree (purchase_id) WHERE ((purchase_id IS NOT NULL) AND (transaction_type = 'PURCHASE'::text) AND (is_deleted = false));
CREATE UNIQUE INDEX recipe_items_recipe_sub_recipe_unique ON public.recipe_items USING btree (recipe_id, sub_recipe_id) WHERE ((sub_recipe_id IS NOT NULL) AND (is_deleted = false));
CREATE UNIQUE INDEX products_sku_unique_active ON public.products USING btree (lower(sku)) WHERE (is_deleted = false);
CREATE INDEX idx_sale_items_order_type ON public.sale_items USING btree (order_type);
CREATE INDEX recipes_product_id_idx ON public.recipes USING btree (product_id);
CREATE INDEX production_batch_splits_source_split_id_idx ON public.production_batch_splits USING btree (source_split_id) WHERE ((source_split_id IS NOT NULL) AND (is_deleted = false));
CREATE UNIQUE INDEX product_stock_movements_frozen_in_once_per_split ON public.product_stock_movements USING btree (batch_split_id) WHERE ((movement_type = 'FROZEN_IN'::text) AND (is_deleted = false));
CREATE INDEX idx_sales_active ON public.sales USING btree (is_deleted);
CREATE INDEX idx_sales_sale_date ON public.sales USING btree (sale_date);
CREATE INDEX product_stock_movements_product_date_idx ON public.product_stock_movements USING btree (product_id, movement_date) WHERE (is_deleted = false);
CREATE INDEX production_batch_splits_batch_id_idx ON public.production_batch_splits USING btree (production_batch_id) WHERE (is_deleted = false);
CREATE UNIQUE INDEX recipes_product_unique_active ON public.recipes USING btree (product_id) WHERE ((product_id IS NOT NULL) AND (is_deleted = false));
CREATE INDEX product_stock_movements_frozen_lot_idx ON public.product_stock_movements USING btree (batch_split_id, movement_type) WHERE (is_deleted = false);
CREATE INDEX production_batch_splits_lot_code_idx ON public.production_batch_splits USING btree (lower(lot_code)) WHERE (is_deleted = false);
CREATE INDEX idx_sale_items_product_id ON public.sale_items USING btree (product_id);
CREATE INDEX recipe_items_sub_recipe_id_idx ON public.recipe_items USING btree (sub_recipe_id) WHERE ((sub_recipe_id IS NOT NULL) AND (is_deleted = false));
CREATE UNIQUE INDEX recipe_items_recipe_ingredient_unique ON public.recipe_items USING btree (recipe_id, ingredient_id) WHERE ((ingredient_id IS NOT NULL) AND (is_deleted = false));
CREATE UNIQUE INDEX sales_operation_key_unique ON public.sales USING btree (operation_key) WHERE (operation_key IS NOT NULL);
CREATE INDEX product_stock_movements_sale_id_idx ON public.product_stock_movements USING btree (sale_id) WHERE ((sale_id IS NOT NULL) AND (is_deleted = false));
CREATE INDEX product_stock_movements_operation_key_idx ON public.product_stock_movements USING btree (operation_key);
CREATE INDEX products_is_deleted_idx ON public.products USING btree (is_deleted);
CREATE INDEX inventory_transactions_maintenance_item_idx ON public.inventory_transactions USING btree (maintenance_item_id) WHERE (maintenance_item_id IS NOT NULL);
CREATE UNIQUE INDEX inventory_transactions_operation_key_uidx ON public.inventory_transactions USING btree (operation_key) WHERE ((operation_key IS NOT NULL) AND (is_deleted = false));
CREATE INDEX idx_sales_channel ON public.sales USING btree (sales_channel);
CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_profiles_updated_at();
CREATE TRIGGER set_incomes_updated_at BEFORE UPDATE ON incomes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER set_suppliers_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_ingredients_updated_at BEFORE UPDATE ON ingredients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sync_recipe_output_from_ingredient_after_write AFTER INSERT OR UPDATE OF nama, is_active, is_deleted ON ingredients FOR EACH ROW EXECUTE FUNCTION sync_recipe_output_from_ingredient();
CREATE TRIGGER set_recipe_items_updated_at BEFORE UPDATE ON recipe_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_recipes_updated_at BEFORE UPDATE ON recipes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sync_recipe_output_ingredient_before_write BEFORE INSERT OR UPDATE OF nama, output_ingredient_id ON recipes FOR EACH ROW EXECUTE FUNCTION sync_recipe_output_ingredient();
CREATE TRIGGER set_production_orders_updated_at BEFORE UPDATE ON production_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_maintenance_purchases_updated_at BEFORE UPDATE ON maintenance_purchases FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_production_batches_updated_at BEFORE UPDATE ON production_batches FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_maintenance_items_updated_at BEFORE UPDATE ON maintenance_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_inventory_updated_at BEFORE UPDATE ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_purchases_updated_at BEFORE UPDATE ON purchases FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_application_settings_updated_at BEFORE UPDATE ON application_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_automatic_split_lot_code BEFORE INSERT ON production_batch_splits FOR EACH ROW EXECUTE FUNCTION set_automatic_split_lot_code();
CREATE TRIGGER set_production_batch_splits_updated_at BEFORE UPDATE ON production_batch_splits FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sales_updated_at BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION set_sales_updated_at();
CREATE TRIGGER prevent_sub_recipe_finished_stock_before_insert BEFORE INSERT ON product_stock_movements FOR EACH ROW EXECUTE FUNCTION prevent_sub_recipe_finished_stock();
CREATE TRIGGER set_product_stock_movements_updated_at BEFORE UPDATE ON product_stock_movements FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_refresh_finished_product_stock_balance AFTER INSERT OR DELETE OR UPDATE ON product_stock_movements FOR EACH ROW EXECUTE FUNCTION refresh_finished_product_stock_balance();
ALTER TABLE public."profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."incomes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ingredients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."recipe_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."recipes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."production_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."maintenance_purchases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."production_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."maintenance_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."inventory_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."finished_product_stock_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."purchases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."sale_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."application_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."production_batch_splits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."sales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."product_stock_movements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((auth.uid() = id));
CREATE POLICY "Owner can create incomes" ON public."incomes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner() AND (created_by = auth.uid())));
CREATE POLICY "Owner can create suppliers" ON public."suppliers" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner() AND (created_by = auth.uid())));
CREATE POLICY "Owner can create ingredients" ON public."ingredients" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner() AND (created_by = auth.uid())));
CREATE POLICY "Owner and Baker can read recipes" ON public."recipes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_owner_or_baker() AND (is_deleted = false)));
CREATE POLICY "Owner can create recipes" ON public."recipes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner() AND (created_by = auth.uid())));
CREATE POLICY "Owner and Baker can read recipe items" ON public."recipe_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_owner_or_baker() AND (is_deleted = false)));
CREATE POLICY "Owner can create recipe items" ON public."recipe_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner() AND (created_by = auth.uid())));
CREATE POLICY "Owner and Baker can read production orders" ON public."production_orders" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_owner_or_baker() AND (is_deleted = false)));
CREATE POLICY "Owner and Baker can create production orders" ON public."production_orders" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner_or_baker() AND (created_by = auth.uid())));
CREATE POLICY "Owner and Baker can update production orders" ON public."production_orders" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner_or_baker()) WITH CHECK (is_owner_or_baker());
CREATE POLICY "All roles can read production batches" ON public."production_batches" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_owner_baker_or_helper() AND (is_deleted = false)));
CREATE POLICY "Owner and Baker can create production batches" ON public."production_batches" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner_or_baker() AND (created_by = auth.uid())));
CREATE POLICY "All roles can update production batches" ON public."production_batches" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner_baker_or_helper()) WITH CHECK (is_owner_baker_or_helper());
CREATE POLICY "Authenticated users can read categories" ON public."categories" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_deleted = false));
CREATE POLICY "Owner can create categories" ON public."categories" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner() AND (created_by = auth.uid())));
CREATE POLICY "Owner can update categories" ON public."categories" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK ((is_owner() AND (updated_by = auth.uid())));
CREATE POLICY "Authenticated users can read products" ON public."products" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_deleted = false));
CREATE POLICY "Owner can create products" ON public."products" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner() AND (created_by = auth.uid())));
CREATE POLICY "Owner can update products" ON public."products" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK ((is_owner() AND (updated_by = auth.uid())));
CREATE POLICY "Authenticated users can read settings" ON public."application_settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_deleted = false));
CREATE POLICY "Owner can read suppliers" ON public."suppliers" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_owner());
CREATE POLICY "Owner can update suppliers" ON public."suppliers" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK ((is_owner() AND (updated_by = auth.uid())));
CREATE POLICY "Owner can read ingredients" ON public."ingredients" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_owner());
CREATE POLICY "Owner can read incomes" ON public."incomes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_owner());
CREATE POLICY "Owner can read all recipes" ON public."recipes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_owner());
CREATE POLICY "Owner can read all production orders" ON public."production_orders" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_owner());
CREATE POLICY "Owner can read all production batches" ON public."production_batches" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_owner());
CREATE POLICY "Owner can create settings" ON public."application_settings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner() AND (created_by = auth.uid())));
CREATE POLICY "Owner can update settings" ON public."application_settings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK ((is_owner() AND (updated_by = auth.uid())));
CREATE POLICY "Owner read purchases" ON public."purchases" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_owner());
CREATE POLICY "Owner insert purchases" ON public."purchases" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner() AND (created_by = auth.uid())));
CREATE POLICY "Authenticated insert inventory transactions" ON public."inventory_transactions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((created_by = auth.uid()) AND (updated_by = auth.uid())));
CREATE POLICY "Owner update inventory transactions" ON public."inventory_transactions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK ((is_owner() AND (updated_by = auth.uid())));
CREATE POLICY "Read inventory transactions" ON public."inventory_transactions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_owner() OR (is_deleted = false)));
CREATE POLICY "Owner read expenses" ON public."expenses" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_owner());
CREATE POLICY "Owner insert expenses" ON public."expenses" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner() AND (created_by = auth.uid())));
CREATE POLICY "Owner update expenses" ON public."expenses" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK ((is_owner() AND (updated_by = auth.uid())));
CREATE POLICY "Owner can read settings" ON public."application_settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_owner());
CREATE POLICY "Owner can read all categories" ON public."categories" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_owner());
CREATE POLICY "Owner can read all products" ON public."products" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_owner());
CREATE POLICY "Owner can update ingredients" ON public."ingredients" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK ((is_owner() AND (updated_by = auth.uid())));
CREATE POLICY "Owner can update recipes" ON public."recipes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK ((is_owner() AND (updated_by = auth.uid())));
CREATE POLICY "Owner can update recipe items" ON public."recipe_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK ((is_owner() AND (updated_by = auth.uid())));
CREATE POLICY "Owner can update incomes" ON public."incomes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK ((is_owner() AND (updated_by = auth.uid())));
CREATE POLICY "Owner update purchases" ON public."purchases" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK ((is_owner() AND (updated_by = auth.uid())));
CREATE POLICY "Owner can read all profiles" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_owner());
CREATE POLICY "Owner can update all profiles" ON public."profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK ((role = ANY (ARRAY['owner'::user_role, 'baker'::user_role, 'helper'::user_role])));
CREATE POLICY "Owner and Baker can read ingredients" ON public."ingredients" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_owner_or_baker() AND (is_deleted = false)));
CREATE POLICY "Owner can read all recipe items" ON public."recipe_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_owner());
CREATE POLICY "Owner can update maintenance purchases" ON public."maintenance_purchases" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY "Baker can read maintenance items" ON public."maintenance_items" AS PERMISSIVE FOR SELECT TO "public" USING ((is_baker() AND (is_deleted = false)));
CREATE POLICY "Helper can read ingredient names" ON public."ingredients" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((is_deleted = false) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['owner'::user_role, 'baker'::user_role, 'helper'::user_role])) AND (p.is_active = true))))));
CREATE POLICY "Helper can read recipe names" ON public."recipes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((is_deleted = false) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['owner'::user_role, 'baker'::user_role, 'helper'::user_role])) AND (p.is_active = true))))));
CREATE POLICY "Operational users can read production batch splits" ON public."production_batch_splits" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_owner_baker_or_helper() AND (is_deleted = false)));
CREATE POLICY "Operational users can read product stock movements" ON public."product_stock_movements" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_owner_baker_or_helper() AND (is_deleted = false)));
CREATE POLICY "Owner can read maintenance items" ON public."maintenance_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_owner() AND (is_deleted = false)));
CREATE POLICY "Owner can create maintenance items" ON public."maintenance_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner() AND (created_by = auth.uid())));
CREATE POLICY "Owner can update maintenance items" ON public."maintenance_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_owner()) WITH CHECK (is_owner());
CREATE POLICY "Owner can read maintenance purchases" ON public."maintenance_purchases" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_owner() AND (is_deleted = false)));
CREATE POLICY "Owner can create maintenance purchases" ON public."maintenance_purchases" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((is_owner() AND (created_by = auth.uid())));
CREATE POLICY "Baker can create maintenance items" ON public."maintenance_items" AS PERMISSIVE FOR INSERT TO "public" WITH CHECK ((is_baker() AND (created_by = auth.uid())));
CREATE POLICY "Baker can update maintenance items" ON public."maintenance_items" AS PERMISSIVE FOR UPDATE TO "public" USING (is_baker()) WITH CHECK ((is_baker() AND (updated_by = auth.uid())));
CREATE POLICY "Baker can read purchases" ON public."purchases" AS PERMISSIVE FOR SELECT TO "public" USING ((is_baker() AND (is_deleted = false)));
CREATE POLICY "Baker can create purchases" ON public."purchases" AS PERMISSIVE FOR INSERT TO "public" WITH CHECK ((is_baker() AND (created_by = auth.uid())));
CREATE POLICY "Baker can update purchases" ON public."purchases" AS PERMISSIVE FOR UPDATE TO "public" USING (is_baker()) WITH CHECK ((is_baker() AND (updated_by = auth.uid())));
CREATE POLICY "Baker can update purchase inventory transactions" ON public."inventory_transactions" AS PERMISSIVE FOR UPDATE TO "public" USING ((is_baker() AND (transaction_type = 'PURCHASE'::text) AND (purchase_id IS NOT NULL))) WITH CHECK ((is_baker() AND (updated_by = auth.uid())));
CREATE POLICY "Baker can read purchase expenses" ON public."expenses" AS PERMISSIVE FOR SELECT TO "public" USING ((is_baker() AND (purchase_id IS NOT NULL) AND (is_deleted = false)));
CREATE POLICY "Baker can create purchase expenses" ON public."expenses" AS PERMISSIVE FOR INSERT TO "public" WITH CHECK ((is_baker() AND (purchase_id IS NOT NULL) AND (created_by = auth.uid())));
CREATE POLICY "Baker can update purchase expenses" ON public."expenses" AS PERMISSIVE FOR UPDATE TO "public" USING ((is_baker() AND (purchase_id IS NOT NULL))) WITH CHECK ((is_baker() AND (purchase_id IS NOT NULL) AND (updated_by = auth.uid())));
CREATE POLICY "Authenticated users can view sales" ON public."sales" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_deleted = false));
CREATE POLICY "Owner can insert sales" ON public."sales" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'owner'::user_role)))));
CREATE POLICY "Owner can update sales" ON public."sales" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'owner'::user_role))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'owner'::user_role)))));
CREATE POLICY "Authenticated users can view sale items" ON public."sale_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM sales
  WHERE ((sales.id = sale_items.sale_id) AND (sales.is_deleted = false)))));
CREATE POLICY "Owner can insert sale items" ON public."sale_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'owner'::user_role)))));
CREATE POLICY "Owner can update sale items" ON public."sale_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'owner'::user_role))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'owner'::user_role)))));
CREATE POLICY "Owner can delete sale items" ON public."sale_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'owner'::user_role)))));
CREATE POLICY "Authenticated users can read finished product balances" ON public."finished_product_stock_balances" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
GRANT INSERT ON TABLE public."profiles" TO "anon";
GRANT SELECT ON TABLE public."profiles" TO "anon";
GRANT UPDATE ON TABLE public."profiles" TO "anon";
GRANT DELETE ON TABLE public."profiles" TO "anon";
GRANT TRUNCATE ON TABLE public."profiles" TO "anon";
GRANT REFERENCES ON TABLE public."profiles" TO "anon";
GRANT TRIGGER ON TABLE public."profiles" TO "anon";
GRANT INSERT ON TABLE public."profiles" TO "authenticated";
GRANT SELECT ON TABLE public."profiles" TO "authenticated";
GRANT UPDATE ON TABLE public."profiles" TO "authenticated";
GRANT DELETE ON TABLE public."profiles" TO "authenticated";
GRANT TRUNCATE ON TABLE public."profiles" TO "authenticated";
GRANT REFERENCES ON TABLE public."profiles" TO "authenticated";
GRANT TRIGGER ON TABLE public."profiles" TO "authenticated";
GRANT INSERT ON TABLE public."profiles" TO "service_role";
GRANT SELECT ON TABLE public."profiles" TO "service_role";
GRANT UPDATE ON TABLE public."profiles" TO "service_role";
GRANT DELETE ON TABLE public."profiles" TO "service_role";
GRANT TRUNCATE ON TABLE public."profiles" TO "service_role";
GRANT REFERENCES ON TABLE public."profiles" TO "service_role";
GRANT TRIGGER ON TABLE public."profiles" TO "service_role";
GRANT INSERT ON TABLE public."categories" TO "anon";
GRANT SELECT ON TABLE public."categories" TO "anon";
GRANT UPDATE ON TABLE public."categories" TO "anon";
GRANT DELETE ON TABLE public."categories" TO "anon";
GRANT TRUNCATE ON TABLE public."categories" TO "anon";
GRANT REFERENCES ON TABLE public."categories" TO "anon";
GRANT TRIGGER ON TABLE public."categories" TO "anon";
GRANT INSERT ON TABLE public."categories" TO "authenticated";
GRANT SELECT ON TABLE public."categories" TO "authenticated";
GRANT UPDATE ON TABLE public."categories" TO "authenticated";
GRANT DELETE ON TABLE public."categories" TO "authenticated";
GRANT TRUNCATE ON TABLE public."categories" TO "authenticated";
GRANT REFERENCES ON TABLE public."categories" TO "authenticated";
GRANT TRIGGER ON TABLE public."categories" TO "authenticated";
GRANT INSERT ON TABLE public."categories" TO "service_role";
GRANT SELECT ON TABLE public."categories" TO "service_role";
GRANT UPDATE ON TABLE public."categories" TO "service_role";
GRANT DELETE ON TABLE public."categories" TO "service_role";
GRANT TRUNCATE ON TABLE public."categories" TO "service_role";
GRANT REFERENCES ON TABLE public."categories" TO "service_role";
GRANT TRIGGER ON TABLE public."categories" TO "service_role";
GRANT INSERT ON TABLE public."incomes" TO "anon";
GRANT SELECT ON TABLE public."incomes" TO "anon";
GRANT UPDATE ON TABLE public."incomes" TO "anon";
GRANT DELETE ON TABLE public."incomes" TO "anon";
GRANT TRUNCATE ON TABLE public."incomes" TO "anon";
GRANT REFERENCES ON TABLE public."incomes" TO "anon";
GRANT TRIGGER ON TABLE public."incomes" TO "anon";
GRANT INSERT ON TABLE public."incomes" TO "authenticated";
GRANT SELECT ON TABLE public."incomes" TO "authenticated";
GRANT UPDATE ON TABLE public."incomes" TO "authenticated";
GRANT DELETE ON TABLE public."incomes" TO "authenticated";
GRANT TRUNCATE ON TABLE public."incomes" TO "authenticated";
GRANT REFERENCES ON TABLE public."incomes" TO "authenticated";
GRANT TRIGGER ON TABLE public."incomes" TO "authenticated";
GRANT INSERT ON TABLE public."incomes" TO "service_role";
GRANT SELECT ON TABLE public."incomes" TO "service_role";
GRANT UPDATE ON TABLE public."incomes" TO "service_role";
GRANT DELETE ON TABLE public."incomes" TO "service_role";
GRANT TRUNCATE ON TABLE public."incomes" TO "service_role";
GRANT REFERENCES ON TABLE public."incomes" TO "service_role";
GRANT TRIGGER ON TABLE public."incomes" TO "service_role";
GRANT INSERT ON TABLE public."expenses" TO "anon";
GRANT SELECT ON TABLE public."expenses" TO "anon";
GRANT UPDATE ON TABLE public."expenses" TO "anon";
GRANT DELETE ON TABLE public."expenses" TO "anon";
GRANT TRUNCATE ON TABLE public."expenses" TO "anon";
GRANT REFERENCES ON TABLE public."expenses" TO "anon";
GRANT TRIGGER ON TABLE public."expenses" TO "anon";
GRANT INSERT ON TABLE public."expenses" TO "authenticated";
GRANT SELECT ON TABLE public."expenses" TO "authenticated";
GRANT UPDATE ON TABLE public."expenses" TO "authenticated";
GRANT DELETE ON TABLE public."expenses" TO "authenticated";
GRANT TRUNCATE ON TABLE public."expenses" TO "authenticated";
GRANT REFERENCES ON TABLE public."expenses" TO "authenticated";
GRANT TRIGGER ON TABLE public."expenses" TO "authenticated";
GRANT INSERT ON TABLE public."expenses" TO "service_role";
GRANT SELECT ON TABLE public."expenses" TO "service_role";
GRANT UPDATE ON TABLE public."expenses" TO "service_role";
GRANT DELETE ON TABLE public."expenses" TO "service_role";
GRANT TRUNCATE ON TABLE public."expenses" TO "service_role";
GRANT REFERENCES ON TABLE public."expenses" TO "service_role";
GRANT TRIGGER ON TABLE public."expenses" TO "service_role";
GRANT INSERT ON TABLE public."suppliers" TO "anon";
GRANT SELECT ON TABLE public."suppliers" TO "anon";
GRANT UPDATE ON TABLE public."suppliers" TO "anon";
GRANT DELETE ON TABLE public."suppliers" TO "anon";
GRANT TRUNCATE ON TABLE public."suppliers" TO "anon";
GRANT REFERENCES ON TABLE public."suppliers" TO "anon";
GRANT TRIGGER ON TABLE public."suppliers" TO "anon";
GRANT INSERT ON TABLE public."suppliers" TO "authenticated";
GRANT SELECT ON TABLE public."suppliers" TO "authenticated";
GRANT UPDATE ON TABLE public."suppliers" TO "authenticated";
GRANT DELETE ON TABLE public."suppliers" TO "authenticated";
GRANT TRUNCATE ON TABLE public."suppliers" TO "authenticated";
GRANT REFERENCES ON TABLE public."suppliers" TO "authenticated";
GRANT TRIGGER ON TABLE public."suppliers" TO "authenticated";
GRANT INSERT ON TABLE public."suppliers" TO "service_role";
GRANT SELECT ON TABLE public."suppliers" TO "service_role";
GRANT UPDATE ON TABLE public."suppliers" TO "service_role";
GRANT DELETE ON TABLE public."suppliers" TO "service_role";
GRANT TRUNCATE ON TABLE public."suppliers" TO "service_role";
GRANT REFERENCES ON TABLE public."suppliers" TO "service_role";
GRANT TRIGGER ON TABLE public."suppliers" TO "service_role";
GRANT INSERT ON TABLE public."products" TO "anon";
GRANT SELECT ON TABLE public."products" TO "anon";
GRANT UPDATE ON TABLE public."products" TO "anon";
GRANT DELETE ON TABLE public."products" TO "anon";
GRANT TRUNCATE ON TABLE public."products" TO "anon";
GRANT REFERENCES ON TABLE public."products" TO "anon";
GRANT TRIGGER ON TABLE public."products" TO "anon";
GRANT INSERT ON TABLE public."products" TO "authenticated";
GRANT SELECT ON TABLE public."products" TO "authenticated";
GRANT UPDATE ON TABLE public."products" TO "authenticated";
GRANT DELETE ON TABLE public."products" TO "authenticated";
GRANT TRUNCATE ON TABLE public."products" TO "authenticated";
GRANT REFERENCES ON TABLE public."products" TO "authenticated";
GRANT TRIGGER ON TABLE public."products" TO "authenticated";
GRANT INSERT ON TABLE public."products" TO "service_role";
GRANT SELECT ON TABLE public."products" TO "service_role";
GRANT UPDATE ON TABLE public."products" TO "service_role";
GRANT DELETE ON TABLE public."products" TO "service_role";
GRANT TRUNCATE ON TABLE public."products" TO "service_role";
GRANT REFERENCES ON TABLE public."products" TO "service_role";
GRANT TRIGGER ON TABLE public."products" TO "service_role";
GRANT INSERT ON TABLE public."ingredients" TO "anon";
GRANT SELECT ON TABLE public."ingredients" TO "anon";
GRANT UPDATE ON TABLE public."ingredients" TO "anon";
GRANT DELETE ON TABLE public."ingredients" TO "anon";
GRANT TRUNCATE ON TABLE public."ingredients" TO "anon";
GRANT REFERENCES ON TABLE public."ingredients" TO "anon";
GRANT TRIGGER ON TABLE public."ingredients" TO "anon";
GRANT INSERT ON TABLE public."ingredients" TO "authenticated";
GRANT SELECT ON TABLE public."ingredients" TO "authenticated";
GRANT UPDATE ON TABLE public."ingredients" TO "authenticated";
GRANT DELETE ON TABLE public."ingredients" TO "authenticated";
GRANT TRUNCATE ON TABLE public."ingredients" TO "authenticated";
GRANT REFERENCES ON TABLE public."ingredients" TO "authenticated";
GRANT TRIGGER ON TABLE public."ingredients" TO "authenticated";
GRANT INSERT ON TABLE public."ingredients" TO "service_role";
GRANT SELECT ON TABLE public."ingredients" TO "service_role";
GRANT UPDATE ON TABLE public."ingredients" TO "service_role";
GRANT DELETE ON TABLE public."ingredients" TO "service_role";
GRANT TRUNCATE ON TABLE public."ingredients" TO "service_role";
GRANT REFERENCES ON TABLE public."ingredients" TO "service_role";
GRANT TRIGGER ON TABLE public."ingredients" TO "service_role";
GRANT INSERT ON TABLE public."recipe_items" TO "anon";
GRANT SELECT ON TABLE public."recipe_items" TO "anon";
GRANT UPDATE ON TABLE public."recipe_items" TO "anon";
GRANT DELETE ON TABLE public."recipe_items" TO "anon";
GRANT TRUNCATE ON TABLE public."recipe_items" TO "anon";
GRANT REFERENCES ON TABLE public."recipe_items" TO "anon";
GRANT TRIGGER ON TABLE public."recipe_items" TO "anon";
GRANT INSERT ON TABLE public."recipe_items" TO "authenticated";
GRANT SELECT ON TABLE public."recipe_items" TO "authenticated";
GRANT UPDATE ON TABLE public."recipe_items" TO "authenticated";
GRANT DELETE ON TABLE public."recipe_items" TO "authenticated";
GRANT TRUNCATE ON TABLE public."recipe_items" TO "authenticated";
GRANT REFERENCES ON TABLE public."recipe_items" TO "authenticated";
GRANT TRIGGER ON TABLE public."recipe_items" TO "authenticated";
GRANT INSERT ON TABLE public."recipe_items" TO "service_role";
GRANT SELECT ON TABLE public."recipe_items" TO "service_role";
GRANT UPDATE ON TABLE public."recipe_items" TO "service_role";
GRANT DELETE ON TABLE public."recipe_items" TO "service_role";
GRANT TRUNCATE ON TABLE public."recipe_items" TO "service_role";
GRANT REFERENCES ON TABLE public."recipe_items" TO "service_role";
GRANT TRIGGER ON TABLE public."recipe_items" TO "service_role";
GRANT INSERT ON TABLE public."recipes" TO "anon";
GRANT SELECT ON TABLE public."recipes" TO "anon";
GRANT UPDATE ON TABLE public."recipes" TO "anon";
GRANT DELETE ON TABLE public."recipes" TO "anon";
GRANT TRUNCATE ON TABLE public."recipes" TO "anon";
GRANT REFERENCES ON TABLE public."recipes" TO "anon";
GRANT TRIGGER ON TABLE public."recipes" TO "anon";
GRANT INSERT ON TABLE public."recipes" TO "authenticated";
GRANT SELECT ON TABLE public."recipes" TO "authenticated";
GRANT UPDATE ON TABLE public."recipes" TO "authenticated";
GRANT DELETE ON TABLE public."recipes" TO "authenticated";
GRANT TRUNCATE ON TABLE public."recipes" TO "authenticated";
GRANT REFERENCES ON TABLE public."recipes" TO "authenticated";
GRANT TRIGGER ON TABLE public."recipes" TO "authenticated";
GRANT INSERT ON TABLE public."recipes" TO "service_role";
GRANT SELECT ON TABLE public."recipes" TO "service_role";
GRANT UPDATE ON TABLE public."recipes" TO "service_role";
GRANT DELETE ON TABLE public."recipes" TO "service_role";
GRANT TRUNCATE ON TABLE public."recipes" TO "service_role";
GRANT REFERENCES ON TABLE public."recipes" TO "service_role";
GRANT TRIGGER ON TABLE public."recipes" TO "service_role";
GRANT INSERT ON TABLE public."production_orders" TO "anon";
GRANT SELECT ON TABLE public."production_orders" TO "anon";
GRANT UPDATE ON TABLE public."production_orders" TO "anon";
GRANT DELETE ON TABLE public."production_orders" TO "anon";
GRANT TRUNCATE ON TABLE public."production_orders" TO "anon";
GRANT REFERENCES ON TABLE public."production_orders" TO "anon";
GRANT TRIGGER ON TABLE public."production_orders" TO "anon";
GRANT INSERT ON TABLE public."production_orders" TO "authenticated";
GRANT SELECT ON TABLE public."production_orders" TO "authenticated";
GRANT UPDATE ON TABLE public."production_orders" TO "authenticated";
GRANT DELETE ON TABLE public."production_orders" TO "authenticated";
GRANT TRUNCATE ON TABLE public."production_orders" TO "authenticated";
GRANT REFERENCES ON TABLE public."production_orders" TO "authenticated";
GRANT TRIGGER ON TABLE public."production_orders" TO "authenticated";
GRANT INSERT ON TABLE public."production_orders" TO "service_role";
GRANT SELECT ON TABLE public."production_orders" TO "service_role";
GRANT UPDATE ON TABLE public."production_orders" TO "service_role";
GRANT DELETE ON TABLE public."production_orders" TO "service_role";
GRANT TRUNCATE ON TABLE public."production_orders" TO "service_role";
GRANT REFERENCES ON TABLE public."production_orders" TO "service_role";
GRANT TRIGGER ON TABLE public."production_orders" TO "service_role";
GRANT INSERT ON TABLE public."maintenance_purchases" TO "anon";
GRANT SELECT ON TABLE public."maintenance_purchases" TO "anon";
GRANT UPDATE ON TABLE public."maintenance_purchases" TO "anon";
GRANT DELETE ON TABLE public."maintenance_purchases" TO "anon";
GRANT TRUNCATE ON TABLE public."maintenance_purchases" TO "anon";
GRANT REFERENCES ON TABLE public."maintenance_purchases" TO "anon";
GRANT TRIGGER ON TABLE public."maintenance_purchases" TO "anon";
GRANT INSERT ON TABLE public."maintenance_purchases" TO "authenticated";
GRANT SELECT ON TABLE public."maintenance_purchases" TO "authenticated";
GRANT UPDATE ON TABLE public."maintenance_purchases" TO "authenticated";
GRANT DELETE ON TABLE public."maintenance_purchases" TO "authenticated";
GRANT TRUNCATE ON TABLE public."maintenance_purchases" TO "authenticated";
GRANT REFERENCES ON TABLE public."maintenance_purchases" TO "authenticated";
GRANT TRIGGER ON TABLE public."maintenance_purchases" TO "authenticated";
GRANT INSERT ON TABLE public."maintenance_purchases" TO "service_role";
GRANT SELECT ON TABLE public."maintenance_purchases" TO "service_role";
GRANT UPDATE ON TABLE public."maintenance_purchases" TO "service_role";
GRANT DELETE ON TABLE public."maintenance_purchases" TO "service_role";
GRANT TRUNCATE ON TABLE public."maintenance_purchases" TO "service_role";
GRANT REFERENCES ON TABLE public."maintenance_purchases" TO "service_role";
GRANT TRIGGER ON TABLE public."maintenance_purchases" TO "service_role";
GRANT INSERT ON TABLE public."production_batches" TO "anon";
GRANT SELECT ON TABLE public."production_batches" TO "anon";
GRANT UPDATE ON TABLE public."production_batches" TO "anon";
GRANT DELETE ON TABLE public."production_batches" TO "anon";
GRANT TRUNCATE ON TABLE public."production_batches" TO "anon";
GRANT REFERENCES ON TABLE public."production_batches" TO "anon";
GRANT TRIGGER ON TABLE public."production_batches" TO "anon";
GRANT INSERT ON TABLE public."production_batches" TO "authenticated";
GRANT SELECT ON TABLE public."production_batches" TO "authenticated";
GRANT UPDATE ON TABLE public."production_batches" TO "authenticated";
GRANT DELETE ON TABLE public."production_batches" TO "authenticated";
GRANT TRUNCATE ON TABLE public."production_batches" TO "authenticated";
GRANT REFERENCES ON TABLE public."production_batches" TO "authenticated";
GRANT TRIGGER ON TABLE public."production_batches" TO "authenticated";
GRANT INSERT ON TABLE public."production_batches" TO "service_role";
GRANT SELECT ON TABLE public."production_batches" TO "service_role";
GRANT UPDATE ON TABLE public."production_batches" TO "service_role";
GRANT DELETE ON TABLE public."production_batches" TO "service_role";
GRANT TRUNCATE ON TABLE public."production_batches" TO "service_role";
GRANT REFERENCES ON TABLE public."production_batches" TO "service_role";
GRANT TRIGGER ON TABLE public."production_batches" TO "service_role";
GRANT INSERT ON TABLE public."maintenance_items" TO "anon";
GRANT SELECT ON TABLE public."maintenance_items" TO "anon";
GRANT UPDATE ON TABLE public."maintenance_items" TO "anon";
GRANT DELETE ON TABLE public."maintenance_items" TO "anon";
GRANT TRUNCATE ON TABLE public."maintenance_items" TO "anon";
GRANT REFERENCES ON TABLE public."maintenance_items" TO "anon";
GRANT TRIGGER ON TABLE public."maintenance_items" TO "anon";
GRANT INSERT ON TABLE public."maintenance_items" TO "authenticated";
GRANT SELECT ON TABLE public."maintenance_items" TO "authenticated";
GRANT UPDATE ON TABLE public."maintenance_items" TO "authenticated";
GRANT DELETE ON TABLE public."maintenance_items" TO "authenticated";
GRANT TRUNCATE ON TABLE public."maintenance_items" TO "authenticated";
GRANT REFERENCES ON TABLE public."maintenance_items" TO "authenticated";
GRANT TRIGGER ON TABLE public."maintenance_items" TO "authenticated";
GRANT INSERT ON TABLE public."maintenance_items" TO "service_role";
GRANT SELECT ON TABLE public."maintenance_items" TO "service_role";
GRANT UPDATE ON TABLE public."maintenance_items" TO "service_role";
GRANT DELETE ON TABLE public."maintenance_items" TO "service_role";
GRANT TRUNCATE ON TABLE public."maintenance_items" TO "service_role";
GRANT REFERENCES ON TABLE public."maintenance_items" TO "service_role";
GRANT TRIGGER ON TABLE public."maintenance_items" TO "service_role";
GRANT INSERT ON TABLE public."inventory_transactions" TO "anon";
GRANT SELECT ON TABLE public."inventory_transactions" TO "anon";
GRANT UPDATE ON TABLE public."inventory_transactions" TO "anon";
GRANT DELETE ON TABLE public."inventory_transactions" TO "anon";
GRANT TRUNCATE ON TABLE public."inventory_transactions" TO "anon";
GRANT REFERENCES ON TABLE public."inventory_transactions" TO "anon";
GRANT TRIGGER ON TABLE public."inventory_transactions" TO "anon";
GRANT INSERT ON TABLE public."inventory_transactions" TO "authenticated";
GRANT SELECT ON TABLE public."inventory_transactions" TO "authenticated";
GRANT UPDATE ON TABLE public."inventory_transactions" TO "authenticated";
GRANT DELETE ON TABLE public."inventory_transactions" TO "authenticated";
GRANT TRUNCATE ON TABLE public."inventory_transactions" TO "authenticated";
GRANT REFERENCES ON TABLE public."inventory_transactions" TO "authenticated";
GRANT TRIGGER ON TABLE public."inventory_transactions" TO "authenticated";
GRANT INSERT ON TABLE public."inventory_transactions" TO "service_role";
GRANT SELECT ON TABLE public."inventory_transactions" TO "service_role";
GRANT UPDATE ON TABLE public."inventory_transactions" TO "service_role";
GRANT DELETE ON TABLE public."inventory_transactions" TO "service_role";
GRANT TRUNCATE ON TABLE public."inventory_transactions" TO "service_role";
GRANT REFERENCES ON TABLE public."inventory_transactions" TO "service_role";
GRANT TRIGGER ON TABLE public."inventory_transactions" TO "service_role";
GRANT INSERT ON TABLE public."finished_product_stock_balances" TO "anon";
GRANT SELECT ON TABLE public."finished_product_stock_balances" TO "anon";
GRANT UPDATE ON TABLE public."finished_product_stock_balances" TO "anon";
GRANT DELETE ON TABLE public."finished_product_stock_balances" TO "anon";
GRANT TRUNCATE ON TABLE public."finished_product_stock_balances" TO "anon";
GRANT REFERENCES ON TABLE public."finished_product_stock_balances" TO "anon";
GRANT TRIGGER ON TABLE public."finished_product_stock_balances" TO "anon";
GRANT INSERT ON TABLE public."finished_product_stock_balances" TO "authenticated";
GRANT SELECT ON TABLE public."finished_product_stock_balances" TO "authenticated";
GRANT UPDATE ON TABLE public."finished_product_stock_balances" TO "authenticated";
GRANT DELETE ON TABLE public."finished_product_stock_balances" TO "authenticated";
GRANT TRUNCATE ON TABLE public."finished_product_stock_balances" TO "authenticated";
GRANT REFERENCES ON TABLE public."finished_product_stock_balances" TO "authenticated";
GRANT TRIGGER ON TABLE public."finished_product_stock_balances" TO "authenticated";
GRANT INSERT ON TABLE public."finished_product_stock_balances" TO "service_role";
GRANT SELECT ON TABLE public."finished_product_stock_balances" TO "service_role";
GRANT UPDATE ON TABLE public."finished_product_stock_balances" TO "service_role";
GRANT DELETE ON TABLE public."finished_product_stock_balances" TO "service_role";
GRANT TRUNCATE ON TABLE public."finished_product_stock_balances" TO "service_role";
GRANT REFERENCES ON TABLE public."finished_product_stock_balances" TO "service_role";
GRANT TRIGGER ON TABLE public."finished_product_stock_balances" TO "service_role";
GRANT INSERT ON TABLE public."purchases" TO "anon";
GRANT SELECT ON TABLE public."purchases" TO "anon";
GRANT UPDATE ON TABLE public."purchases" TO "anon";
GRANT DELETE ON TABLE public."purchases" TO "anon";
GRANT TRUNCATE ON TABLE public."purchases" TO "anon";
GRANT REFERENCES ON TABLE public."purchases" TO "anon";
GRANT TRIGGER ON TABLE public."purchases" TO "anon";
GRANT INSERT ON TABLE public."purchases" TO "authenticated";
GRANT SELECT ON TABLE public."purchases" TO "authenticated";
GRANT UPDATE ON TABLE public."purchases" TO "authenticated";
GRANT DELETE ON TABLE public."purchases" TO "authenticated";
GRANT TRUNCATE ON TABLE public."purchases" TO "authenticated";
GRANT REFERENCES ON TABLE public."purchases" TO "authenticated";
GRANT TRIGGER ON TABLE public."purchases" TO "authenticated";
GRANT INSERT ON TABLE public."purchases" TO "service_role";
GRANT SELECT ON TABLE public."purchases" TO "service_role";
GRANT UPDATE ON TABLE public."purchases" TO "service_role";
GRANT DELETE ON TABLE public."purchases" TO "service_role";
GRANT TRUNCATE ON TABLE public."purchases" TO "service_role";
GRANT REFERENCES ON TABLE public."purchases" TO "service_role";
GRANT TRIGGER ON TABLE public."purchases" TO "service_role";
GRANT INSERT ON TABLE public."sale_items" TO "anon";
GRANT SELECT ON TABLE public."sale_items" TO "anon";
GRANT UPDATE ON TABLE public."sale_items" TO "anon";
GRANT DELETE ON TABLE public."sale_items" TO "anon";
GRANT TRUNCATE ON TABLE public."sale_items" TO "anon";
GRANT REFERENCES ON TABLE public."sale_items" TO "anon";
GRANT TRIGGER ON TABLE public."sale_items" TO "anon";
GRANT INSERT ON TABLE public."sale_items" TO "authenticated";
GRANT SELECT ON TABLE public."sale_items" TO "authenticated";
GRANT UPDATE ON TABLE public."sale_items" TO "authenticated";
GRANT DELETE ON TABLE public."sale_items" TO "authenticated";
GRANT TRUNCATE ON TABLE public."sale_items" TO "authenticated";
GRANT REFERENCES ON TABLE public."sale_items" TO "authenticated";
GRANT TRIGGER ON TABLE public."sale_items" TO "authenticated";
GRANT INSERT ON TABLE public."sale_items" TO "service_role";
GRANT SELECT ON TABLE public."sale_items" TO "service_role";
GRANT UPDATE ON TABLE public."sale_items" TO "service_role";
GRANT DELETE ON TABLE public."sale_items" TO "service_role";
GRANT TRUNCATE ON TABLE public."sale_items" TO "service_role";
GRANT REFERENCES ON TABLE public."sale_items" TO "service_role";
GRANT TRIGGER ON TABLE public."sale_items" TO "service_role";
GRANT INSERT ON TABLE public."application_settings" TO "anon";
GRANT SELECT ON TABLE public."application_settings" TO "anon";
GRANT UPDATE ON TABLE public."application_settings" TO "anon";
GRANT DELETE ON TABLE public."application_settings" TO "anon";
GRANT TRUNCATE ON TABLE public."application_settings" TO "anon";
GRANT REFERENCES ON TABLE public."application_settings" TO "anon";
GRANT TRIGGER ON TABLE public."application_settings" TO "anon";
GRANT INSERT ON TABLE public."application_settings" TO "authenticated";
GRANT SELECT ON TABLE public."application_settings" TO "authenticated";
GRANT UPDATE ON TABLE public."application_settings" TO "authenticated";
GRANT DELETE ON TABLE public."application_settings" TO "authenticated";
GRANT TRUNCATE ON TABLE public."application_settings" TO "authenticated";
GRANT REFERENCES ON TABLE public."application_settings" TO "authenticated";
GRANT TRIGGER ON TABLE public."application_settings" TO "authenticated";
GRANT INSERT ON TABLE public."application_settings" TO "service_role";
GRANT SELECT ON TABLE public."application_settings" TO "service_role";
GRANT UPDATE ON TABLE public."application_settings" TO "service_role";
GRANT DELETE ON TABLE public."application_settings" TO "service_role";
GRANT TRUNCATE ON TABLE public."application_settings" TO "service_role";
GRANT REFERENCES ON TABLE public."application_settings" TO "service_role";
GRANT TRIGGER ON TABLE public."application_settings" TO "service_role";
GRANT INSERT ON TABLE public."production_batch_splits" TO "service_role";
GRANT SELECT ON TABLE public."production_batch_splits" TO "service_role";
GRANT UPDATE ON TABLE public."production_batch_splits" TO "service_role";
GRANT DELETE ON TABLE public."production_batch_splits" TO "service_role";
GRANT TRUNCATE ON TABLE public."production_batch_splits" TO "service_role";
GRANT REFERENCES ON TABLE public."production_batch_splits" TO "service_role";
GRANT TRIGGER ON TABLE public."production_batch_splits" TO "service_role";
GRANT SELECT ON TABLE public."production_batch_splits" TO "authenticated";
GRANT INSERT ON TABLE public."sales" TO "anon";
GRANT SELECT ON TABLE public."sales" TO "anon";
GRANT UPDATE ON TABLE public."sales" TO "anon";
GRANT DELETE ON TABLE public."sales" TO "anon";
GRANT TRUNCATE ON TABLE public."sales" TO "anon";
GRANT REFERENCES ON TABLE public."sales" TO "anon";
GRANT TRIGGER ON TABLE public."sales" TO "anon";
GRANT INSERT ON TABLE public."sales" TO "authenticated";
GRANT SELECT ON TABLE public."sales" TO "authenticated";
GRANT UPDATE ON TABLE public."sales" TO "authenticated";
GRANT DELETE ON TABLE public."sales" TO "authenticated";
GRANT TRUNCATE ON TABLE public."sales" TO "authenticated";
GRANT REFERENCES ON TABLE public."sales" TO "authenticated";
GRANT TRIGGER ON TABLE public."sales" TO "authenticated";
GRANT INSERT ON TABLE public."sales" TO "service_role";
GRANT SELECT ON TABLE public."sales" TO "service_role";
GRANT UPDATE ON TABLE public."sales" TO "service_role";
GRANT DELETE ON TABLE public."sales" TO "service_role";
GRANT TRUNCATE ON TABLE public."sales" TO "service_role";
GRANT REFERENCES ON TABLE public."sales" TO "service_role";
GRANT TRIGGER ON TABLE public."sales" TO "service_role";
GRANT INSERT ON TABLE public."product_stock_movements" TO "service_role";
GRANT SELECT ON TABLE public."product_stock_movements" TO "service_role";
GRANT UPDATE ON TABLE public."product_stock_movements" TO "service_role";
GRANT DELETE ON TABLE public."product_stock_movements" TO "service_role";
GRANT TRUNCATE ON TABLE public."product_stock_movements" TO "service_role";
GRANT REFERENCES ON TABLE public."product_stock_movements" TO "service_role";
GRANT TRIGGER ON TABLE public."product_stock_movements" TO "service_role";
GRANT SELECT ON TABLE public."product_stock_movements" TO "authenticated";
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO "postgres";
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO "anon";
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO "service_role";
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO "postgres";
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO "anon";
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO "service_role";
REVOKE ALL ON FUNCTION public.is_owner_or_baker() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_owner_or_baker() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner_or_baker() TO "postgres";
GRANT EXECUTE ON FUNCTION public.is_owner_or_baker() TO "anon";
GRANT EXECUTE ON FUNCTION public.is_owner_or_baker() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.is_owner_or_baker() TO "service_role";
REVOKE ALL ON FUNCTION public.is_owner_baker_or_helper() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_owner_baker_or_helper() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner_baker_or_helper() TO "postgres";
GRANT EXECUTE ON FUNCTION public.is_owner_baker_or_helper() TO "anon";
GRANT EXECUTE ON FUNCTION public.is_owner_baker_or_helper() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.is_owner_baker_or_helper() TO "service_role";
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_owner() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner() TO "postgres";
GRANT EXECUTE ON FUNCTION public.is_owner() TO "anon";
GRANT EXECUTE ON FUNCTION public.is_owner() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.is_owner() TO "service_role";
REVOKE ALL ON FUNCTION public.set_profiles_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_profiles_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profiles_updated_at() TO "postgres";
GRANT EXECUTE ON FUNCTION public.set_profiles_updated_at() TO "anon";
GRANT EXECUTE ON FUNCTION public.set_profiles_updated_at() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.set_profiles_updated_at() TO "service_role";
REVOKE ALL ON FUNCTION public.assert_frozen_flow_operator() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_frozen_flow_operator() TO "postgres";
GRANT EXECUTE ON FUNCTION public.assert_frozen_flow_operator() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.assert_frozen_flow_operator() TO "service_role";
REVOKE ALL ON FUNCTION public.record_shaping_split(bigint,bigint,integer,integer,integer,text,date,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_shaping_split(bigint,bigint,integer,integer,integer,text,date,uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION public.record_shaping_split(bigint,bigint,integer,integer,integer,text,date,uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.record_shaping_split(bigint,bigint,integer,integer,integer,text,date,uuid) TO "service_role";
REVOKE ALL ON FUNCTION public.release_frozen_stock(bigint,integer,date,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_frozen_stock(bigint,integer,date,uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION public.release_frozen_stock(bigint,integer,date,uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.release_frozen_stock(bigint,integer,date,uuid) TO "service_role";
REVOKE ALL ON FUNCTION public.record_baking_result(bigint,integer,integer,date,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_baking_result(bigint,integer,integer,date,uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION public.record_baking_result(bigint,integer,integer,date,uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.record_baking_result(bigint,integer,integer,date,uuid) TO "service_role";
REVOKE ALL ON FUNCTION public.record_non_purchase_stock(date,bigint,numeric,text,numeric,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_non_purchase_stock(date,bigint,numeric,text,numeric,text,text,text) TO "postgres";
GRANT EXECUTE ON FUNCTION public.record_non_purchase_stock(date,bigint,numeric,text,numeric,text,text,text) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.record_non_purchase_stock(date,bigint,numeric,text,numeric,text,text,text) TO "service_role";
REVOKE ALL ON FUNCTION public.set_automatic_split_lot_code() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_automatic_split_lot_code() TO "postgres";
GRANT EXECUTE ON FUNCTION public.set_automatic_split_lot_code() TO "service_role";
REVOKE ALL ON FUNCTION public.record_inventory_adjustment(date,bigint,text,numeric,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_inventory_adjustment(date,bigint,text,numeric,text,text,text,text) TO "postgres";
GRANT EXECUTE ON FUNCTION public.record_inventory_adjustment(date,bigint,text,numeric,text,text,text,text) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.record_inventory_adjustment(date,bigint,text,numeric,text,text,text,text) TO "service_role";
REVOKE ALL ON FUNCTION public.is_baker() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_baker() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_baker() TO "postgres";
GRANT EXECUTE ON FUNCTION public.is_baker() TO "anon";
GRANT EXECUTE ON FUNCTION public.is_baker() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.is_baker() TO "service_role";
REVOKE ALL ON FUNCTION public.set_sales_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_sales_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_sales_updated_at() TO "postgres";
GRANT EXECUTE ON FUNCTION public.set_sales_updated_at() TO "anon";
GRANT EXECUTE ON FUNCTION public.set_sales_updated_at() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.set_sales_updated_at() TO "service_role";
REVOKE ALL ON FUNCTION public.sync_recipe_output_ingredient() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_recipe_output_ingredient() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_recipe_output_ingredient() TO "postgres";
GRANT EXECUTE ON FUNCTION public.sync_recipe_output_ingredient() TO "anon";
GRANT EXECUTE ON FUNCTION public.sync_recipe_output_ingredient() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.sync_recipe_output_ingredient() TO "service_role";
REVOKE ALL ON FUNCTION public.sync_recipe_output_from_ingredient() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_recipe_output_from_ingredient() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_recipe_output_from_ingredient() TO "postgres";
GRANT EXECUTE ON FUNCTION public.sync_recipe_output_from_ingredient() TO "anon";
GRANT EXECUTE ON FUNCTION public.sync_recipe_output_from_ingredient() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.sync_recipe_output_from_ingredient() TO "service_role";
REVOKE ALL ON FUNCTION public.prevent_sub_recipe_finished_stock() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prevent_sub_recipe_finished_stock() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_sub_recipe_finished_stock() TO "postgres";
GRANT EXECUTE ON FUNCTION public.prevent_sub_recipe_finished_stock() TO "anon";
GRANT EXECUTE ON FUNCTION public.prevent_sub_recipe_finished_stock() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.prevent_sub_recipe_finished_stock() TO "service_role";
REVOKE ALL ON FUNCTION public.delete_sale_transaction(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_sale_transaction(bigint) TO "postgres";
GRANT EXECUTE ON FUNCTION public.delete_sale_transaction(bigint) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.delete_sale_transaction(bigint) TO "service_role";
REVOKE ALL ON FUNCTION public.get_finished_product_balances() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_finished_product_balances() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_finished_product_balances() TO "postgres";
GRANT EXECUTE ON FUNCTION public.get_finished_product_balances() TO "anon";
GRANT EXECUTE ON FUNCTION public.get_finished_product_balances() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.get_finished_product_balances() TO "service_role";
REVOKE ALL ON FUNCTION public.refresh_finished_product_stock_balance() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_finished_product_stock_balance() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_finished_product_stock_balance() TO "postgres";
GRANT EXECUTE ON FUNCTION public.refresh_finished_product_stock_balance() TO "anon";
GRANT EXECUTE ON FUNCTION public.refresh_finished_product_stock_balance() TO "authenticated";
GRANT EXECUTE ON FUNCTION public.refresh_finished_product_stock_balance() TO "service_role";
REVOKE ALL ON FUNCTION public.record_product_stock_adjustment(bigint,text,integer,date,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_product_stock_adjustment(bigint,text,integer,date,text,text,uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION public.record_product_stock_adjustment(bigint,text,integer,date,text,text,uuid) TO "anon";
GRANT EXECUTE ON FUNCTION public.record_product_stock_adjustment(bigint,text,integer,date,text,text,uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.record_product_stock_adjustment(bigint,text,integer,date,text,text,uuid) TO "service_role";
REVOKE ALL ON FUNCTION public.record_cafe_deposit(bigint,integer,date,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_cafe_deposit(bigint,integer,date,uuid,text) TO "postgres";
GRANT EXECUTE ON FUNCTION public.record_cafe_deposit(bigint,integer,date,uuid,text) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.record_cafe_deposit(bigint,integer,date,uuid,text) TO "service_role";
REVOKE ALL ON FUNCTION public.record_multi_product_release(date,text,text,jsonb,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_multi_product_release(date,text,text,jsonb,uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION public.record_multi_product_release(date,text,text,jsonb,uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.record_multi_product_release(date,text,text,jsonb,uuid) TO "service_role";
REVOKE ALL ON FUNCTION public.record_sale_transaction(date,text,text,jsonb,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_sale_transaction(date,text,text,jsonb,uuid) TO "postgres";
GRANT EXECUTE ON FUNCTION public.record_sale_transaction(date,text,text,jsonb,uuid) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.record_sale_transaction(date,text,text,jsonb,uuid) TO "service_role";
REVOKE ALL ON FUNCTION public.update_sale_transaction(bigint,date,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_sale_transaction(bigint,date,text,text,jsonb) TO "postgres";
GRANT EXECUTE ON FUNCTION public.update_sale_transaction(bigint,date,text,text,jsonb) TO "authenticated";
GRANT EXECUTE ON FUNCTION public.update_sale_transaction(bigint,date,text,text,jsonb) TO "service_role";
COMMIT;
