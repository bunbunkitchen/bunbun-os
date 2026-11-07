-- EPHEMERAL UNIFIED CI: sales schema only; existing frozen/baking fixture
-- already seeded finished lots, so never insert them twice.
-- EPHEMERAL PostgreSQL 16 ONLY: model sales and sale_items as observed in
-- live schema, but with synthetic IDs/products. No Bunbun production changes.
alter table public.products add column sku text not null default 'SKU-DEMO';
update public.products set sku=case when id=1 then 'SB-ORI' else 'SB-SBC' end;

create table public.sales (
  id bigint generated always as identity primary key,
  sale_date date not null,
  sales_channel text not null,
  total_amount numeric(18,2) not null default 0,
  notes text,
  is_deleted boolean not null default false,
  operation_key uuid unique,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create table public.sale_items (
  id bigint generated always as identity primary key,
  sale_id bigint not null references public.sales(id) on delete restrict,
  product_id bigint not null references public.products(id),
  product_sku text,
  product_name text not null,
  quantity numeric not null,
  selling_price numeric(18,2) not null,
  subtotal numeric(18,2) not null,
  order_type text
);

grant select,insert,update on public.sales to service_role;
grant select,insert on public.sale_items to service_role;
grant usage,select on all sequences in schema public to service_role;

alter table public.product_stock_movements
  add constraint product_stock_sale_source_fk foreign key(sale_id)
    references public.sales(id) on delete restrict;

