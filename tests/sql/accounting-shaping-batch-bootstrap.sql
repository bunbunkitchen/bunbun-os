-- SYNTHETIC PRODUCTION PARENT FIXTURE FOR SHAPING/BATCH CI ONLY.
-- Mirrors fields relevant to the existing Bunbun production RPC without
-- copying any real customer, sale, or ingredient data.
create table public.recipes (
 id bigint primary key,
 product_id bigint references public.products(id),
 is_deleted boolean not null default false
);
create table public.production_orders (
 id bigint primary key,
 recipe_id bigint not null references public.recipes(id),
 is_deleted boolean not null default false
);
create table public.production_batches (
 id bigint primary key,
 production_order_id bigint not null references public.production_orders(id),
 target numeric not null,
 selesai numeric not null default 0,
 reject numeric not null default 0,
 status text not null,
 inventory_consumed boolean not null default true,
 is_deleted boolean not null default false,
 updated_by uuid references auth.users(id)
);
grant select on public.recipes,public.production_orders to service_role;
grant select,update on public.production_batches to service_role;

insert into public.recipes(id,product_id) values (501,1),(502,2);
insert into public.production_orders(id,recipe_id) values (601,501),(602,502);
insert into public.production_batches
 (id,production_order_id,target,status,inventory_consumed) values
 (70,601,10,'Shaping',true),
 (71,601,4,'Shaping',true),
 (72,602,3,'Shaping',true),
 (73,601,4,'Shaping',true),
 (74,602,3,'Shaping',false),
 (75,602,3,'Shaping',true),
 (76,601,4,'Shaping',true),
 (77,601,5,'Shaping',true),
 (78,601,2,'Shaping',true),
 (79,601,2,'Shaping',true);

-- The original synthetic frozen/baking fixture includes historical splits
-- on parent ID 10 and 11. This test deliberately uses new 70+ parent IDs.
