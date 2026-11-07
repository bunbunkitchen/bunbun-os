-- EPHEMERAL POSTGRES CI BOOTSTRAP — NOT A SUPABASE MIGRATION.
-- Run AFTER tests/sql/accounting-staging-bootstrap.sql in a brand new DB.
create table public.products (
  id bigint primary key,
  nama text not null,
  is_active boolean not null default true,
  is_deleted boolean not null default false
);

create table public.production_batch_splits (
  id bigint primary key,
  product_id bigint not null references public.products(id),
  source_split_id bigint references public.production_batch_splits(id),
  route text not null,
  is_deleted boolean not null default false
);

create table public.product_stock_movements (
  id bigint generated always as identity primary key,
  movement_date date not null,
  movement_type text not null check (movement_type in
    ('FINISHED_IN','FROZEN_IN','FROZEN_OUT',
     'CAFE_OUT','CAFE_IN','OPENING_BALANCE')),
  product_id bigint not null references public.products(id),
  qty integer not null check (qty > 0),
  unit text not null default 'pcs',
  operation_key uuid,
  sale_id bigint,
  notes text,
  is_deleted boolean not null default false,
  created_by uuid,
  updated_by uuid
);

grant select,update on public.products to service_role;
grant select on public.production_batch_splits to service_role;
grant select,insert on public.product_stock_movements to service_role;
grant usage,select on all sequences in schema public to service_role;

insert into public.products(id,nama) values
  (1,'Original Salt Bread'),
  (2,'Smoked Beef & Cheese Salt Bread');

insert into public.production_batch_splits
 (id,product_id,source_split_id,route)
values
  (101,1,null,'DIRECT'),
  (200,1,null,'FROZEN'),
  (102,1,200,'DIRECT'),
  (103,2,null,'DIRECT');

insert into public.product_stock_movements
 (movement_date,movement_type,product_id,qty,unit)
values
 ('2026-11-03','FINISHED_IN',1,6,'pcs'),
 ('2026-11-05','FINISHED_IN',1,4,'pcs'),
 ('2026-11-04','FINISHED_IN',2,7,'pcs');
