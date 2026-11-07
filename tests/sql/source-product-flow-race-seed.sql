-- DISPOSABLE CI ONLY. Synthetic known-value position for competing COGS tests.
DO $$ BEGIN IF current_database()<>'bunbun_product_flow_ci' OR EXISTS(SELECT 1 FROM bunbun_accounting.journals)
 THEN RAISE EXCEPTION 'Requires empty isolated product-flow CI database'; END IF; END $$;
INSERT INTO public.products(id,sku,nama) OVERRIDING SYSTEM VALUE VALUES(925001,'LOCAL-FLOW-RACE','Synthetic product');
INSERT INTO public.recipes(id,kode,nama,yield_qty,product_id) OVERRIDING SYSTEM VALUE VALUES(925001,'LOCAL-FLOW-RACE','Synthetic recipe',10,925001);
INSERT INTO public.production_orders(id,kode,tanggal,recipe_id,target_produksi) OVERRIDING SYSTEM VALUE VALUES(925001,'LOCAL-FLOW-RACE','2026-11-01',925001,10);
INSERT INTO public.production_batches(id,kode,production_order_id,target,status,inventory_consumed,created_at) OVERRIDING SYSTEM VALUE
 VALUES(925001,'LOCAL-FLOW-RACE',925001,10,'Finished',true,'2026-11-01');
INSERT INTO public.production_batch_splits(id,production_batch_id,product_id,route,qty,status,baked_good_qty) OVERRIDING SYSTEM VALUE
 VALUES(925001,925001,925001,'DIRECT',10,'BAKED',10);
INSERT INTO public.sales(id,sale_date,sales_channel,total_amount) VALUES(925001,'2026-11-04','DIRECT',140),(925002,'2026-11-04','DIRECT',140);
INSERT INTO public.sale_items(sale_id,product_id,product_name,quantity,selling_price,subtotal,order_type)
 VALUES(925001,925001,'Synthetic product',7,20,140,'TAKE_AWAY'),(925002,925001,'Synthetic product',7,20,140,'TAKE_AWAY');
INSERT INTO public.product_stock_movements(id,movement_date,movement_type,product_id,batch_split_id,qty,operation_key,sale_id) OVERRIDING SYSTEM VALUE
 VALUES(925001,'2026-11-01','FINISHED_IN',925001,925001,10,gen_random_uuid(),null),
 (925002,'2026-11-04','CAFE_OUT',925001,null,7,gen_random_uuid(),925001),(925003,'2026-11-04','CAFE_OUT',925001,null,7,gen_random_uuid(),925002);
INSERT INTO bunbun_accounting.periods(id,month_start,cutover_on,status,approved_by,approved_at)
 VALUES('92500000-0000-4000-8000-000000000001','2026-11-01','2026-11-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET ROLE service_role;
DO $$ DECLARE actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; j uuid:=gen_random_uuid(); n bigint; s jsonb; BEGIN
 INSERT INTO bunbun_accounting.opening_snapshots(period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at)
 VALUES('92500000-0000-4000-8000-000000000001','2026-11-01','{"test_only":true}','LOCAL-FLOW-RACE-OPENING','APPROVED',actor,now());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(j,'92500000-0000-4000-8000-000000000001','2026-11-01','OPENING','LOCAL-FLOW-RACE-OPENING',gen_random_uuid());
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
 VALUES(j,1,'1220',100,0),(j,2,'1020',1000,0),(j,3,'3000',0,1100);
 PERFORM bunbun_accounting.post_reviewed_journal(j,actor);
 -- Seed a trusted known position only; the complete source-backed valuation
 -- pipeline is covered independently by cloud-product-cost-flow-rollback.sql.
 INSERT INTO bunbun_accounting.production_completions(batch_id,completion_date,material_cost,labor_cost,overhead_cost,reject_cost,total_cost,loss_policy,journal_id,source_snapshot,evidence_ref,actor_id)
 VALUES(925001,'2026-11-01',100,0,0,0,100,'ABSORB_NORMAL_LOSS',j,'SYNTHETIC-POSITION-ONLY','LOCAL-FLOW-RACE-POSITION',actor);
 INSERT INTO bunbun_accounting.production_lot_values(split_id,batch_id,product_id,source_movement_id,initial_location,quantity,actual_value)
 VALUES(925001,925001,925001,925001,'FINISHED',10,100);
 FOREACH n IN ARRAY ARRAY[925001,925002]::bigint[] LOOP
   s:=public.accounting_revenue_service('review_sale',jsonb_build_object('saleId',n::text),actor);
   PERFORM public.accounting_revenue_service('post_sale',jsonb_build_object('saleId',n::text,'sourceSnapshot',s->>'sourceSnapshot','netEntitlement','140',
     'recordedBasis','NET_BUNBUN','soldConfirmed',true,'evidenceRef','LOCAL-FLOW-RACE-SOLD','operationKey',gen_random_uuid()),actor);
 END LOOP;
END $$;
RESET ROLE;
