-- DISPOSABLE CI DATABASE ONLY, seeded after rollback suites.
DO $$ BEGIN IF current_database()<>'bunbun_material_ci' OR EXISTS(SELECT 1 FROM bunbun_accounting.journals)
 THEN RAISE EXCEPTION 'Requires isolated empty material CI database'; END IF; END $$;
INSERT INTO public.recipes(id,kode,nama,yield_qty) OVERRIDING SYSTEM VALUE VALUES(909001,'RACE-MATERIAL','Synthetic recipe',1);
INSERT INTO public.production_orders(id,kode,tanggal,recipe_id,target_produksi) OVERRIDING SYSTEM VALUE VALUES(909001,'RACE-MATERIAL','2026-11-01',909001,2);
INSERT INTO public.production_batches(id,kode,production_order_id,target,status,inventory_consumed,created_at) OVERRIDING SYSTEM VALUE
 VALUES(909001,'RACE-MATERIAL-1',909001,1,'Finished',true,'2026-11-01'),(909002,'RACE-MATERIAL-2',909001,1,'Finished',true,'2026-11-01');
INSERT INTO public.inventory_transactions(id,transaction_date,transaction_type,ingredient_id,production_batch_id,qty,unit)
 OVERRIDING SYSTEM VALUE SELECT 909001,'2026-11-02','PRODUCTION_OUT',min(id),909001,2,'g' FROM public.ingredients;
INSERT INTO public.inventory_transactions(id,transaction_date,transaction_type,ingredient_id,production_batch_id,qty,unit)
 OVERRIDING SYSTEM VALUE SELECT 909002,'2026-11-02','PRODUCTION_OUT',min(id),909002,2,'g' FROM public.ingredients;
INSERT INTO bunbun_accounting.periods(id,month_start,cutover_on,status,approved_by,approved_at)
 VALUES('90900000-0000-4000-8000-000000000001','2026-11-01','2026-11-01','OPEN','2375b60c-c418-47c2-b157-af80b262fadf',now());
SET ROLE service_role;
DO $$ DECLARE actor uuid:='2375b60c-c418-47c2-b157-af80b262fadf'; op uuid:=gen_random_uuid(); BEGIN
 INSERT INTO bunbun_accounting.opening_snapshots(period_id,cutover_on,opening_payload,evidence_summary,status,approved_by,approved_at)
 VALUES('90900000-0000-4000-8000-000000000001','2026-11-01','{"test_only":true}','LOCAL-CI-MATERIAL-OPENING','APPROVED',actor,now());
 INSERT INTO bunbun_accounting.journals(id,period_id,posting_date,source_type,source_key,operation_key)
 VALUES(op,'90900000-0000-4000-8000-000000000001','2026-11-01','OPENING','LOCAL-CI-MATERIAL-OPENING',gen_random_uuid());
 INSERT INTO bunbun_accounting.journal_lines(journal_id,line_number,account_code,debit,credit)
 VALUES(op,1,'1210',1,0),(op,2,'3000',0,1);
 INSERT INTO bunbun_accounting.stock_cost_movements(journal_id,source_key,ingredient_id,valuation_class,quantity_base,value_delta,base_unit)
 SELECT op,'LOCAL-CI-MATERIAL-OPENING',min(id),'RAW',3,1,'g' FROM public.ingredients;
 PERFORM bunbun_accounting.post_reviewed_journal(op,actor);
END $$;
RESET ROLE;
